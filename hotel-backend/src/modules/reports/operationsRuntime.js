import { prisma } from '../../config/database.js';
import { realtimeService } from '../../services/realtimeService.js';
import { WhatsAppMessagingService } from '../whatsapp/WhatsAppMessagingService.js';
import { createMetaClient } from '../whatsapp/MetaClient.js';
import { createHousekeepingOperations } from './housekeepingOperations.js';
const messaging = new WhatsAppMessagingService({ db: prisma, request: createMetaClient() });
export const housekeepingOperations = createHousekeepingOperations({ db: prisma,
  send: options => messaging.send(options), broadcast: (...args) => realtimeService.broadcastToHotel(...args) });
