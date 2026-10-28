import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createLostFoundRouter } from '../modules/lost-found/lostFoundRoutes.js';

test('lost and found persists validated items for Manager and Front Office, isolates hotels and prevents stale edits', async () => {
  let actor = { id: 'manager-a', hotelId: 'hotel-a', role: 'manager' };
  const rows = [], queries = [];
  const match = (row, where) => row.hotelId === where.hotelId && (!where.id || row.id === where.id)
    && (where.version === undefined || row.version === where.version)
    && (!where.OR || where.OR.some(condition => Object.entries(condition).some(([key, value]) => row[key].toLowerCase().includes(value.contains.toLowerCase()))));
  const db = { lostFoundItem: {
    create: async ({ data }) => {
      const row = { ...data, id: `item-${rows.length}`, version: 1, createdAt: new Date(), updatedAt: new Date() };
      rows.push(row); return row;
    },
    findMany: async ({ where, skip, take }) => { queries.push({ where, skip, take }); return rows.filter(row => match(row, where)).slice(skip, skip + take); },
    count: async ({ where }) => rows.filter(row => match(row, where)).length,
    findFirst: async ({ where }) => rows.find(row => match(row, where)) || null,
    updateMany: async ({ where, data }) => {
      const row = rows.find(row => match(row, where));
      if (!row) return { count: 0 };
      Object.assign(row, { ...data, version: row.version + data.version.increment }); return { count: 1 };
    },
  } };
  const app = express(); app.use(express.json(), createLostFoundRouter({ db, auth: (req, res, next) => {
    if (!actor) return res.status(401).json({ success: false });
    req.user = actor; next();
  } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://localhost:${server.address().port}`;
  const request = async (path = '/', method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...await response.json() };
  };
  const valid = { category: ' Electronics ', item: 'Headphones', description: 'Black headphones in a blue case', foundLocation: 'Room 203', storageLocation: 'Front Office shelf B' };
  try {
    actor = null; assert.equal((await request()).status, 401);
    actor = { id: 'worker-a', hotelId: 'hotel-a', role: 'housekeeping' };
    assert.equal((await request()).status, 403);
    assert.equal((await request('/', 'POST', valid)).status, 403);
    actor = { id: 'manager-a', hotelId: 'hotel-a', role: 'manager' };
    for (const field of Object.keys(valid)) {
      assert.equal((await request('/', 'POST', { ...valid, [field]: ' ' })).status, 400);
      assert.equal((await request('/', 'POST', { ...valid, [field]: {} })).status, 400);
    }
    assert.equal((await request('/', 'POST', { ...valid, description: 'x'.repeat(4001) })).status, 400);
    assert.equal(rows.length, 0);
    const created = await request('/', 'POST', { ...valid, hotelId: 'hotel-b', createdBy: 'forged', id: 'forged', version: 500 });
    assert.equal(created.status, 201);
    assert.equal(created.data.category, 'Electronics');
    assert.equal(created.data.hotelId, 'hotel-a');
    assert.equal(created.data.createdBy, 'manager-a');
    assert.equal(created.data.version, 1);
    const id = created.data.id;
    actor = { id: 'fo-a', hotelId: 'hotel-a', role: 'front-office' };
    const list = await request('/?q=BLUE');
    assert.equal(list.data.total, 1); assert.equal(list.data.items[0].id, id);
    assert.equal((await request('/?q=missing')).data.total, 0);
    assert.equal((await request('/?page=0')).status, 400);
    await request('/?page=2');
    assert.equal(queries.at(-1).skip, 50); assert.equal(queries.at(-1).take, 50);
    const saved = await request(`/${id}`, 'PATCH', { ...valid, version: 1, storageLocation: 'Safe 2' });
    assert.equal(saved.status, 200); assert.equal(saved.data.version, 2);
    assert.equal(saved.data.updatedBy, 'fo-a'); assert.equal(saved.data.createdBy, 'manager-a');
    assert.equal((await request(`/${id}`, 'PATCH', { ...valid, version: 1 })).status, 409);
    assert.equal((await request()).data.items[0].storageLocation, 'Safe 2');
    actor = { id: 'manager-b', hotelId: 'hotel-b', role: 'manager' };
    assert.equal((await request('/?hotelId=hotel-a')).data.total, 0);
    assert.equal((await request(`/${id}`, 'PATCH', { ...valid, version: 2, hotelId: 'hotel-a' })).status, 404);
    assert.equal(rows[0].storageLocation, 'Safe 2');
    actor = { id: 'no-hotel', role: 'manager' };
    assert.equal((await request()).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
