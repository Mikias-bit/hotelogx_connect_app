import { createReadinessService, invalidateRoomReadiness } from '../modules/rooms/readinessService.js';
import { createMaintenanceOperations } from '../modules/maintenance/maintenanceOperations.js';
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
    // Corrected source preserves completed work and invalidates old instruction tokens.
    await ingest(hk.map(r => r.room === finished.data.room && r.task === finished.data.task ? { ...r, comment: 'Changed cleaning instructions' } : r));
    await inbound(complete);
    assert.equal((await db.reportTask.findUnique({ where: { id: finished.id } })).status, 'Completed');
    await assert.rejects(updateReportTask(db, user, finished.id, { status: 'Completed', reportContentHash: finished.contentHash }), /Source changed/);
    await assert.rejects(updateReportTask(db, { ...user, hotelId: 'ops-b' }, finished.id, { status: 'Completed', reportContentHash: finished.contentHash }), /not found/);
    // Failed run retains known tasks, but prevents acting as if those tasks are current.
    await ingest([], 'failed'); view = await readOperations(db, user);
    assert.equal(view.tasks.length, 5); assert(view.sources.find(s => s.kind === 'housekeeping').latestRunFailed);
    await inbound('TASKS'); assert.match(sent.at(-1).text, /latest run failed/); assert(!sent.at(-1).buttons?.length);
    await assert.rejects(service.assign(user, { ...request, requestKey: randomUUID() }), /source changed|staff review|Tasks changed/);
    await ingest(); view = await readOperations(db, user);
    // Unknown send outcome must not cause automatic duplicate sends on HTTP replay.
    delivery = { success: false, uncertain: true };
    await ingest([...hk, { room: '999', task: 'towels' }]); view = await readOperations(db, user);
    const retryInput = { workerId: worker.id, tasks: view.tasks.filter(t => t.department === 'Housekeeping' && t.status === 'New').map(t => ({ id: t.id, contentHash: t.reportContentHash })), requestKey: randomUUID() };
    assert(retryInput.tasks.length > 0);
    const unknown = await service.assign(user, retryInput); assert.equal(unknown.deliveryStatus, 'uncertain');
    const after = sent.length; await service.assign(user, retryInput); assert.equal(sent.length, after);
    await ingest([]); view = await readOperations(db, user); assert(view.housekeeping.roomCount > 0, 'assigned and completed work remain visible for review');
    assert.equal(await db.reportTask.count({ where: { kind: 'housekeeping', sourcePresent: false } }), 4);
    assert(await db.reportTaskEvent.count() > 5, 'audit history remains after task removal');
    assert.equal((await readOperations(db, { ...user, role: 'front-office' })).workers.length, 0);
  } finally { await db.$disconnect(); }
});


test('daily plan changes preserve history, isolate hotels and invalidate stale WhatsApp controls', { skip: process.env.OPERATIONS_DATABASE_TESTS !== 'true', timeout: 180000 }, async () => {
  const db = new PrismaClient(), sent = [];
  const user = { hotelId: 'plan-a', id: 'plan-manager', role: 'manager' }, fo = { ...user, id: 'plan-fo', role: 'front-office' };
  const today = new Date().toISOString().slice(0, 10);
  let clock = new Date(`${today}T08:00:00Z`), sequence = 0, delivery = { success: true, messageId: 'plan-provider' };
  const service = createHousekeepingOperations({ db, now: () => clock, env: { PMS_MCP_CONTEXT_KEY: 'test'.repeat(12) }, send: async payload => { sent.push(payload); return delivery; } });
  const input = (values, reason = 'Guest extended') => ({ values, reason, requestKey: randomUUID() });
  const view = async id => (await readOperations(db, user)).tasks.find(t => t.id === id);
  const read = id => db.reportTask.findUnique({ where: { id } });
  const change = async (id, values, extra = {}) => service.change(fo, id, { ...input(values), reportContentHash: (await view(id)).reportContentHash, ...extra });
  async function ingest(rows, status = 'complete') {
    return ingestReports(db, { hotelId: user.hotelId, engineHotelId: 'plan-engine' }, { schema_version: 1, hotel_id: 'plan-engine', run_id: randomUUID(), generated_at: new Date(Date.now() - 60000 + ++sequence * 1000).toISOString(), reports: [{ kind: 'housekeeping', date: today, status, rows }] });
  }
  try {
    for (const id of ['plan-a', 'plan-b']) await db.hotel.create({ data: { id, timezone: 'UTC', name: 'Plan Test', legalName: 'Test', address: '', postcode: '', city: '', country: '', phone: '', email: '', website: '', bookingEngine: '', whatsappNumber: '', vatNumber: '', description: '' } });
    const worker = await db.housekeepingWorker.create({ data: { hotelId: user.hotelId, name: 'Plan Worker', phone: '+31611223344', whatsappEnabled: true, lastInboundAt: clock } });
    const integration = await db.whatsAppIntegration.create({ data: { hotelId: user.hotelId, phoneNumber: '+31600000001', phoneNumberId: 'plan-phone', wabaId: 'plan-waba', targetType: 'internal', verifiedAt: clock } });
    const inbound = value => service.handle(integration, { id: randomUUID(), from: '31611223344', timestamp: String(+clock / 1000), ...(typeof value === 'string' ? { text: { body: value } } : { interactive: { button_reply: value } }) });
    const assign = async id => service.assign(user, { workerId: worker.id, requestKey: randomUUID(), tasks: [{ id, contentHash: (await view(id)).reportContentHash }] });
    // Staff work is actionable before any engine run, including public locations.
    const created = await service.change(fo, null, input({ location: 'Lobby', task: 'public_area', priority: 'Urgent', comment: 'Clean spill' }, 'Urgent request'));
    const publicId = created.taskId;
    assert.equal((await view(publicId)).location, 'Lobby');
    const publicBatch = await assign(publicId);
    assert.equal(publicBatch.deliveryStatus, 'submitted');
    await inbound('TASKS'); await inbound(sent.at(-1).buttons[0]);
    assert.equal((await read(publicId)).status, 'Accepted');
    const staleStart = sent.at(-1).buttons.find(b => b.title === 'Start');
    const before = await read(publicId);
    const changed = await change(publicId, { notBeforeTime: '14:00', dueTime: '15:00', comment: 'Public event; enter after 14:00' });
    assert.equal(changed.deliveryStatus, 'submitted');
    const after = await read(publicId);
    assert.equal(after.status, 'Accepted'); assert.equal(after.assignmentId, before.assignmentId); assert.deepEqual(after.acceptedAt, before.acceptedAt);
    assert.match(sent.at(-1).text, /Do not enter before 14:00/);
    await inbound(staleStart); assert.equal((await read(publicId)).status, 'Accepted');
    await inbound('TASKS'); assert(!sent.at(-1).buttons.some(b => b.title === 'Start'));
    const current = await read(publicId);
    const forgedEarlyStart = service.button(worker, current.assignmentId, `${current.id}~${current.planVersion}`, 'start', 'Start');
    await inbound(forgedEarlyStart); assert.equal((await read(publicId)).status, 'Accepted'); assert.match(sent.at(-1).text, /Do not enter/);
    clock = new Date(`${today}T14:01:00Z`);
    await inbound('TASKS'); await inbound(sent.at(-1).buttons.find(b => b.title === 'Start'));
    assert.equal((await read(publicId)).status, 'In Progress');
    const staleDone = sent.at(-1).buttons.find(b => b.title === 'Completed');
    const started = (await read(publicId)).startedAt;
    await change(publicId, { comment: 'Also clean the entrance mat' });
    await inbound(staleDone); assert.equal((await read(publicId)).status, 'In Progress');
    assert.deepEqual((await read(publicId)).startedAt, started);
    await inbound('TASKS'); await inbound(sent.at(-1).buttons.find(b => b.title === 'Completed'));
    const completed = await read(publicId); assert(completed.completedAt);
    await assert.rejects(change(publicId, { comment: 'Overwrite completed work' }), /Completed work is retained/);
    await assert.rejects(updateReportTask(db, user, publicId, { status: 'New', reportContentHash: (await view(publicId)).reportContentHash }), /Completed work is retained/);
    // Engine work: extension changes keep assignment and audit history; snapshots stay immutable.
    const sourceRows = [{ room: '203', task: 'departure_clean_required', comment: 'Departure clean' }, { room: '204', task: 'towels' }];
    await ingest(sourceRows);
    const room = (await readOperations(db, user)).tasks.find(t => t.room === '203');
    await assign(room.id); await inbound('TASKS'); const oldAccept = sent.at(-1).buttons[0];
    const original = await read(room.id);
    const request = { ...input({ task: 'stayover_clean', comment: 'Guest extended. Stayover clean only.', priority: 'High' }), reportContentHash: room.reportContentHash };
    const notice = await service.change(fo, room.id, request);
    const sendCount = sent.length; assert.equal((await service.change(fo, room.id, request)).id, notice.id); assert.equal(sent.length, sendCount);
    assert.equal((await read(room.id)).data.task, 'departure_clean_required');
    assert.equal((await view(room.id)).planData.task, 'stayover_clean');
    assert.equal((await read(room.id)).assignmentId, original.assignmentId);
    await inbound(oldAccept); assert.equal((await read(room.id)).status, 'Assigned');
    await inbound('TASKS'); await inbound(sent.at(-1).buttons[0]); assert.equal((await read(room.id)).status, 'Accepted');
    await assert.rejects(service.change(fo, room.id, { ...request, requestKey: randomUUID() }), /Task changed/);
    await assert.rejects(service.change({ ...fo, hotelId: 'plan-b' }, room.id, { ...input({ comment: 'foreign' }), reportContentHash: (await view(room.id)).reportContentHash }), /not found/);
    await assert.rejects(service.change({ ...fo, role: 'maintenance' }, room.id, input({})), { status: 403 });
    const historyBefore = await db.reportTaskEvent.count({ where: { taskId: room.id } });
    await ingest(sourceRows); assert.equal((await view(room.id)).executionStatus, 'Accepted');
    assert.equal((await view(room.id)).planData.task, 'stayover_clean');
    assert.equal(await db.reportTaskEvent.count({ where: { taskId: room.id } }), historyBefore);
    await ingest(sourceRows.map(r => r.room === '203' ? { ...r, comment: 'New engine instructions' } : r));
    assert.equal((await view(room.id)).sourceReviewRequired, true);
    assert.equal((await view(room.id)).executionStatus, 'Accepted');
    await assert.rejects(change(room.id, { comment: 'Without review' }), /Review the changed/);
    await change(room.id, { comment: 'Keep approved stayover' }, { sourceDecision: 'keep' });
    assert.equal((await view(room.id)).planData.task, 'stayover_clean');
    assert.equal((await view(room.id)).sourceReviewRequired, false);
    // Concurrent editors cannot silently overwrite each other.
    const token = (await view(room.id)).reportContentHash;
    const races = await Promise.allSettled([1, 2].map(n => service.change(fo, room.id, { ...input({ comment: `Editor ${n}` }), reportContentHash: token })));
    assert.equal(races.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(races.find(r => r.status === 'rejected').reason.status, 409);
    // No active WhatsApp window: save the task, report pending notification, then use a separate approved change template.
    await db.housekeepingWorker.update({ where: { id: worker.id }, data: { lastInboundAt: null } });
    assert.equal((await change(room.id, { priority: 'Urgent' })).deliveryStatus, 'waiting_window');
    await db.housekeepingConfig.create({ data: { hotelId: user.hotelId, changeTemplateName: 'housekeeping_plan_changed' } });
    assert.equal((await change(room.id, { comment: 'Waiting arrival' })).deliveryStatus, 'template_submitted');
    assert.equal(sent.at(-1).template.name, 'housekeeping_plan_changed');
    assert.equal(sent.at(-1).template.components[0].parameters[1].text, 'Room 203');
    delivery = { success: false, uncertain: true };
    const uncertainRequest = { ...input({ comment: 'Latest instructions' }), reportContentHash: (await view(room.id)).reportContentHash };
    assert.equal((await service.change(fo, room.id, uncertainRequest)).deliveryStatus, 'uncertain');
    const count = sent.length; await service.change(fo, room.id, uncertainRequest); assert.equal(sent.length, count);
    delivery = { success: true, messageId: 'plan-provider' };
    // Removal never erases assigned work; authorized staff may retain it as an operational exception.
    await ingest([]); assert.equal((await view(room.id)).sourceReviewRequired, true);
    assert.equal((await read(publicId)).status, 'Completed', 'staff task survives all engine reruns');
    await change(room.id, { comment: 'Still needed despite source removal' }, { sourceDecision: 'keep' });
    await inbound('TASKS'); await inbound(sent.at(-1).buttons.find(b => b.title === 'Start'));
    await inbound(sent.at(-1).buttons.find(b => b.title === 'Completed'));
    const finished = await read(room.id); assert.equal(finished.status, 'Completed');
    await ingest([{ room: '203', task: 'departure_clean_required', comment: 'Engine corrected after completion' }]);
    const final = await readOperations(db, user);
    assert.equal((await read(room.id)).status, 'Completed'); assert.deepEqual((await read(room.id)).completedAt, finished.completedAt);
    assert.deepEqual((await read(room.id)).assignedAt, original.assignedAt);
    assert(final.tasks.find(t => t.id === room.id).trail.some(e => /Plan changed by front-office/.test(e.text)));
    // Cancellation retains its record, invalidates controls, and cannot be resurrected by a report rerun.
    await ingest([{ room: '500', task: 'towels', comment: 'Original' }]);
    const cancelledTask = (await readOperations(db, user)).tasks.find(t => t.room === '500');
    await assign(cancelledTask.id);
    const cancellation = await change(cancelledTask.id, {}, { cancel: true });
    assert.equal(cancellation.deliveryStatus, 'submitted'); assert.match(sent.at(-1).text, /Task cancelled/);
    const cancelled = await read(cancelledTask.id); assert.equal(cancelled.status, 'Cancelled'); assert(cancelled.assignmentId);
    await ingest([{ room: '500', task: 'towels', comment: 'Changed after cancellation' }]);
    await readOperations(db, user); assert.equal((await read(cancelled.id)).active, false);
    assert.equal((await read(cancelled.id)).status, 'Cancelled');
    // Invalid times or mixed locations never create work.
    await assert.rejects(service.change(fo, null, input({ room: '100', location: 'Lobby', task: 'delivery' })), /either a room/);
    await assert.rejects(service.change(fo, null, input({ room: '100', task: 'delivery', notBeforeTime: '15:00', dueTime: '14:00' })), /deadline/);
  } finally { await db.$disconnect(); }
});


test('room inspection and release remain separate; housekeeping faults link through repair and follow-up', { skip: process.env.OPERATIONS_DATABASE_TESTS !== 'true', timeout: 180000 }, async () => {
  const db = new PrismaClient(), sent = [], notices = [];
  const manager = { id: 'ready-manager', hotelId: 'ready-a', role: 'manager' };
  const fo = { ...manager, id: 'ready-fo', role: 'front-office' }, hkUser = { ...manager, id: 'ready-hk', role: 'housekeeping' };
  const env = { PMS_MCP_CONTEXT_KEY: 'readiness-test'.repeat(4) };
  const broadcast = (...event) => notices.push(event);
  const send = async payload => { sent.push(payload); return { success: true, messageId: randomUUID() }; };
  const housekeeping = createHousekeepingOperations({ db, send, env, broadcast });
  const maintenance = createMaintenanceOperations({ db, send, env, broadcast });
  const readiness = createReadinessService({ db, broadcast });
  const view = async id => (await readOperations(db, manager)).tasks.find(t => t.id === id);
  const room = async number => (await readiness.read(manager)).rooms.find(r => r.number === number);
  const action = async (user, number, name, extra = {}) => readiness.update(user, number, { action: name, note: 'Staff verified the current condition', token: (await room(number)).token, ...extra });
  const add = async (values, who = hkUser) => housekeeping.change(who, null, { requestKey: randomUUID(), reason: 'Operational request', values });
  const report = async (id, note) => housekeeping.reportRepair(hkUser, id, { note, reportContentHash: (await view(id)).reportContentHash });
  const finish = async id => updateReportTask(db, hkUser, id, { status: 'Completed', reportContentHash: (await view(id)).reportContentHash });
  const issue = id => db.issue.findUnique({ where: { id } });
  try {
    for (const id of ['ready-a', 'ready-b']) await db.hotel.create({ data: { id, timezone: 'UTC', name: 'Readiness Test', legalName: 'Test', address: '', postcode: '', city: '', country: '', phone: '', email: '', website: '', bookingEngine: '', whatsappNumber: '', vatNumber: '', description: '' } });
    for (const hotelId of ['ready-a', 'ready-b']) for (const number of ['100', '101']) await db.room.create({ data: { hotelId, number, floor: 1, status: 'Clean', guestStatus: 'Vacant', updatedAt: '09:00' } });
    const original = await add({ room: '100', task: 'departure_clean_required', priority: 'High' });
    const duplicateTask = await add({ room: '100', task: 'towels' });
    const differentTask = await add({ room: '100', task: 'linen_change' });
    const hkWorker = await db.housekeepingWorker.create({ data: { hotelId: manager.hotelId, name: 'Cleaner', phone: '+31655550001', whatsappEnabled: true, lastInboundAt: new Date() } });
    const technician = await db.maintenanceWorker.create({ data: { hotelId: manager.hotelId, name: 'Technician', phone: '+31655550002', whatsappEnabled: true, lastInboundAt: new Date() } });
    const integration = await db.whatsAppIntegration.create({ data: { hotelId: manager.hotelId, phoneNumber: '+31655550000', phoneNumberId: 'readiness-phone', wabaId: 'readiness-waba', targetType: 'internal', verifiedAt: new Date() } });
    const inbound = (service, phone, value, id = randomUUID()) => service.handle(integration, { id, from: phone.replace('+', ''), timestamp: String(Math.floor(Date.now() / 1000)), ...(typeof value === 'string' ? { text: { body: value } } : { interactive: { button_reply: value } }) });
    assert.equal((await room('100')).cleanliness, 'Needs cleaning'); assert.equal((await room('100')).ready, false);
    await assert.rejects(action(fo, '100', 'inspect'), { status: 403 });
    await assert.rejects(action(hkUser, '100', 'release'), { status: 403 });
    await assert.rejects(action(fo, '100', 'release'), /requires a current inspection/);
    await assert.rejects(action(hkUser, '100', 'cleaned'), /individual housekeeping/);
    // Worker-originated maintenance button creates a provisional linked ticket immediately.
    await housekeeping.assign(hkUser, { workerId: hkWorker.id, requestKey: randomUUID(), tasks: [{ id: original.taskId, contentHash: (await view(original.taskId)).reportContentHash }] });
    await inbound(housekeeping, hkWorker.phone, 'TASKS'); await inbound(housekeeping, hkWorker.phone, sent.at(-1).buttons[0]);
    await inbound(housekeeping, hkWorker.phone, sent.at(-1).buttons.find(b => b.title === 'Problem'));
    const maintenanceButton = sent.at(-1).buttons.find(b => b.title === 'Maintenance');
    await inbound(housekeeping, hkWorker.phone, maintenanceButton, 'repair-report-once');
    let links = await db.housekeepingMaintenanceLink.findMany({ where: { hotelId: manager.hotelId, reportTaskId: original.taskId, active: true } });
    assert.equal(links.length, 1); const repairId = links[0].issueId;
    await inbound(housekeeping, hkWorker.phone, maintenanceButton, 'repair-report-once');
    assert.equal(await db.housekeepingMaintenanceLink.count({ where: { hotelId: manager.hotelId, reportTaskId: original.taskId } }), 1);
    await inbound(housekeeping, hkWorker.phone, 'Leaking sink tap');
    assert.equal((await issue(repairId)).detail, 'Leaking sink tap');
    const duplicate = await report(duplicateTask.taskId, '  LEAKING sink tap! ');
    assert.equal(duplicate.id, repairId, 'same normalized fault shares the existing open ticket');
    const different = await report(differentTask.taskId, 'Broken bedside lamp'); assert.notEqual(different.id, repairId);
    assert.equal((await room('100')).issues.length, 2);
    await assert.rejects(finish(original.taskId), /Linked maintenance is still open/);
    await assert.rejects(housekeeping.reportRepair({ ...hkUser, hotelId: 'ready-b' }, original.taskId, { note: 'foreign', reportContentHash: (await view(original.taskId)).reportContentHash }), { status: 404 });
    // Technician acceptance, start and completion create one follow-up without completing the original task.
    await maintenance.assign(manager, { workerId: technician.id, requestKey: randomUUID(), work: [{ kind: 'issue', id: repairId, version: (await issue(repairId)).version }] });
    await inbound(maintenance, technician.phone, 'MAINTENANCE'); await inbound(maintenance, technician.phone, sent.at(-1).buttons[0]);
    await inbound(maintenance, technician.phone, sent.at(-1).buttons.find(b => b.title === 'Start'));
    const done = sent.at(-1).buttons.find(b => b.title === 'Completed'); await inbound(maintenance, technician.phone, done, 'repair-done-once');
    const repaired = await issue(repairId); assert.equal(repaired.status, 'Completed'); assert(repaired.followUpTaskId);
    await inbound(maintenance, technician.phone, done, 'repair-done-once');
    assert.equal((await issue(repairId)).followUpTaskId, repaired.followUpTaskId);
    assert.equal((await view(original.taskId)).executionStatus, 'Problem');
    assert.equal((await view(repaired.followUpTaskId)).sourceIssueId, repairId);
    assert.equal((await room('100')).ready, false);
    // Reopening a repair blocks old follow-up controls; another completion creates a new cycle of work.
    await maintenance.updateStatus(manager, 'issue', repairId, { status: 'Open', version: (await issue(repairId)).version });
    await assert.rejects(finish(repaired.followUpTaskId), /Linked maintenance is still open/);
    await maintenance.updateStatus(manager, 'issue', repairId, { status: 'Completed', version: (await issue(repairId)).version });
    assert.notEqual((await issue(repairId)).followUpTaskId, repaired.followUpTaskId);
    await maintenance.updateStatus(manager, 'issue', different.id, { status: 'Completed', version: (await issue(different.id)).version });
    for (const task of (await readOperations(db, manager)).tasks.filter(t => t.room === '100' && t.status !== 'Completed')) await finish(task.id);
    assert.equal((await db.room.findUnique({ where: { hotelId_number: { hotelId: manager.hotelId, number: '100' } } })).status, 'Clean', 'no task or repair path writes PMS room status');
    assert.equal((await room('100')).cleanliness, 'Awaiting inspection'); assert.equal((await room('100')).ready, false);
    const stale = (await room('100')).token;
    await action(hkUser, '100', 'inspect');
    assert.equal((await room('100')).releaseStatus, 'Awaiting release approval');
    await assert.rejects(readiness.update(fo, '100', { action: 'release', token: stale, note: 'Old screen' }), { status: 409 });
    await action(fo, '100', 'release'); assert.equal((await room('100')).ready, true);
    assert.equal((await room('100')).inspectedBy, hkUser.id); assert.equal((await room('100')).releasedBy, fo.id);
    // New work invalidates readiness; completion alone cannot reinstate an old inspection or approval.
    const extra = await add({ room: '100', task: 'urgent_clean' }); assert.equal((await room('100')).ready, false);
    await finish(extra.taskId); assert.equal((await room('100')).cleanliness, 'Awaiting inspection');
    await action(hkUser, '100', 'inspect'); await action(fo, '100', 'release');
    await action(fo, '100', 'restrictions', { restrictions: { occupied: false, dnd: true, maintenanceBlocked: false, otherRestriction: '' } });
    assert.equal((await room('100')).ready, false);
    await assert.rejects(action(hkUser, '100', 'inspect'), /restrictions/);
    await action(fo, '100', 'restrictions', { restrictions: { occupied: false, dnd: false, maintenanceBlocked: false, otherRestriction: '' } });
    await action(hkUser, '100', 'inspect'); await action(fo, '100', 'release');
    await invalidateRoomReadiness(db, manager.hotelId, ['100']); assert.equal((await room('100')).ready, false);
    await db.room.update({ where: { hotelId_number: { hotelId: manager.hotelId, number: '100' } }, data: { guestStatus: 'Occupied' } });
    assert((await room('100')).restrictions.includes('Occupied / guest inside'));
    await assert.rejects(action(hkUser, '100', 'inspect'), /restrictions/);
    // Hotel B's same room number remains untouched; a missing foreign-only room is not created by a mutation.
    assert.equal((await readiness.read({ ...manager, hotelId: 'ready-b' })).rooms.find(r => r.number === '100').ready, false);
    await assert.rejects(readiness.update(manager, 'not-a-room', { action: 'release', token: 'forged', note: 'forged' }), { status: 404 });
    await assert.rejects(readiness.read({ ...manager, role: 'guest' }), { status: 403 });
    // Manual dirty flags are independent of completed task history.
    await action(hkUser, '101', 'needs_cleaning'); assert.equal((await room('101')).cleanliness, 'Needs cleaning');
    await action(hkUser, '101', 'cleaned'); await action(hkUser, '101', 'inspect'); await action(fo, '101', 'release');
    assert.equal((await room('101')).ready, true);
    await db.task.create({ data: { id: 'ready-legacy-task', hotelId: manager.hotelId, room: '101', department: 'Housekeeping', title: 'Additional cleaning', createdAt: '12:00', source: 'Front Office', priority: 'Normal' } });
    assert.equal((await room('101')).ready, false);
    await db.task.update({ where: { id: 'ready-legacy-task' }, data: { status: 'Completed', version: { increment: 1 } } });
    assert.equal((await room('101')).ready, false, 'finishing a legacy task cannot resurrect an old approval');

    assert(notices.some(n => n[1] === 'readiness:updated'));
    assert(await db.roomReadinessEvent.count({ where: { hotelId: manager.hotelId } }) > 5);
  } finally { await db.$disconnect(); }
});
