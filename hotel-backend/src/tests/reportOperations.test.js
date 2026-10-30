import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { operationsRouter } from '../modules/reports/operationsRoutes.js';
import { createHousekeepingOperations } from '../modules/reports/housekeepingOperations.js';
import { WhatsAppMessagingService } from '../modules/whatsapp/WhatsAppMessagingService.js';
import { encryptToken } from '../utils/tokenCrypto.js';
import { hotelTime, planToken } from '../modules/reports/housekeepingPlan.js';
import { saveHousekeepingChange } from '../modules/reports/housekeepingChanges.js';

test('plan access times use hotel timezone and reject DST gaps and ambiguity', () => {
  assert.equal(hotelTime('2026-10-30', '14:00', 'Europe/Amsterdam').toISOString(), '2026-10-30T13:00:00.000Z');
  assert.equal(hotelTime('2026-07-30', '14:00', 'Europe/Amsterdam').toISOString(), '2026-07-30T12:00:00.000Z');
  assert.throws(() => hotelTime('2026-03-29', '02:30', 'Europe/Amsterdam'), /clock change/);
  assert.throws(() => hotelTime('2026-10-25', '02:30', 'Europe/Amsterdam'), /clock change/);
  assert.throws(() => hotelTime('2026-10-30', '25:00', 'Europe/Amsterdam'), /valid hotel-local/);
  assert.equal(hotelTime('2026-10-30', '', 'Europe/Amsterdam'), null);
  assert.notEqual(planToken({ contentHash: 'source', planVersion: 1 }), planToken({ contentHash: 'source', planVersion: 2 }));
});

test('plan changes deny unauthorized roles before database access', async () => {
  for (const role of ['maintenance', 'guest', 'unknown']) await assert.rejects(saveHousekeepingChange({}, { role }, null, {}), { status: 403 });
});

test('operational button IDs authenticate worker, hotel and expiry', () => {
  let time = new Date('2026-10-28T10:00:00Z');
  const service = createHousekeepingOperations({ db: {}, send: async () => {}, now: () => time, env: { PMS_MCP_CONTEXT_KEY: 'test'.repeat(12) } });
  const worker = { hotelId: 'hotel-a', id: 'worker-a' };
  const { id } = service.button(worker, 'assignment', 'task', 'done', 'Completed');
  assert.equal(service.parse(worker, id).action, 'done');
  assert.equal(service.parse({ ...worker, id: 'worker-b' }, id), null);
  assert.equal(service.parse({ ...worker, hotelId: 'hotel-b' }, id), null);
  assert.equal(service.parse(worker, id.replace('.done.', '.start.')), null);
  assert.equal(service.parse(worker, id.slice(0, -22) + 'é'.repeat(22)), null);
  time = new Date(+time + 86401000); assert.equal(service.parse(worker, id), null);
});

test('Meta sender preserves signed button IDs and rejects malformed controls', async () => {
  const sent = [];
  const service = new WhatsAppMessagingService({ db: { whatsAppIntegration: { findFirst: async () => ({ id: 'wa', hotelId: 'a', status: 'connected', verifiedAt: new Date(), phoneNumberId: '123', wabaId: '456', accessToken: encryptToken('test-token') }), update: async () => {} } }, request: async (path, token, options) => { sent.push(options.body); return { messages: [{ id: 'message' }] }; } });
  const body = { hotelId: 'a', to: '+31612345678', text: 'Task', buttons: [{ id: 'signed-action', title: 'Accept' }] };
  assert.equal((await service.send(body)).success, true);
  assert.deepEqual(sent[0].interactive.action.buttons[0].reply, body.buttons[0]);
  assert.equal((await service.send({ ...body, buttons: [body.buttons[0], body.buttons[0]] })).success, false);
  assert.equal(sent.length, 1);
});

test('worker administration trusts authenticated hotel and rejects foreign worker changes', async () => {
  const workers = [], db = { $executeRaw: async () => 1, housekeepingWorker: {
    create: async ({ data }) => { const row = { id: `w-${workers.length}`, ...data }; workers.push(row); return row; },
    findFirst: async ({ where }) => workers.find(row => Object.entries(where).every(([k, v]) => row[k] === v)),
    update: async ({ where, data }) => Object.assign(workers.find(w => w.id === where.id), data),
  } }; db.$transaction = work => work(db);
  const app = express(); app.use(express.json()); app.use('/operations', operationsRouter({ db, service: {}, broadcast: () => {}, auth: (req, res, next) => { req.user = { id: 'manager', hotelId: req.headers['x-test-hotel'] || 'a', role: req.headers['x-test-role'] || 'manager' }; next(); } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/operations/workers`;
  const body = { name: 'Worker', phone: '+31612345678', whatsappEnabled: true, active: true, hotelId: 'forged' };
  const send = (suffix = '', extra = {}, data = body) => fetch(url + suffix, { method: suffix ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(data) });
  try {
    assert.equal((await send('', { 'x-test-role': 'front-office' })).status, 403);
    assert.equal((await send('', { 'x-test-role': 'maintenance' })).status, 403);
    assert.equal((await send()).status, 200); assert.equal(workers[0].hotelId, 'a');
    assert.equal((await send('/w-0', { 'x-test-hotel': 'b' })).status, 404);
    assert.equal((await send('/w-0', {}, { ...body, phone: '+31687654321' })).status, 200);
    assert.equal(workers[0].id, 'w-0'); assert.equal(workers[0].lastInboundAt, null);
    assert.equal((await send('', {}, { ...body, phone: '0612345678' })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
