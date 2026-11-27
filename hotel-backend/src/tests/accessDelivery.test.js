import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAccessDelivery } from '../modules/auth/accessDelivery.js';
import { createAccessOperatorRouter } from '../modules/auth/accessOperatorRoutes.js';
import { approveHotelAccess } from '../modules/auth/hotelAccessApproval.js';
import { createInviteHandler } from '../../../hotel-frontend/netlify/functions/hotel-invite.mjs';

const env = { ACCESS_SMTP_HOST: 'smtp.example.com', ACCESS_SMTP_USER: 'support@hotelogx.com', ACCESS_SMTP_PASSWORD: 'test-only',
  NETLIFY_IDENTITY_SITE_URL: 'https://hotelogx.example', HOTELOGX_INVITE_BRIDGE_SECRET: 'test-secret'.repeat(5) };
function fixture() {
  const requestRow = { id: 'request', status: 'pending', notificationStatus: 'pending', name: 'Applicant', hotelName: 'Hotel', email: 'guest@example.com' };
  const invitation = { id: 'invite', email: 'approved@example.com', deliveryStatus: 'pending', expiresAt: new Date('2099-01-01') };
  const match = (row, where) => Object.entries(where).every(([k, v]) => v?.gt ? row[k] > v.gt : (row[k] ?? null) === v);
  const model = row => ({ findUnique: async () => row, update: async ({ data }) => Object.assign(row, data),
    updateMany: async ({ where, data }) => { if (!match(row, where)) return { count: 0 }; Object.assign(row, data); return { count: 1 }; } });
  const db = { hotelAccessRequest: model(requestRow), hotelOnboardingInvite: model(invitation) };
  return { db, requestRow, invitation };
}
test('new requests notify only the configured operator, once, with a review link rather than an approval action', async () => {
  const f = fixture(), messages = [];
  const delivery = createAccessDelivery({ db: f.db, env, createTransport: () => ({ sendMail: async msg => { messages.push(msg); return { accepted: [msg.to] }; }, close() {} }) });
  await Promise.all([delivery.notify('request'), delivery.notify('request')]);
  assert.equal(messages.length, 1); assert.equal(messages[0].to, 'support@hotelogx.com'); assert.equal(messages[0].from, 'support@hotelogx.com');
  assert.match(messages[0].text, /https:\/\/hotelogx.example\/manager\/access-requests/);
  assert.match(messages[0].text, /guest@example.com/); assert.equal(f.requestRow.status, 'pending'); assert.equal(f.requestRow.notificationStatus, 'sent');
});
test('missing configuration keeps notification pending; ambiguous failures never cause automatic duplicates', async () => {
  const f = fixture(); const noConfig = createAccessDelivery({ db: f.db, env: {} });
  assert.equal((await noConfig.notify('request')).status, 'pending'); assert.equal(f.requestRow.notificationStatus, 'pending');
  let calls = 0;
  const delivery = createAccessDelivery({ db: f.db, env, createTransport: () => ({ sendMail: async () => { calls++; throw new Error('timeout'); }, close() {} }) });
  await delivery.notify('request'); await delivery.notify('request'); assert.equal(calls, 1); assert.equal(f.requestRow.notificationStatus, 'uncertain');
});
test('invitation sender uses only the approved recipient and records uncertain delivery without resending', async () => {
  const f = fixture(), calls = [];
  const delivery = createAccessDelivery({ db: f.db, env, request: async (url, options) => { calls.push({ url, options }); throw new Error('timeout'); } });
  await Promise.all([delivery.sendInvite('invite'), delivery.sendInvite('invite')]);
  assert.equal(calls.length, 1); assert.equal(String(calls[0].url), 'https://hotelogx.example/.netlify/functions/hotel-invite');
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'approved@example.com' }); assert.equal(f.invitation.deliveryStatus, 'uncertain');
  await delivery.sendInvite('invite'); assert.equal(calls.length, 1);
});
test('accepted, revoked and expired approvals cannot send an invitation', async () => {
  for (const data of [{ acceptedAt: new Date() }, { revokedAt: new Date() }, { expiresAt: new Date(0) }]) {
    const f = fixture(); Object.assign(f.invitation, data);
    const delivery = createAccessDelivery({ db: f.db, env, request: async () => assert.fail('must not send') });
    await assert.rejects(delivery.sendInvite('invite'));
  }
});
test('successful invitations are recorded once and confirmed provider rejection is marked failed', async () => {
  for (const accepted of [true, false]) {
    const f = fixture(); let calls = 0;
    const delivery = createAccessDelivery({ db: f.db, env, request: async () => {
      calls++; return { ok: accepted, json: async () => accepted ? { sent: true, userId: 'netlify-user' } : { definitelyNotSent: true } };
    } });
    assert.equal((await delivery.sendInvite('invite')).status, accepted ? 'sent' : 'failed');
    assert.equal(f.invitation.deliveryMessageId, accepted ? 'netlify-user' : null);
    await delivery.sendInvite('invite'); assert.equal(calls, 1);
  }
});
test('Netlify bridge requires the server secret and trusted platform Identity context; browser payload cannot choose credentials', async () => {
  const calls = []; const handler = createInviteHandler({ env, request: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ id: 'identity-user' }) }; } });
  const event = { httpMethod: 'POST', body: JSON.stringify({ email: 'approved@example.com', token: 'attacker-token' }), headers: {} };
  const context = { clientContext: { identity: { url: 'https://hotelogx.example/.netlify/identity', token: 'platform-token' } } };
  assert.equal((await handler(event, context)).statusCode, 403);
  event.headers.authorization = `Bearer ${env.HOTELOGX_INVITE_BRIDGE_SECRET}`;
  assert.equal((await handler(event, {})).statusCode, 503);
  const wrong = { clientContext: { identity: { url: 'https://wrong.example/.netlify/identity', token: 'platform-token' } } };
  assert.equal((await handler(event, wrong)).statusCode, 503);
  const result = await handler(event, context); assert.equal(result.statusCode, 200); assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer platform-token'); assert.deepEqual(JSON.parse(result.body), { sent: true, userId: 'identity-user' });
  assert.equal((await handler({ ...event, httpMethod: 'GET' }, context)).statusCode, 405);
});
test('ordinary hotel managers cannot list requests or approve hotels; the operator identity comes from authentication', async () => {
  let id = 'ordinary-manager', reads = 0;
  const db = { hotelAccessRequest: { findMany: async () => { reads++; return []; } }, hotelOnboardingInvite: { findMany: async () => [] } };
  const app = express(); app.use(express.json()); app.use(createAccessOperatorRouter({ db, env: { HOTELOGX_OPERATOR_USER_IDS: 'operator' },
    auth: (req, res, next) => { req.user = { id, role: 'manager' }; next(); }, delivery: { notificationReady: () => true, invitationReady: () => true } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve)); const url = `http://localhost:${server.address().port}`;
  try {
    assert.equal((await fetch(url)).status, 403); assert.equal(reads, 0);
    assert.equal((await fetch(url + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approvedBy: 'operator', confirmed: true }) })).status, 403);
    id = 'operator'; assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 409);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('operator can approve a direct invitation without any prior request', async () => {
  let saved;
  const db = { $executeRaw: async () => {}, $transaction: async fn => fn(db),
    hotelOnboardingInvite: { findUnique: async () => null, create: async ({ data }) => { saved = data; return { id: 'new-invite', ...data }; } },
    hotel: { create: async ({ data }) => data }, user: { findUnique: async () => null },
    hotelAccessRequest: { updateMany: async () => ({ count: 0 }) } };
  const result = await approveHotelAccess(db, { email: 'DIRECT@example.com', name: 'Direct Manager', hotelName: 'Direct Hotel', approvedBy: 'operator' });
  assert.equal(result.invitationId, 'new-invite'); assert.equal(saved.email, 'direct@example.com'); assert.equal(saved.role, 'manager'); assert.equal(saved.approvedBy, 'operator');
});
