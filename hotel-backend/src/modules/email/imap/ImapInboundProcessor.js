import { createHash } from 'node:crypto';

export function imapMessageKey(hotelId, mailbox, providerId) {
  return createHash('sha256').update(JSON.stringify([hotelId, mailbox.toLowerCase(), providerId])).digest('hex');
}

export class ImapInboundProcessor {
  constructor({ db, automate, send, broadcast }) { Object.assign(this, { db, automate, send, broadcast }); }

  async isProcessed(integration, providerId) {
    const row = await this.db.imapInboundMessage.findUnique({ where: { id: imapMessageKey(integration.hotelId, integration.email, providerId) }, select: { status: true } });
    return row?.status === 'processed';
  }

  async resumePending(integration, assertOwned) {
    const pending = await this.db.imapInboundMessage.findMany({ where: { hotelId: integration.hotelId, mailbox: integration.email.toLowerCase(), mailboxKey: integration.imapMailboxKey, status: 'pending' }, orderBy: { receivedAt: 'asc' } });
    for (const receipt of pending) {
      await assertOwned();
      const message = await this.db.message.findUnique({ where: { id: `m-imap-${receipt.id}` } });
      if (!message) throw new Error('Pending Imap receipt has no stored message');
      await this.process(integration, { id: receipt.providerMessageId, threadId: receipt.threadId, sender: receipt.sender,
        from: receipt.sender, subject: receipt.subject, text: message.body, receivedAt: receipt.receivedAt, internetMessageId: receipt.internetMessageId }, { assertOwned });
    }
  }

  async process(integration, message, { assertOwned = async () => {}, recovery = false } = {}) {
    const hotelId = integration.hotelId;
    const id = imapMessageKey(hotelId, integration.email, message.id);
    const where = { id };
    let receipt = await this.db.imapInboundMessage.findUnique({ where });
    if (receipt?.status === 'processed') return { duplicate: true };
    const time = message.receivedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (!receipt) {
      if (!message.sender.includes('@')) throw new Error('Imap message has no valid sender');
      const guestId = `gst-email-${imapMessageKey(hotelId, message.sender, 'guest')}`;
      // One durable conversation per tenant/mailbox/Imap thread, with no
      // fabricated PMS reservations or room assignments from untrusted text.
      const conversationId = `c-imap-${imapMessageKey(hotelId, integration.email, message.threadId || message.id)}`;
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
        await tx.message.create({ data: { id: `m-imap-${id}`, conversationId, author: 'guest', channel: 'email', body: message.text, at: time } });
        return tx.imapInboundMessage.create({ data: {
          id, hotelId, mailbox: integration.email.toLowerCase(), providerMessageId: message.id,
          conversationId, mailboxKey: integration.imapMailboxKey, threadId: message.threadId, sender: message.sender, subject: message.subject,
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
        if (!result) throw new Error('Imap automation did not complete');
        const taskIds = JSON.parse(conversation.taskIds || '[]');
        if (result.task?.id && !taskIds.includes(result.task.id)) taskIds.push(result.task.id);
        await tx.conversation.update({ where: { id: receipt.conversationId }, data: {
          suggestedReply: result.replyText || '', aiStatus: result.aiStatus || (result.requiresApproval ? 'human-takeover' : 'ai-handling'),
          taskIds: JSON.stringify(taskIds), knowledgeUsed: JSON.stringify(result.knowledgeUsed || []),
          ...(result.escalation ? { escalation: JSON.stringify(result.escalation) } : {}),
        } });
        const saved = { replyText: result.replyText || '', requiresApproval: Boolean(result.requiresApproval || result.escalation), messageId: result.message?.id || null };
        return tx.imapInboundMessage.update({ where, data: { automationResult: saved } });
      }, { timeout: 90000, maxWait: 10000 });
    }
    const automation = receipt.automationResult;
    if (!automation.requiresApproval && automation.replyText && receipt.replyStatus !== 'sent') {
      if (['sending', 'uncertain'].includes(receipt.replyStatus)) {
        // SMTP may already have accepted DATA. SMTP does not guarantee an IMAP
        // Sent copy; an operator must check provider delivery evidence first.
        throw new Error('SMTP delivery uncertain; verify provider delivery logs before retrying');
      }
      if (receipt.replyStatus !== 'sent') {
        await assertOwned();
        await this.db.imapInboundMessage.update({ where, data: { replyStatus: 'sending' } });
        let sent;
        try {
          sent = await this.send({ hotelId, to: receipt.sender, subject: receipt.subject,
            bodyText: automation.replyText,
            inReplyTo: receipt.internetMessageId, references: message.references || receipt.internetMessageId,
            rfcMessageId: `<hotelogx-${id}@hotelogx.local>` });
        } catch (error) {
          // Explicit SMTP rejection can retry; a lost DATA response may have sent.
          const rejected = error.definitelyNotSent === true;
          await this.db.imapInboundMessage.update({ where, data: { replyStatus: rejected ? 'pending' : 'uncertain', lastError: rejected ? 'Provider rejected reply; retry pending' : 'Delivery uncertain; verify provider delivery logs' } });
          throw error;
        }
        if (!sent?.success) throw new Error('Imap send did not confirm success');
        await this.db.imapInboundMessage.update({ where, data: { replyStatus: 'sent', outboundMessageId: sent.messageId, lastError: null } });
      }
    }
    await assertOwned();
    await this.db.$transaction(async tx => {
      await tx.imapInboundMessage.update({ where, data: { status: 'processed', lastError: null } });
      if (automation.messageId) await tx.message.update({ where: { id: automation.messageId }, data: { deliveryStatus: 'sent' } });
      await tx.activityItem.upsert({ where: { id: `act-imap-${id}` }, update: {}, create: {
        id: `act-imap-${id}`, hotelId, at: time, kind: 'conversation', text: `New guest email: ${message.subject}`, meta: 'Email',
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
        this.broadcast(hotelId, 'activity:new', { id: `act-imap-${id}`, at: time, kind: 'conversation', text: `New guest email: ${message.subject}`, meta: 'Email' });
      }
    } catch {}
    return { duplicate: false };
  }
}
