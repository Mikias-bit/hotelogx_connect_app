import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCheckinAutomation, chooseCheckinContact, eligibleCheckin } from '../modules/pms/checkinAutomation.js';
import { createCheckinWebhookRouter } from '../modules/pms/checkinWebhookRoutes.js';

const now = new Date('2026-11-18T12:00:00Z');
const config = { hotelId: 'hotel-a', enabledSince: new Date('2026-11-18T09:00:00Z'), automaticEnabled: true, automaticChannel: 'email_first', whatsappTemplate: 'welcome', updatedBy: 'manager' };
const stay = { Id: 'stay', State: 'Started', AccountType: 'Customer', AccountId: 'guest', AssignedResourceId: 'room-307', ActualStartUtc: '2026-11-18T11:00:00Z', ScheduledEndUtc: '2026-11-20T11:00:00Z' };
function fixture() {
  const sends = [], revokes = []; let currentStay = { ...stay }, previous = null;
  const db = { guestMessagingInvite: { findFirst: async () => previous, updateMany: async input => { revokes.push(input); } },
    pmsConversationBinding: { deleteMany: async input => { revokes.push(input); } },
    user: { findFirst: async ({ where }) => ({ id: where.id, hotelId: where.hotelId, role: 'manager' }) } };
  const reader = { reservation: async () => currentStay, customer: async id => ({ Id: id, Email: id === 'guest' ? 'guest@example.com' : 'booker@example.com' }) };
  const automation = createCheckinAutomation({ db, now: () => now, readerFor: async () => reader,
    messagingFor: () => ({ issueAutomatic: async (actor, input) => { sends.push({ actor, input }); return { status: 'sent' }; } }) });
  return { automation, reader, sends, revokes, db, setStay: value => { currentStay = value; }, previous: value => { previous = value; } };
}
test('reception, online and kiosk use the same authoritative Started check-in condition', async () => {
  for (const method of ['Reception', 'Online', 'Kiosk']) {
    const f = fixture(); f.setStay({ ...stay, CheckinMethod: method });
    assert.equal((await f.automation.process(config, f.reader, { reservationId: 'stay' })).status, 'done');
    assert.equal(f.sends.length, 1); assert.equal(f.sends[0].input.expectedCustomerId, 'guest');
  }
  for (const patch of [{ State: 'Confirmed' }, { State: 'Canceled' }, { State: 'Processed' }, { ActualStartUtc: null }, { ActualStartUtc: '2026-11-18T13:00:00Z' }, { ActualStartUtc: '2026-11-17T11:00:00Z' }, { AssignedResourceId: null }, { AccountType: 'Company' }]) {
    assert.equal(eligibleCheckin({ ...stay, ...patch }, config, now), false);
    const f = fixture(); f.setStay({ ...stay, ...patch }); await f.automation.process(config, f.reader, { reservationId: 'stay' }); assert.equal(f.sends.length, 0);
  }
});
test('checkout invalidates codes and remembered links; earlier sends never trigger a repeat', async () => {
  const f = fixture(); f.setStay({ ...stay, State: 'Processed', ActualEndUtc: now.toISOString() });
  await f.automation.process(config, f.reader, { reservationId: 'stay' }); assert.equal(f.revokes.length, 2);
  for (const status of ['sent', 'redeemed', 'revoked', 'uncertain', 'sending', 'failed']) {
    const g = fixture(); g.previous({ status }); await g.automation.process(config, g.reader, { reservationId: 'stay' }); assert.equal(g.sends.length, 0);
  }
});
test('contact selection rejects proxies and booker contacts, respects channel preference and missing template', () => {
  assert.equal(chooseCheckinContact(config, { Email: 'guest@example.com' }).channel, 'email');
  assert.equal(chooseCheckinContact(config, { Phone: '+31612345678' }).channel, 'whatsapp');
  assert(chooseCheckinContact(config, { Email: '123@guest.booking.com' }).reason);
  assert(chooseCheckinContact(config, { Email: 'booker@example.com' }, { Email: 'booker@example.com' }).reason);
  assert(chooseCheckinContact({ ...config, whatsappTemplate: '' }, { Phone: '+31612345678' }).reason);
  assert(chooseCheckinContact({ ...config, automaticChannel: 'email' }, { Phone: '+31612345678' }).reason);
});
test('authenticated general webhook maps enterprise/integration exactly and only persists work', async () => {
  const secret = 's'.repeat(40), received = [], queries = [];
  const db = { guestMessagingConfig: { findMany: async ({ where }) => { queries.push(where); return where.mewsEnterpriseId === 'enterprise-a' && where.mewsIntegrationId === 'integration-a' ? [config] : []; } } };
  const app = express(); app.use(express.json()); app.use(createCheckinWebhookRouter({ db, env: { MEWS_GENERAL_WEBHOOK_SECRET: secret }, automation: { enqueue: async (...args) => received.push(args) } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://localhost:${server.address().port}/webhook/mews/general`;
  const body = { EnterpriseId: 'enterprise-a', IntegrationId: 'integration-a', hotelId: 'attacker-hotel', Events: [{ Discriminator: 'ServiceOrderUpdated', Value: { Id: '11111111-1111-1111-1111-111111111111' } }] };
  const send = (payload, token) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-webhook-secret': token } : {}) }, body: JSON.stringify(payload) });
  try {
    assert.equal((await send(body)).status, 401); assert.equal(queries.length, 0);
    assert.equal((await send({ ...body, EnterpriseId: 'other' }, secret)).status, 409);
    assert.equal((await send(body, secret)).status, 202); assert.equal(received[0][0], 'hotel-a');
    assert.equal((await send({ ...body, Events: [{ Discriminator: 'ServiceOrderUpdated', Value: { Id: 'bad' } }] }, secret)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('recovery checkpoints a page only after durable enqueue and resumes its cursor after failure', async () => {
  const state = { ...config, lastScannedAt: config.enabledSince, scanCursor: null }, queued = [], calls = [];
  let fail = true;
  const db = {
    $transaction: fn => fn(db),
    guestMessagingConfig: { findUnique: async () => ({ ...state }), updateMany: async ({ data }) => { Object.assign(state, data); return { count: 1 }; } },
    guestMessagingJob: { createMany: async ({ data }) => queued.push(...data), updateMany: async () => ({ count: 1 }), findMany: async () => [] },
  };
  const reader = { updated: async (start, end, cursor) => { calls.push(cursor); if (!cursor) return { reservations: [{ Id: 'one' }], cursor: 'next-page' }; if (fail) throw new Error('PMS offline'); return { reservations: [{ Id: 'two' }], cursor: null }; } };
  const service = createCheckinAutomation({ db, readerFor: async () => reader, now: () => now });
  await service.runHotel('hotel-a'); assert.equal(state.scanCursor, 'next-page'); assert.equal(+state.lastScannedAt, +config.enabledSince); assert(state.automationError);
  fail = false; await service.runHotel('hotel-a'); assert.equal(calls.at(-1), 'next-page'); assert.equal(state.scanCursor, null); assert.equal(+state.lastScannedAt, +now);
  assert.deepEqual(queued.map(j => j.reservationId), ['one', 'two']); assert(queued.every(j => j.hotelId === 'hotel-a'));
});
