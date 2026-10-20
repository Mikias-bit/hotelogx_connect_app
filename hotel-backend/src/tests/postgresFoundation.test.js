import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bulkUpsert } from '../utils/bulkUpsert.js';

test('PostgreSQL bulk upsert binds values and uses composite conflict keys', async () => {
  const queries = [];
  const prisma = { $executeRaw: async query => queries.push(query) };
  const hostile = "Guest's name'); DROP TABLE Room; --";
  await bulkUpsert(prisma, 'Room', ['hotelId', 'number', 'note', 'vip'],
    [['hotel-a', '101', hostile, false]], ['hotelId', 'number'], ['note', 'vip']);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /ON CONFLICT \("hotelId","number"\)|ON CONFLICT \("hotelId", "number"\)/);
  assert.match(queries[0].text, /EXCLUDED\."note"/);
  assert.ok(!queries[0].text.includes(hostile));
  assert.deepEqual(queries[0].values, ['hotel-a', '101', hostile, false]);
});

test('PostgreSQL batches large syncs and rejects invalid identifiers', async () => {
  let calls = 0;
  const prisma = { $executeRaw: async () => calls++ };
  await bulkUpsert(prisma, 'Guest', ['id', 'name'],
    Array.from({ length: 501 }, (_, i) => [String(i), 'Guest']), ['id'], ['name']);
  assert.equal(calls, 2);
  await assert.rejects(bulkUpsert(prisma, 'Guest;DROP', ['id'], [['1']], ['id'], ['id']), /Invalid SQL identifier/);
});
