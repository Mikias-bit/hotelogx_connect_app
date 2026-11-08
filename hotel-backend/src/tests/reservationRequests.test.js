import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reservationRequestKinds, captureReservationRequests } from '../modules/pms/reservationRequests.js';

test('reservation changes and extra-bed requests are routed before general booking or upsell automation', () => {
  assert.deepEqual(reservationRequestKinds('Please cancel my booking'), ['cancellation']);
  assert.deepEqual(reservationRequestKinds('Can I change my arrival date?'), ['amendment']);
  assert.deepEqual(reservationRequestKinds('Please extend our stay and arrange an extra bed'), ['amendment', 'extra_bed']);
  assert.deepEqual(reservationRequestKinds('Can you prepare the sofa bed?'), ['extra_bed']);
  assert.deepEqual(reservationRequestKinds('What is your cancellation policy?'), []);
  assert.deepEqual(reservationRequestKinds('Is breakfast included?'), []);
});
test('unrelated messages have no request database side effects', async () => {
  assert.equal(await captureReservationRequests({}, { messageText: 'Thank you' }), null);
});
