import test from 'node:test';
import assert from 'node:assert/strict';
import { completedToday, messageTime, conversationTime, dateLabel } from '../src/lib/timeline.ts';

test('completed today uses completion date and hotel timezone, not creation date or status alone', () => {
  const now = new Date('2026-11-17T23:30:00Z');
  const task = { status: 'Completed', createdAt: '2026-11-01T12:00:00Z', completedAt: '2026-11-17T23:05:00Z' };
  assert.equal(completedToday(task, 'Europe/Amsterdam', now), true);
  assert.equal(completedToday({ ...task, completedAt: '2026-11-17T20:00:00Z' }, 'Europe/Amsterdam', now), false);
  assert.equal(completedToday({ ...task, completedAt: undefined }, 'Europe/Amsterdam', now), false);
  assert.equal(completedToday({ ...task, status: 'In Progress' }, 'Europe/Amsterdam', now), false);
});

test('messages and conversations sort across midnight and prefer provider dates over import dates', () => {
  const old = { at: '23:59', createdAt: '2026-11-16T23:59:00Z' };
  const recent = { at: '00:01', createdAt: '2026-11-17T00:01:00Z' };
  assert.ok(messageTime(recent) > messageTime(old));
  assert.ok(conversationTime({ lastAt: '00:01', messages: [recent] }) > conversationTime({ lastAt: '23:59', messages: [old] }));
  assert.equal(messageTime({ at: '2026-10-01T10:00:00Z', createdAt: '2026-11-17T00:01:00Z' }), Date.parse('2026-10-01T10:00:00Z'));
});

test('legacy time-only dates are labelled unavailable instead of being presented as today', () => {
  assert.equal(dateLabel('12:30'), '12:30 (date unavailable)');
  assert.equal(dateLabel(undefined), 'Date unavailable');
});
