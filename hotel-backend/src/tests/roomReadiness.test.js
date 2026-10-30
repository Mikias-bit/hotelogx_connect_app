import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadinessService } from '../modules/rooms/readinessService.js';
import { updateRoomStatus } from '../modules/rooms/roomsController.js';
import { handleAction } from '../modules/whatsapp/whatsappController.js';

test('readiness role checks reject unauthorized mutations before database access', async () => {
  const service = createReadinessService({ db: {} });
  await assert.rejects(service.read({ hotelId: 'a', role: 'guest' }), { status: 403 });
  const input = { token: 'test', note: 'Verified', action: 'inspect' };
  await assert.rejects(service.update({ hotelId: 'a', role: 'front-office' }, '100', input), { status: 403 });
  await assert.rejects(service.update({ hotelId: 'a', role: 'housekeeping' }, '100', { ...input, action: 'release' }), { status: 403 });
  await assert.rejects(service.update({ hotelId: 'a', role: 'maintenance' }, '100', input), { status: 403 });
});

test('legacy room and unsigned WhatsApp actions cannot complete tasks or release rooms', () => {
  for (const handler of [updateRoomStatus, handleAction]) {
    let status, body;
    const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
    handler({ user: { hotelId: 'a', role: 'manager' }, body: { status: 'Clean', actionType: 'room_clean', label: 'Cleaned' } }, res);
    assert.equal(status, 409); assert.equal(body.success, false);
  }
});
