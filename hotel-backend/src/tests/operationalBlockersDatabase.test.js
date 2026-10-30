import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createBlockerService, assertUnblocked } from '../modules/operations/blockers.js';
import { ingestReports } from '../modules/reports/reportService.js';
import { readOperations, updateReportTask, assertCurrentSource } from '../modules/reports/reportOperations.js';
import { planToken } from '../modules/reports/housekeepingPlan.js';
import { createHousekeepingOperations } from '../modules/reports/housekeepingOperations.js';
import { createReadinessService } from '../modules/rooms/readinessService.js';
import { createMaintenanceOperations } from '../modules/maintenance/maintenanceOperations.js';

const enabled = process.env.BLOCKERS_DATABASE_TESTS === 'true';
const today = new Date().toISOString().slice(0, 10), yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const hotel = id => ({ id, timezone: 'UTC', name: 'Blocker Test', legalName: 'Test', address: '', postcode: '', city: '', country: '', phone: '', email: '', website: '', bookingEngine: '', whatsappNumber: '', vatNumber: '', description: '' });
const fields = (type = 'dnd') => ({ type, description: 'Operational restriction', ownerName: 'Duty coordinator', department: 'Housekeeping', nextAction: 'Confirm and resume work only when safe', followUpLocal: `${today}T00:00`, details: { service: 'Room cleaning', alternative: 'Towels only', item: 'Linen', part: 'Valve', contractor: 'Electrician', remainingFault: 'No power' } });

test('blockers survive report rollover with assignment history, tenant isolation and explicit resolution', { skip: !enabled, timeout: 240000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).searchParams.get('schema') || '', /^blockers_test_[a-f0-9]{16}$/);
  const db = new PrismaClient(), user = { id: 'coordinator', hotelId: 'block-a', role: 'manager' };
  const service = createBlockerService({ db }), read = id => db.reportTask.findUnique({ where: { id } });
  let seq = 0;
  const ingest = (date, rows) => ingestReports(db, { hotelId: user.hotelId, engineHotelId: 'block-engine' }, { schema_version: 1, hotel_id: 'block-engine', run_id: randomUUID(), generated_at: new Date(Date.now() - 60000 + ++seq * 1000).toISOString(), reports: [{ kind: 'housekeeping', date, status: 'complete', rows }] });
  try {
    for (const id of ['block-a', 'block-b']) await db.hotel.create({ data: hotel(id) });
    await ingest(yesterday, [{ room: '203', task: 'departure_clean_required' }]);
    const projected = (await readOperations(db, user)).tasks[0];
    const worker = await db.housekeepingWorker.create({ data: { hotelId: user.hotelId, name: 'Maria', phone: '+31600000001', whatsappEnabled: true } });
    const assignment = await db.housekeepingAssignment.create({ data: { hotelId: user.hotelId, workerId: worker.id, taskIds: [projected.id], requestKey: randomUUID(), createdBy: user.id, deliveryStatus: 'accepted' } });
    const firstStart = new Date(`${yesterday}T13:00:00Z`);
    let row = await db.reportTask.update({ where: { id: projected.id }, data: { assignmentId: assignment.id, assignedWorkerId: worker.id, assignedAt: firstStart, acceptedAt: firstStart, startedAt: firstStart, status: 'In Progress' } });
    const request = { ...fields(), workKind: 'report', workId: row.id, reportContentHash: planToken(row), requestKey: randomUUID() };
    const blocker = await service.save(user, null, request);
    assert.equal((await service.save(user, null, request)).id, blocker.id, 'create replay does not duplicate');
    await assert.rejects(service.save(user, null, { ...request, description: 'Changed payload' }), /reused/);
    await assert.rejects(service.save({ ...user, role: 'maintenance' }, null, request), { status: 403 });
    await assert.rejects(service.save({ ...user, hotelId: 'block-b' }, blocker.id, { ...fields(), version: 0 }), { status: 404 });
    assert.equal((await service.read({ ...user, hotelId: 'block-b' })).blockers.length, 0);
    assert.equal((await service.read({ ...user, role: 'maintenance' })).blockers.length, 0);
    await ingest(today, [{ room: '203', task: 'departure_clean_required' }, { room: '204', task: 'towels' }]);
    let view = await readOperations(db, user), carried = view.tasks.find(t => t.id === row.id);
    assert(carried && carried.carryReviewRequired && carried.carriedFrom === yesterday);
    assert.equal(carried.assignedWorkerId, worker.id); assert.deepEqual(carried.startedAt, firstStart);
    assert.equal(carried.blockers[0].id, blocker.id);
    assert(view.tasks.find(t => t.room === '203' && t.id !== row.id).sourceReviewRequired, 'today duplicate work needs review');
    await assert.rejects(assertCurrentSource(db, user.hotelId, [await read(row.id)], today), /staff review/);
    await service.reviewCarry({ ...user, role: 'front-office' }, row.id, { reportContentHash: carried.reportContentHash, note: 'Same guest and instructions confirmed' });
    await assert.rejects(assertCurrentSource(db, user.hotelId, [await read(row.id)], today), /unresolved/);
    assert.equal((await service.read(user)).blockers[0].due, 'Due now');
    assert.equal((await read(row.id)).status, 'Problem', 'time passing never resolves work');
    await assert.rejects(updateReportTask(db, user, row.id, { status: 'Completed', reportContentHash: planToken(await read(row.id)) }), /unresolved/);
    // Concurrent updates: only one coordinator may replace the schedule from the same version.
    const edits = await Promise.allSettled([1, 2].map(n => service.save(user, blocker.id, { ...fields(), description: `Confirmed instruction ${n}`, version: 0 })));
    assert.equal(edits.filter(r => r.status === 'fulfilled').length, 1); assert.equal(edits.find(r => r.status === 'rejected').reason.status, 409);
    let updated = await db.operationalBlocker.findUnique({ where: { id: blocker.id } });
    updated = await service.save(user, blocker.id, { ...fields(), followUpLocal: '2099-01-01T14:00', version: updated.version });
    await assert.rejects(service.resolve(user, blocker.id, { version: updated.version, note: 'Trying too early' }), /has not arrived/);
    updated = await service.save(user, blocker.id, { ...fields(), version: updated.version });
    const second = await service.save(user, null, { ...fields('supplies'), workKind: 'report', workId: row.id, reportContentHash: planToken(await read(row.id)), requestKey: randomUUID() });
    await service.resolve(user, blocker.id, { version: updated.version, note: 'Guest confirmed entry permitted now' });
    assert.equal((await read(row.id)).status, 'Problem', 'second blocker still holds work');
    await service.resolve(user, second.id, { version: second.version, note: 'Linen delivered' });
    row = await read(row.id); assert.equal(row.status, 'Accepted'); assert.equal(row.carryReviewedDate, today);
    assert.equal(row.assignmentId, assignment.id); assert.deepEqual(row.startedAt, firstStart); assert.equal(row.completedAt, null);
    await assertCurrentSource(db, user.hotelId, [row], today);
    await updateReportTask(db, user, row.id, { status: 'Completed', reportContentHash: planToken(row) });
    assert.equal((await read(row.id)).carryForward, false);
    assert(await db.operationalBlockerEvent.count({ where: { blockerId: blocker.id } }) >= 4);
    assert(await db.reportTaskEvent.count({ where: { taskId: row.id } }) >= 4);
    // Each type stores its required details. Cross-department writes are denied.
    for (const type of ['guest_inside', 'declined', 'parts', 'contractor', 'repair_failed']) {
      const issue = await db.issue.create({ data: { id: randomUUID(), hotelId: user.hotelId, room: '204', title: `Test ${type}`, reportedBy: 'Staff', createdAt: '10:00' } });
      const body = { ...fields(type), workKind: 'issue', workId: issue.id, workVersion: issue.version, requestKey: randomUUID() };
      await assert.rejects(service.save({ ...user, role: 'front-office' }, null, body), { status: 403 });
      const saved = await service.save({ ...user, role: 'maintenance' }, null, body);
      await assert.rejects(assertUnblocked(db, user.hotelId, 'issue', [issue.id]), /unresolved/);
      assert.equal(saved.type, type); assert.equal(saved.needsDetails, false);
    }
    const readiness = await createReadinessService({ db }).read(user);
    const blockedRoom = readiness.rooms.find(r => r.number === '204');
    assert(blockedRoom.restrictions.some(s => s.includes('parts'))); assert.equal(blockedRoom.ready, false);
  } finally { await db.$disconnect(); }
});

test('WhatsApp blocker reports create drafts, pause work, and resume without losing original start time', { skip: !enabled, timeout: 240000 }, async () => {
  const db = new PrismaClient(), sent = [], user = { hotelId: 'block-wa', id: 'manager', role: 'manager' };
  const ops = createHousekeepingOperations({ db, env: { PMS_MCP_CONTEXT_KEY: 'test'.repeat(12) }, send: async p => { sent.push(p); return { success: true, messageId: randomUUID() }; } });
  const service = createBlockerService({ db });
  try {
    await db.hotel.create({ data: hotel(user.hotelId) });
    const worker = await db.housekeepingWorker.create({ data: { hotelId: user.hotelId, name: 'Worker', phone: '+31600000002', whatsappEnabled: true, lastInboundAt: new Date() } });
    const integration = await db.whatsAppIntegration.create({ data: { hotelId: user.hotelId, phoneNumber: '+31600000003', phoneNumberId: 'block-phone', wabaId: 'block-waba', targetType: 'internal', verifiedAt: new Date() } });
    const inbound = value => ops.handle(integration, { id: randomUUID(), from: '31600000002', timestamp: String(Math.floor(Date.now() / 1000)), ...(typeof value === 'string' ? { text: { body: value } } : { interactive: { button_reply: value } }) });
    const task = await ops.change(user, null, { values: { room: '501', task: 'stayover_clean', comment: 'Clean room' }, reason: 'Guest request', requestKey: randomUUID() });
    const read = () => db.reportTask.findUnique({ where: { id: task.taskId } });
    const other = await ops.change(user, null, { values: { room: '502', task: 'towels', comment: 'Deliver towels' }, reason: 'Guest request', requestKey: randomUUID() });
    const readOther = () => db.reportTask.findUnique({ where: { id: other.taskId } });
    await ops.assign(user, { workerId: worker.id, requestKey: randomUUID(), tasks: [{ id: task.taskId, contentHash: planToken(await read()) }, { id: other.taskId, contentHash: planToken(await readOther()) }] });
    await service.save(user, null, { ...fields(), workKind: 'report', workId: other.taskId, reportContentHash: planToken(await readOther()), requestKey: randomUUID() });
    await inbound('TASKS'); await inbound(sent.at(-1).buttons[0]); await inbound(sent.at(-1).buttons.find(b => b.title === 'Start'));
    assert.equal((await read()).status, 'In Progress', 'a blocker on one assignment item does not prevent accepting the other items');
    assert.equal((await readOther()).status, 'Problem');
    const started = (await read()).startedAt, staleDone = sent.at(-1).buttons.find(b => b.title === 'Completed');
    await inbound(sent.at(-1).buttons.find(b => b.title === 'Problem'));
    await inbound(sent.at(-1).buttons.find(b => b.title === 'Other blocker'));
    await inbound(sent.at(-1).buttons.find(b => b.title === 'Missing supplies'));
    await inbound('No bath towels; laundry must deliver');
    let blocker = await db.operationalBlocker.findFirst({ where: { workId: task.taskId } });
    assert.equal(blocker.type, 'supplies'); assert.equal(blocker.needsDetails, true); assert.equal(blocker.followUpAt, null);
    assert.match(blocker.description, /bath towels/);
    await inbound(staleDone); assert.equal((await read()).status, 'Problem');
    await inbound('TASKS'); assert(!sent.at(-1).buttons?.length); assert.match(sent.at(-1).text, /schedule follow-up/i);
    await assert.rejects(ops.change(user, task.taskId, { cancel: true, reason: 'Hide blocked task', requestKey: randomUUID(), reportContentHash: planToken(await read()), values: {} }), /unresolved/);
    blocker = await service.save(user, blocker.id, { ...fields('supplies'), version: blocker.version });
    await service.resolve(user, blocker.id, { version: blocker.version, note: 'Laundry delivered towels; resume' });
    await inbound('TASKS'); await inbound(sent.at(-1).buttons.find(b => b.title === 'Start'));
    assert.deepEqual((await read()).startedAt, started);
    await inbound(sent.at(-1).buttons.find(b => b.title === 'Completed'));
    assert.equal((await read()).status, 'Completed'); assert.equal((await read()).carryForward, false);
    // Manual Waiting Parts cannot bypass the structured blocker flow.
    const mt = createMaintenanceOperations({ db });
    const issue = await db.issue.create({ data: { id: randomUUID(), hotelId: user.hotelId, room: '501', title: 'Replace valve', reportedBy: 'Staff', createdAt: '10:00' } });
    await mt.updateStatus(user, 'issue', issue.id, { status: 'Waiting Parts', version: 0, note: 'Valve ordered' });
    await assert.rejects(mt.updateStatus(user, 'issue', issue.id, { status: 'Completed' }), /unresolved/);
    assert.equal((await db.operationalBlocker.findFirst({ where: { workId: issue.id } })).type, 'parts');
  } finally { await db.$disconnect(); }
});
