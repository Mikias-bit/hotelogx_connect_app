import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MicrosoftGraphEmailAdapter, graphRetryAt } from '../modules/email/microsoft/MicrosoftGraphEmailAdapter.js';
import { MicrosoftPollingService } from '../modules/email/microsoft/MicrosoftPollingService.js';
import { MicrosoftGraphWebhookService, createMicrosoftPushHandler } from '../modules/email/microsoft/MicrosoftGraphWebhookService.js';
import { MicrosoftGraphSubscriptionService } from '../modules/email/microsoft/MicrosoftGraphSubscriptionService.js';
import { MicrosoftWorkerService } from '../modules/email/microsoft/MicrosoftWorkerService.js';
import { createTaskDispatcher } from '../modules/email/microsoft/CloudTaskDispatcher.js';
const integration = { id: 'i', hotelId: 'h', provider: 'microsoft', status: 'connected', email: 'hotel@example.com', lastDeltaLink: 'https://graph.microsoft.com/v1.0/delta?old', graphSubscriptionId: 'sub', graphClientState: 'state' };
const raw = id => ({ id, from: { emailAddress: { address: 'guest@example.com' } }, receivedDateTime: '2026-10-20T19:00:00Z', body: { content: 'Hello', contentType: 'text' } });
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: { get: () => null } });
const adapter = fetchImpl => new MicrosoftGraphEmailAdapter(integration, { getToken: async () => ({ accessToken: 'fake' }), fetchImpl });
test('Graph Retry-After delays subsequent attempts', async () => {
  const when = graphRetryAt({ status: 429, retryAfter: '120' });
  assert.ok(when.getTime() >= Date.now() + 119000);
  const a = new MicrosoftGraphEmailAdapter({ ...integration, microsoftRetryAt: when }, { getToken: async () => { throw new Error('must not obtain token'); } });
  await assert.rejects(a.request('/me'), /Retry-After/);
});

test('delta traverses every page, skips tombstones/drafts/self and retains terminal link', async () => {
  let calls = 0;
  const a = adapter(async (url, options) => {
    assert.match(options.headers.Prefer, /ImmutableId/);
    calls++;
    return response(calls === 1 ? { value: [raw('1'), { id: 'deleted', '@removed': {} }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next' } :
      { value: [raw('2'), { ...raw('draft'), isDraft: true }, { ...raw('self'), from: { emailAddress: { address: integration.email } } }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?new' });
  });
  const pages = []; for await (const page of a.fetchInboundChanges({ pageSize: 1 })) pages.push(page);
  assert.equal(calls, 2); assert.deepEqual(pages.flatMap(p => p.messages.map(m => m.id)), ['1', '2']); assert.ok(pages[1].deltaLink);
});
test('expired cursor recovers from inbox and marks all recovery pages', async () => {
  let calls = 0;
  const a = adapter(async () => ++calls === 1 ? response({}, 410) : response({ value: [raw('old')], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?reset' }));
  for await (const page of a.fetchInboundChanges()) { assert.equal(page.recovery, true); assert.equal(page.expiredCursor, true); }
  assert.equal(calls, 2);
});
test('rejects malicious delta hosts before obtaining bearer token', async () => {
  const a = adapter(async () => { throw new Error('must not fetch'); });
  await assert.rejects(a.request('https://attacker.example/v1.0/delta'), /Invalid Graph URL/);
});
test('reply uses message ID and never falls back or retries ambiguous send', async () => {
  let calls = 0;
  const a = adapter(async (url, options) => { calls++; assert.match(url, /messages\/message-id\/reply$/); assert.equal(JSON.parse(options.body).message.body.contentType, 'Text'); throw new Error('timeout'); });
  await assert.rejects(a.reply({ targetMessageId: 'message-id', bodyText: 'Hello' })); assert.equal(calls, 1);
});
test('provider rejection is retryable but 5xx delivery is uncertain', async () => {
  for (const status of [429, 503]) {
    const a = adapter(async () => response({}, status));
    await assert.rejects(a.reply({ targetMessageId: 'id', bodyText: 'Hi' }), error => error.definitelyNotSent === (status === 429));
  }
});
test('failure retains cursor; retry commits only after all messages process', async () => {
  const updates = []; let fail = true; let resumed = 0;
  const db = { emailIntegration: { findUnique: async () => integration, updateMany: async args => { updates.push(args.data); return { count: 1 }; } } };
  const polling = new MicrosoftPollingService({ db, withMailboxLock: async (_, work) => work(async () => {}),
    adapterFactory: () => ({ async *fetchInboundChanges() { yield { messages: [{ id: '1' }], deltaLink: 'new' }; } }),
    processor: { resumePending: async () => { resumed++; }, process: async () => { if (fail) throw new Error('AI failure'); return {}; } } });
  await assert.rejects(polling.pollIntegration('h')); assert.equal(updates.some(x => x.lastDeltaLink), false);
  fail = false; await polling.pollIntegration('h'); assert.equal(updates.at(-1).lastDeltaLink, 'new'); assert.equal(resumed, 2);
});
test('initial history suppresses old mail; expired cursor suppresses recovered mail', async () => {
  const flags = [];
  const db = { emailIntegration: { findUnique: async () => ({ ...integration, microsoftConnectedAt: new Date('2026-10-20') }), updateMany: async () => ({ count: 1 }) } };
  const polling = new MicrosoftPollingService({ db, withMailboxLock: async (_, work) => work(async () => {}), adapterFactory: () => ({ async *fetchInboundChanges() {
    yield { messages: [{ receivedAt: new Date('2026-10-19') }, { receivedAt: new Date('2026-10-21') }], recovery: true };
    yield { messages: [{ receivedAt: new Date('2026-10-21') }], recovery: true, expiredCursor: true, deltaLink: 'new' };
  } }), processor: { resumePending: async () => {}, process: async (_, m, options) => { flags.push(Boolean(options.recovery)); return {}; } } });
  await polling.pollIntegration('h'); assert.deepEqual(flags, [true, false, true]);
});
test('webhook validates all client states before durable queue or dispatch', async () => {
  const order = [];
  const db = { emailIntegration: { findFirst: async () => integration }, microsoftSyncJob: { upsert: async () => order.push('save') } };
  const service = new MicrosoftGraphWebhookService({ db, enqueue: async () => order.push('dispatch') });
  await assert.rejects(service.accept({ value: [{ subscriptionId: 'sub', clientState: 'bad' }] }), { status: 403 }); assert.deepEqual(order, []);
  await service.accept({ value: [{ subscriptionId: 'sub', clientState: 'state' }] }); assert.deepEqual(order, ['save', 'dispatch']);
});
test('webhook validation is plaintext; queue failure is non-2xx', async () => {
  let status, type, text;
  const res = { status: n => { status = n; return res; }, type: n => { type = n; return res; }, send: n => { text = n; }, json: () => {}, end: () => {} };
  const handler = createMicrosoftPushHandler({ accept: async () => { throw new Error('queue offline'); } });
  await handler({ query: { validationToken: 'a+b test' } }, res); assert.equal(status, 200); assert.equal(type, 'text/plain'); assert.equal(text, 'a+b test');
  await handler({ query: {}, body: {} }, res); assert.equal(status, 503);
});
test('renewal does not create a duplicate subscription on transient failure', async () => {
  const paths = [];
  const service = new MicrosoftGraphSubscriptionService({ db: { emailIntegration: { update: async () => {} } }, adapterFactory: () => ({ request: async path => { paths.push(path); throw Object.assign(new Error('outage'), { status: 503 }); } }) });
  await assert.rejects(service.registerUnlocked(integration)); assert.deepEqual(paths, ['/subscriptions/sub']);
});
test('missing subscription is recreated with lifecycle endpoint and persisted client state', async () => {
  const writes = [], requests = [];
  const service = new MicrosoftGraphSubscriptionService({ notificationUrl: 'https://backend.example/webhook', db: { emailIntegration: { update: async x => writes.push(x.data) } }, adapterFactory: () => ({ request: async (path, options) => {
    requests.push({ path, options });
    if (path === '/subscriptions/sub') throw Object.assign(new Error('gone'), { status: 404 });
    if (!options) return { value: [] };
    return { id: 'new-sub', expirationDateTime: '2026-10-26T00:00:00Z' };
  } }) });
  await service.registerUnlocked(integration);
  assert.equal(requests.at(-1).options.body.lifecycleNotificationUrl, 'https://backend.example/webhook');
  assert.equal(writes[0].graphClientState, 'state'); assert.equal(writes.at(-1).graphSubscriptionId, 'new-sub');
});
test('worker renews lifecycle subscription before sync and only clears its own revision', async () => {
  const order = [];
  const worker = new MicrosoftWorkerService({ db: { emailIntegration: { findUnique: async () => integration }, microsoftSyncJob: {
    findUnique: async () => ({ renew: true, revision: 'r1' }), deleteMany: async q => { assert.equal(q.where.revision, 'r1'); order.push('delete'); },
  } }, subscriptions: { registerForHotel: async () => order.push('renew') }, polling: { pollIntegration: async () => order.push('poll') } });
  await worker.runHotel('h'); assert.deepEqual(order, ['renew', 'poll', 'delete']);
});
test('Cloud Tasks dispatch carries hotel ID and configured OIDC identity', async () => {
  let task;
  const enqueue = createTaskDispatcher({ queue: 'projects/p/locations/r/queues/q', url: 'https://backend.example/worker', audience: 'aud', serviceAccountEmail: 'worker@example.com', fetchImpl: async (url, options) => {
    if (url.includes('metadata.google')) return response({ access_token: 'fake-runtime-token', expires_in: 3600 });
    task = JSON.parse(options.body).task; return response({});
  } });
  await enqueue('hotel-a'); assert.deepEqual(JSON.parse(Buffer.from(task.httpRequest.body, 'base64')), { hotelId: 'hotel-a' });
  assert.equal(task.httpRequest.oidcToken.audience, 'aud'); assert.equal(task.dispatchDeadline, '600s');
});
