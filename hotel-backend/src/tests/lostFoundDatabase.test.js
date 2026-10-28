import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { createLostFoundRouter } from '../modules/lost-found/lostFoundRoutes.js';

test('migrated Neon register stores shared items and rejects concurrent or foreign-hotel updates', {
  skip: process.env.LOST_FOUND_DATABASE_TESTS !== 'true', timeout: 120000,
}, async () => {
  assert.match(new URL(process.env.DATABASE_URL).searchParams.get('schema') || '', /^lost_found_test_[a-f0-9]{16}$/);
  const db = new PrismaClient();
  let actor = { id: 'manager-a', hotelId: 'lost-found-a', role: 'manager' };
  const app = express(); app.use(express.json(), createLostFoundRouter({ db, auth: (req, res, next) => { req.user = actor; next(); } }));
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://localhost:${server.address().port}`;
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, ...await res.json() };
  };
  try {
    for (const id of ['lost-found-a', 'lost-found-b']) await db.hotel.create({ data: {
      id, name: 'Test hotel', legalName: 'Test', address: '', postcode: '', city: '', country: '', phone: '', email: '', website: '', bookingEngine: '', whatsappNumber: '', vatNumber: '', description: '',
    } });
    const fields = { category: 'Electronics', item: 'Test headphones', description: 'Blue case', foundLocation: 'Room 203', storageLocation: 'Shelf B' };
    const created = await call('/', 'POST', fields);
    assert.equal(created.status, 201); assert(created.data.id); assert(created.data.createdAt);
    actor = { ...actor, id: 'fo-a', role: 'front-office' };
    const list = await call('/?q=BLUE');
    assert.equal(list.data.total, 1); assert.equal(list.data.items[0].id, created.data.id);
    const edits = await Promise.all(['Shelf C', 'Safe 2'].map(storageLocation => call(`/${created.data.id}`, 'PATCH', { ...fields, storageLocation, version: 1 })));
    assert.deepEqual(edits.map(result => result.status).sort(), [200, 409]);
    const persisted = await db.lostFoundItem.findUnique({ where: { id: created.data.id } });
    assert.equal(persisted.version, 2); assert.equal(persisted.createdBy, 'manager-a'); assert.equal(persisted.updatedBy, 'fo-a');
    actor = { ...actor, hotelId: 'lost-found-b' };
    assert.equal((await call('/')).data.total, 0);
    assert.equal((await call(`/${created.data.id}`, 'PATCH', { ...fields, version: 2 })).status, 404);
    assert.equal((await db.lostFoundItem.findUnique({ where: { id: created.data.id } })).version, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await db.$disconnect();
  }
});
