import { prisma } from '../../config/database.js';
import { createMetaClient } from './MetaClient.js';
import { WhatsAppConnectionService } from './WhatsAppConnectionService.js';
export const whatsappConnections = new WhatsAppConnectionService({ db: prisma, request: createMetaClient() });
export const exchangeMetaCodeForToken = options => whatsappConnections.connect(options);
export const connectManualWhatsAppCredentials = options => whatsappConnections.connect(options);
