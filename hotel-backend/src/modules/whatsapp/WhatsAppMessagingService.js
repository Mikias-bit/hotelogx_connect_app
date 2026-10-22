import { decryptToken } from '../../utils/tokenCrypto.js';
import { verifiedConnection } from './MetaClient.js';
export class WhatsAppMessagingService {
  constructor({ db, request }) { Object.assign(this, { db, request }); }
  async send({ hotelId, targetType = 'guest', to, text, buttons = [], template }) {
    const recipient = String(to || '').replace(/[+\s()-]/g, '');
    if (!hotelId || !/^\d{8,15}$/.test(recipient) || (!template && !text?.trim())) return { success: false, error: 'Hotel, valid international recipient, and message are required' };
    const integration = await this.db.whatsAppIntegration.findFirst({ where: { hotelId, targetType: { in: [targetType, 'both'] }, status: 'connected' } });
    if (!verifiedConnection(integration) || (integration.tokenExpiresAt && integration.tokenExpiresAt <= new Date())) return { success: false, error: 'Reconnect and verify this hotel WhatsApp account' };
    const token = decryptToken(integration.accessToken);
    if (!token) return { success: false, error: 'Cannot decrypt WhatsApp credentials' };
    const payload = { messaging_product: 'whatsapp', to: recipient, type: template ? 'template' : buttons.length ? 'interactive' : 'text',
      ...(template ? { template } : buttons.length ? { interactive: { type: 'button', body: { text }, action: { buttons: buttons.slice(0, 3).map((title, i) => ({ type: 'reply', reply: { id: `action_${i}`, title: String(title).slice(0, 20) } })) } } } : { text: { body: text, preview_url: false } }) };
    try {
      const result = await this.request(`${integration.phoneNumberId}/messages`, token, { method: 'POST', body: payload });
      if (!result.messages?.[0]?.id) return { success: false, uncertain: true, error: 'Meta did not return a message ID; check delivery before retrying' };
      await this.db.whatsAppIntegration.update({ where: { id: integration.id }, data: { lastOutboundAt: new Date(), lastDeliveryStatus: 'accepted' } });
      return { success: true, messageId: result.messages[0].id, status: 'accepted' };
    } catch (error) { return { success: false, uncertain: error.uncertain ?? true, error: error.message }; }
  }
}
