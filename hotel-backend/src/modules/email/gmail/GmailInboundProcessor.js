import { createHash } from 'node:crypto';

export function gmailMessageKey(hotelId, mailbox, providerId) {
  return createHash('sha256').update(JSON.stringify([hotelId, mailbox.toLowerCase(), providerId])).digest('hex');
}

export class GmailInboundProcessor {
  constructor({ db, automate, send, broadcast, findSent }) { Object.assign(this, { db, automate, send, broadcast, findSent }); }

  async isProcessed(integration, providerId) {
    const row = await this.db.gmailInboundMessage.findUnique({ where: { id: gmailMessageKey(integration.hotelId, integration.email, providerId) }, select: { status: true } });
    return row?.status === 'processed';
  }

  async resumePending(integration, assertOwned) {
    const pending = await this.db.gmailInboundMessage.findMany({ where: { hotelId: integration.hotelId, mailbox: integration.email.toLowerCase(), status: 'pending' }, orderBy: { receivedAt: 'asc' } });
    for (const receipt of pending) {
      await assertOwned();
      const message = await this.db.message.findUnique({ where: { id: `m-gmail-${receipt.id}` } });
      if (!message) throw new Error('Pending Gmail receipt has no stored message');
      await this.process(integration, { id: receipt.providerMessageId, threadId: receipt.threadId, sender: receipt.sender,
        subject: receipt.subject, text: message.body, receivedAt: receipt.receivedAt, internetMessageId: receipt.internetMessageId }, { assertOwned });
    }
  }

  async process(integration, message, { assertOwned = async () => {}, recovery = false } = {}) {
    const hotelId = integration.hotelId;
    const id = gmailMessageKey(hotelId, integration.email, message.id);
    const where = { id };
    let receipt = await this.db.gmailInboundMessage.findUnique({ where });
    if (receipt?.status === 'processed') return { duplicate: true };
    const time = message.receivedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (!receipt) {
      if (!message.sender.includes('@')) throw new Error('Gmail message has no valid sender');
      const guestId = `gst-email-${gmailMessageKey(hotelId, message.sender, 'guest')}`;
      // One durable conversation per tenant/mailbox/Gmail thread, with no
      // fabricated PMS reservations or room assignments from untrusted text.
      const conversationId = `c-gmail-${gmailMessageKey(hotelId, integration.email, message.threadId || message.id)}`;
      receipt = await this.db.$transaction(async tx => {
        if (!await tx.hotel.findUnique({ where: { id: hotelId } })) throw new Error('Hotel does not exist');
        const name = message.from.includes('<') ? message.from.split('<')[0].replace(/["']/g, '').trim() : message.sender.split('@')[0];
        await tx.guest.upsert({ where: { id: guestId }, update: {}, create: {
          id: guestId, hotelId, name: name || 'Guest', country: '', language: 'en', tags: JSON.stringify(['Email Contact', message.sender]),
        } });
        await tx.conversation.upsert({ where: { id: conversationId }, create: {
          id: conversationId, guestId, stage: 'Pre-arrival', primaryChannel: 'email', aiStatus: 'ai-handling', sentiment: 'neutral',
          subject: message.subject.slice(0, 100), summary: message.text.slice(0, 200), suggestedReply: '', unread: 1, lastAt: time,
        }, update: { unread: { increment: 1 }, lastAt: time } });
        await tx.message.create({ data: { id: `m-gmail-${id}`, conversationId, author: 'guest', channel: 'email', body: message.text, at: time } });
        return tx.gmailInboundMessage.create({ data: {
          id, hotelId, mailbox: integration.email.toLowerCase(), providerMessageId: message.id,
          conversationId, threadId: message.threadId, sender: message.sender, subject: message.subject,
          internetMessageId: message.internetMessageId || null, receivedAt: message.receivedAt,
          // Recovery imports old mail for staff review, never sends retroactive replies.
          suppressReply: recovery || message.automated,
        } });
      });
    }
    await assertOwned();
    if (!receipt.automationResult) {
      receipt = await this.db.$transaction(async tx => {
        const config = await tx.aiConfig.findUnique({ where: { hotelId } });
        const conversation = await tx.conversation.findUnique({ where: { id: receipt.conversationId } });
        const manual = receipt.suppressReply || config?.autoReply === false || ['human-takeover', 'escalated'].includes(conversation.aiStatus);
        // Automation writes and its checkpoint commit together. The existing AI
        // engine defers provider delivery so transaction retries never send mail.
        const result = manual ? { requiresApproval: true, replyText: '', aiStatus: 'human-takeover' } : await this.automate({
          messageText: message.text, conversationId: receipt.conversationId, hotelId, channel: 'email', database: tx, deferEmailDelivery: true,
        });
        if (!result) throw new Error('Gmail automation did not complete');
        const taskIds = JSON.parse(conversation.taskIds || '[]');
        if (result.task?.id && !taskIds.includes(result.task.id)) taskIds.push(result.task.id);
        await tx.conversation.update({ where: { id: receipt.conversationId }, data: {
          suggestedReply: result.replyText || '', aiStatus: result.aiStatus || (result.requiresApproval ? 'human-takeover' : 'ai-handling'),
          taskIds: JSON.stringify(taskIds), knowledgeUsed: JSON.stringify(result.knowledgeUsed || []),
          ...(result.escalation ? { escalation: JSON.stringify(result.escalation) } : {}),
        } });
        const saved = { replyText: result.replyText || '', requiresApproval: Boolean(result.requiresApproval || result.escalation), messageId: result.message?.id || null };
        return tx.gmailInboundMessage.update({ where, data: { automationResult: saved } });
      }, { timeout: 90000, maxWait: 10000 });
    }
    const automation = receipt.automationResult;
    if (!automation.requiresApproval && automation.replyText && receipt.replyStatus !== 'sent') {
      if (['sending', 'uncertain'].includes(receipt.replyStatus)) {
        // A previous worker may have died after Gmail accepted the send. Leave
        // this receipt unresolved; an operator must reconcile Sent Mail.
        const sent = this.findSent ? await this.findSent(integration, `<hotelogx-${id}@hotelogx.local>`) : null;
        if (!sent) throw new Error('Gmail reply delivery uncertain; inspect Sent Mail before retrying');
        await this.db.gmailInboundMessage.update({ where, data: { replyStatus: 'sent', outboundMessageId: sent.id, lastError: null } });
        receipt.replyStatus = 'sent';
      }
      if (receipt.replyStatus !== 'sent') {
        await assertOwned();
        await this.db.gmailInboundMessage.update({ where, data: { replyStatus: 'sending' } });
        let sent;
        try {
          sent = await this.send({ hotelId, to: receipt.sender, subject: receipt.subject,
            bodyText: automation.replyText, threadId: receipt.threadId,
            inReplyTo: receipt.internetMessageId, references: message.references || receipt.internetMessageId,
            rfcMessageId: `<hotelogx-${id}@hotelogx.local>` });
        } catch (error) {
          // Explicit rejection can retry; transport errors and 5xx may have sent.
          const rejected = error.definitelyNotSent === true;
          await this.db.gmailInboundMessage.update({ where, data: { replyStatus: rejected ? 'pending' : 'uncertain', lastError: rejected ? 'Provider rejected reply; retry pending' : 'Delivery uncertain; inspect Sent Mail' } });
          throw error;
        }
        if (!sent?.success) throw new Error('Gmail send did not confirm success');
        await this.db.gmailInboundMessage.update({ where, data: { replyStatus: 'sent', outboundMessageId: sent.messageId, lastError: null } });
      }
    }
    await assertOwned();
    await this.db.$transaction(async tx => {
      await tx.gmailInboundMessage.update({ where, data: { status: 'processed', lastError: null } });
      if (automation.messageId) await tx.message.update({ where: { id: automation.messageId }, data: { deliveryStatus: 'sent' } });
      await tx.activityItem.upsert({ where: { id: `act-gmail-${id}` }, update: {}, create: {
        id: `act-gmail-${id}`, hotelId, at: time, kind: 'conversation', text: `New guest email: ${message.subject}`, meta: 'Gmail',
      } });
    });
    // SSE is best-effort; persisted conversation state remains authoritative.
    try {
      const conversation = await this.db.conversation.findFirst({ where: { id: receipt.conversationId, guest: { hotelId } },
        include: { guest: { include: { reservations: true } }, messages: { orderBy: { createdAt: 'asc' } } } });
      if (conversation) {
        const parse = (value, fallback = []) => { try { return JSON.parse(value || 'null') ?? fallback; } catch { return fallback; } };
        const normalized = { ...conversation, channels: ['email'], stage: conversation.stage === 'In House' ? 'in-house' : 'pre-arrival',
          knowledgeUsed: parse(conversation.knowledgeUsed), upsellIdeas: parse(conversation.upsellIdeas), taskIds: parse(conversation.taskIds),
          escalation: parse(conversation.escalation, null), guest: { ...conversation.guest, tags: parse(conversation.guest.tags), reservation: conversation.guest.reservations?.[0] || null },
          messages: conversation.messages.map(m => ({ ...m, knowledge: parse(m.knowledge), buttons: parse(m.buttons) })),
        };
        this.broadcast(hotelId, 'conversation:updated', { conversationId: receipt.conversationId, channel: 'email', lastMessage: message.text.slice(0, 120), time, conversation: normalized });
        this.broadcast(hotelId, 'activity:new', { id: `act-gmail-${id}`, at: time, kind: 'conversation', text: `New guest email: ${message.subject}`, meta: 'Gmail' });
      }
    } catch {}
    return { duplicate: false };
  }
}
