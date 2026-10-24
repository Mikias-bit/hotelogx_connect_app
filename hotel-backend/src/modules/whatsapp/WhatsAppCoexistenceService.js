const digits = value => String(value || '').replace(/[^0-9]/g, '');
const validPhone = value => /^\d{8,15}$/.test(value);
const messageText = message => message.text?.body || message.interactive?.button_reply?.title || message.button?.text || `[${message.type || 'unsupported'} message ? view in WhatsApp Business]`;

// These events are already signature-checked and routed to an exact WABA/phone by the caller.
export async function acceptCoexistence(service, integration, field, value, assertOwned) {
  const { db } = service;
  if (field === 'smb_message_echoes') {
    for (const message of value.message_echoes || []) {
      await assertOwned();
      if (digits(message.from) !== digits(integration.phoneNumber)) throw new Error('Business app echo sender mismatch');
      await importMessage(service, integration, message, digits(message.to), true, false);
    }
  } else if (field === 'history') {
    for (const chunk of value.history || []) {
      await assertOwned();
      if (chunk.errors?.length) {
        await db.whatsAppIntegration.update({ where: { id: integration.id }, data: { historySyncStatus: chunk.errors.some(e => e.code === 2593109) ? 'not-shared' : 'needs-review' } });
        continue;
      }
      for (const thread of chunk.threads || []) for (const message of thread.messages || []) {
        await assertOwned();
        const peer = digits(thread.id), sender = digits(message.from);
        if (sender !== peer && sender !== digits(integration.phoneNumber)) throw new Error('History sender mismatch');
        await importMessage(service, integration, message, peer, sender === digits(integration.phoneNumber), true);
      }
      // A phase reaching 100 is not proof that every phase/chunk was received.
      await db.whatsAppIntegration.update({ where: { id: integration.id }, data: { historySyncStatus: 'received' } });
    }
  } else if (field === 'smb_app_state_sync') {
    for (const item of value.state_sync || []) {
      await assertOwned();
      const peer = digits(item.contact?.phone_number);
      if (item.type !== 'contact' || !validPhone(peer)) continue;
      const name = item.action === 'remove' ? 'WhatsApp guest' : (item.contact.full_name || item.contact.first_name || 'WhatsApp guest');
      // Contact metadata never grants staff membership or changes operational permissions.
      if (item.action === 'remove') {
        await db.guest.updateMany({ where: { id: `g-wa-${integration.hotelId}-${peer}`, hotelId: integration.hotelId }, data: { name } });
      } else if (['add', 'update'].includes(item.action)) {
        await db.guest.upsert({ where: { id: `g-wa-${integration.hotelId}-${peer}` }, create: { id: `g-wa-${integration.hotelId}-${peer}`, hotelId: integration.hotelId, name, country: '', language: 'en', vip: false, previousStays: 0, tags: JSON.stringify(['WhatsApp Contact', `+${peer}`]) }, update: { name } });
      } else continue;
      await db.waThread.updateMany({ where: { id: `wa-${integration.hotelId}-${peer}`, hotelId: integration.hotelId, role: 'unverified' }, data: { contact: name } });
    }
    await db.whatsAppIntegration.update({ where: { id: integration.id }, data: { contactSyncStatus: 'received' } });
  }
}

async function importMessage(service, integration, message, peer, outbound, historical) {
  if (!message.id || !validPhone(peer)) throw new Error('Invalid Coexistence message');
  const timestamp = Number(message.timestamp) * 1000;
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > 8640000000000000) throw new Error('Invalid Coexistence timestamp');
  const at = new Date(timestamp).toISOString(), text = messageText(message);
  const { db } = service, hotelId = integration.hotelId;
  const receiptId = `${integration.phoneNumberId}:${message.id}`;
  const staff = integration.targetType === 'guest' ? null : await db.user.findFirst({ where: { hotelId, whatsapp: true, phone: { in: [peer, `+${peer}`] } } });
  const internal = integration.targetType === 'internal' || Boolean(staff);
  const threadId = `wa-${hotelId}-${peer}`, guestId = `g-wa-${hotelId}-${peer}`, conversationId = `conv-wa-${hotelId}-${peer}`;
  await db.$transaction(async tx => {
    const receipt = await tx.whatsAppReceipt.findUnique({ where: { id: receiptId } });
    if (receipt?.status === 'done') return;
    if (internal) {
      await tx.waThread.upsert({ where: { id: threadId }, create: { id: threadId, hotelId, contact: staff?.name || 'WhatsApp contact', phone: peer, role: staff?.role || 'unverified', department: 'WhatsApp' }, update: {} });
      await tx.waMessage.upsert({ where: { id: `${outbound ? 'wa-out' : 'wa-in'}-${message.id}` }, create: { id: `${outbound ? 'wa-out' : 'wa-in'}-${message.id}`, hotelId, threadId, from: outbound ? 'hotelogx' : 'staff', body: text, at }, update: {} });
    } else {
      await tx.guest.upsert({ where: { id: guestId }, create: { id: guestId, hotelId, name: 'WhatsApp guest', country: '', language: 'en', vip: false, previousStays: 0, tags: JSON.stringify(['WhatsApp Contact', `+${peer}`]) }, update: {} });
      await tx.conversation.upsert({ where: { id: conversationId }, create: { id: conversationId, guestId, stage: 'Pre-arrival', primaryChannel: 'whatsapp', aiStatus: 'human-takeover', sentiment: 'neutral', subject: 'WhatsApp conversation', summary: text.slice(0, 200), suggestedReply: '', unread: 0, lastAt: at, aiHandledCount: 0 }, update: {} });
      const existing = await tx.message.findUnique({ where: { id: `m-wa-${message.id}` } });
      if (!existing) {
        await tx.message.create({ data: { id: `m-wa-${message.id}`, conversationId, author: outbound ? 'staff' : 'guest', channel: 'whatsapp', body: text, at, ...(outbound ? { deliveryStatus: 'sent' } : {}) } });
        if (outbound && !historical) await tx.conversation.update({ where: { id: conversationId }, data: { aiStatus: 'human-takeover', suggestedReply: '' } });
      }
      // Late history cannot reorder a conversation above newer live messages.
      await tx.conversation.updateMany({ where: { id: conversationId, lastAt: { lt: at } }, data: { lastAt: at } });
    }
    await tx.whatsAppReceipt.upsert({ where: { id: receiptId }, create: { id: receiptId, hotelId, phoneNumberId: integration.phoneNumberId, sender: peer, status: 'done' }, update: { status: 'done' } });
  });
  if (!historical && outbound) await db.whatsAppIntegration.update({ where: { id: integration.id }, data: { lastOutboundAt: new Date(timestamp) } });
  service.broadcast(hotelId, internal ? 'whatsapp:updated' : 'conversation:updated', { threadId, conversationId, channel: 'whatsapp' });
}
