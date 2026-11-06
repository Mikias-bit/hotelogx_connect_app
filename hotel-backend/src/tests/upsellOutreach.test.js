import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactDetails, matchesProduct, eligibleProducts, pricedProducts } from '../modules/upsells/upsellOutreach.js';
import { dueForUpsell, defaultUpsellConfig } from '../modules/upsells/upsellDelivery.js';
import { runPmsAiTools } from '../modules/pms/pmsAiTools.js';
import { upsellPipeline } from '../modules/upsells/upsellReporting.js';
import { createUpsellRouter } from '../modules/pms/pmsUpsellRoutes.js';
import { createUpsellWorkerRouter } from '../modules/upsells/upsellWorkerRoutes.js';
import { createUpsellPmsTriggers } from '../modules/upsells/upsellPmsTriggers.js';
import express from 'express';

test('campaign uses hotel-local dates, three-day default, late booking catch-up and excludes past/cancelled stays', () => {
  assert.equal(defaultUpsellConfig.daysBeforeArrival, 3);
  const config = { daysBeforeArrival: 3 }, now = new Date('2026-11-05T23:30:00Z');
  const due = (arrival, status = 'Confirmed') => dueForUpsell({ arrival, status }, config, now, 'Europe/Amsterdam');
  assert(due('2026-11-09')); assert(!due('2026-11-10')); assert(due('2026-11-07'));
  assert(!due('2026-11-05')); assert(!due('2026-11-10', 'Canceled')); assert(!due('2026-11-10', 'In House'));
  assert(!dueForUpsell({ arrival: '2026-11-11', status: 'Confirmed' }, { daysBeforeArrival: 2 }, now, 'Europe/Amsterdam'));
});

test('short-lead and same-day reservations become due on confirmation, using the hotel window', () => {
  const now = new Date('2026-11-06T09:00:00Z');
  for (const arrival of ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']) {
    assert(!dueForUpsell({ arrival, status: 'Optional', createdAt: now }, defaultUpsellConfig, now));
    assert(dueForUpsell({ arrival, status: 'Confirmed', createdAt: now }, defaultUpsellConfig, now));
  }
  assert(!dueForUpsell({ arrival: '2026-11-10', status: 'Confirmed' }, defaultUpsellConfig, now));
  assert(dueForUpsell({ arrival: '2026-11-10', status: 'Confirmed' }, { daysBeforeArrival: 7 }, now));
  assert(!dueForUpsell({ arrival: '2026-11-08', status: 'Confirmed' }, { daysBeforeArrival: 1 }, now));
});

test('authenticated reservation confirmation refreshes PMS then checks due offers immediately', async () => {
  const calls = []; let enabled = true;
  const triggers = createUpsellPmsTriggers({
    db: { upsellAutomationConfig: { findUnique: async ({ where }) => { assert.equal(where.hotelId, 'hotel-a'); return { enabled }; } } },
    sync: async id => { calls.push('sync'); await triggers.afterSync(id); },
    run: async id => { assert.equal(id, 'hotel-a'); calls.push('offers'); },
  });
  await triggers.afterWebhook('hotel-a', { Events: [{ Discriminator: 'ServiceOrderUpdated' }] }, true);
  assert.deepEqual(calls, ['sync', 'offers']);
  calls.length = 0;
  await triggers.afterWebhook('hotel-a', { type: 'ReservationConfirmed' }, false);
  await triggers.afterWebhook('hotel-a', { type: 'RoomUpdated' }, true);
  enabled = false;
  await triggers.afterWebhook('hotel-a', { type: 'ReservationConfirmed' }, true);
  await triggers.afterSync('hotel-a');
  assert.deepEqual(calls, []);
});

test('outreach failure does not turn a successful reservation sync into a failed sync', async () => {
  let reports = 0;
  const triggers = createUpsellPmsTriggers({ db: { upsellAutomationConfig: { findUnique: async () => ({ enabled: true }) } }, run: async () => { throw new Error('provider unavailable'); }, report: () => reports++ });
  await triggers.afterSync('hotel-a');
  assert.equal(reports, 1);
});

test('catalogue matching covers packages, transfers and hotel keywords without fabricated prices', () => {
  for (const [category, text] of [['airport_transfer', 'Our flight arrives at the airport'], ['birthday', 'It is my birthday'], ['romance', 'Our honeymoon'], ['wine', 'Bubles please'], ['early_checkin', 'We arrive early']]) assert(matchesProduct(text, { category, label: 'Hotel extra' }));
  assert(matchesProduct('een verrassing graag', { label: 'Love package', keywords: 'verrassing, romance' }));
  assert(!matchesProduct('I need towels', { label: 'Love package', category: 'romance' }));
  assert.deepEqual(contactDetails({ tags: '["phone:+31 612345678","guest@example.com"]' }), { email: 'guest@example.com', phone: '31612345678' });
  assert.equal(contactDetails({ tags: '["room:123","12345678"]' }).phone, null);
});

test('prior staff messages, AI offers and uncertain attempts suppress the same product across channels', async () => {
  const context = { hotelId: 'h', reservation: { mewsId: 'r', createdAt: new Date('2026-01-01') }, conversationIds: ['email', 'wa'] };
  const db = {
    upsellOutreach: { findMany: async ({ where }) => { assert.deepEqual(where, { hotelId: 'h', reservationId: 'r' }); return [{ productId: 'wine', status: 'uncertain' }]; } },
    pmsUpsellOffer: { findMany: async () => [{ productId: 'transfer', status: 'posted' }] },
    message: { findMany: async ({ where }) => { assert.deepEqual(where.conversationId.in, ['email', 'wa']); return [{ author: 'staff', channel: 'email', body: 'We can arrange a birthday package for you.' }]; } },
  };
  const products = [{ productId: 'wine', label: 'Wine' }, { productId: 'transfer', label: 'Transfer' }, { productId: 'birthday', label: 'Birthday package', category: 'birthday' }, { productId: 'parking', label: 'Parking', category: 'parking' }];
  assert.deepEqual((await eligibleProducts(db, context, products)).map(p => p.productId), ['parking']);
});

test('recommendations use only active configured products with live positive prices', async () => {
  const db = { pmsUpsellProduct: { findMany: async ({ where }) => { assert.equal(where.hotelId, 'h'); assert.equal(where.active, true); return [{ productId: 'p', label: 'Birthday package', category: 'birthday' }]; } } };
  const client = { callConversationTool: async (ctx, name) => { assert.deepEqual(ctx, { hotelId: 'h', conversationId: 'c' }); assert.equal(name, 'search_upsell_products'); return { structuredContent: { products: [{ product_id: 'p', name: 'Birthday package', unit_amount: 79, currency: 'EUR' }, { product_id: 'unapproved', unit_amount: 1, currency: 'EUR' }] } }; } };
  const result = await pricedProducts(db, client, { hotelId: 'h', conversationId: 'c' }, { text: 'Birthday trip' });
  assert.equal(result.length, 1); assert.equal(result[0].unitAmount, 79);
  client.callConversationTool = async () => ({ structuredContent: { products: [{ product_id: 'p', unit_amount: null, currency: 'EUR' }] } });
  assert.deepEqual(await pricedProducts(db, client, { hotelId: 'h', conversationId: 'c' }), []);
});

test('birthday messages enter PMS search and catalogue results remain structured for duplicate checks', async () => {
  let step = 0;
  const result = await runPmsAiTools({ hotelId: 'h', conversationId: 'c', messageText: 'It is my birthday', env: { OPENAI_API_KEY: 'test' },
    client: { listConversationTools: async () => ({ tools: [{ name: 'search_upsell_products', inputSchema: {} }] }), callConversationTool: async () => ({ structuredContent: { products: [{ product_id: 'cake', name: 'Birthday cake', unit_amount: 20, currency: 'EUR' }] } }) },
    request: async () => ({ ok: true, json: async () => ({ choices: [{ message: step++ === 0 ? { role: 'assistant', tool_calls: [{ id: '1', function: { name: 'search_upsell_products', arguments: '{"query":"birthday"}' } }] } : { content: 'Here is a cake' } }] }) }),
  });
  assert.equal(result.catalogueProducts[0].product_id, 'cake');
});

test('model prose without a catalogue lookup cannot send an invented priced offer', async () => {
  const result = await runPmsAiTools({ hotelId: 'h', conversationId: 'c', messageText: 'Birthday package please', env: { OPENAI_API_KEY: 'test' },
    client: { listConversationTools: async () => ({ tools: [{ name: 'search_upsell_products', inputSchema: {} }] }) },
    request: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'We can offer champagne for 1 EUR' } }] }) }),
  });
  assert.doesNotMatch(result.replyText, /1 EUR|champagne/);
});

test('reporting replaces invitation with PMS quote and counts revenue only after posting', async () => {
  const row = { hotelId: 'h', reservationId: 'r', productId: 'p', conversationId: 'c', createdAt: new Date('2026-11-05'), currency: 'EUR', name: 'Wine' };
  const db = { pmsUpsellOffer: { findMany: async () => [{ ...row, id: 'abcdef123456', totalAmount: 50, status: 'posted', expiresAt: new Date('2026-11-06') }] }, upsellOutreach: { findMany: async () => [{ ...row, id: 'invitation', status: 'sent', unitAmount: 25 }] }, conversation: { findMany: async () => [{ id: 'c', primaryChannel: 'email', guest: { name: 'Guest' } }] }, message: { findMany: async () => [] } };
  const rows = await upsellPipeline(db, 'h'); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'Accepted'); assert.equal(rows[0].value, 50);
  db.pmsUpsellOffer.findMany = async () => [];
  db.upsellOutreach.findMany = async () => [{ ...row, id: 'invitation', status: 'uncertain', unitAmount: 25 }];
  assert.equal((await upsellPipeline(db, 'h'))[0].status, 'Uncertain');
});

async function withServer(router, callback) {
  const app = express(); app.use(express.json(), router); const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try { await callback(`http://localhost:${server.address().port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('only managers configure schedules and configuration is scoped to authenticated hotel', async () => {
  let role = 'front-office'; const writes = [];
  const router = createUpsellRouter({ client: {}, db: { upsellAutomationConfig: { upsert: async args => { writes.push(args); return args.create; } } }, authenticateStaff: (req, res, next) => { req.user = { id: 'manager', hotelId: 'h', role }; next(); } });
  await withServer(router, async url => {
    const put = body => fetch(`${url}/automation`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const config = { ...defaultUpsellConfig, enabled: true, hotelId: 'foreign' };
    assert.equal((await put(config)).status, 400); role = 'manager';
    assert.equal((await put({ ...config, daysBeforeArrival: -1 })).status, 400);
    assert.equal((await put(config)).status, 200); assert.equal(writes[0].create.hotelId, 'h'); assert.equal(writes[0].create.daysBeforeArrival, 3);
  });
});
test('scheduled worker rejects missing or foreign identity before running campaigns', async () => {
  let calls = 0;
  const router = createUpsellWorkerRouter({ env: { UPSELL_WORKER_AUDIENCE: 'worker', UPSELL_WORKER_SERVICE_ACCOUNT: 'scheduler' }, verify: async token => { if (token !== 'Bearer trusted') throw new Error('no'); }, run: async () => { calls++; } });
  await withServer(router, async url => {
    assert.equal((await fetch(`${url}/upsell-campaigns`, { method: 'POST' })).status, 401); assert.equal(calls, 0);
    assert.equal((await fetch(`${url}/upsell-campaigns`, { method: 'POST', headers: { authorization: 'Bearer trusted' } })).status, 200); assert.equal(calls, 1);
  });
});
