import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { WhatsAppConnectionService } from '../modules/whatsapp/WhatsAppConnectionService.js';
import { WhatsAppMessagingService } from '../modules/whatsapp/WhatsAppMessagingService.js';
import { WhatsAppWebhookService, verifyMetaSignature } from '../modules/whatsapp/WhatsAppWebhookService.js';
import { encryptToken, decryptToken } from '../utils/tokenCrypto.js';
const row = { id: 'integration', hotelId: 'hotel-a', targetType: 'guest', status: 'connected', verifiedAt: new Date(), phoneNumberId: '123', wabaId: '456', accessToken: encryptToken('test-token') };
const env = { META_APP_ID: '789', META_APP_SECRET: 'secret', META_WEBHOOK_VERIFY_TOKEN: 'verify' };
function connectionFixture(failPath) {
  const writes = [], calls = [];
  const db = { whatsAppIntegration: { findFirst: async () => null, findMany: async () => [], upsert: async args => { writes.push(args); return args.create; } },
    hotel: { findUnique: async () => ({ onboardingSteps: '[]' }), update: async () => {} } };
  db.$transaction = work => work(db);
  const request = async (path, token, options) => {
    calls.push({ path, token, options });
    if (path === failPath) throw new Error('Meta rejected request');
    if (path === 'oauth/access_token') return { access_token: 'real-test-token' };
    if (path === 'debug_token') return { data: { is_valid: true, app_id: '789', scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'] } };
    if (path === '456/phone_numbers') return { data: [{ id: '123', status: 'CONNECTED', display_phone_number: '+31612345678' }] };
    if (path === '456/subscribed_apps') return { success: true };
    throw new Error('Unexpected request');
  };
  return { service: new WhatsAppConnectionService({ db, request, env }), writes, calls, db };
}
test('real code exchange verifies ownership, subscribes, and stores encrypted token', async () => {
  const { service, writes, calls } = connectionFixture();
  await service.connect({ hotelId: 'hotel-a', code: 'auth-code', phoneNumberId: '123', wabaId: '456' });
  assert.equal(writes.length, 1);
  assert.equal(decryptToken(writes[0].create.accessToken), 'real-test-token');
  assert.equal(writes[0].create.displayPhoneNumber, '+31612345678');
  assert.deepEqual(calls.map(c => c.path), ['oauth/access_token', 'debug_token', '456/phone_numbers', '456/subscribed_apps']);
});
for (const path of ['debug_token', '456/phone_numbers', '456/subscribed_apps']) test(`failure at ${path} never saves connected status`, async () => {
  const { service, writes } = connectionFixture(path);
  await assert.rejects(service.connect({ hotelId: 'hotel-a', accessToken: 'token', phoneNumberId: '123', wabaId: '456' }));
  assert.equal(writes.length, 0);
});
test('another hotel cannot claim an assigned number', async () => {
  const { service, db, calls } = connectionFixture();
  db.whatsAppIntegration.findFirst = async () => row;
  await assert.rejects(service.connect({ hotelId: 'hotel-b', phoneNumberId: '123', wabaId: '456', accessToken: 'token' }), /assigned/);
  assert.equal(calls.length, 0);
});
test('Secret Manager file newline is excluded from Meta app credentials', async () => {
  const { service, calls } = connectionFixture();
  service.env = { ...env, META_APP_SECRET: 'secret\r\n' };
  await service.connect({ hotelId: 'hotel-a', code: 'code', phoneNumberId: '123', wabaId: '456' });
  assert.equal(calls[0].options.query.client_secret, 'secret');
  assert.equal(calls[1].token, '789|secret');
});
test('webhook requires signature over exact raw bytes and configured secret', () => {
  const raw = '{ "object": "whatsapp_business_account" }';
  const signature = 'sha256=' + createHmac('sha256', 'secret').update(raw).digest('hex');
  assert.equal(verifyMetaSignature(raw, signature, 'secret'), true);
  for (const [body, sig, secret] of [[raw, null, 'secret'], [raw, signature, null], ['{}', signature, 'secret'], [raw, 'sha256=bad', 'secret']]) assert.equal(verifyMetaSignature(body, sig, secret), false);
});
test('sending never falls back from placeholder tenant credentials to environment token', async () => {
  const service = new WhatsAppMessagingService({ db: { whatsAppIntegration: { findFirst: async () => ({ ...row, phoneNumberId: 'phone_fake' }) } }, request: async () => assert.fail('Must not send') });
  assert.equal((await service.send({ hotelId: 'hotel-a', to: '+31612345678', text: 'test' })).success, false);
});
test('send requires provider message ID and distinguishes acceptance from delivery', async () => {
  let result = {};
  const service = new WhatsAppMessagingService({ db: { whatsAppIntegration: { findFirst: async () => row, update: async () => {} } }, request: async () => result });
  assert.equal((await service.send({ hotelId: 'hotel-a', to: '+31612345678', text: 'test' })).uncertain, true);
  result = { messages: [{ id: 'wamid.out' }] };
  const sent = await service.send({ hotelId: 'hotel-a', to: '+31612345678', text: 'test' });
  assert.equal(sent.messageId, 'wamid.out'); assert.equal(sent.status, 'accepted'); assert.equal(sent.delivered, undefined);
});
function webhookFixture(sendResult = { success: true, messageId: 'out' }) {
  const receipts = new Map(), messages = new Map(); let sends = 0, automations = 0, unread = 0;
  const db = {
    whatsAppIntegration: { findFirst: async ({ where }) => where.phoneNumberId === '123' && where.wabaId === '456' ? row : null, update: async () => {} },
    whatsAppReceipt: { upsert: async ({ where, create }) => { if (!receipts.has(where.id)) receipts.set(where.id, { ...create, status: 'pending' }); return { ...receipts.get(where.id) }; }, update: async ({ where, data }) => { receipts.set(where.id, { ...receipts.get(where.id), ...data }); return { ...receipts.get(where.id) }; } },
    guest: { upsert: async () => ({}) },
    conversation: { upsert: async () => ({ aiStatus: 'ai-handling' }), update: async ({ data }) => { if (data.unread) unread++; } },
    message: { findUnique: async ({ where }) => messages.get(where.id), create: async ({ data }) => messages.set(data.id, data), update: async () => {} },
    hotel: { findUnique: async () => ({ aiMode: 'Autonomous' }) }, aiConfig: { findUnique: async () => ({ autoReply: true }) },
    $transaction: async ops => Promise.all(ops),
  };
  const service = new WhatsAppWebhookService({ db, withLock: async (key, work) => work(async () => {}),
    automate: async () => { automations++; return { replyText: 'Reply', message: { id: 'ai-message' } }; },
    send: async () => { sends++; return sendResult; }, broadcast: () => {} });
  const payload = { object: 'whatsapp_business_account', entry: [{ id: '456', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '123' }, messages: [1, 2].map(n => ({ id: `in-${n}`, from: '31612345678', type: 'text', text: { body: 'Hello' } })) } }] }] };
  return { service, payload, receipts, db, counts: () => ({ sends, automations, unread }) };
}
test('all batched messages process once and duplicate webhooks do not send or increment unread', async () => {
  const f = webhookFixture(); await f.service.accept(f.payload); await f.service.accept(f.payload);
  assert.deepEqual(f.counts(), { sends: 2, automations: 2, unread: 2 });
});
test('unknown Meta phone/WABA cannot route to a default hotel', async () => {
  const f = webhookFixture(); f.payload.entry[0].id = 'another-waba'; await f.service.accept(f.payload);
  assert.deepEqual(f.counts(), { sends: 0, automations: 0, unread: 0 });
});
test('ambiguous outbound failure is retained without automatically sending again', async () => {
  const f = webhookFixture({ success: false, uncertain: true, error: 'Timeout' });
  await f.service.accept(f.payload); await f.service.accept(f.payload);
  assert.equal(f.counts().sends, 2); assert.ok([...f.receipts.values()].every(r => r.status === 'uncertain'));
});
test('human takeover prevents automatic replies', async () => {
  const f = webhookFixture(); f.db.conversation.upsert = async () => ({ aiStatus: 'human-takeover' });
  await f.service.accept(f.payload); assert.equal(f.counts().sends, 0); assert.equal(f.counts().automations, 0);
});
test('known rejected send retries without rerunning AI or duplicating inbound messages', async () => {
  const f = webhookFixture({ success: false, uncertain: false, error: 'Rejected' });
  await assert.rejects(f.service.accept(f.payload), /retry/);
  f.service.send = async () => ({ success: true, messageId: 'retry-out' });
  await f.service.accept(f.payload);
  assert.equal(f.counts().automations, 2); assert.equal(f.counts().unread, 2);
  assert.ok([...f.receipts.values()].every(r => r.status === 'done'));
});
test('delivery statuses record failures but never regress from read', async () => {
  const f = webhookFixture(); let current = 'sent';
  f.db.message.findFirst = async ({ where }) => { assert.equal(where.conversation.guest.hotelId, 'hotel-a'); return { id: 'm-wa-out', conversationId: 'conv', deliveryStatus: current }; };
  f.db.message.update = async ({ data }) => { current = data.deliveryStatus; };
  await f.service.delivery(row, { id: 'out', status: 'failed' }); assert.equal(current, 'failed');
  await f.service.delivery(row, { id: 'out', status: 'read' }); assert.equal(current, 'read');
  await f.service.delivery(row, { id: 'out', status: 'delivered' }); assert.equal(current, 'read');
});
test('internal messages persist in the hotel operations thread without AI or room mutations', async () => {
  const f = webhookFixture(); const threads = [], messages = [];
  f.db.whatsAppIntegration.findFirst = async () => ({ ...row, targetType: 'internal' });
  f.db.user = { findFirst: async () => ({ name: 'Housekeeping', role: 'housekeeping' }) };
  f.db.waThread = { upsert: async args => threads.push(args) };
  f.db.waMessage = { upsert: async args => messages.push(args) };
  await f.service.accept(f.payload); await f.service.accept(f.payload);
  assert.equal(messages.length, 2); assert.equal(threads[0].create.hotelId, 'hotel-a');
  assert.equal(messages[0].create.hotelId, 'hotel-a'); assert.equal(f.counts().automations, 0);
});
