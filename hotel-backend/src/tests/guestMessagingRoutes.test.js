import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createGuestMessagingRouter } from '../modules/pms/guestMessagingRoutes.js';
import { captureGuestMessagingCode, isCheckinCodeMessage } from '../modules/pms/guestMessaging.js';

test('staff endpoints isolate the authenticated hotel, hide code hashes, and restrict settings to managers', async () => {
  const seen = [], writes = [];
  let role = 'front-office';
  const db = {
    guestMessagingConfig: { findUnique: async ({ where }) => { seen.push(where); return null; }, upsert: async input => { writes.push(input); return input.create; } },
    guestMessagingInvite: { findMany: async ({ where }) => { seen.push(where); return [{ id: 'invite', codeHash: 'private-hash', status: 'sent' }]; } },
    reservation: { findMany: async ({ where }) => { seen.push(where); return []; } },
  };
  const service = { issue: async (actor, input) => { assert.equal(actor.hotelId, 'hotel-a'); assert.equal(input.hotelId, 'hotel-b'); return { status: 'sent' }; },
    revoke: async actor => { assert.equal(actor.hotelId, 'hotel-a'); return { status: 'revoked' }; } };
  const app = express(); app.use(express.json()); app.use(createGuestMessagingRouter({ db, service,
    authenticateStaff: (req, res, next) => { req.user = { id: 'staff', hotelId: 'hotel-a', role }; next(); } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://localhost:${server.address().port}`;
  const post = (path, body, method = 'POST') => fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const body = await (await fetch(url + '/?hotelId=hotel-b')).json(); assert.equal(body.data.invitations[0].codeHash, undefined);
    await fetch(url + '/reservations?q=307&hotelId=hotel-b'); assert(seen.every(w => w.hotelId === 'hotel-a'));
    assert.equal((await post('/invitations', { hotelId: 'hotel-b' })).status, 200);
    assert.equal((await post('/invitations/invite/revoke', {})).status, 200);
    assert.equal((await post('/config', { whatsappTemplate: 'connection', whatsappLanguage: 'en' }, 'PUT')).status, 403);
    role = 'housekeeping'; assert.equal((await fetch(url + '/')).status, 403);
    role = 'manager'; assert.equal((await post('/config', { whatsappTemplate: 'connection', whatsappLanguage: 'en' }, 'PUT')).status, 200);
    assert.equal(writes[0].create.hotelId, 'hotel-a'); assert.equal(writes[0].create.updatedBy, 'staff');
    assert.equal((await post('/config', { whatsappTemplate: '../bad', whatsappLanguage: 'en' }, 'PUT')).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('code acknowledgments preserve escalation/manual ownership and respect disabled automatic replies', async () => {
  for (const [aiStatus, aiMode, autoReply, expected] of [
    ['ai-handling', 'Autonomous', true, false], ['escalated', 'Autonomous', true, false],
    ['human-takeover', 'Autonomous', true, true], ['ai-handling', 'Manual', true, true], ['ai-handling', 'Autonomous', false, true],
  ]) {
    const messages = [], calls = [];
    const db = { conversation: { findFirst: async () => ({ aiStatus, primaryChannel: 'whatsapp' }) },
      hotel: { findUnique: async () => ({ aiMode }) }, aiConfig: { findUnique: async () => ({ autoReply }) },
      message: { findFirst: async () => ({ channel: 'whatsapp' }), create: async ({ data }) => { messages.push(data); return data; } } };
    const result = await captureGuestMessagingCode(db, { hotelId: 'hotel-a', conversationId: 'c', messageText: 'CONNECT 0123456789ABCDEF01234567', sender: 'guest@example.com' },
      { redeem: async (ctx, text) => { calls.push({ ctx, text }); return 'Your guest messaging is connected for this stay.'; } });
    assert.equal(result.requiresApproval, expected); assert.equal(result.aiStatus, aiStatus); assert.equal(calls.length, 1);
    assert.equal(messages.length, expected ? 0 : 1);
    if (!expected) assert.match(result.message.id, /^m-info-/); // Existing WhatsApp acknowledgment delivery gate.
  }
  assert(isCheckinCodeMessage('CONNECT 0123456789ABCDEF01234567'));
  assert(!isCheckinCodeMessage('How do I connect to wifi?'));
  assert(!isCheckinCodeMessage('connect to wifi'));
});
