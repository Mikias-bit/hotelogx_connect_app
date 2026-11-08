import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createUpsellRouter } from '../modules/pms/pmsUpsellRoutes.js';

test('conversation review only loads offers and bindings from the selected hotel conversation', async () => {
  const queries = [];
  const db = {
    task: { findMany: async ({ where }) => { assert.equal(where.hotelId, 'hotel-a'); assert.deepEqual(where.upsellOfferId, { in: [] }); return []; } },
    conversation: { findFirst: async ({ where }) => {
      assert.equal(where.guest.hotelId, 'hotel-a');
      return where.id === 'conv-a' ? { id: 'conv-a' } : null;
    } },
    pmsUpsellOffer: { findMany: async ({ where }) => { queries.push(where); return []; } },
    pmsConversationBinding: { findMany: async ({ where }) => { queries.push(where); return []; } },
  };
  const app = express();
  app.use(createUpsellRouter({ db, client: {}, authenticateStaff: (req, res, next) => {
    req.user = { id: 'staff-a', hotelId: 'hotel-a', role: 'front-office' }; next();
  } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://localhost:${server.address().port}`;
  try {
    assert.equal((await fetch(`${url}/?conversationId=other-hotel-conversation`)).status, 400);
    assert.equal(queries.length, 0);
    assert.equal((await fetch(`${url}/?conversationId=conv-a`)).status, 200);
    assert.deepEqual(queries, [
      { hotelId: 'hotel-a', conversationId: 'conv-a' },
      { hotelId: 'hotel-a', conversationId: 'conv-a' },
    ]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('staff approval is tenant-scoped, immutable, and never a raw arbitrary tool call', async () => {
  let actor = { id: 'staff-a', hotelId: 'hotel-a', role: 'front-office' };
  let found = true; const calls = [];
  const offer = { id: 'offer-a', conversationId: 'conv-a', status: 'pending_approval', expiresAt: new Date(Date.now() + 60000) };
  const db = {
    conversation: { findFirst: async ({ where }) => { assert.equal(where.guest.hotelId, 'hotel-a'); return { id: 'conv-a' }; } },
    pmsUpsellOffer: {
      findFirst: async ({ where }) => { assert.equal(where.hotelId, 'hotel-a'); return found ? offer : null; },
      updateMany: async ({ where, data }) => { assert.equal(where.hotelId, 'hotel-a'); assert.equal(data.approvedBy, 'staff-a'); assert.equal(data.unitAmount, undefined); return { count: 1 }; },
    },
  };
  const client = { callStaffConversationTool: async (user, conversationId, name, args) => {
    assert.equal(user.hotelId, 'hotel-a'); assert.equal(conversationId, 'conv-a');
    calls.push({ name, args }); return { structuredContent: { status: 'awaiting_guest_acceptance' } };
  } };
  const app = express(); app.use(express.json(), createUpsellRouter({ db, client, authenticateStaff: (req, res, next) => { req.user = actor; next(); } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://localhost:${server.address().port}`;
  const post = body => fetch(`${url}/offers/offer-a/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    actor = { ...actor, role: 'housekeeping' }; assert.equal((await post({ note: 'checked' })).status, 403);
    actor = { ...actor, role: 'front-office' }; found = false; assert.equal((await post({ note: 'checked' })).status, 400);
    found = true; assert.equal((await post({ note: '' })).status, 400);
    assert.equal((await post({ note: 'Availability checked', hotelId: 'other', unitAmount: 1, name: 'charge_card' })).status, 200);
    assert.deepEqual(calls, [{ name: 'post_accepted_upsell', args: { offer_id: 'offer-a' } }]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test('only a manager can configure preparation, scoped to this hotel and a verified PMS product', async () => {
  let role = 'front-office'; let saved;
  const db = { pmsUpsellProduct: { upsert: async args => { saved = args; return args.create; } } };
  const client = { callTool: async (actor, tool) => {
    assert.equal(actor.hotelId, 'hotel-a'); assert.equal(tool, 'get_products');
    return { structuredContent: { Products: [{ Id: 'flowers', ServiceId: 'service', IsActive: true }] } };
  } };
  const app = express(); app.use(express.json(), createUpsellRouter({ db, client, authenticateStaff: (req, res, next) => { req.user = { id: 'manager', hotelId: 'hotel-a', role }; next(); } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const put = data => fetch(`http://localhost:${server.address().port}/products/flowers`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const data = { label: 'Flowers', serviceId: 'service', category: 'romance', priceSource: 'pms', preparationDepartment: 'Front Office', preparationInstructions: 'Place flowers before arrival', hotelId: 'foreign' };
  try {
    assert.equal((await put(data)).status, 400); assert.equal(saved, undefined);
    role = 'manager'; assert.equal((await put({ ...data, preparationDepartment: 'foreign' })).status, 400);
    assert.equal((await put(data)).status, 200);
    assert.equal(saved.create.hotelId, 'hotel-a'); assert.equal(saved.create.preparationDepartment, 'Front Office');
    assert.equal(saved.update.preparationInstructions, data.preparationInstructions);
    assert.equal((await put({ ...data, preparationDepartment: null })).status, 200);
    assert.equal(saved.update.preparationDepartment, null);
    for (const label of ['Baby cot', 'Travel crib', 'Babybedje']) {
      assert.equal((await put({ ...data, label, category: 'other', preparationDepartment: null })).status, 200);
      assert.equal(saved.update.category, 'baby_cot');
      assert.equal(saved.update.preparationDepartment, 'Housekeeping');
    }
    assert.equal((await put({ ...data, category: 'baby_cot', preparationDepartment: 'Front Office' })).status, 200);
    assert.equal(saved.update.preparationDepartment, 'Housekeeping');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
