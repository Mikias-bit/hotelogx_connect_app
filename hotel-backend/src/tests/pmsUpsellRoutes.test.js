import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createUpsellRouter } from '../modules/pms/pmsUpsellRoutes.js';

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
