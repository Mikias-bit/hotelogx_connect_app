import { prisma } from '../../config/database.js';
import { createPmsMcpClient } from './pmsMcpClient.js';
import { createGuestMessaging } from './guestMessaging.js';
import { emailService } from '../email/emailService.js';
import { WhatsAppMessagingService } from '../whatsapp/WhatsAppMessagingService.js';
import { createMetaClient } from '../whatsapp/MetaClient.js';
export const guestMessagingFor = (db = prisma) => createGuestMessaging({ db, client: createPmsMcpClient(),
  sendEmail: args => emailService.sendGuestEmail(args),
  sendWhatsApp: args => new WhatsAppMessagingService({ db, request: createMetaClient() }).send(args) });
