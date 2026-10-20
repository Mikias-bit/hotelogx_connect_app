import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createInvitationService } from '../modules/users/invitationService.js';
import { createInvitationMailer } from '../utils/mailer.js';

const actor = { id: 'manager-1', hotelId: 'hotel-1', role: 'manager' };
function fixture(existing = null, sender = async () => ({ success: true, messageId: 'provider-1' }), connected = true) {
  const calls = { sends: [], creates: [], deletes: [], activities: [] };
  const db = {
    hotel: { findUnique: async () => ({ id: actor.hotelId, name: 'Test Hotel' }) },
    emailIntegration: { findUnique: async () => connected ? { status: 'connected', provider: 'google' } : null },
    user: {
      findUnique: async () => existing,
      create: async ({ data }) => { calls.creates.push(data); return { id: 'new-user', ...data }; },
      delete: async args => calls.deletes.push(args),
    },
    activityItem: { create: async args => calls.activities.push(args) },
  };
  const invite = createInvitationService({ db, send: async args => { calls.sends.push(args); return sender(args); } });
  return { invite, calls };
}

test('new staff gets a real send request and a matching hashed initial password', async () => {
  const { invite, calls } = fixture();
  const result = await invite(actor, { email: 'Staff@Example.com', role: 'front-office' });
  assert.equal(result.email, 'staff@example.com');
  assert.equal(result.passwordHash, undefined);
  assert.equal(calls.sends.length, 1);
  assert.ok(await bcrypt.compare(calls.sends[0].temporaryPassword, calls.creates[0].passwordHash));
  assert.equal(calls.activities.length, 1);
});

test('provider failure removes new account and never reports invitation success', async () => {
  const { invite, calls } = fixture(null, async () => { throw new Error('Provider failure'); });
  await assert.rejects(invite(actor, { email: 'staff@example.com' }), { status: 502 });
  assert.equal(calls.deletes.length, 1);
  assert.equal(calls.activities.length, 0);
});

test('simulation is rejected as unsuccessful delivery', async () => {
  const { invite } = fixture(null, async () => ({ success: true, simulated: true }));
  await assert.rejects(invite(actor, { email: 'staff@example.com' }), { status: 502 });
});

test('existing manager cannot be overwritten by an invitation', async () => {
  const { invite, calls } = fixture({ ...actor, email: 'manager@example.com' });
  await assert.rejects(invite(actor, { email: 'manager@example.com', role: 'housekeeping' }), { status: 409 });
  assert.equal(calls.sends.length, 0);
  assert.equal(calls.creates.length, 0);
});

test('cross-hotel account and non-manager requests are rejected', async () => {
  const { invite, calls } = fixture({ id: 'other', hotelId: 'hotel-2' });
  await assert.rejects(invite(actor, { email: 'other@example.com' }), { status: 409 });
  await assert.rejects(invite({ ...actor, role: 'housekeeping' }, { email: 'staff@example.com' }), { status: 403 });
  assert.equal(calls.sends.length, 0);
});

test('resending to existing staff preserves role and password', async () => {
  const existing = { id: 'existing', hotelId: actor.hotelId, email: 'staff@example.com', role: 'front-office', passwordHash: 'existing-hash' };
  const { invite, calls } = fixture(existing);
  await invite(actor, { email: existing.email, role: existing.role });
  assert.equal(calls.sends[0].temporaryPassword, null);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.deletes.length, 0);
});

test('missing connected mailbox fails before saving any user', async () => {
  const { invite, calls } = fixture(null, undefined, false);
  await assert.rejects(invite(actor, { email: 'staff@example.com' }), { status: 409 });
  assert.equal(calls.creates.length, 0);
});

test('invitation mail uses connected Gmail and the production frontend URL', async () => {
  let captured;
  const send = createInvitationMailer({
    db: { emailIntegration: { findUnique: async () => ({ provider: 'google', status: 'connected' }) } },
    google: { sendGuestGmail: async message => { captured = message; return { success: true, messageId: 'mock-provider-id' }; } },
    settings: { frontendUrl: 'https://hotelogxconnect.netlify.app', nodeEnv: 'production' },
  });
  await send({ hotelId: 'hotel-1', toEmail: 'staff@example.com', toName: 'Staff', title: 'Front Office', hotelName: 'Hotel', temporaryPassword: 'test-only-password' });
  assert.equal(captured.to, 'staff@example.com');
  assert.ok(captured.bodyText.includes('https://hotelogxconnect.netlify.app/login'));
  assert.ok(captured.bodyText.includes('test-only-password'));
  assert.ok(!captured.bodyText.includes('localhost'));
});
