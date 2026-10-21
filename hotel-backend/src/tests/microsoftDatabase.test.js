import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('Microsoft ingestion PostgreSQL and HTTP integration', { skip: process.env.MICROSOFT_DATABASE_TESTS !== 'true' }, async t => {
  assert.match(new URL(process.env.DATABASE_URL).searchParams.get('schema') || '', /^microsoft_test_[a-f0-9]+$/);
  const { prisma: db } = await import('../config/database.js');
  const { createMailboxLock } = await import('../modules/email/gmail/MailboxLock.js');
  const { MicrosoftInboundProcessor, microsoftMessageKey } = await import('../modules/email/microsoft/MicrosoftInboundProcessor.js');
  const { MicrosoftPollingService } = await import('../modules/email/microsoft/MicrosoftPollingService.js');
  const hotelId = 'ms-test-hotel';
  const integration = await db.emailIntegration.create({ data: { hotelId, email: 'hotel@example.com', provider: 'microsoft', accessToken: 'fake', lastDeltaLink: 'old', microsoftConnectedAt: new Date(0) } });
  const hotelData = { name: 'Test', legalName: '', address: '', postcode: '', city: '', country: '', phone: '', email: 'hotel@example.com', website: '', bookingEngine: '', whatsappNumber: '', vatNumber: '', description: '' };
  await db.hotel.create({ data: { id: hotelId, ...hotelData } });
  const lock = createMailboxLock(db, { schema: new URL(process.env.DATABASE_URL).searchParams.get('schema') });
  const message = { id: 'provider-1', threadId: 'thread-1', from: 'Guest <guest@example.com>', sender: 'guest@example.com', text: 'Hello', subject: 'Question', receivedAt: new Date() };
  let failAI = true, failSend = true, calls = 0, sends = 0;
  const processor = new MicrosoftInboundProcessor({ db, broadcast: () => {}, automate: async ({ database: tx, conversationId }) => {
    calls++;
    await tx.message.create({ data: { id: randomUUID(), conversationId, author: 'ai', channel: 'email', body: 'Welcome', at: 'now' } });
    if (failAI) throw new Error('AI failure');
    return { replyText: 'Welcome' };
  }, send: async options => {
    assert.equal(options.targetMessageId, message.id); sends++;
    if (failSend) throw Object.assign(new Error('Throttled'), { definitelyNotSent: true });
    return { success: true, messageId: null };
  } });
  let messages = [message];
  const polling = new MicrosoftPollingService({ db, processor, withMailboxLock: lock, adapterFactory: () => ({ async *fetchInboundChanges() { yield { messages, deltaLink: 'new' }; } }) });
  try {
    await t.test('case-insensitive mailbox uniqueness rejects another hotel', async () => {
      await assert.rejects(db.emailIntegration.create({ data: { hotelId: 'other', email: 'HOTEL@example.com', provider: 'microsoft' } }), { code: 'P2002' });
    });
    await t.test('AI rollback and failure leave cursor unchanged and one inbound receipt', async () => {
      await assert.rejects(polling.pollIntegration(hotelId));
      assert.equal((await db.emailIntegration.findUnique({ where: { hotelId } })).lastDeltaLink, 'old');
      assert.equal(await db.message.count({ where: { author: 'ai' } }), 0);
      assert.equal(await db.microsoftInboundMessage.count(), 1);
    });
    await t.test('send retry resumes persisted work after original message disappears', async () => {
      failAI = false;
      await assert.rejects(polling.pollIntegration(hotelId));
      assert.equal(calls, 2); assert.equal(sends, 1);
      failSend = false; messages = [];
      await polling.pollIntegration(hotelId);
      assert.equal(calls, 2); assert.equal(sends, 2);
      assert.equal((await db.emailIntegration.findUnique({ where: { hotelId } })).lastDeltaLink, 'new');
      messages = [message]; await polling.pollIntegration(hotelId); assert.equal(sends, 2);
      assert.equal(await db.message.count({ where: { author: 'guest' } }), 1);
    });
    await t.test('uncertain send is not repeated and cursor remains available', async () => {
      const receiptId = microsoftMessageKey(hotelId, integration.email, 'uncertain');
      let uncertainSends = 0;
      const uncertain = new MicrosoftInboundProcessor({ db, broadcast: () => {}, automate: async () => ({ replyText: 'Hi' }), send: async () => { uncertainSends++; throw new Error('Transport timeout'); } });
      await assert.rejects(lock(hotelId, async assertOwned => uncertain.process(integration, { ...message, id: 'uncertain' }, { assertOwned })));
      assert.equal((await db.microsoftInboundMessage.findUnique({ where: { id: receiptId } })).replyStatus, 'uncertain');
      await assert.rejects(lock(hotelId, check => uncertain.resumePending(integration, check)));
      assert.equal(uncertainSends, 1);
    });
    await t.test('OAuth authenticates manager, rejects wrong purpose and mailbox theft, preserves cursor', async () => {
      const { default: app } = await import('../app.js');
      const { signToken } = await import('../utils/jwt.js');
      const { generateOAuthState } = await import('../utils/tokenCrypto.js');
      const { microsoftClient } = await import('../modules/email/microsoftClient.js');
      const { microsoftSubscriptions } = await import('../modules/email/microsoft/runtime.js');
      const user = await db.user.create({ data: { hotelId, email: 'manager@example.com', name: 'Manager', role: 'manager' } });
      const token = signToken({ id: user.id, hotelId });
      const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}/api`;
      const saved = [microsoftClient.exchangeCodeForTokens, microsoftClient.getAuthenticatedMicrosoftProfile, microsoftSubscriptions.registerUnlocked];
      try {
        assert.equal((await fetch(`${base}/email/oauth/microsoft?hotelId=other`)).status, 401);
        const initiation = await fetch(`${base}/email/oauth/microsoft?hotelId=other`, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal((await initiation.json()).data.hotelId, hotelId);
        microsoftClient.exchangeCodeForTokens = async () => ({ accessToken: 'fake', refreshToken: 'fake-refresh', expiresIn: 3600 });
        microsoftClient.getAuthenticatedMicrosoftProfile = async () => ({ mail: integration.email });
        microsoftSubscriptions.registerUnlocked = async () => {};
        const callback = async (id, purpose) => {
          const state = generateOAuthState(id, '/onboarding', 'https://frontend.example', purpose);
          return fetch(`${base}/email-integrations/microsoft/callback?code=fake&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
        };
        assert.match((await callback(hotelId, 'gmail_oauth')).headers.get('location'), /oauth_status=error/);
        assert.match((await callback(hotelId, 'microsoft_oauth')).headers.get('location'), /oauth_status=success/);
        assert.equal((await db.emailIntegration.findUnique({ where: { hotelId } })).lastDeltaLink, 'new');
        await db.hotel.create({ data: { id: 'other', ...hotelData } });
        assert.match((await callback('other', 'microsoft_oauth')).headers.get('location'), /oauth_status=error/);
        assert.equal((await db.emailIntegration.findUnique({ where: { hotelId } })).email, integration.email);
        const validation = await fetch(`${base}/webhooks/email/microsoft/notifications?validationToken=hello%2Bworld`, { method: 'POST' });
        assert.equal(validation.status, 200); assert.equal(await validation.text(), 'hello+world');
        const worker = await fetch(`${base}/workers/email/microsoft-process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hotelId }) });
        assert.ok([401, 503].includes(worker.status));
      } finally {
        [microsoftClient.exchangeCodeForTokens, microsoftClient.getAuthenticatedMicrosoftProfile, microsoftSubscriptions.registerUnlocked] = saved;
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      }
    });
  } finally { await db.$disconnect(); }
});
