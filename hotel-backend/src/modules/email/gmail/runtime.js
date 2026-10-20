import { prisma } from '../../../config/database.js';
import { config } from '../../../config/env.js';
import { gmailClient } from '../gmailClient.js';
import { processGuestMessageAI } from '../../conversations/aiService.js';
import { realtimeService } from '../../../services/realtimeService.js';
import { GoogleWorkspaceEmailAdapter } from './GoogleWorkspaceEmailAdapter.js';
import { GoogleOidcVerifier } from './GoogleOidcVerifier.js';
import { GmailPollingService } from './GmailPollingService.js';
import { GmailWatchService } from './GmailWatchService.js';
import { GmailInboundProcessor } from './GmailInboundProcessor.js';
import { GmailPubSubService } from './GmailPubSubService.js';
import { createMailboxLock } from './MailboxLock.js';

export const withGmailMailboxLock = createMailboxLock(prisma, { schema: new URL(config.databaseUrl).searchParams.get('schema') || 'public' });
const adapterFactory = integration => new GoogleWorkspaceEmailAdapter(integration, { getToken: (hotelId, options) => gmailClient.getValidAccessTokenForHotel(hotelId, options) });
export const gmailInboundProcessor = new GmailInboundProcessor({ db: prisma,
  automate: processGuestMessageAI, send: options => gmailClient.sendGuestGmail(options),
  findSent: (integration, messageId) => adapterFactory(integration).findSentMessage(messageId),
  broadcast: (...args) => realtimeService.broadcastToHotel(...args),
});
export const gmailPollingService = new GmailPollingService({ db: prisma, adapterFactory, processor: gmailInboundProcessor, withMailboxLock: withGmailMailboxLock });
export const gmailWatchService = new GmailWatchService({ db: prisma, adapterFactory, withMailboxLock: withGmailMailboxLock, topic: config.googlePubSub.topic });
export const gmailPubSubService = new GmailPubSubService({ db: prisma, polling: gmailPollingService, subscription: config.googlePubSub.subscription });
export const googleOidcVerifier = new GoogleOidcVerifier();
