import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuestHandoffService, guestReplyNeedsReview, isGuestDepartmentTask } from '../modules/operations/guestHandoffs.js';

test('only Front Office and managers can confirm contact or resolve a guest issue', async () => {
  const service = createGuestHandoffService({ db: {} });
  for (const role of ['guest', 'housekeeping', 'maintenance', 'unknown']) {
    const user = { id: 'x', hotelId: 'a', role };
    await assert.rejects(service.act(user, 'id', { action: 'resolve', note: 'Done', version: 0 }), { status: 403 });
    await assert.rejects(service.enable(user, { workKind: 'task', workId: 'id' }), { status: 403 });
  }
  await assert.rejects(service.read({ role: 'manager' }), { status: 403 });
});
test('contact requires an actual channel and an outcome note; flags cannot bypass the sequence', async () => {
  const service = createGuestHandoffService({ db: {} }), user = { hotelId: 'a', role: 'front-office' };
  await assert.rejects(service.act(user, 'id', { action: 'contact', note: 'Called guest', channel: 'simulated' }), /channel/);
  await assert.rejects(service.act(user, 'id', { action: 'not_required', note: ' ' }), /record what happened/);
  assert.equal(isGuestDepartmentTask({ department: 'Maintenance', conversationId: 'c' }), true);
  assert.equal(isGuestDepartmentTask({ department: 'Maintenance' }), false);
  assert.equal(isGuestDepartmentTask({ department: 'Billing', conversationId: 'c' }), false);
});
test('guest replies during handoff require human review; recurrence never auto-resolves or chooses a repair', async () => {
  const queries = [], db = { guestHandoff: { findFirst: async ({ where }) => { queries.push(where); return where.state === 'resolved' ? { id: 'resolved' } : null; } } };
  assert.equal(await guestReplyNeedsReview(db, 'a', 'c', 'Thank you'), false);
  assert.equal(await guestReplyNeedsReview(db, 'a', 'c', 'The tap is still leaking'), true);
  assert(queries.every(q => q.hotelId === 'a' && q.conversationId === 'c'));
  assert.equal(await guestReplyNeedsReview({ guestHandoff: { findFirst: async () => ({ id: 'pending' }) } }, 'a', 'c', 'Thank you'), true);
});
