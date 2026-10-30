import { prisma } from '../../config/database.js';
import { realtimeService } from '../../services/realtimeService.js';
import { WhatsAppMessagingService } from '../whatsapp/WhatsAppMessagingService.js';
import { createMetaClient } from '../whatsapp/MetaClient.js';
import { createMaintenanceOperations } from './maintenanceOperations.js';

const messaging = new WhatsAppMessagingService({ db: prisma, request: createMetaClient() });
export const maintenanceOperations = createMaintenanceOperations({ db: prisma,
  send: options => messaging.send(options), broadcast: (...args) => realtimeService.broadcastToHotel(...args) });
