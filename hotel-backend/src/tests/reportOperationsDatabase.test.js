import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ingestReports } from '../modules/reports/reportService.js';
import { readOperations, updateReportTask } from '../modules/reports/reportOperations.js';
import { createHousekeepingOperations } from '../modules/reports/housekeepingOperations.js';

test('Neon operational projection, tenant isolation and WhatsApp task lifecycle', { skip: process.env.OPERATIONS_DATABASE_TESTS !== 'true', timeout: 180000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).searchParams.get('schema') || '', /^operations_test_[a-f0-9]{16}$/);
  const db = new PrismaClient(), sent = []; let sequence = 0, delivery = { success: true, messageId: 'provider-test' };
  const user = { hotelId: 'ops-a', id: 'manager', role: 'manager' };
  const now = new Date(), today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const source = { hotelId: user.hotelId, engineHotelId: 'engine-a' };
  const hk = [{ room: '203', task: 'departure_clean_required' }, { room: '345', task: 'linen_change' }, { room: '345', task: 'towels' }, { room: '401', task: 'stayover_no_cleaning' }];
  async function ingest(rows = hk, status = 'complete', kind = 'housekeeping') {
    return ingestReports(db, source, { schema_version: 1, hotel_id: source.engineHotelId, run_id: `run-${++sequence}-${randomUUID()}`, generated_at: new Date(+now - 60000 + sequence * 1000).toISOString(), reports: [{ kind, date: today, status, rows }] });
  }
  try {
    for (const id of ['ops-a', 'ops-b']) await db.hotel.create({ data: { id, name: 'Test', legalName: 'Test', address: '', postcode: '', city: '', country: '', phone: '', email: '', website: '', bookingEngine: '', whatsappNumber: '', vatNumber: '', description: '' } });
    await ingest();
    await ingest([{ reservation_id: 'reservation', vip_type: 'long_stay', guest_name: 'Test Guest', benefits: ['welcome card'] }], 'complete', 'vip');
    await ingest([{ reservation_id: 'reservation', amount: '-22.500', currency: 'EUR', reason: 'overpayment' }], 'complete', 'departure_bills');
    let view = await readOperations(db, user);
    assert.equal(view.tasks.length, 5); assert.equal(view.housekeeping.roomCount, 2); assert.deepEqual(view.housekeeping.noCleaningRooms, ['401']);
    assert(view.tasks.find(t => t.department === 'Billing').title.includes('-22.500 EUR'));
    assert(view.tasks.find(t => t.department === 'VIP').detail.includes('welcome card'));
    assert.equal((await readOperations(db, { ...user, hotelId: 'ops-b' })).tasks.length, 0);
    assert((await readOperations(db, { ...user, role: 'housekeeping' })).tasks.every(t => t.department === 'Housekeeping'));
    const worker = await db.housekeepingWorker.create({ data: { hotelId: user.hotelId, name: 'Test Worker', phone: '+31612345678', whatsappEnabled: true } });
    const otherWorker = await db.housekeepingWorker.create({ data: { hotelId: 'ops-b', name: 'Other Worker', phone: '+31612345678', whatsappEnabled: true } });
    const integration = await db.whatsAppIntegration.create({ data: { hotelId: user.hotelId, phoneNumber: '+31600000000', phoneNumberId: 'phone-a', wabaId: 'waba-a', targetType: 'internal', verifiedAt: now } });
    const service = createHousekeepingOperations({ db, env: { PMS_MCP_CONTEXT_KEY: 'test'.repeat(12) }, send: async payload => { sent.push(payload); return delivery; } });
    const tasks = view.tasks.filter(t => t.department === 'Housekeeping');
    const selection = tasks.map(t => ({ id: t.id, contentHash: t.reportContentHash }));
    const request = { workerId: worker.id, tasks: selection, requestKey: randomUUID() };
    await assert.rejects(service.assign({ ...user, role: 'front-office' }, request), /access required/);
    await assert.rejects(service.assign(user, { ...request, workerId: otherWorker.id }), /active WhatsApp/);
    const batch = await service.assign(user, request);
    assert.equal(batch.deliveryStatus, 'waiting_window'); assert.equal(sent.length, 0);
    assert.equal((await service.assign(user, request)).id, batch.id);
    assert.equal(await db.housekeepingAssignment.count(), 1);
    async function inbound(value, from = '31612345678', messageId = randomUUID()) {
      return service.handle(integration, { id: messageId, from, timestamp: String(Math.floor(Date.now() / 1000)), ...(typeof value === 'string' ? { text: { body: value } } : { interactive: { button_reply: value } }) });
    }
    assert.equal(await inbound('TASKS', '31699999999'), false);
    await inbound('TASKS'); const accept = sent.at(-1).buttons[0];
    assert.equal(service.parse(otherWorker, accept.id), null);
    await inbound({ ...accept, id: accept.id + 'x' });
    assert.equal(await db.reportTask.count({ where: { status: 'Accepted' } }), 0);
    await inbound(accept, undefined, 'accept-once');
    assert.equal(await db.reportTask.count({ where: { status: 'Accepted' } }), 3);
    const count = sent.length; await inbound(accept, undefined, 'accept-once'); assert.equal(sent.length, count);
    assert.equal((await db.housekeepingAssignment.findUnique({ where: { id: batch.id } })).deliveryStatus, 'accepted');
    const start = sent.at(-1).buttons[0]; await inbound(start);
    const complete = sent.at(-1).buttons[0]; assert.equal(complete.title, 'Completed'); await inbound(complete);
    const finished = await db.reportTask.findFirst({ where: { status: 'Completed' } });
    assert(finished.assignedAt && finished.acceptedAt && finished.startedAt && finished.completedAt);
    await ingest(); view = await readOperations(db, user);
    assert.equal(view.tasks.find(t => t.id === finished.id).status, 'Completed', 'same source preserves completion');
    assert.equal(await db.reportTask.count(), 5, 'reruns do not duplicate work');
    const currentPacket = await service.packet(worker); const problem = currentPacket.buttons.find(b => b.title === 'Problem');
    await inbound(problem); await inbound(sent.at(-1).buttons.find(b => b.title === 'Maintenance')); await inbound('Leaking tap');
    assert.equal((await db.reportTask.findFirst({ where: { status: 'Problem' } })).problemNote, 'Leaking tap');
    // Corrected source resets only the changed row and invalidates its old assignment token.
    await ingest(hk.map(r => r.room === finished.data.room && r.task === finished.data.task ? { ...r, comment: 'Changed cleaning instructions' } : r));
    await inbound(complete);
    assert.equal((await db.reportTask.findUnique({ where: { id: finished.id } })).status, 'New');
    await assert.rejects(updateReportTask(db, user, finished.id, { status: 'Completed', reportContentHash: finished.contentHash }), /Source changed/);
    await assert.rejects(updateReportTask(db, { ...user, hotelId: 'ops-b' }, finished.id, { status: 'Completed', reportContentHash: finished.contentHash }), /not found/);
    // Failed run retains known tasks, but prevents acting as if those tasks are current.
    await ingest([], 'failed'); view = await readOperations(db, user);
    assert.equal(view.tasks.length, 5); assert(view.sources.find(s => s.kind === 'housekeeping').latestRunFailed);
    await inbound('TASKS'); assert.match(sent.at(-1).text, /latest run failed/); assert(!sent.at(-1).buttons);
    await assert.rejects(service.assign(user, { ...request, requestKey: randomUUID() }), /successful current/);
    await ingest(); view = await readOperations(db, user);
    // Unknown send outcome must not cause automatic duplicate sends on HTTP replay.
    delivery = { success: false, uncertain: true };
    const retryInput = { workerId: worker.id, tasks: view.tasks.filter(t => t.department === 'Housekeeping' && t.status === 'New').map(t => ({ id: t.id, contentHash: t.reportContentHash })), requestKey: randomUUID() };
    assert(retryInput.tasks.length > 0);
    const unknown = await service.assign(user, retryInput); assert.equal(unknown.deliveryStatus, 'uncertain');
    const after = sent.length; await service.assign(user, retryInput); assert.equal(sent.length, after);
    await ingest([]); view = await readOperations(db, user); assert.equal(view.housekeeping.roomCount, 0);
    assert.equal(await db.reportTask.count({ where: { kind: 'housekeeping', active: false } }), 3);
    assert(await db.reportTaskEvent.count() > 5, 'audit history remains after task removal');
    assert.equal((await readOperations(db, { ...user, role: 'front-office' })).workers.length, 0);
  } finally { await db.$disconnect(); }
});
