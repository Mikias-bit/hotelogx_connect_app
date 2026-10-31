import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { createGuestHandoffService, createGuestTask, assertGuestHandoffsResolved } from '../modules/operations/guestHandoffs.js';
import { guestHandoffRouter } from '../modules/operations/guestHandoffRoutes.js';
import { createMaintenanceOperations } from '../modules/maintenance/maintenanceOperations.js';
import { createHousekeepingOperations } from '../modules/reports/housekeepingOperations.js';
import { updateReportTask } from '../modules/reports/reportOperations.js';
import { planToken } from '../modules/reports/housekeepingPlan.js';
import { processGuestMessageAI } from '../modules/conversations/aiService.js';
import { resolveConversation, toggleTakeover, getConversations } from '../modules/conversations/conversationsController.js';

const enabled = process.env.HANDOFFS_DATABASE_TESTS === 'true';
const hotel = id => ({ id, timezone: 'UTC', name: 'Handoff Test', legalName: 'Test', address: '', postcode: '', city: '', country: '', phone: '', email: '', website: '', bookingEngine: '', whatsappNumber: '', vatNumber: '', description: '' });
async function conversation(db, hotelId, id) {
  await db.guest.create({ data: { id: `guest-${id}`, hotelId, name: 'Test Guest', country: 'NL', language: 'en' } });
  return db.conversation.create({ data: { id, guestId: `guest-${id}`, stage: 'in-house', primaryChannel: 'whatsapp', aiStatus: 'ai-handling', sentiment: 'neutral', subject: 'Room problem', summary: '', suggestedReply: '', lastAt: '10:00' } });
}

test('WhatsApp completion, FO acknowledgment, real contact recording, resolution and reopening remain separate', { skip: !enabled, timeout: 240000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).searchParams.get('schema') || '', /^handoffs_test_[a-f0-9]{16}$/);
  const db = new PrismaClient(), sent = [], events = [];
  const manager = { hotelId: 'handoff-a', id: 'manager', role: 'manager' }, fo = { ...manager, id: 'desk', role: 'front-office' };
  const service = createGuestHandoffService({ db, broadcast: (...args) => events.push(args) });
  let server;
  const mt = createMaintenanceOperations({ db, env: { PMS_MCP_CONTEXT_KEY: 'test'.repeat(12) }, send: async p => { sent.push(p); return { success: true, messageId: randomUUID() }; } });
  try {
    for (const id of ['handoff-a', 'handoff-b']) await db.hotel.create({ data: hotel(id) });
    await conversation(db, manager.hotelId, 'conv-a'); await conversation(db, 'handoff-b', 'conv-b');
    const body = { id: 'guest-repair', hotelId: manager.hotelId, title: 'Repair tap', department: 'Maintenance', room: '203', conversationId: 'conv-a', createdAt: '10:00' };
    await assert.rejects(createGuestTask(db, { data: { ...body, conversationId: 'conv-b' } }), /Conversation not found/);
    assert.equal(await db.task.count(), 0, 'foreign conversation rolls back task creation');
    const task = await createGuestTask(db, { data: body });
    let row = (await service.read(fo))[0]; assert.equal(row.workCompletedAt, null); assert.equal(row.foInformedAt, null);
    assert.equal((await service.read({ ...fo, hotelId: 'handoff-b' })).length, 0);
    assert.equal((await service.read({ ...fo, role: 'housekeeping' })).length, 0);
    await assert.rejects(service.act(fo, row.id, { action: 'inform', note: 'Premature', version: row.version }), /must be completed/);
    const worker = await mt.saveWorker(manager, null, { name: 'Technician', phone: '+31611110000', active: true, whatsappEnabled: true });
    const integration = await db.whatsAppIntegration.create({ data: { hotelId: manager.hotelId, phoneNumber: '+31611119999', phoneNumberId: 'handoff-phone', wabaId: 'handoff-waba', targetType: 'internal', status: 'connected', verifiedAt: new Date() } });
    await mt.assign(manager, { workerId: worker.id, work: [{ kind: 'task', id: task.id, version: 0 }], requestKey: randomUUID() });
    const inbound = value => mt.handle(integration, { id: randomUUID(), from: '31611110000', timestamp: String(Math.floor(Date.now() / 1000)), ...(typeof value === 'string' ? { text: { body: value } } : { interactive: { button_reply: value } }) });
    await inbound('MAINTENANCE'); await inbound(sent.at(-1).buttons[0]); await inbound(sent.at(-1).buttons[0]);
    const doneButton = sent.at(-1).buttons[0]; await inbound(doneButton);
    row = (await service.read(fo))[0]; assert.equal(row.workStatus, 'Completed'); assert(row.workCompletedAt);
    assert.equal(row.foInformedAt, null); assert.equal(row.contactStatus, 'pending'); assert.notEqual(row.state, 'resolved');
    assert.equal((await db.conversation.findUnique({ where: { id: 'conv-a' } })).aiStatus, 'escalated');
    const app = express(); app.use(express.json()); app.use((req, res, next) => { req.user = fo; next(); });
    app.get('/conversations', getConversations); app.post('/conversations/:id/resolve', resolveConversation); app.post('/conversations/:id/takeover', toggleTakeover);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (path, body = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('/conversations/conv-a/resolve')).status, 409);
    assert.equal((await post('/conversations/conv-a/takeover', { aiStatus: 'resolved' })).status, 400);
    assert.equal((await post('/conversations/conv-a/takeover', { aiStatus: 'ai-handling' })).status, 409);
    assert.equal((await post('/conversations/conv-a/takeover', { aiStatus: 'human-takeover' })).status, 200);
    const listed = await (await fetch(base + '/conversations')).json();
    assert.equal(listed.data.find(c => c.id === 'conv-a').guestFollowUpPending, true, 'handoff remains in escalation counts during staff takeover');
    assert.equal(await db.message.count({ where: { author: { in: ['ai', 'staff'] } } }), 0, 'completion does not fabricate guest contact');
    await assert.rejects(assertGuestHandoffsResolved(db, manager.hotelId, 'conv-a'), /follow-ups/);
    await assert.rejects(service.act(fo, row.id, { action: 'resolve', note: 'Technician finished', version: row.version }), /acknowledgment/);
    const result = await processGuestMessageAI({ database: db, hotelId: manager.hotelId, conversationId: 'conv-a', messageText: 'It is still leaking', channel: 'whatsapp' });
    assert.equal(result.requiresApproval, true); assert.equal(result.type, 'guest_follow_up'); assert.equal(await db.task.count(), 1);
    row = await service.act(fo, row.id, { action: 'inform', note: 'Desk received technician report', version: row.version });
    row = await service.act(fo, row.id, { action: 'unreachable', note: 'Called room; no answer', channel: 'phone', version: row.version });
    await assert.rejects(service.act(fo, row.id, { action: 'resolve', note: 'No answer', version: row.version }), /guest contact/);
    row = await service.act(fo, row.id, { action: 'contact', note: 'Guest confirms tap still leaks', channel: 'phone', version: row.version });
    const priorVersion = row.version;
    row = await service.act(fo, row.id, { action: 'reopen', note: 'Guest confirms leak continues; technician must revisit', version: row.version });
    const reopened = await db.task.findUnique({ where: { id: task.id } });
    assert.equal(reopened.id, task.id); assert.equal(reopened.status, 'New'); assert.equal(reopened.assignmentId, null); assert.equal(reopened.completedAt, null);
    assert.equal(row.state, 'reopened'); assert.equal(row.cycle, 1); assert.equal(row.contactStatus, 'pending'); assert.equal(row.foInformedAt, null);
    await inbound(doneButton); assert.equal((await db.task.findUnique({ where: { id: task.id } })).status, 'New', 'old worker controls cannot close reopened work');
    await assert.rejects(service.act(fo, row.id, { action: 'resolve', note: 'Stale screen', version: priorVersion }), /changed/);
    const historical = await db.guestHandoffEvent.findFirst({ where: { handoffId: row.id, action: 'Guest issue reopened; returned to department' } });
    assert(historical.data.previous.workCompletedAt); assert.equal(historical.data.previous.contactStatus, 'contacted'); assert(historical.data.previousWork.assignmentId);
    await mt.updateStatus(manager, 'task', task.id, { status: 'Completed', version: reopened.version, note: 'Valve replaced and tested' });
    row = (await service.read(fo))[0]; assert.equal(row.foInformedAt, null);
    row = await service.act(fo, row.id, { action: 'inform', note: 'Second repair handed over', version: row.version });
    row = await service.act(fo, row.id, { action: 'contact', note: 'Guest confirms leak stopped', channel: 'in_person', version: row.version });
    const resolutions = await Promise.allSettled([1, 2].map(() => service.act(fo, row.id, { action: 'resolve', note: 'Guest confirmed repair successful', version: row.version })));
    assert.equal(resolutions.filter(r => r.status === 'fulfilled').length, 1);
    await assertGuestHandoffsResolved(db, manager.hotelId, 'conv-a');
    assert.equal((await service.read(fo))[0].state, 'resolved');
    assert.equal((await post('/conversations/conv-a/resolve')).status, 200);
    // Subsequent explicit recurrence is routed to FO without silently creating a second repair.
    const recurrence = await processGuestMessageAI({ database: db, hotelId: manager.hotelId, conversationId: 'conv-a', messageText: 'The same problem is back' });
    assert.equal(recurrence.requiresApproval, true); assert.equal(await db.task.count(), 1);
    assert(events.some(e => e[1] === 'handoffs:updated'));
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await db.$disconnect(); }
});

test('manual issues and housekeeping reports support handoff; scoped HTTP actions enforce roles and blockers', { skip: !enabled, timeout: 180000 }, async () => {
  const db = new PrismaClient(), user = { hotelId: 'handoff-manual', id: 'manager', role: 'manager' }, service = createGuestHandoffService({ db });
  let server;
  try {
    await db.hotel.create({ data: hotel(user.hotelId) });
    const hk = createHousekeepingOperations({ db });
    const created = await hk.change(user, null, { values: { room: '302', task: 'stayover_clean', comment: 'Guest complained about cleaning' }, reason: 'Guest request', requestKey: randomUUID() });
    let row = await service.enable(user, { workKind: 'report', workId: created.taskId });
    assert.equal((await service.enable(user, { workKind: 'report', workId: created.taskId })).id, row.id);
    const work = await db.reportTask.findUnique({ where: { id: created.taskId } });
    await assert.rejects(hk.change(user, work.id, { cancel: true, reason: 'Remove it', values: {}, requestKey: randomUUID(), reportContentHash: planToken(work) }), /Guest follow-up is still open/);
    await updateReportTask(db, { ...user, role: 'housekeeping' }, work.id, { status: 'Completed', reportContentHash: planToken(work) });
    row = (await service.read(user))[0]; assert(row.workCompletedAt); assert.equal(row.contactStatus, 'pending');
    const app = express(); app.use(express.json()); app.use('/handoffs', guestHandoffRouter({ service, auth: (req, res, next) => { req.user = { ...user, hotelId: req.headers['x-hotel'] || user.hotelId, role: req.headers['x-role'] || 'front-office' }; next(); } }));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/handoffs/${row.id}/actions`;
    const post = (body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({ action: 'inform', version: row.version, note: 'seen' }, { 'x-role': 'housekeeping' })).status, 403);
    assert.equal((await post({ action: 'inform', version: row.version, note: 'seen' }, { 'x-hotel': 'other' })).status, 404);
    row = await service.act(user, row.id, { action: 'inform', version: row.version, note: 'FO received report' });
    row = await service.act(user, row.id, { action: 'not_required', version: row.version, note: 'Guest asked not to be contacted; supervisor inspected the requested cleaning' });
    row = await service.act(user, row.id, { action: 'resolve', version: row.version, note: 'Supervisor confirmed cleaning meets the guest request; contact exception documented' });
    assert.equal(row.state, 'resolved');
    row = await service.act(user, row.id, { action: 'reopen', version: row.version, note: 'Guest reports dust remains' });
    assert.equal((await db.reportTask.findUnique({ where: { id: work.id } })).carryForward, true);
    const issue = await db.issue.create({ data: { id: 'manual-issue', hotelId: user.hotelId, room: '302', title: 'Noise reported in person', reportedBy: 'FO', createdAt: '10:00' } });
    await service.enable(user, { workKind: 'issue', workId: issue.id });
    await createMaintenanceOperations({ db }).updateStatus(user, 'issue', issue.id, { status: 'Completed', version: 0 });
    const manual = (await service.read(user)).find(r => r.workKind === 'issue');
    assert.equal(manual.awaitingFrontOffice, true); assert.equal(manual.conversationId, null);
    assert.equal(manual.foInformedAt, null); assert.equal(manual.contactStatus, 'pending');
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await db.$disconnect(); }
});
