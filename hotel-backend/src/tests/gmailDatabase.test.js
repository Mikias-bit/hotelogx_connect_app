import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('Gmail PostgreSQL migration, leases, atomic ingestion and retry recovery', { skip: process.env.GMAIL_DATABASE_TESTS !== 'true' }, async t => {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema');
  assert.match(schema || '', /^gmail_test_[a-f0-9]+$/); // Never run against application tables.
  const { prisma: db } = await import('../config/database.js');
  const { createMailboxLock } = await import('../modules/email/gmail/MailboxLock.js');
  const { GmailInboundProcessor, gmailMessageKey } = await import('../modules/email/gmail/GmailInboundProcessor.js');
  const { GmailPollingService } = await import('../modules/email/gmail/GmailPollingService.js');
  const lock = createMailboxLock(db, { schema });
  const hotelId = 'gmail-test-hotel';
  const integration = await db.emailIntegration.create({ data: { hotelId, email: 'mail@example.com', provider: 'google', historyId: '100', accessToken: 'fake' } });
  await db.hotel.create({ data: { id: hotelId, name: 'Test', legalName: '', address: '', postcode: '', city: '', country: '', phone: '', email: 'mail@example.com', website: '', bookingEngine: '', whatsappNumber: '', vatNumber: '', description: '' } });
  const message = { id: 'provider-one', threadId: 'thread-one', from: 'Guest <guest@example.com>', sender: 'guest@example.com', text: 'Hello', subject: 'Question', receivedAt: new Date() };
  try {
    await t.test('lease excludes another worker and releases after exceptions', async () => {
      await lock(hotelId, async assertOwned => {
        await assertOwned();
        await assert.rejects(lock(hotelId, async () => {}), { status: 503 });
      });
      await assert.rejects(lock(hotelId, async () => { throw new Error('worker failed'); }));
      await lock(hotelId, async assertOwned => assertOwned());
    });
    await t.test('expired lease can be reclaimed without stale worker releasing its successor', async () => {
      await lock(hotelId, async assertOwned => {
        await db.gmailMailboxLock.update({ where: { hotelId }, data: { token: 'new-owner', expiresAt: new Date(Date.now() + 60000) } });
        await assert.rejects(assertOwned());
      });
      assert.equal((await db.gmailMailboxLock.findUnique({ where: { hotelId } })).token, 'new-owner');
      await db.gmailMailboxLock.update({ where: { hotelId }, data: { expiresAt: new Date(0) } });
      await lock(hotelId, async check => check());
    });
    await t.test('Gmail mailbox uniqueness is case-insensitive across hotels', async () => {
      await assert.rejects(db.emailIntegration.create({ data: { hotelId: 'other', email: 'MAIL@example.com', provider: 'google' } }), { code: 'P2002' });
    });
    let automationCalls = 0, sends = 0, failAutomation = true, rejectSend = true;
    const processor = new GmailInboundProcessor({ db, broadcast: () => {}, automate: async ({ database: tx, conversationId }) => {
      automationCalls++;
      await tx.message.create({ data: { id: randomUUID(), conversationId, author: 'ai', channel: 'email', body: 'Hello', at: 'now' } });
      if (failAutomation) throw new Error('automation failed');
      return { replyText: 'Hello', requiresApproval: false };
    }, send: async () => {
      sends++;
      if (rejectSend) throw Object.assign(new Error('Gmail unavailable'), { definitelyNotSent: true });
      return { success: true, messageId: 'sent-one' };
    } });
    const adapter = { async *fetchInboundChanges() { yield { ids: [message.id], newHistoryId: '200', recovery: false }; }, fetchMessage: async () => message };
    const polling = new GmailPollingService({ db, withMailboxLock: lock, adapterFactory: () => adapter, processor });
    await t.test('automation failure rolls back its writes, retains one inbound and the old cursor', async () => {
      await assert.rejects(polling.pollIntegration(integration));
      assert.equal(await db.message.count({ where: { author: 'ai' } }), 0);
      assert.equal(await db.message.count({ where: { author: 'guest' } }), 1);
      assert.equal((await db.emailIntegration.findUnique({ where: { hotelId } })).historyId, '100');
    });
    await t.test('failed send checkpoints automation; next attempt does not regenerate or duplicate it', async () => {
      failAutomation = false;
      await assert.rejects(polling.pollIntegration(integration));
      assert.equal(automationCalls, 2); assert.equal(sends, 1);
      assert.equal(await db.message.count({ where: { author: 'ai' } }), 1);
      const receipt = await db.gmailInboundMessage.findUnique({ where: { id: gmailMessageKey(hotelId, integration.email, message.id) } });
      assert.ok(receipt.automationResult); assert.equal(receipt.replyStatus, 'pending');
      rejectSend = false;
      // The provider message can disappear: durable pending work must still resume.
      adapter.fetchMessage = async () => null;
      await polling.pollIntegration(integration);
      assert.equal(automationCalls, 2); assert.equal(sends, 2);
      assert.equal((await db.emailIntegration.findUnique({ where: { hotelId } })).historyId, '200');
      assert.equal(await db.conversation.count(), 1);
      assert.equal((await db.conversation.findFirst()).unread, 1);
      assert.equal(await db.message.count({ where: { author: 'guest' } }), 1);
      await polling.pollIntegration(integration);
      assert.equal(sends, 2);
    });
    await t.test('recovery imports do not send retroactive replies', async () => {
      await lock(hotelId, async assertOwned => processor.process(integration, { ...message, id: 'old-mail' }, { assertOwned, recovery: true }));
      assert.equal(sends, 2); assert.equal(automationCalls, 2);
      assert.equal(await db.gmailInboundMessage.count({ where: { status: 'processed' } }), 2);
    });
    await t.test('current AI engine runs transactionally with external mail delivery deferred', async () => {
      const { processGuestMessageAI } = await import('../modules/conversations/aiService.js');
      const realProcessor = new GmailInboundProcessor({ db, automate: processGuestMessageAI, broadcast: () => {}, send: async () => ({ success: true, messageId: 'mock-real-ai-send' }) });
      await lock(hotelId, async assertOwned => realProcessor.process(integration, { ...message, id: 'real-ai', threadId: 'real-ai-thread', text: 'Hello, thank you for your help' }, { assertOwned }));
      const receipt = await db.gmailInboundMessage.findUnique({ where: { id: gmailMessageKey(hotelId, integration.email, 'real-ai') } });
      assert.equal(receipt.status, 'processed');
      assert.ok(receipt.automationResult.replyText);
      assert.equal(receipt.replyStatus, 'sent');
    });
    await t.test('HTTP routes enforce hotel ownership, OAuth preserves cursor, push errors are not acknowledged', async () => {
      const { default: app } = await import('../app.js');
      const { signToken } = await import('../utils/jwt.js');
      const { generateOAuthState } = await import('../utils/tokenCrypto.js');
      const { gmailClient } = await import('../modules/email/gmailClient.js');
      const { gmailWatchService } = await import('../modules/email/gmail/runtime.js');
      const { createPushHandler } = await import('../modules/email/gmail/gmailRoutes.js');
      const user = await db.user.create({ data: { hotelId, email: 'manager@example.com', name: 'Manager', role: 'manager' } });
      const token = signToken({ id: user.id, hotelId });
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}/api`;
      const saved = [gmailClient.exchangeCodeForTokens, gmailClient.getAuthenticatedGmailAddress, gmailWatchService.registerUnlocked];
      try {
        assert.equal((await fetch(`${base}/email/oauth/google?hotelId=other`)).status, 401);
        assert.equal((await fetch(`${base}/email/status?hotelId=other`)).status, 401);
        process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client';
        const initiation = await fetch(`${base}/email/oauth/google?hotelId=other`, { headers: { Authorization: `Bearer ${token}` } });
        const body = await initiation.json(); assert.equal(body.data.hotelId, hotelId);
        gmailClient.exchangeCodeForTokens = async () => ({ accessToken: 'fake', refreshToken: 'fake-refresh', expiresIn: 3600 });
        gmailClient.getAuthenticatedGmailAddress = async () => ({ email: integration.email, historyId: '99999' });
        gmailWatchService.registerUnlocked = async () => {};
        const state = generateOAuthState(hotelId, '/onboarding', 'https://frontend.example', 'gmail_oauth');
        const response = await fetch(`${base}/email-integrations/google/callback?code=fake&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
        assert.match(response.headers.get('location'), /oauth_status=success/);
        assert.equal((await db.emailIntegration.findUnique({ where: { hotelId } })).historyId, '200');
        let status;
        const res = { status: code => { status = code; return res; }, json: () => {}, end: () => {} };
        const handler = createPushHandler({ verifier: { verifyAuthorizationHeader: async () => {} }, pubsub: { processPushEnvelope: async () => { throw new Error('Processing failed'); } }, auth: {} });
        await handler({ headers: {}, body: {} }, res); assert.equal(status, 500);
        const success = createPushHandler({ verifier: { verifyAuthorizationHeader: async () => {} }, pubsub: { processPushEnvelope: async () => ({}) }, auth: {} });
        await success({ headers: {}, body: {} }, res); assert.equal(status, 204);
      } finally {
        [gmailClient.exchangeCodeForTokens, gmailClient.getAuthenticatedGmailAddress, gmailWatchService.registerUnlocked] = saved;
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      }
    });
  } finally { await db.$disconnect(); }
});
