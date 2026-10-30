import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBlocker, blockerTypes, createBlockerService, carryNeedsReview } from '../modules/operations/blockers.js';

const input = { type: 'dnd', description: 'Guest requested quiet', ownerName: 'FO duty manager', department: 'Front Office', nextAction: 'Confirm permission with guest', followUpLocal: '2026-10-30T14:00', details: {} };
test('structured blockers require owners, next steps, valid hotel-local dates and type-specific details', () => {
  const details = { service: 'Cleaning', alternative: 'Fresh towels at 15:00', item: 'Bath towels', part: 'Valve', contractor: 'Electrician', remainingFault: 'Outlet still has no power' };
  for (const type of Object.keys(blockerTypes)) {
    const values = validateBlocker({ ...input, type, details }, 'Europe/Amsterdam');
    assert.equal(values.followUpAt.toISOString(), '2026-10-30T13:00:00.000Z');
    assert.equal(values.needsDetails, false);
    if (!['dnd', 'guest_inside'].includes(type)) assert.throws(() => validateBlocker({ ...input, type }, 'UTC'), /Enter/);
  }
  for (const key of ['description', 'ownerName', 'department', 'nextAction', 'followUpLocal']) assert.throws(() => validateBlocker({ ...input, [key]: '' }, 'UTC'), /Enter/);
  for (const date of ['2026-02-30T14:00', '2026-10-30T26:00', 'tomorrow']) assert.throws(() => validateBlocker({ ...input, followUpLocal: date }, 'UTC'));
  for (const date of ['2026-03-29T02:30', '2026-10-25T02:30']) assert.throws(() => validateBlocker({ ...input, followUpLocal: date }, 'Europe/Amsterdam'), /clock change/);
  assert.throws(() => validateBlocker({ ...input, type: 'unknown' }, 'UTC'), /Choose/);
});
test('carry-over review is required each new hotel day, never implicitly completed', () => {
  const row = { carryForward: true, reportDate: '2026-10-28', carryReviewedDate: '2026-10-29' };
  assert.equal(carryNeedsReview(row, '2026-10-29'), false);
  assert.equal(carryNeedsReview(row, '2026-10-30'), true);
});
test('blocker operations reject unauthenticated and unrelated roles before database access', async () => {
  const service = createBlockerService({ db: {} });
  for (const user of [null, {}, { hotelId: 'a', role: 'guest' }]) {
    for (const call of [() => service.read(user), () => service.save(user), () => service.resolve(user, 'x', { note: 'done' })]) await assert.rejects(call, { status: 403 });
  }
  await assert.rejects(service.reviewCarry({ hotelId: 'a', role: 'maintenance' }, 'x'), { status: 403 });
});
