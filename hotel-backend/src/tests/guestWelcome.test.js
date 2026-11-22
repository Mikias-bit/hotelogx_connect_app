import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuestWelcome, welcomeText, safeWelcomeUrl } from '../modules/pms/guestWelcome.js';
import { createCheckinAutomation } from '../modules/pms/checkinAutomation.js';

const clock = new Date('2026-11-22T10:00:00Z');
const hotel = { id: 'hotel-a', name: 'Hotel Example', checkIn: '15:00', timezone: 'Europe/Amsterdam', aiMode: 'Autonomous' };
const customer = { Id: 'guest', FirstName: 'Maya', LastName: 'Guest', Email: 'maya@example.com', Phone: '+31612345678' };
const stay = { Id: 'stay', AccountId: 'guest', AccountType: 'Customer', State: 'Confirmed', CreatedUtc: '2026-11-22T09:00:00Z', ScheduledStartUtc: '2026-11-23T14:00:00Z', ScheduledEndUtc: '2026-11-25T10:00:00Z', AssignedResourceId: 'room-307', ActualStartUtc: clock.toISOString() };
const config = { hotelId: 'hotel-a', automaticEnabled: true, welcomeEnabled: true, welcomeSince: new Date('2026-11-22T08:00:00Z'), enabledSince: new Date('2026-11-22T08:00:00Z'),
  automaticChannel: 'email', confirmationSender: 'hotelogx', checkinSender: 'hotelogx', welcomeUpsells: false, arrivalInstructions: 'Reception is open 24 hours.', onlineCheckinUrl: 'https://hotel.example/checkin',
  catalogueUrl: 'https://hotel.example/extras', bookingWelcomeTemplate: 'booking_welcome', checkinWelcomeTemplate: 'stay_welcome', whatsappLanguage: 'en', updatedBy: 'manager' };
function fixture(stage = 'confirmation') {
  const welcomes = [], messages = [], sent = [], claims = [];
  let proof = null, fail = false, changed = false, pending = Promise.resolve();
  const current = { ...stay, State: stage === 'confirmation' ? 'Confirmed' : 'Started' };
  const db = {
    $transaction: fn => { const work = pending.then(() => fn({ ...db, $transaction: undefined })); pending = work.catch(() => {}); return work; },
    $executeRaw: async () => 1,
    hotel: { findUnique: async () => hotel }, guest: { upsert: async () => ({ id: 'guest' }) },
    guestMessagingConfig: { findUnique: async () => config }, guestMessagingInvite: { findFirst: async () => null },
    guestContactVerification: { findFirst: async () => proof },
    guestWelcome: {
      findUnique: async ({ where }) => welcomes.find(w => w.reservationId === where.hotelId_reservationId_stage.reservationId && w.stage === where.hotelId_reservationId_stage.stage) || null,
      create: async ({ data }) => { const row = { status: 'sending', ...data }; welcomes.push(row); return row; },
      update: async ({ where, data }) => { const row = welcomes.find(w => w.id === where.id); Object.assign(row, data); return row; },
    },
    conversation: { upsert: async ({ create }) => create, update: async () => {}, findMany: async () => [{ id: 'conv', aiStatus: 'ai-handling' }] },
    message: { create: async ({ data }) => messages.push(data), update: async ({ where, data }) => Object.assign(messages.find(m => m.id === where.id), data), findMany: async () => [] },
    upsellOutreach: { updateMany: async () => {}, findMany: async () => claims, create: async ({ data }) => { claims.push(data); return data; } },
    pmsUpsellOffer: { findMany: async () => [] }, aiConfig: { findUnique: async () => ({ autoReply: true }) }, aiRule: { findFirst: async () => null },
    upsellAutomationConfig: { findUnique: async () => ({ daysBeforeArrival: 3 }) },
    pmsUpsellProduct: { findMany: async () => [{ productId: 'transfer', label: 'Airport transfer', category: 'airport_transfer' }] },
  };
  const client = { callTool: async () => ({ structuredContent: { products: [{ product_id: 'transfer', name: 'Airport transfer', unit_amount: '35', currency: 'EUR' }] } }) };
  const sender = async args => { sent.push(args); return fail ? { success: false, uncertain: true } : { success: true, dispatched: true, messageId: 'provider' }; };
  const service = createGuestWelcome({ db, client, now: () => clock, sendEmail: sender, sendWhatsApp: sender });
  const reader = { reservation: async () => changed ? { ...current, State: 'Canceled' } : current, customer: async () => customer };
  const input = { config, reader, stage, stay: current, customer, contact: { channel: 'email', contact: customer.Email }, actor: { id: 'manager', hotelId: 'hotel-a', role: 'manager' } };
  return { service, input, db, sent, welcomes, messages, claims, current, setProof: () => { proof = { id: 'proof' }; }, uncertain: () => { fail = true; }, cancel: () => { changed = true; } };
}

test('welcome wording uses hotel and live reservation dates, including approved late checkout and timezone', () => {
  const body = welcomeText({ stage: 'checkin', hotel, customer, stay: { ...stay, ScheduledEndUtc: '2026-11-25T14:00:00Z' }, config, verified: true });
  assert.match(body, /Dear Maya/); assert.match(body, /Welcome to Hotel Example/); assert.match(body, /25 November 2026 by 15:00/); assert.doesNotMatch(body, /Accept|CONNECT/);
  const generic = welcomeText({ stage: 'checkin', hotel, customer, stay, config, verified: false });
  assert.doesNotMatch(generic, /Maya|25 November|307/); assert.match(generic, /VERIFY/);
  const booking = welcomeText({ stage: 'confirmation', hotel, customer, stay, config });
  assert.match(booking, /23 November 2026/); assert.match(booking, /15:00/); assert.match(booking, /https:\/\/hotel.example\/checkin/);
  assert.equal(safeWelcomeUrl('javascript:alert(1)'), ''); assert.equal(safeWelcomeUrl('https://user:password@example.com'), '');
});
test('a stage sends once across concurrent workers and stores only a hash of the email reply reference', async () => {
  const f = fixture(); await Promise.all([f.service.send(f.input), f.service.send(f.input)]);
  assert.equal(f.sent.length, 1); assert.equal(f.welcomes.length, 1); assert.equal(f.messages.length, 1);
  const token = /HX-([A-F0-9]{32})/.exec(f.sent[0].subject)[1]; assert(!f.welcomes[0].replyTokenHash.includes(token));
  assert.equal(f.welcomes[0].status, 'sent'); assert.match(f.sent[0].text, /Thank you for booking/);
});
test('staff/PMS records and uncertain delivery suppress automatic resends', async () => {
  const f = fixture(); await f.service.recordExternal(f.input.actor, { reservationId: 'stay', customerId: 'guest', stage: 'confirmation', expiresAt: new Date(stay.ScheduledEndUtc) });
  assert.equal((await f.service.send(f.input)).status, 'already_handled'); assert.equal(f.sent.length, 0);
  const g = fixture(); g.uncertain(); assert.equal((await g.service.send(g.input)).status, 'uncertain');
  assert.equal((await g.service.send(g.input)).status, 'review'); assert.equal(g.sent.length, 1);
});
test('only previously verified contacts receive a personal check-in welcome; sending never verifies them', async () => {
  const f = fixture('checkin'); await f.service.send(f.input); assert.doesNotMatch(f.sent[0].text, /checkout is on/);
  const g = fixture('checkin'); g.setProof(); await g.service.send(g.input); assert.match(g.sent[0].text, /Your checkout is on/); assert.doesNotMatch(g.sent[0].text, /CONNECT|Accept/);
  const h = fixture(); h.cancel(); assert.equal((await h.service.send(h.input)).status, 'failed'); assert.equal(h.sent.length, 0);
});
test('short-lead booking combines only live catalogue products and records them for cross-channel suppression', async () => {
  const f = fixture(); await f.service.send({ ...f.input, config: { ...config, welcomeUpsells: true } });
  assert.equal(f.sent.length, 1); assert.match(f.sent[0].text, /Airport transfer: 35 EUR/);
  assert.equal(f.claims.length, 1); assert.equal(f.claims[0].source, 'welcome'); assert.equal(f.claims[0].reservationId, 'stay');
  const g = fixture(); g.claims.push({ productId: 'transfer', source: 'staff' });
  await g.service.send({ ...g.input, config: { ...config, welcomeUpsells: true } }); assert.doesNotMatch(g.sent[0].text, /35 EUR/);
  const early = fixture(); early.current.ScheduledStartUtc = '2026-12-02T14:00:00Z'; early.current.ScheduledEndUtc = '2026-12-04T10:00:00Z';
  await early.service.send({ ...early.input, config: { ...config, welcomeUpsells: true } }); assert.equal(early.claims.length, 0); assert.match(early.sent[0].text, /Explore extras/);
});
test('confirmed and started events choose different welcomes and do not backfill old bookings', async () => {
  const f = fixture(); const sends = [];
  f.db.user = { findFirst: async () => f.input.actor };
  const automation = createCheckinAutomation({ db: f.db, now: () => clock, welcomeFor: () => ({ send: async input => { sends.push(input.stage); return { status: 'sent' }; } }) });
  await automation.process(config, f.input.reader, { reservationId: 'stay' });
  f.current.State = 'Started'; await automation.process(config, f.input.reader, { reservationId: 'stay' });
  assert.deepEqual(sends, ['confirmation', 'checkin']);
  f.current.State = 'Confirmed'; f.current.CreatedUtc = '2026-11-01T09:00:00Z'; await automation.process(config, f.input.reader, { reservationId: 'stay' }); assert.equal(sends.length, 2);
});
