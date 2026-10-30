import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createMaintenanceOperations } from '../modules/maintenance/maintenanceOperations.js';

test('Neon maintenance assignment, WhatsApp acceptance, completion, problems and isolation', {
  skip: process.env.MAINTENANCE_DATABASE_TESTS !== 'true', timeout: 180000,
}, async () => {
  assert.match(new URL(process.env.DATABASE_URL).searchParams.get('schema') || '', /^maintenance_test_[a-f0-9]{16}$/);
  const db = new PrismaClient(), sent = [], broadcasts = [];
  const user = { id: 'manager-a', hotelId: 'mt-a', role: 'maintenance' }, env = { PMS_MCP_CONTEXT_KEY: 'test'.repeat(12) };
  let delivery = { success: true, messageId: 'mock-message' }, onSend;
  const service = createMaintenanceOperations({ db, env, send: async payload => { sent.push(payload); if (onSend) await onSend(); return delivery; }, broadcast: (...args) => broadcasts.push(args) });
  const integration = { hotelId: 'mt-a', phoneNumberId: 'phone-a', targetType: 'internal' };
  const inbound = (content, from = '31612345678', messageId = randomUUID(), target = integration) => service.handle(target, {
    id: messageId, from, timestamp: String(Math.floor(Date.now() / 1000)),
    ...(typeof content === 'string' ? { text: { body: content } } : { interactive: { button_reply: content } }),
  });
  const latest = () => sent.at(-1);
  try {
    for (const id of ['mt-a', 'mt-b']) await db.hotel.create({ data: { id, name: 'Test', legalName: 'Test', address: '', postcode: '', city: '', country: '', phone: '', email: '', website: '', bookingEngine: '', whatsappNumber: '', vatNumber: '', description: '' } });
    await db.whatsAppIntegration.create({ data: { hotelId: 'mt-a', phoneNumber: '+31600000000', phoneNumberId: 'phone-a', wabaId: 'waba-a', targetType: 'internal', status: 'connected', verifiedAt: new Date() } });
    await db.room.create({ data: { hotelId: 'mt-a', number: '203', floor: 2, cleaningType: 'Departure', guestStatus: 'Vacant', status: 'Maintenance', priority: 'High', updatedAt: '10:00' } });
    const issue = await db.issue.create({ data: { id: 'issue-a', hotelId: 'mt-a', room: '203', title: 'Repair lamp', priority: 'High', reportedBy: 'Staff', createdAt: '10:00', outOfService: true } });
    const task = await db.task.create({ data: { id: 'task-a', hotelId: 'mt-a', room: '203', title: 'Check spare parts', department: 'Maintenance', createdAt: '10:00' } });
    await db.task.create({ data: { id: 'task-other', hotelId: 'mt-a', room: '203', title: 'Unrelated repair', department: 'Maintenance', createdAt: '10:00' } });
    await db.task.create({ data: { id: 'task-fo', hotelId: 'mt-a', title: 'Front Office work', department: 'Front Office', createdAt: '10:00' } });
    await db.issue.create({ data: { id: 'issue-b', hotelId: 'mt-b', room: '203', title: 'Other hotel issue', reportedBy: 'Staff', createdAt: '10:00' } });
    const worker = await service.saveWorker(user, null, { name: 'Test technician', phone: '+31612345678', active: true, whatsappEnabled: true });
    const second = await service.saveWorker(user, null, { name: 'Second technician', phone: '+31622222222', active: true, whatsappEnabled: true });
    const foreign = await service.saveWorker({ ...user, hotelId: 'mt-b' }, null, { name: 'Other hotel worker', phone: '+31612345678', active: true, whatsappEnabled: true });
    const view = await service.read(user);
    assert.equal(view.work.length, 3); assert.equal(view.work.find(row => row.id === issue.id).status, 'Open');
    assert.equal((await service.read({ ...user, hotelId: 'mt-b' })).work.length, 1);
    const request = { workerId: worker.id, work: [{ kind: 'issue', id: issue.id, version: 0 }, { kind: 'task', id: task.id, version: 0 }], requestKey: randomUUID() };
    await assert.rejects(service.assign(user, { ...request, workerId: foreign.id }), /technician/);
    for (const bad of [{ kind: 'issue', id: 'issue-b', version: 0 }, { kind: 'task', id: 'task-fo', version: 0 }, { kind: 'issue', id: issue.id, version: 99 }]) await assert.rejects(service.assign(user, { ...request, work: [bad], requestKey: randomUUID() }), /Tasks changed/);
    const batch = await service.assign(user, request);
    assert.equal(batch.deliveryStatus, 'waiting_window'); assert.equal(sent.length, 0);
    assert.equal((await service.assign(user, request)).id, batch.id);
    assert.equal(await db.maintenanceAssignment.count({ where: { hotelId: 'mt-a' } }), 1);
    let row = await db.issue.findUnique({ where: { id: issue.id } });
    assert.equal(row.status, 'Assigned'); assert.equal(row.acceptedAt, null); assert.equal(row.assignedWorkerId, worker.id);
    await assert.rejects(service.assign(user, { ...request, workerId: second.id }), /reused/);
    assert.equal(await inbound('MAINTENANCE', '31699999999'), false);
    await inbound('MAINTENANCE'); assert.match(latest().text, /203: Repair lamp/); assert.match(latest().text, /203: Check spare parts/);
    const accept = latest().buttons[0];
    await inbound(service.button(worker, batch.id, `issue:${issue.id}`, 'done', 'Completed'));
    assert.equal((await db.issue.findUnique({ where: { id: issue.id } })).status, 'Assigned');
    await inbound(accept, '31622222222');
    assert.equal((await db.issue.findUnique({ where: { id: issue.id } })).status, 'Assigned');
    await inbound(accept, undefined, 'accept-once');
    const sentCount = sent.length; await inbound(accept, undefined, 'accept-once'); assert.equal(sent.length, sentCount);
    row = await db.issue.findUnique({ where: { id: issue.id } });
    assert.equal(row.status, 'Accepted'); assert(row.acceptedAt);
    assert.equal((await db.task.findUnique({ where: { id: task.id } })).status, 'Accepted');
    assert.equal((await db.maintenanceAssignment.findUnique({ where: { id: batch.id } })).deliveryStatus, 'accepted');
    await inbound('MAINTENANCE'); assert.match(latest().text, /Repair lamp/);
    await inbound(latest().buttons[0]); assert.equal((await db.issue.findUnique({ where: { id: issue.id } })).status, 'In Progress');
    const done = latest().buttons[0]; assert.equal(done.title, 'Completed');
    await inbound(done);
    row = await db.issue.findUnique({ where: { id: issue.id } }); assert.equal(row.status, 'Completed'); assert(row.startedAt && row.completedAt);
    assert.equal((await db.room.findUnique({ where: { hotelId_number: { hotelId: 'mt-a', number: '203' } } })).status, 'Maintenance');
    assert.equal((await db.task.findUnique({ where: { id: 'task-other' } })).status, 'New');
    assert.match(latest().text, /Check spare parts/);
    await inbound(latest().buttons[0]); // start follow-up task
    await inbound(latest().buttons[1]); // problem
    await inbound(latest().buttons[0]); // parts required
    assert.equal((await db.task.findUnique({ where: { id: task.id } })).status, 'Waiting');
    await inbound('Replacement cable arrives tomorrow');
    assert.equal((await db.task.findUnique({ where: { id: task.id } })).problemNote, 'Replacement cable arrives tomorrow');
    await inbound('MAINTENANCE'); await inbound(latest().buttons[0]); await inbound(latest().buttons[0]);
    assert.equal((await db.task.findUnique({ where: { id: task.id } })).status, 'Completed');
    assert.match(latest().text, /No maintenance tasks/);
    const events = await db.issueUpdate.findMany({ where: { issueId: issue.id } });
    assert.equal(events.filter(event => event.text.includes('WhatsApp: Completed')).length, 1);
    await inbound(done); assert.equal(await db.issueUpdate.count({ where: { issueId: issue.id } }), events.length);
    assert(broadcasts.some(args => args[0] === 'mt-a' && args[1] === 'maintenance:updated'));

    // Reassignment and changed phone revoke previous worker actions.
    await service.updateStatus(user, 'issue', issue.id, { status: 'Open', version: row.version });
    row = await db.issue.findUnique({ where: { id: issue.id } });
    const reassigned = await service.assign(user, { workerId: second.id, work: [{ kind: 'issue', id: issue.id, version: row.version }], requestKey: randomUUID() });
    await inbound(done); assert.equal((await db.issue.findUnique({ where: { id: issue.id } })).status, 'Assigned');
    await inbound('MAINTENANCE', '31622222222');
    const secondAccept = latest().buttons[0];
    await service.saveWorker(user, second.id, { ...second, phone: '+31633333333' });
    await inbound(secondAccept, '31633333333'); assert.equal((await db.issue.findUnique({ where: { id: issue.id } })).status, 'Assigned');
    assert.equal(await inbound('MAINTENANCE', '31622222222'), false);

    // Approved template has two body variables; provider uncertainty is not retried.
    await service.saveConfig(user, { templateName: 'maintenance_assignment', templateLanguage: 'en_US' });
    await db.maintenanceWorker.update({ where: { id: worker.id }, data: { lastInboundAt: null } });
    delivery = { success: false, uncertain: true };
    const templateRequest = { workerId: worker.id, work: [{ kind: 'task', id: 'task-other', version: 0 }], requestKey: randomUUID() };
    const templateBatch = await service.assign(user, templateRequest);
    assert.equal(templateBatch.deliveryStatus, 'uncertain'); assert.equal(latest().template.name, 'maintenance_assignment');
    assert.deepEqual(latest().template.components[0].parameters.map(p => p.text), ['Test technician', '1']);
    const beforeRetry = sent.length; await service.assign(user, templateRequest); assert.equal(sent.length, beforeRetry);
    // A very fast worker acceptance must not be overwritten by provider submission status.
    delivery = { success: true, messageId: 'mock' };
    onSend = async () => { await db.maintenanceAssignment.updateMany({ where: { hotelId: 'mt-a', deliveryStatus: 'sending' }, data: { deliveryStatus: 'accepted' } }); };
    row = await db.issue.findUnique({ where: { id: issue.id } });
    const concurrent = await service.assign(user, { workerId: worker.id, work: [{ kind: 'issue', id: issue.id, version: row.version }], requestKey: randomUUID() });
    assert.equal(concurrent.deliveryStatus, 'accepted'); onSend = null;
    assert.equal(service.parse(foreign, secondAccept.id), null);
    assert(reassigned.id);
    // A shared staff phone must explicitly select its department.
    const hkWorker = await db.housekeepingWorker.create({ data: { hotelId: 'mt-a', name: 'Shared worker', phone: worker.phone, active: true, whatsappEnabled: true } });
    await inbound('TASKS'); assert.match(latest().text, /Reply MAINTENANCE.*HOUSEKEEPING/);
    assert.equal(await inbound('HOUSEKEEPING'), false);
    assert.equal(await inbound({ id: 'hk.some.action', title: 'Accept' }), false);
    await inbound('MAINTENANCE'); assert.match(latest().text, /Maintenance/);
    await db.housekeepingWorker.update({ where: { id: hkWorker.id }, data: { pendingProblemTaskId: 'hk-task' } });
    assert.equal(await inbound('Housekeeping problem note'), false);
    assert.equal(await inbound('MAINTENANCE', undefined, randomUUID(), { ...integration, targetType: 'guest' }), false);
    const disabled = await service.saveWorker(user, worker.id, { ...worker, active: false });
    assert.equal(disabled.active, false);
    assert.equal(await inbound('MAINTENANCE'), false);
  } finally { await db.$disconnect(); }
});
