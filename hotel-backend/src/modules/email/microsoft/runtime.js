import { prisma } from '../../../config/database.js';
import { config } from '../../../config/env.js';
import { microsoftClient } from '../microsoftClient.js';
import { withGmailMailboxLock } from '../gmail/runtime.js';
import { processGuestMessageAI } from '../../conversations/aiService.js';
import { realtimeService } from '../../../services/realtimeService.js';
import { MicrosoftGraphEmailAdapter } from './MicrosoftGraphEmailAdapter.js';
import { MicrosoftInboundProcessor } from './MicrosoftInboundProcessor.js';
import { MicrosoftPollingService } from './MicrosoftPollingService.js';
import { MicrosoftGraphSubscriptionService } from './MicrosoftGraphSubscriptionService.js';
import { MicrosoftGraphWebhookService, createMicrosoftPushHandler } from './MicrosoftGraphWebhookService.js';
import { MicrosoftWorkerService } from './MicrosoftWorkerService.js';
import { createTaskDispatcher } from './CloudTaskDispatcher.js';

// Share the hotel-level lease with Gmail OAuth/disconnect to serialize provider changes.
export const withMicrosoftMailboxLock = withGmailMailboxLock;
export const adapterFactory = integration => new MicrosoftGraphEmailAdapter(integration, { getToken: id => microsoftClient.getValidAccessTokenForHotel(id) });
export const microsoftInboundProcessor = new MicrosoftInboundProcessor({ db: prisma, automate: processGuestMessageAI,
  send: options => microsoftClient.sendGuestMicrosoftMail(options), broadcast: (...args) => realtimeService.broadcastToHotel(...args) });
export const microsoftPollingService = new MicrosoftPollingService({ db: prisma, adapterFactory, processor: microsoftInboundProcessor, withMailboxLock: withMicrosoftMailboxLock });
export const microsoftSubscriptions = new MicrosoftGraphSubscriptionService({ db: prisma, adapterFactory, withMailboxLock: withMicrosoftMailboxLock,
  notificationUrl: config.microsoftGraph.notificationUrl });
export const microsoftWorker = new MicrosoftWorkerService({ db: prisma, polling: microsoftPollingService, subscriptions: microsoftSubscriptions });
const dispatcher = createTaskDispatcher({ queue: config.microsoftGraph.taskQueue, url: `${config.backendBaseUrl}/api/workers/email/microsoft-process`,
  audience: config.microsoftGraph.workerAudience, serviceAccountEmail: config.microsoftGraph.workerServiceAccount });
export const microsoftWebhook = new MicrosoftGraphWebhookService({ db: prisma, enqueue: dispatcher });
export const microsoftPushHandler = createMicrosoftPushHandler(microsoftWebhook);
