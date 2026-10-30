import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMaintenanceOperations } from '../modules/maintenance/maintenanceOperations.js';
import { createMaintenanceRouter } from '../modules/maintenance/maintenanceRoutes.js';

test('maintenance action signatures bind hotel, worker, phone, assignment and expiry', () => {
  let date = new Date('2026-10-30T10:00:00Z');
  const service = createMaintenanceOperations({ db: {}, send: () => {}, env: { PMS_MCP_CONTEXT_KEY: 'x'.repeat(40) }, now: () => date });
  const worker = { id: 'worker-a', hotelId: 'hotel-a', phone: '+31612345678' };
  const button = service.button(worker, 'batch', 'issue:ticket.with.dots', 'start', 'Start');
  assert.equal(service.parse(worker, button.id).workRef, 'issue:ticket.with.dots');
  for (const other of [{ ...worker, id: 'worker-b' }, { ...worker, hotelId: 'hotel-b' }, { ...worker, phone: '+31699999999' }]) assert.equal(service.parse(other, button.id), null);
  assert.equal(service.parse(worker, button.id.replace('.start.', '.done.')), null);
  date = new Date('2026-11-01T10:00:00Z'); assert.equal(service.parse(worker, button.id), null);
});

test('assignment inputs and API access fail closed before database or provider use', async () => {
  const service = createMaintenanceOperations({ db: {}, send: () => { throw new Error('Must not send'); } });
  await assert.rejects(service.assign({ hotelId: 'a', role: 'front-office' }, {}), /access required/);
  await assert.rejects(service.assign({ hotelId: 'a', role: 'maintenance' }, { work: [], requestKey: 'x' }), /Choose a technician/);
  await assert.rejects(service.assign({ hotelId: 'a', role: 'maintenance' }, { work: [{ kind: 'issue', id: 'ticket', version: 0 }], requestKey: '1234567890123456' }), /Choose a technician/);
  let actor = { id: 'staff', hotelId: 'hotel-a', role: 'front-office' }, called = 0;
  const app = express(); app.use(createMaintenanceRouter({ service: { read: async user => { called++; assert.equal(user.hotelId, 'hotel-a'); return { work: [], workers: [] }; } }, auth: (req, res, next) => { req.user = actor; next(); } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://localhost:${server.address().port}/?hotelId=hotel-b`;
    assert.equal((await fetch(url)).status, 403);
    actor = { ...actor, role: 'maintenance' }; assert.equal((await fetch(url)).status, 200);
    actor = { ...actor, hotelId: null }; assert.equal((await fetch(url)).status, 403);
    assert.equal(called, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
