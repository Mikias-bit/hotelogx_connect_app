import { prisma } from '../../config/database.js';
import { createPmsMcpClient } from './pmsMcpClient.js';
import { checkinPmsReader } from './checkinPmsReader.js';
import { createContactRecognition } from './guestContactRecognition.js';
import { createGuestWelcome } from './guestWelcome.js';
import { emailService } from '../email/emailService.js';
import { WhatsAppMessagingService } from '../whatsapp/WhatsAppMessagingService.js';
import { createMetaClient } from '../whatsapp/MetaClient.js';
export const contactRecognitionFor = (db = prisma) => createContactRecognition({ db, readerFor: config => checkinPmsReader(db, config) });
export const guestWelcomeFor = (db = prisma) => createGuestWelcome({ db, client: createPmsMcpClient(), sendEmail: args => emailService.sendGuestEmail(args),
  sendWhatsApp: args => new WhatsAppMessagingService({ db, request: createMetaClient() }).send(args) });
