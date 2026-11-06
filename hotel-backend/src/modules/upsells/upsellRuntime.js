import { prisma } from '../../config/database.js';
import { createPmsMcpClient } from '../pms/pmsMcpClient.js';
import { emailService } from '../email/emailService.js';
import { WhatsAppMessagingService } from '../whatsapp/WhatsAppMessagingService.js';
import { createMetaClient } from '../whatsapp/MetaClient.js';
import { realtimeService } from '../../services/realtimeService.js';
import { createUpsellDelivery } from './upsellDelivery.js';
import { createUpsellPmsTriggers } from './upsellPmsTriggers.js';
const messaging = new WhatsAppMessagingService({ db: prisma, request: createMetaClient() });
export const upsellDelivery = createUpsellDelivery({ db: prisma, client: createPmsMcpClient(), sendEmail: args => emailService.sendGuestEmail(args), sendWhatsApp: args => messaging.send(args), broadcast: (...args) => realtimeService.broadcastToHotel(...args) });
export const upsellPmsTriggers = createUpsellPmsTriggers({ db: prisma,
  sync: async hotelId => (await import('../pms/pmsService.js')).pmsService.syncPmsData(hotelId),
  run: hotelId => upsellDelivery.runHotel(hotelId),
  report: () => console.warn('[Upsell confirmation trigger] Check deferred to the scheduled worker'),
});
let running = false;
export async function runUpsellCampaigns() {
  if (running) return;
  running = true;
  try {
    for (const config of await prisma.upsellAutomationConfig.findMany({ where: { enabled: true } })) await upsellDelivery.runHotel(config.hotelId);
  } finally { running = false; }
}
