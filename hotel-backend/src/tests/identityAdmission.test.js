import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/database.js';
import { createIdentityAdmission, verifyIdentitySession, identityIssuer } from '../modules/auth/netlifyIdentity.js';
import { createIdentityRouter } from '../modules/auth/identityRoutes.js';
import { register, login, refreshToken } from '../modules/auth/authController.js';
import { signToken } from '../utils/jwt.js';

const issuer = 'https://hotelogx.example/.netlify/identity';
test('Identity session is checked at the configured HTTPS service, never at a token-supplied issuer', async () => {
  let captured;
  const user = await verifyIdentitySession('a-valid-looking-session-token', { siteUrl: 'https://hotelogx.example', request: async (url, options) => {
    captured = { url, options }; return { ok: true, json: async () => ({ id: 'identity', email: 'MANAGER@EXAMPLE.COM', confirmed_at: '2026-11-25', user_metadata: { hotelId: 'attacker', role: 'manager' } }) };
  } });
  assert.equal(captured.url, `${issuer}/user`); assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.options.headers.Authorization, 'Bearer a-valid-looking-session-token');
  assert.deepEqual(user, { id: 'identity', email: 'manager@example.com', issuer });
  for (const url of ['', 'http://hotelogx.example', 'https://name:password@hotelogx.example', 'https://hotelogx.example/other']) assert.throws(() => identityIssuer(url));
});
test('invalid, expired, unverified, banned and unavailable Identity sessions fail closed', async () => {
  const base = { siteUrl: 'https://hotelogx.example' };
  await assert.rejects(verifyIdentitySession(undefined, base), e => e.status === 401);
  await assert.rejects(verifyIdentitySession('x'.repeat(30), { ...base, request: async () => ({ ok: false, status: 401 }) }), e => e.status === 401);
  for (const data of [{ id: 'i', email: 'x@example.com' }, { id: 'i', email: 'x@example.com', confirmed_at: '2026-11-25', banned_until: '2099-01-01' }]) {
    await assert.rejects(verifyIdentitySession('x'.repeat(30), { ...base, request: async () => ({ ok: true, json: async () => data }) }), e => e.status === 403);
  }
  await assert.rejects(verifyIdentitySession('x'.repeat(30), { ...base, request: async () => { throw new Error('offline'); } }), e => e.status === 503);
});

function fixture() {
  const users = [], invitations = [{ id: 'invite', hotelId: 'approved-hotel', email: 'manager@example.com', name: 'Hotel Manager', role: 'manager', expiresAt: new Date('2099-01-01') }];
  const identity = { id: 'identity', email: 'manager@example.com', issuer };
  let chain = Promise.resolve();
  const db = {
    $executeRaw: async () => {},
    $transaction: fn => { const next = chain.then(() => fn(db)); chain = next.catch(() => {}); return next; },
    hotel: { findUnique: async ({ where }) => where.id === 'approved-hotel' ? { id: where.id, onboardingDone: false } : null },
    user: { findUnique: async ({ where }) => users.find(u => Object.entries(where).every(([k, v]) => u[k] === v)) || null,
      create: async ({ data }) => { const user = { id: 'user', ...data }; users.push(user); return user; },
      update: async ({ where, data }) => { const user = users.find(u => u.id === where.id); Object.assign(user, data); return user; } },
    hotelOnboardingInvite: { findUnique: async ({ where }) => invitations.find(i => i.email === where.email) || null,
      updateMany: async ({ where, data }) => { const invite = invitations.find(i => i.id === where.id && !i.acceptedAt && !i.revokedAt && i.expiresAt > where.expiresAt.gt);
        if (!invite) return { count: 0 }; Object.assign(invite, data); return { count: 1 }; } },
  };
  return { users, invitations, identity, db, admit: createIdentityAdmission({ db, verify: async () => identity }) };
}
test('approved manager is attached to the exact hotel, with atomic idempotent acceptance and no password exposure', async () => {
  const f = fixture(); const results = await Promise.all([f.admit('token'), f.admit('token')]);
  assert.equal(f.users.length, 1); assert.equal(f.invitations[0].identityId, 'identity'); assert(f.invitations[0].acceptedAt);
  for (const result of results) {
    assert.equal(result.user.hotelId, 'approved-hotel'); assert.equal(result.user.role, 'manager'); assert.equal(result.onboardingRequired, true);
    assert.equal(result.user.passwordHash, undefined); assert.equal(result.user.netlifyIdentityId, undefined);
  }
  assert.equal(f.users[0].passwordHash, '');
});
test('missing, expired, revoked, consumed and wrong-role approvals never create an account', async () => {
  for (const change of [f => f.invitations.pop(), f => { f.invitations[0].expiresAt = new Date(0); }, f => { f.invitations[0].revokedAt = new Date(); },
    f => { f.invitations[0].acceptedAt = new Date(); }, f => { f.invitations[0].role = 'front-office'; }, f => { f.identity.email = 'other@example.com'; }]) {
    const f = fixture(); change(f); await assert.rejects(f.admit('token'), e => e.status === 403); assert.equal(f.users.length, 0);
  }
});
test('existing accounts require an approved same-hotel and same-role mapping; existing password is preserved', async () => {
  for (const extra of [{ hotelId: 'another-hotel' }, { role: 'front-office' }, { netlifyIdentityId: 'different-identity' }]) {
    const f = fixture(); f.users.push({ id: 'existing', email: f.identity.email, hotelId: 'approved-hotel', role: 'manager', ...extra });
    await assert.rejects(f.admit('token'), e => e.status === 403);
  }
  const f = fixture(); f.users.push({ id: 'existing', email: f.identity.email, hotelId: 'approved-hotel', role: 'manager', passwordHash: 'existing-hash' });
  assert.equal((await f.admit('token')).user.id, 'existing'); assert.equal(f.users[0].passwordHash, 'existing-hash');
  f.identity.issuer = 'https://different.example/.netlify/identity'; await assert.rejects(f.admit('token'), e => e.status === 403);
});
test('HTTP admission ignores client hotel/role/email, closes public signup, and access requests do not grant access', async () => {
  const f = fixture(), requests = [];
  f.db.hotelAccessRequest = { upsert: async args => { requests.push(args); return {}; } };
  const app = express(); app.use(express.json()); app.post('/register', register);
  app.use(createIdentityRouter({ db: f.db, admit: async token => { assert.equal(token, 'identity-token'); return f.admit(token); },
    sign: (claims, ttl) => { assert.equal(claims.hotelId, 'approved-hotel'); assert.equal(claims.authProvider, 'netlify'); assert.equal(ttl, '30m'); return 'app-token'; } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://localhost:${server.address().port}`;
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer identity-token' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/register', {})).status, 403);
    assert.equal((await post('/request-access', { name: 'User', hotelName: 'Hotel', email: 'USER@EXAMPLE.COM', role: 'manager', hotelId: 'attack' })).status, 202);
    assert.equal(f.users.length, 0); assert.equal(requests[0].create.email, 'user@example.com'); assert.equal(requests[0].create.role, undefined); assert.deepEqual(requests[0].update, {});
    const response = await post('/identity', { hotelId: 'attack', role: 'superadmin', email: 'other@example.com' });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).data.user.hotelId, 'approved-hotel');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('legacy users retain real-password login; demo passwords and Identity JWT legacy refresh are rejected', async () => {
  const original = prisma.user.findUnique;
  const user = { id: 'old-manager', hotelId: 'old-hotel', role: 'manager', name: 'Manager', email: 'manager@example.com', passwordHash: await bcrypt.hash('actual-existing-password', 4) };
  prisma.user.findUnique = async () => user;
  const invoke = async (handler, req) => {
    let body, status = 200;
    const res = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
    await handler(req, res, error => { throw error; }); return { status, body };
  };
  try {
    assert.equal((await invoke(login, { body: { email: user.email, password: 'actual-existing-password' } })).status, 200);
    for (const password of ['demo-access', '123456', 'password123', '', undefined]) assert.equal((await invoke(login, { body: { email: user.email, password } })).status, 401);
    const token = signToken({ id: user.id, hotelId: user.hotelId, authProvider: 'netlify' }, '30m');
    assert.equal((await invoke(refreshToken, { headers: { authorization: `Bearer ${token}` } })).status, 401);
  } finally { prisma.user.findUnique = original; }
});
