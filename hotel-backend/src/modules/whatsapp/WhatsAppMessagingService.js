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
    const replies = buttons.map((button, i) => typeof button === 'string' ? { id: `action_${i}`, title: button.slice(0, 20) } : button);
    if (replies.length > 3 || replies.some(b => !b || typeof b.id !== 'string' || !b.id || b.id.length > 256 || typeof b.title !== 'string' || !b.title || b.title.length > 20) || new Set(replies.map(b => b.id)).size !== replies.length) return { success: false, error: 'Invalid WhatsApp reply buttons' };
    const payload = { messaging_product: 'whatsapp', to: recipient, type: template ? 'template' : buttons.length ? 'interactive' : 'text',
      ...(template ? { template } : replies.length ? { interactive: { type: 'button', body: { text }, action: { buttons: replies.map(reply => ({ type: 'reply', reply })) } } } : { text: { body: text, preview_url: false } }) };
    try {
      const result = await this.request(`${integration.phoneNumberId}/messages`, token, { method: 'POST', body: payload });
      if (!result.messages?.[0]?.id) return { success: false, uncertain: true, error: 'Meta did not return a message ID; check delivery before retrying' };
      await this.db.whatsAppIntegration.update({ where: { id: integration.id }, data: { lastOutboundAt: new Date(), lastDeliveryStatus: 'accepted' } });
      return { success: true, messageId: result.messages[0].id, status: 'accepted' };
    } catch (error) { return { success: false, uncertain: error.uncertain ?? true, error: error.message }; }
  }
}
