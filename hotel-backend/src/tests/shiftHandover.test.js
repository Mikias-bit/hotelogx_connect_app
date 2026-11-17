import test from 'node:test';
import assert from 'node:assert/strict';
import { nextShift, listHandovers, createHandover, updateHandover } from '../modules/shift-handover/service.js';
const user = { hotelId: 'hotel-a', id: 'staff-a', name: 'Receptionist', role: 'front-office' };
const input = { shiftDate: '2026-12-31', shift: 'Night', title: 'Late arrival', body: 'Guest in room 208 arrives after midnight.', room: '208', priority: 'High' };

test('shift succession handles night, month/year rollover, leap dates and invalid dates', () => {
  assert.deepEqual(nextShift('2026-12-31', 'Night'), { targetDate: '2027-01-01', targetShift: 'Morning' });
  assert.deepEqual(nextShift('2026-12-31', 'Morning'), { targetDate: '2026-12-31', targetShift: 'Evening' });
  assert.deepEqual(nextShift('2028-02-29', 'Evening'), { targetDate: '2028-02-29', targetShift: 'Night' });
  assert.throws(() => nextShift('2026-02-29', 'Morning'));
  assert.throws(() => nextShift('2026-01-01', 'Other'));
});

test('unauthorized roles cannot read, create or update handovers', async () => {
  for (const role of ['housekeeping', 'maintenance', undefined]) {
    const actor = { ...user, role };
    await assert.rejects(listHandovers({}, actor, input.shiftDate), /access/);
    await assert.rejects(createHandover({}, actor, input), /access/);
    await assert.rejects(updateHandover({}, actor, 'id', {}), /access/);
  }
});

test('creation trusts authenticated hotel and author, validates content and preserves full timestamps', async () => {
  let data;
  const db = { shiftHandover: { create: async args => { data = args.data; return data; } } };
  await createHandover(db, user, { ...input, hotelId: 'foreign', authorId: 'foreign', targetShift: 'Night' });
  assert.equal(data.hotelId, user.hotelId); assert.equal(data.authorId, user.id);
  assert.equal(data.targetShift, 'Morning'); assert.equal(data.targetDate, '2027-01-01');
  assert.equal(data.events[0].actorName, user.name); assert.ok(Date.parse(data.events[0].at));
  await assert.rejects(createHandover(db, user, { ...input, body: '' }), /text/);
  await assert.rejects(createHandover(db, user, { ...input, priority: 'Unknown' }), /priority/);
});

test('listing scopes all branches to hotel and carries unfinished previous shifts forward', async () => {
  let query;
  await listHandovers({ shiftHandover: { findMany: async args => { query = args; return []; } } }, user, input.shiftDate);
  assert.equal(query.where.hotelId, 'hotel-a');
  assert.deepEqual(query.where.OR[2], { status: { not: 'Completed' }, targetDate: { lte: input.shiftDate } });
});

test('acknowledging does not complete work; completion and reopening require notes and retain audit history', async () => {
  let row = { id: 'id', hotelId: 'hotel-a', status: 'Open', version: 0, events: [] };
  const db = { shiftHandover: {
    findFirst: async ({ where }) => where.hotelId === row.hotelId ? row : null,
    updateMany: async ({ where, data }) => {
      assert.equal(where.hotelId, 'hotel-a'); assert.equal(where.version, row.version);
      row = { ...row, ...data, version: row.version + 1 }; return { count: 1 };
    },
  } };
  await updateHandover(db, user, 'id', { action: 'Acknowledge', version: 0 });
  assert.equal(row.status, 'Acknowledged');
  await assert.rejects(updateHandover(db, user, 'id', { action: 'Complete', version: 1 }), /text/);
  await updateHandover(db, user, 'id', { action: 'Complete', note: 'Guest checked in.', version: 1 });
  assert.equal(row.status, 'Completed');
  await updateHandover(db, user, 'id', { action: 'Reopen', note: 'Guest still needs a key.', version: 2 });
  assert.equal(row.status, 'Open'); assert.equal(row.events.length, 3);
  await assert.rejects(updateHandover(db, { ...user, hotelId: 'foreign' }, 'id', { action: 'Comment', note: 'hi', version: 3 }), /not found/);
  await assert.rejects(updateHandover(db, user, 'id', { action: 'Comment', note: 'hi', version: 0 }), /changed/);
  db.shiftHandover.updateMany = async () => ({ count: 0 });
  await assert.rejects(updateHandover(db, user, 'id', { action: 'Comment', note: 'hi', version: 3 }), /changed/);
});
