import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBookingOrigin, lookupBookingOrigin, sourceReply } from '../modules/pms/bookingOrigin.js';

test('PMS source classification never infers direct from missing agency data alone', () => {
  for (const Origin of ['Distributor', 'Navigator', 'CommanderPhone', 'CommanderEmail', 'CommanderWebsite', 'CommanderInPerson']) assert.equal(classifyBookingOrigin({ Origin }).type, 'direct');
  assert.equal(classifyBookingOrigin({ Origin: 'Commander', CommanderOrigin: 'Phone' }).type, 'direct');
  for (const Origin of ['Connector', 'Import', 'Commander', 'CommanderRoomingList', undefined]) assert.equal(classifyBookingOrigin({ Origin }).type, 'unknown');
  assert.equal(classifyBookingOrigin({ Origin: 'Connector' }, true).type, 'direct');
  for (const row of [{ Origin: 'ChannelManager' }, { Origin: 'CommanderChannel' }, { Origin: 'Commander', CommanderOrigin: 'Channel' }, { Origin: 'Distributor', TravelAgencyId: 'agency' }, { Origin: 'Connector', ChannelNumber: 'reference' }, { Origin: 'Commander', OriginDetails: 'Sabre GDS' }]) assert.equal(classifyBookingOrigin(row, true).type, 'external');
  const ota = classifyBookingOrigin({ Origin: 'ChannelManager', OriginDetails: 'Booking.com' });
  assert.equal(ota.provider, 'Booking.com'); assert.match(sourceReply(ota), /Booking.com/);
  assert.match(sourceReply({ type: 'external' }), /travel agency or booking service/);
});

test('source lookup requires verified ownership and a hotel-scoped PMS reader', async () => {
  let binding = null, calls = 0;
  const db = { pmsConversationBinding: { findFirst: async ({ where }) => { assert.equal(where.hotelId, 'h'); return binding; } }, user: { findFirst: async () => ({ id: 'staff', hotelId: 'h', role: 'manager' }) } };
  let reservation = { Id: 'r', AccountType: 'Customer', AccountId: 'guest', Origin: 'Distributor' };
  const client = { callTool: async (actor, name, args) => { calls++; assert.equal(actor.hotelId, 'h'); assert.equal(name, 'get_reservations'); assert.deepEqual(args, { reservation_ids: ['r'] }); return { structuredContent: { Reservations: [reservation] } }; } };
  const context = { hotelId: 'h', conversationId: 'c' };
  assert.equal((await lookupBookingOrigin(db, context, { client })).type, 'unknown'); assert.equal(calls, 0);
  binding = { reservationId: 'r', customerId: 'guest', expiresAt: new Date(0) };
  assert.equal((await lookupBookingOrigin(db, context, { client })).type, 'unknown'); assert.equal(calls, 0);
  binding.expiresAt = null;
  assert.equal((await lookupBookingOrigin(db, context, { client })).type, 'direct');
  reservation.AccountId = 'different';
  assert.equal((await lookupBookingOrigin(db, context, { client })).type, 'unknown');
  assert.equal((await lookupBookingOrigin(db, context, { client, actor: { hotelId: 'other', role: 'manager' } })).type, 'unknown');
  assert.equal((await lookupBookingOrigin(db, context, { client: { callTool: async () => { throw new Error('offline'); } } })).type, 'unknown');
});
