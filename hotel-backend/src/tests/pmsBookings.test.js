import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBookingAi } from '../modules/pms/pmsBookingAi.js';
import { createBookingRouter } from '../modules/pms/pmsBookingRoutes.js';
import { savePmsHandoff } from '../modules/pms/pmsHandoff.js';
import express from 'express';

const ctx = { hotelId: 'h', conversationId: 'c', messageText: 'I want to book a room', env: { OPENAI_API_KEY: 'test' } };
const tool = (name, args) => ({ role: 'assistant', tool_calls: [{ id: '1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const request = messages => async (_, options) => {
  const body = JSON.parse(options.body);
  assert.equal(body.parallel_tool_calls, false);
  assert(!body.tools.some(t => t.function.name === 'create_accepted_booking'));
  return { ok: true, json: async () => ({ choices: [{ message: messages.shift() }] }) };
};
test('new booking asks missing details, blocks model writes and invented quotes', async () => {
  const client = { callConversationTool: () => assert.fail('No PMS call expected') };
  const asked = await runBookingAi({ ...ctx, client, request: request([tool('ask_booking_details', { field: 'dates' })]) });
  assert.match(asked.replyText, /check-in and check-out/);
  for (const answer of [tool('create_accepted_booking', { offer_id: 'x' }), { content: 'Your reservation is confirmed for 1 EUR' }, tool('quote_booking', { price: 1 })]) {
    assert.equal((await runBookingAi({ ...ctx, client, request: request([answer]) })).status, 'booking_staff_check');
  }
});
test('search then quote uses server output; exact BOOK bypasses the model', async () => {
  const dates = { check_in: '2027-06-01', check_out: '2027-06-02', adults: 2, children_ages: [] };
  const calls = [];
  const client = { callConversationTool: async (context, name, args) => {
    assert.deepEqual(context, { hotelId: 'h', conversationId: 'c' }); calls.push(name);
    return { structuredContent: name === 'search_booking_availability' ? { status: 'booking_information', options: [{ category_id: 'room', rate_id: 'rate' }], reply_text: 'Live availability' } : { status: 'booking_offered', reply_text: 'Exact terms and BOOK ABCDEF123456' } };
  } };
  const result = await runBookingAi({ ...ctx, client, request: request([tool('search_booking_availability', dates), tool('quote_booking', { ...dates, category_id: 'room', rate_id: 'rate', first_name: 'Test', last_name: 'Guest', email: 't@example.com', phone: '+31612345678' })]) });
  assert.match(result.replyText, /^Exact terms/);
  assert.deepEqual(calls, ['search_booking_availability', 'quote_booking']);
  await runBookingAi({ ...ctx, messageText: 'BOOK ABCDEF123456', client, request: () => assert.fail('No model on acceptance') });
  assert.equal(calls.at(-1), 'create_accepted_booking');
});
test('successful booking enters Front Office escalation for payment; quote does not', async () => {
  const updates = [];
  const db = { conversation: { updateMany: async args => { updates.push(args); return { count: 1 }; } } };
  const context = { hotelId: 'h', conversationId: 'c', raisedAt: '12:00' };
  assert.equal(await savePmsHandoff(db, context, { status: 'booking_offered' }), null);
  const result = await savePmsHandoff(db, context, { status: 'booking_booked' });
  assert.equal(result.kind, 'pms_booking'); assert.match(result.reason, /payment/);
  assert.equal(updates[0].where.guest.hotelId, 'h');
});
test('booking API limits configuration to managers and denies foreign conversations', async () => {
  let user = { id: 'fo', hotelId: 'h', role: 'front-office' }, writes = 0;
  const db = { conversation: { findFirst: async () => null }, pmsBookingConfig: { upsert: () => { writes++; } } };
  const app = express(); app.use(express.json()); app.use(createBookingRouter({ db, client: { callTool: () => assert.fail('No PMS call') }, authenticateStaff: (req, res, next) => { req.user = user; next(); } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://localhost:${server.address().port}`;
    assert.equal((await fetch(url+'/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
    assert.equal((await fetch(url+'/offers?conversationId=foreign')).status, 400);
    user = { ...user, role: 'housekeeping' }; assert.equal((await fetch(url+'/config')).status, 403);
    assert.equal(writes, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('staff booking approval binds the stored hotel/conversation; disabling needs no PMS access', async () => {
  const user = { id: 'manager', hotelId: 'h', role: 'manager' }, calls = [], writes = [];
  const row = { id: 'offer', hotelId: 'h', conversationId: 'c', status: 'pending_approval', expiresAt: new Date(Date.now()+60000) };
  const db = {
    conversation: { findFirst: async args => { assert.equal(args.where.guest.hotelId, 'h'); return { id: 'c' }; }, updateMany: async args => { writes.push(args); return { count: 1 }; } },
    pmsBookingConfig: { updateMany: async args => { writes.push(args); return { count: 1 }; } },
    pmsBookingOffer: {
      findFirst: async args => { assert.equal(args.where.hotelId, 'h'); return args.where.id === 'offer' ? row : null; },
      updateMany: async args => { writes.push(args); return { count: 1 }; },
    },
  };
  const client = { callStaffConversationTool: async (actor, conversationId, name, args) => { calls.push({ actor, conversationId, name, args }); return { structuredContent: { status: 'booking_booked', reply_text: 'Created; staff will arrange payment.' } }; } };
  const app = express(); app.use(express.json()); app.use(createBookingRouter({ db, client, authenticateStaff: (req, res, next) => { req.user = user; next(); } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://localhost:${server.address().port}`;
    const post = (path, data) => fetch(url+path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await post('/offers/offer/approve', { note: 'Checked rate conditions and guest details', restrictionsChecked: true, hotelId: 'foreign', conversationId: 'foreign', price: 1 })).status, 200);
    assert.deepEqual(calls[0], { actor: user, conversationId: 'c', name: 'create_accepted_booking', args: { offer_id: 'offer' } });
    assert.equal((await post('/offers/foreign/approve', {})).status, 400);
    row.expiresAt = new Date(0); assert.equal((await post('/offers/offer/approve', { note: 'Checked everything', restrictionsChecked: true })).status, 400);
    assert.equal((await post('/disable', { hotelId: 'foreign' })).status, 200);
    assert.deepEqual(writes.at(-1).where, { hotelId: 'h' }); assert.equal(writes.at(-1).data.enabled, false);
    assert.equal(calls.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
