import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppWebhookService } from '../modules/whatsapp/WhatsAppWebhookService.js';

function fixture() {
  const integration = { id: 'i', hotelId: 'h', targetType: 'guest', onboardingMode: 'coexistence', phoneNumber: '31611111111', phoneNumberId: '123', wabaId: '456', accessToken: 'encrypted', verifiedAt: new Date(), status: 'connected' };
  const messages = new Map(), receipts = new Map(), conversations = new Map(), guests = new Map(), threads = new Map();
  let sends = 0, automations = 0;
  const table = map => ({
    findUnique: async ({ where }) => map.get(where.id),
    upsert: async ({ where, create, update }) => { const next = map.has(where.id) ? { ...map.get(where.id), ...update } : { ...create }; map.set(where.id, next); return next; },
    create: async ({ data }) => { assert.ok(!map.has(data.id)); map.set(data.id, { ...data }); return data; },
    update: async ({ where, data }) => { const next = { ...map.get(where.id), ...data }; map.set(where.id, next); return next; },
    updateMany: async ({ where, data }) => { const row = map.get(where.id); if (row && (!where.lastAt || row.lastAt < where.lastAt.lt)) { map.set(where.id, { ...row, ...data }); return { count: 1 }; } return { count: 0 }; },
  });
  const db = { message: table(messages), whatsAppReceipt: table(receipts), conversation: table(conversations), guest: table(guests), waThread: table(threads), waMessage: table(new Map()),
    user: { findFirst: async () => null }, hotel: { findUnique: async () => ({ aiMode: 'Autonomous' }) }, aiConfig: { findUnique: async () => ({ autoReply: true }) },
    whatsAppIntegration: { findFirst: async ({ where }) => where.phoneNumberId === '123' && where.wabaId === '456' ? integration : null, update: async ({ data }) => Object.assign(integration, data) } };
  db.$transaction = work => typeof work === 'function' ? work(db) : Promise.all(work);
  const service = new WhatsAppWebhookService({ db, withLock: async (key, work) => work(async () => {}), send: async () => { sends++; return { success: true, messageId: 'out' }; }, automate: async () => { automations++; return { replyText: 'AI' }; }, broadcast() {} });
  const message = (id, from = integration.phoneNumber, to = '31622222222', timestamp = '1700000000') => ({ id, from, to, timestamp, type: 'text', text: { body: id } });
  const change = (field, data) => ({ field, value: { metadata: { phone_number_id: '123' }, ...data } });
  const payload = (...changes) => ({ object: 'whatsapp_business_account', entry: [{ id: '456', changes }] });
  return { db, service, integration, messages, receipts, conversations, guests, message, change, payload, counts: () => ({ sends, automations }) };
}

test('phone echo is outbound, pauses AI, and duplicate delivery does not reset a resumed conversation', async () => {
  const f = fixture(), event = f.payload(f.change('smb_message_echoes', { message_echoes: [f.message('echo')] }));
  await f.service.accept(event);
  assert.equal(f.messages.get('m-wa-echo').author, 'staff');
  const conversation = f.conversations.get('conv-wa-h-31622222222'); assert.equal(conversation.aiStatus, 'human-takeover');
  conversation.aiStatus = 'ai-handling'; await f.service.accept(event);
  assert.equal(f.messages.size, 1); assert.equal(conversation.aiStatus, 'ai-handling');
  assert.deepEqual(f.counts(), { sends: 0, automations: 0 });
});

test('history preserves direction and times without unread increments, AI, or duplicate live ingestion', async () => {
  const f = fixture();
  await f.service.accept(f.payload(f.change('smb_message_echoes', { message_echoes: [f.message('new', undefined, undefined, '1800000000')] })));
  const messages = [f.message('old-in', '31622222222', undefined, '1600000000'), f.message('old-out')];
  const event = f.payload(f.change('history', { history: [{ metadata: { phase: 0, progress: 100 }, threads: [{ id: '31622222222', messages }] }] }));
  await f.service.accept(event); await f.service.accept(event);
  await f.service.accept(f.payload(f.change('messages', { messages: [messages[0]] })));
  assert.equal(f.messages.size, 3); assert.equal(f.messages.get('m-wa-old-in').author, 'guest');
  assert.equal(f.messages.get('m-wa-old-out').author, 'staff');
  assert.equal(f.conversations.get('conv-wa-h-31622222222').lastAt, new Date(1800000000000).toISOString());
  assert.equal(f.conversations.get('conv-wa-h-31622222222').unread, 0);
  assert.deepEqual(f.counts(), { sends: 0, automations: 0 });
});

test('same-batch phone echo is handled before new guest messages', async () => {
  const f = fixture();
  await f.service.accept(f.payload(f.change('messages', { messages: [f.message('in', '31622222222')] }), f.change('smb_message_echoes', { message_echoes: [f.message('echo')] })));
  assert.deepEqual(f.counts(), { sends: 0, automations: 0 });
});

test('wrong WABA and standard connections cannot import Coexistence events', async () => {
  const f = fixture(); const event = f.payload(f.change('smb_message_echoes', { message_echoes: [f.message('echo')] }));
  event.entry[0].id = '999'; await f.service.accept(event); assert.equal(f.messages.size, 0);
  event.entry[0].id = '456'; f.integration.onboardingMode = 'standard'; await f.service.accept(event); assert.equal(f.messages.size, 0);
});

test('declined history is visible and does not trigger AI', async () => {
  const f = fixture(); await f.service.accept(f.payload(f.change('history', { history: [{ errors: [{ code: 2593109 }] }] })));
  assert.equal(f.integration.historySyncStatus, 'not-shared'); assert.deepEqual(f.counts(), { sends: 0, automations: 0 });
});

test('API outbound IDs echoed back do not duplicate or take over conversations', async () => {
  const f = fixture(); const convId = 'conv-wa-h-31622222222';
  f.conversations.set(convId, { id: convId, aiStatus: 'ai-handling', lastAt: '2020-01-01' });
  f.messages.set('m-wa-api', { id: 'm-wa-api', conversationId: convId, author: 'ai' });
  await f.service.accept(f.payload(f.change('smb_message_echoes', { message_echoes: [f.message('api')] })));
  assert.equal(f.messages.size, 1); assert.equal(f.conversations.get(convId).aiStatus, 'ai-handling');
});

test('contact sync names survive a later history import without granting staff access', async () => {
  const f = fixture();
  await f.service.accept(f.payload(f.change('smb_app_state_sync', { state_sync: [{ type: 'contact', action: 'add', contact: { phone_number: '+31622222222', full_name: 'Guest name' } }] })));
  await f.service.accept(f.payload(f.change('history', { history: [{ threads: [{ id: '31622222222', messages: [f.message('old')] }] }] })));
  assert.equal(f.guests.get('g-wa-h-31622222222').name, 'Guest name'); assert.equal(f.integration.contactSyncStatus, 'received');
});

test('invalid business sender does not create outbound messages', async () => {
  const f = fixture(); await assert.rejects(f.service.accept(f.payload(f.change('smb_message_echoes', { message_echoes: [f.message('bad', '31699999999')] }))), /mismatch/);
  assert.equal(f.messages.size, 0);
});
