import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savePmsHandoff } from '../modules/pms/pmsHandoff.js';

const context = { hotelId: 'hotel-a', conversationId: 'conv-a', raisedAt: '10:00' };

test('PMS approvals and uncertain outcomes enter the hotel-scoped escalation queue without creating tasks', async () => {
  for (const status of ['pending_approval', 'staff_check', 'uncertain', 'posting']) {
    let update;
    const db = { conversation: { updateMany: async args => { update = args; return { count: 1 }; } } };
    const escalation = await savePmsHandoff(db, context, { status });
    assert.deepEqual(update.where, { id: context.conversationId, guest: { hotelId: context.hotelId } });
    assert.equal(update.data.aiStatus, 'escalated');
    assert.equal(JSON.parse(update.data.escalation).department, 'Front Office');
    assert.equal(escalation.kind, status === 'pending_approval' ? 'pms_approval' : 'pms_review');
  }
});

test('ordinary quotes and completed postings do not escalate; reservation verification still does', async () => {
  let calls = 0;
  const db = { conversation: { updateMany: async () => { calls++; return { count: 1 }; } } };
  for (const status of ['information', 'offered', 'posted', 'awaiting_guest_acceptance', 'verification']) {
    assert.equal(await savePmsHandoff(db, context, { status }), null);
  }
  assert.equal(calls, 0);
  assert.equal((await savePmsHandoff(db, context, { status: 'verification', staffReview: true })).kind, 'reservation_verification');
  db.conversation.updateMany = async () => ({ count: 0 });
  await assert.rejects(savePmsHandoff(db, context, { status: 'pending_approval' }), /mismatch/);
});
