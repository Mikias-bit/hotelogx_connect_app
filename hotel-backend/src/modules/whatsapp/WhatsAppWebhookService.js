import { createHmac, timingSafeEqual } from 'node:crypto';
import { verifiedConnection } from './MetaClient.js';
export function verifyMetaSignature(rawBody, signature, secret) {
  if (!secret || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature) || (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}
export class WhatsAppWebhookService {
  constructor({ db, withLock, automate, send, broadcast }) { Object.assign(this, { db, withLock, automate, send, broadcast }); }
  async accept(body) {
    if (body?.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) throw Object.assign(new Error('Invalid Meta payload'), { status: 400 });
    for (const entry of body.entry) for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const integration = await this.db.whatsAppIntegration.findFirst({ where: { phoneNumberId, wabaId: entry.id, status: 'connected' } });
      if (!verifiedConnection(integration)) continue;
      await this.withLock(`whatsapp:${integration.hotelId}`, async assertOwned => {
        for (const status of value.statuses || []) { await assertOwned(); await this.delivery(integration, status); }
        for (const message of value.messages || []) {
          await assertOwned();
          await this.process(integration, message, value.contacts?.find(c => c.wa_id === message.from)?.profile?.name || 'WhatsApp guest', assertOwned);
        }
      });
    }
  }
  async delivery(integration, event) {
    if (!['sent', 'delivered', 'read', 'failed'].includes(event.status) || !event.id) return;
    const message = await this.db.message.findFirst({ where: { id: `m-wa-${event.id}`, conversation: { guest: { hotelId: integration.hotelId } } } });
    const ranks = { failed: 0, sent: 1, delivered: 2, read: 3 };
    if (message && (event.status === 'failed' ? !['delivered', 'read'].includes(message.deliveryStatus) : !(ranks[message.deliveryStatus] > ranks[event.status]))) {
      await this.db.message.update({ where: { id: message.id }, data: { deliveryStatus: event.status } });
    }
    await this.db.whatsAppIntegration.update({ where: { id: integration.id }, data: { lastDeliveryStatus: event.status } });
    this.broadcast(integration.hotelId, 'conversation:updated', { conversationId: message?.conversationId, channel: 'whatsapp', deliveryStatus: event.status });
  }
  async process(integration, message, name, assertOwned) {
    if (!message.id || !/^\d{8,15}$/.test(message.from || '')) throw new Error('Invalid Meta message');
    const id = `${integration.phoneNumberId}:${message.id}`;
    let receipt = await this.db.whatsAppReceipt.upsert({ where: { id }, create: { id, hotelId: integration.hotelId, phoneNumberId: integration.phoneNumberId, sender: message.from }, update: {} });
    if (['done', 'uncertain'].includes(receipt.status)) return;
    if (receipt.status === 'sending') {
      await this.db.whatsAppReceipt.update({ where: { id }, data: { status: 'uncertain', lastError: 'A previous send may have completed. Check delivery before retrying.' } });
      return;
    }
    const text = message.text?.body || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || message.button?.text || `[${message.type || 'unsupported'} message received]`;
    const hotelId = integration.hotelId;
    const at = new Date(Number(message.timestamp) * 1000 || Date.now()).toISOString();
    await this.db.whatsAppIntegration.update({ where: { id: integration.id }, data: { lastInboundAt: new Date() } });
    const staff = integration.targetType === 'guest' ? null : await this.db.user.findFirst({ where: { hotelId, whatsapp: true, phone: { in: [message.from, `+${message.from}`] } } });
    if (integration.targetType === 'internal' || staff) {
      const threadId = `wa-${hotelId}-${message.from}`;
      await this.db.waThread.upsert({ where: { id: threadId }, create: { id: threadId, hotelId, contact: staff?.name || name, phone: message.from,
        role: staff?.role || 'unverified', department: ({ housekeeping: 'Housekeeping', maintenance: 'Maintenance', 'front-office': 'Front Office', manager: 'Front Office' })[staff?.role] || 'Unverified sender' }, update: {} });
      await this.db.waMessage.upsert({ where: { id: `wa-in-${message.id}` }, create: { id: `wa-in-${message.id}`, hotelId, threadId, from: 'staff', body: text, at }, update: {} });
      await this.db.whatsAppReceipt.update({ where: { id }, data: { status: 'done' } });
      // Receiving a message does not authorize room/task mutations by an unknown sender.
      this.broadcast(hotelId, 'whatsapp:updated', { threadId });
      return;
    }
    const guestId = `g-wa-${hotelId}-${message.from}`;
    const convId = `conv-wa-${hotelId}-${message.from}`;
    // Never infer reservations, occupied rooms, or operational actions from an unverified sender.
    await this.db.guest.upsert({ where: { id: guestId }, create: { id: guestId, hotelId, name, country: '', language: 'en', vip: false, previousStays: 0, tags: JSON.stringify(['WhatsApp Contact', `+${message.from}`]) }, update: {} });
    let conversation = await this.db.conversation.upsert({ where: { id: convId }, create: { id: convId, guestId, stage: 'Pre-arrival', primaryChannel: 'whatsapp', aiStatus: integration.targetType === 'internal' ? 'human-takeover' : 'ai-handling', sentiment: 'neutral', subject: `WhatsApp: ${name}`, summary: text.slice(0, 200), suggestedReply: '', unread: 0, lastAt: at, aiHandledCount: 0 }, update: {} });
    const inboundId = `m-wa-${message.id}`;
    const exists = await this.db.message.findUnique({ where: { id: inboundId } });
    if (!exists) {
      await this.db.$transaction([
        this.db.message.create({ data: { id: inboundId, conversationId: convId, author: 'guest', channel: 'whatsapp', body: text, at } }),
        this.db.conversation.update({ where: { id: convId }, data: { unread: { increment: 1 }, lastAt: at } }),
      ]);
    }
    if (receipt.status === 'pending') {
      const hotel = await this.db.hotel.findUnique({ where: { id: hotelId } });
      const aiConfig = await this.db.aiConfig.findUnique({ where: { hotelId } });
      const canAutomate = integration.targetType !== 'internal' && conversation.aiStatus === 'ai-handling' && hotel?.aiMode === 'Autonomous' && aiConfig?.autoReply !== false && message.type === 'text';
      let result;
      if (canAutomate) {
        // A retry after an interrupted AI call must not run side effects a second time.
        await this.db.whatsAppReceipt.update({ where: { id }, data: { status: 'processing' } });
        result = await this.automate({ messageText: text, conversationId: convId, hotelId, channel: 'whatsapp', deferEmailDelivery: true });
      }
      await assertOwned();
      const reply = result?.replyText && !result.requiresApproval && !result.escalation ? result.replyText : null;
      receipt = await this.db.whatsAppReceipt.update({ where: { id }, data: { status: reply ? 'ready' : 'done', replyText: reply, replyMessageId: result?.message?.id || null } });
      await this.db.conversation.update({ where: { id: convId }, data: { suggestedReply: result?.replyText || '', ...(result?.aiStatus ? { aiStatus: result.aiStatus } : {}) } });
    } else if (receipt.status === 'processing') {
      await this.db.whatsAppReceipt.update({ where: { id }, data: { status: 'uncertain', lastError: 'AI processing interrupted; review conversation before replying' } });
      await this.db.conversation.update({ where: { id: convId }, data: { aiStatus: 'human-takeover' } });
      return;
    }
    if (receipt.status === 'ready') {
      await assertOwned();
      await this.db.whatsAppReceipt.update({ where: { id }, data: { status: 'sending' } });
      const result = await this.send({ hotelId, targetType: integration.targetType === 'internal' ? 'internal' : 'guest', to: message.from, text: receipt.replyText });
      if (!result.success) {
        await this.db.whatsAppReceipt.update({ where: { id }, data: { status: result.uncertain ? 'uncertain' : 'ready', lastError: result.error } });
        if (receipt.replyMessageId) await this.db.message.update({ where: { id: receipt.replyMessageId }, data: { deliveryStatus: result.uncertain ? 'uncertain' : 'failed' } });
        if (!result.uncertain) throw new Error('WhatsApp send failed; retry required');
      } else {
        if (receipt.replyMessageId) await this.db.message.update({ where: { id: receipt.replyMessageId }, data: { id: `m-wa-${result.messageId}`, deliveryStatus: 'sent' } });
        await this.db.whatsAppReceipt.update({ where: { id }, data: { status: 'done', providerMessageId: result.messageId, lastError: null } });
      }
    }
    this.broadcast(hotelId, 'conversation:updated', { conversationId: convId, guestId, channel: 'whatsapp', lastMessage: text.slice(0, 120) });
  }
}
