import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { GoogleWorkspaceEmailAdapter, GmailApiError } from '../modules/email/gmail/GoogleWorkspaceEmailAdapter.js';
import { GmailPollingService } from '../modules/email/gmail/GmailPollingService.js';
import { GmailWatchService } from '../modules/email/gmail/GmailWatchService.js';
import { GmailPubSubService } from '../modules/email/gmail/GmailPubSubService.js';
import { GoogleOidcVerifier } from '../modules/email/gmail/GoogleOidcVerifier.js';
import { GmailInboundProcessor, gmailMessageKey } from '../modules/email/gmail/GmailInboundProcessor.js';

const integration = { id: 'integration-a', hotelId: 'hotel-a', email: 'mail@example.com', provider: 'google', status: 'connected', historyId: '90071992547409930' };
const withMailboxLock = async (id, work) => work(async () => {});
const adapter = () => new GoogleWorkspaceEmailAdapter(integration, { getToken: async () => ({ accessToken: 'fake' }) });

test('history pagination does not truncate, includes messages moved into inbox, retains integer precision', async () => {
  const a = adapter(), requests = [];
  a.request = async path => {
    requests.push(path);
    return requests.length === 1 ? { history: [{ messagesAdded: [{ message: { id: 'one' } }] }], historyId: '90071992547409999', nextPageToken: 'second' } :
      { history: [{ labelsAdded: [{ labelIds: ['INBOX'], message: { id: 'two' } }] }], historyId: '90071992547410000' };
  };
  const pages = []; for await (const p of a.fetchInboundChanges({ pageSize: 1 })) pages.push(p);
  assert.equal(pages[0].newHistoryId, null);
  assert.deepEqual(pages.flatMap(p => p.ids), ['one', 'two']);
  assert.equal(pages[1].newHistoryId, '90071992547410000');
  assert.match(requests[1], /startHistoryId=90071992547409930/);
  assert.match(requests[1], /pageToken=second/);
});

test('expired history performs a paginated full inbox scan with baseline captured before scan', async () => {
  const a = adapter(), requests = [];
  a.request = async path => {
    requests.push(path);
    if (path.startsWith('history')) throw new GmailApiError(404);
    if (path === 'profile') return { historyId: '100000000000000000' };
    return path.includes('pageToken') ? { messages: [{ id: 'old2' }] } : { messages: [{ id: 'old1' }], nextPageToken: 'next' };
  };
  const pages = []; for await (const p of a.fetchInboundChanges()) pages.push(p);
  assert.equal(requests[1], 'profile');
  assert.deepEqual(pages.flatMap(p => p.ids), ['old1', 'old2']);
  assert.ok(pages.every(p => p.recovery));
  assert.equal(pages.at(-1).newHistoryId, '100000000000000000');
});

test('history 429/500 errors never fall back and hide the failure', async () => {
  for (const status of [429, 500]) {
    const a = adapter(); a.request = async () => { throw new GmailApiError(status); };
    await assert.rejects(async () => { for await (const p of a.fetchInboundChanges()) void p; }, { status });
  }
});

test('message parser reads nested MIME and external text bodies; skips sent mail and deleted messages', async () => {
  const a = adapter();
  a.request = async path => path.includes('/attachments/') ? { data: Buffer.from('Full nested message').toString('base64url') } : {
    id: 'm1', threadId: 't1', labelIds: ['INBOX'], payload: { headers: [{ name: 'From', value: 'Guest <guest@example.com>' }], parts: [
      { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { attachmentId: 'body1' } }] },
    ] },
  };
  const msg = await a.fetchMessage('m1');
  assert.equal(msg.text, 'Full nested message'); assert.equal(msg.sender, 'guest@example.com');
  a.request = async () => ({ labelIds: ['INBOX', 'SENT'] });
  assert.equal(await a.fetchMessage('sent'), null);
  a.request = async () => { throw new GmailApiError(404); };
  assert.equal(await a.fetchMessage('deleted'), null);
  a.request = async () => { throw new GmailApiError(503); };
  await assert.rejects(a.fetchMessage('retry'));
});

function pollFixture(failAt = null) {
  const updates = [], processed = [], completed = new Set(); let shouldFail = failAt;
  const current = { ...integration };
  const db = { emailIntegration: {
    findUnique: async () => ({ ...current }),
    updateMany: async ({ data, where }) => { updates.push({ data, where }); Object.assign(current, data); return { count: 1 }; },
  } };
  const a = { async *fetchInboundChanges() { yield { ids: ['1'], newHistoryId: null }; yield { ids: ['2'], newHistoryId: '90071992547409940' }; }, fetchMessage: async id => ({ id }) };
  const processor = { process: async (i, m) => {
    if (shouldFail === m.id) throw new Error('Transient failure');
    if (completed.has(m.id)) return { duplicate: true };
    processed.push(m.id); completed.add(m.id); return {};
  } };
  const polling = new GmailPollingService({ db, adapterFactory: () => a, processor, withMailboxLock });
  return { polling, updates, processed, current, a, retry: () => { shouldFail = null; } };
}

test('failed message retains cursor; retry resumes and commits only after all pages complete', async () => {
  const f = pollFixture('2');
  await assert.rejects(f.polling.pollIntegration(integration));
  assert.equal(f.current.historyId, integration.historyId);
  assert.equal(f.updates.some(u => u.data.historyId), false);
  f.retry(); const result = await f.polling.pollIntegration(integration);
  assert.equal(result.duplicates, 1); assert.equal(result.processed, 1);
  assert.deepEqual(f.processed, ['1', '2']);
  assert.equal(f.current.historyId, '90071992547409940');
  assert.equal(f.updates.at(-1).where.historyId, integration.historyId);
});

test('message fetch failure and later page failure both retain cursor', async () => {
  const f = pollFixture();
  f.a.fetchMessage = async () => { throw new Error('Provider unavailable'); };
  await assert.rejects(f.polling.pollIntegration(integration));
  assert.equal(f.current.historyId, integration.historyId);
  const g = pollFixture();
  g.a.fetchInboundChanges = async function* () { yield { ids: ['1'] }; throw new Error('Page 2 unavailable'); };
  await assert.rejects(g.polling.pollIntegration(integration));
  assert.equal(g.current.historyId, integration.historyId);
});

test('watch renewal changes expiration but never the processing cursor', async () => {
  const writes = [];
  const db = { emailIntegration: { findUnique: async () => integration, update: async q => writes.push(q.data) } };
  const watches = new GmailWatchService({ db, withMailboxLock, topic: 'projects/hotelogx/topics/gmail', adapterFactory: () => ({
    renewSubscription: async () => ({ historyId: '999999999999999999', expiration: String(Date.now() + 86400000) }),
  }) });
  await watches.registerWatchForHotel(integration.hotelId);
  assert.ok(writes[0].watchExpiresAt);
  assert.equal('historyId' in writes[0], false);
  assert.equal('lastSyncAt' in writes[0], false);
});

test('Pub/Sub resolves only connected mailbox, never uses notification cursor as checkpoint', async () => {
  let query, polled;
  const pubsub = new GmailPubSubService({ db: { emailIntegration: { findMany: async q => { query = q; return [integration]; } } },
    polling: { pollIntegration: async i => { polled = i; return { success: true }; } }, subscription: 'projects/p/subscriptions/s' });
  const body = { subscription: 'projects/p/subscriptions/s', message: { data: Buffer.from(JSON.stringify({ emailAddress: 'MAIL@example.com', historyId: '999999999999999999' })).toString('base64') } };
  await pubsub.processPushEnvelope(body);
  assert.equal(query.where.email.equals, 'mail@example.com'); assert.equal(query.where.status, 'connected');
  assert.equal(polled.historyId, integration.historyId);
  assert.throws(() => pubsub.decodePushEnvelope({ ...body, subscription: 'wrong' }), { status: 400 });
  assert.throws(() => pubsub.decodePushEnvelope({ ...body, message: { data: 'bad' } }), { status: 400 });
});

test('OIDC verifies signature, audience, issuer, service identity, verified email and expiry; fails closed', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key' };
  let calls = 0;
  const verifier = new GoogleOidcVerifier({ now: () => 1700000000000, fetchImpl: async () => { calls++; return { ok: true, headers: new Headers({ 'cache-control': 'max-age=3600' }), json: async () => ({ keys: [jwk] }) }; } });
  const auth = { audience: 'https://backend/push', serviceAccountEmail: 'push@project.iam.gserviceaccount.com' };
  const claims = { iss: 'https://accounts.google.com', aud: auth.audience, email: auth.serviceAccountEmail, email_verified: true, sub: '123', iat: 1700000000, exp: 1700003600 };
  const token = (changes = {}, alg = 'RS256') => {
    const data = [ { alg, kid: 'test-key' }, { ...claims, ...changes } ].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
    return `Bearer ${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
  };
  assert.equal((await verifier.verifyAuthorizationHeader(token(), auth)).verified, true);
  await verifier.verifyAuthorizationHeader(token(), auth); assert.equal(calls, 1);
  for (const changes of [{ aud: 'wrong' }, { email: 'wrong' }, { email_verified: false }, { exp: 1699999999 }, { iss: 'evil' }]) {
    await assert.rejects(verifier.verifyAuthorizationHeader(token(changes), auth), { status: 401 });
  }
  await assert.rejects(verifier.verifyAuthorizationHeader(token({}, 'none'), auth), { status: 401 });
  await assert.rejects(verifier.verifyAuthorizationHeader('', auth), { status: 401 });
  await assert.rejects(verifier.verifyAuthorizationHeader(token(), {}), { status: 503 });
  const forged = token().split('.'); forged[2] = Buffer.from('forged').toString('base64url');
  await assert.rejects(verifier.verifyAuthorizationHeader(forged.join('.'), auth), { status: 401 });
});

test('deduplication is scoped to tenant AND mailbox AND provider message', () => {
  const first = gmailMessageKey('a', 'mail@example.com', '1');
  assert.notEqual(first, gmailMessageKey('b', 'mail@example.com', '1'));
  assert.notEqual(first, gmailMessageKey('a', 'other@example.com', '1'));
  assert.equal(first, gmailMessageKey('a', 'MAIL@example.com', '1'));
});

test('persisted automation resumes after rejected send without rerunning AI; uncertain sends are not repeated', async () => {
  const receipt = { id: gmailMessageKey(integration.hotelId, integration.email, '1'), conversationId: 'c1', sender: 'guest@example.com', subject: 'Question',
    automationResult: { replyText: 'Hello', requiresApproval: false, messageId: 'ai1' }, replyStatus: 'pending', status: 'pending' };
  const db = {
    gmailInboundMessage: { findUnique: async () => ({ ...receipt }), update: async ({ data }) => Object.assign(receipt, data) },
    message: { update: async () => {} }, activityItem: { upsert: async () => {} }, $transaction: async fn => fn(db),
  };
  let sends = 0, fail = true;
  const p = new GmailInboundProcessor({ db, automate: () => { throw new Error('AI must not rerun'); }, broadcast: () => {}, send: async () => {
    sends++; if (fail) throw Object.assign(new Error('Rejected'), { definitelyNotSent: true }); return { success: true, messageId: 'out' };
  } });
  const message = { id: '1', text: 'Question', receivedAt: new Date() };
  await assert.rejects(p.process(integration, message)); assert.equal(receipt.replyStatus, 'pending');
  fail = false; await p.process(integration, message); assert.equal(receipt.status, 'processed'); assert.equal(sends, 2);
  assert.equal((await p.process(integration, message)).duplicate, true); assert.equal(sends, 2);
  receipt.status = 'pending'; receipt.replyStatus = 'sending';
  await assert.rejects(p.process(integration, message), /uncertain/); assert.equal(sends, 2);
});
