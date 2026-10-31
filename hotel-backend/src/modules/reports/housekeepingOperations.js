import { draftBlocker, addBlockerNote, carryNeedsReview, workBlockers } from '../operations/blockers.js';
import { guestWorkStatusChanged } from '../operations/guestHandoffs.js';
import { beginHousekeepingRepair, describeHousekeepingRepair } from './housekeepingRepairs.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readReports } from './reportService.js';
import { planData, planToken, planRef, batchRef, planLocation, planPriority, planOrder } from './housekeepingPlan.js';
import { saveHousekeepingChange, notifyHousekeepingChange } from './housekeepingChanges.js';
import { assertCurrentSource, failOperation, hkLabels, syncOperations } from './reportOperations.js';

export function createHousekeepingOperations({ db, send, broadcast = () => {}, env = process.env, now = () => new Date() }) {
  const publish = hotelId => { for (const event of ['reports:updated', 'maintenance:updated', 'readiness:updated', 'blockers:updated']) broadcast(hotelId, event, { refresh: true }); };
  function signature(worker, value) {
    const key = env.PMS_MCP_CONTEXT_KEY;
    if (!key || key.length < 32) throw new Error('Operational action signing is not configured');
    return createHmac('sha256', key).update(`${worker.hotelId}:${worker.id}:${worker.phone || ''}:${value}`).digest('base64url').slice(0, 22);
  }
  function button(worker, assignmentId, taskId, action, title) {
    const value = `hk.${assignmentId}.${taskId}.${action}.${Math.floor(+now() / 1000) + 86400}`;
    return { id: `${value}.${signature(worker, value)}`, title };
  }
  function parse(worker, value) {
    const parts = String(value || '').split('.');
    if (parts.length !== 6 || parts[0] !== 'hk' || !['accept', 'start', 'done', 'problem', 'dnd', 'maintenance', 'next', 'more', 'inside', 'declined', 'supplies'].includes(parts[3])) return null;
    const expires = Number(parts[4]);
    if (!Number.isFinite(expires) || expires < +now() / 1000 || expires > +now() / 1000 + 86410) return null;
    const expected = signature(worker, parts.slice(0, 5).join('.'));
    if (!/^[A-Za-z0-9_-]{22}$/.test(parts[5]) || !timingSafeEqual(Buffer.from(parts[5]), Buffer.from(expected))) return null;
    return { assignmentId: parts[1], taskId: parts[2].split('~')[0], ref: parts[2], action: parts[3] };
  }
  function validRef(action, rows) {
    if (action.taskId === 'all') return action.ref === batchRef(rows.filter(r => r.status === 'Assigned')) || (action.ref === 'all' && rows.every(r => !r.planVersion));
    return rows.length === 1 && (action.ref === planRef(rows[0]) || (action.ref === rows[0].id && !rows[0].planVersion));
  }
  async function packet(worker) {
    const snapshot = await readReports(db, { hotelId: worker.hotelId, role: 'housekeeping' });
    const source = snapshot.reports.find(r => r.kind === 'housekeeping');
    const current = source?.status === 'complete' && !source.stale && !source.latestRunFailed;
    const all = await db.reportTask.findMany({ where: { hotelId: worker.hotelId, kind: 'housekeeping', active: true, OR: [{ reportDate: snapshot.today }, { carryForward: true }], assignedWorkerId: worker.id, status: { in: ['Assigned', 'Accepted', 'In Progress', 'Problem', 'Waiting', 'Escalated'] } } });
    const blockers = await workBlockers(db, worker.hotelId, 'report', all.map(t => t.id));
    const tasks = all.filter(t => ['Assigned', 'Accepted', 'In Progress'].includes(t.status) && !t.sourceReviewRequired && !carryNeedsReview(t, snapshot.today) && !blockers.some(b => b.workId === t.id) && (t.origin === 'staff' || (t.carryForward && t.reportDate < snapshot.today) || current)).sort(planOrder);
    const heldSummary = blockers.slice(0, 6).map(b => `${planLocation(all.find(t => t.id === b.workId))}: ${b.type.replaceAll('_', ' ')} ? ${b.followUpLocal ? `follow up ${b.followUpLocal.replace('T', ' ')} (${b.timezone}); owner ${b.ownerName}` : 'coordinator must schedule follow-up'}`).join('\n');
    const blocked = all.length - tasks.length;
    const pending = tasks.find(t => t.status === 'Assigned');
    if (pending) {
      const batch = tasks.filter(t => t.assignmentId === pending.assignmentId && t.status === 'Assigned');
      // Accept only a complete, current batch. A partly changed batch needs staff review first.
      const allPending = all.filter(t => t.assignmentId === pending.assignmentId && t.status === 'Assigned');
      if (allPending.length !== batch.length) return { text: 'Part of your assignment needs staff review. Contact housekeeping before accepting it. Reply TASKS after the plan is updated.' };
      return { text: `Housekeeping ? ${pending.reportDate}\nHi ${worker.name}, ${batch.length} task(s) await your acceptance.\n${batch.slice(0, 8).map(t => `${planLocation(t)}: ${hkLabels[planData(t).task] || planData(t).task} (${planPriority(t)})`).join('\n')}${batch.length > 8 ? '\nMore tasks follow after acceptance.' : ''}`.slice(0, 1000),
        buttons: [button(worker, pending.assignmentId, batchRef(batch), 'accept', 'Accept')] };
    }
    const task = tasks.find(t => t.status === 'In Progress' && (!t.notBefore || +t.notBefore <= +now())) || tasks.find(t => !t.notBefore || +t.notBefore <= +now()) || tasks[0];
    if (!task) return { text: blocked ? `Your plan needs staff review, has unresolved blockers, or its latest run failed. Contact housekeeping before continuing.\n${heldSummary}` : 'No accepted tasks are waiting. Reply TASKS to refresh your assignments.', buttons: [] };
    const d = planData(task), accessBlocked = task.notBefore && +task.notBefore > +now();
    return { text: `${planLocation(task)} ? ${hkLabels[d.task] || d.task}\nPriority: ${planPriority(task)}${d.notBeforeTime ? `\nDo not enter before ${d.notBeforeTime} (hotel time)` : ''}${d.dueTime ? `\nNeeded by ${d.dueTime} (hotel time)` : ''}\n${d.comment || ''}${d.checkoutTime ? `\nExpected checkout: ${d.checkoutTime}` : ''}\nStatus: ${task.status}${accessBlocked ? '\nAccess is restricted. Reply TASKS after the access time.' : ''}`.slice(0, 1000),
      buttons: [...(accessBlocked ? [] : [button(worker, task.assignmentId, planRef(task), task.status === 'In Progress' ? 'done' : 'start', task.status === 'In Progress' ? 'Completed' : 'Start')]), button(worker, task.assignmentId, planRef(task), 'problem', 'Problem')] };
  }
  async function notify(assignment, worker) {
    if (assignment.deliveryStatus !== 'pending') return assignment;
    const openWindow = worker.lastInboundAt && +worker.lastInboundAt > +now() - 23.5 * 3600000;
    const config = await db.housekeepingConfig.findUnique({ where: { hotelId: worker.hotelId } });
    if (!openWindow && !config?.templateName) return db.housekeepingAssignment.update({ where: { id: assignment.id }, data: { deliveryStatus: 'waiting_window', lastError: 'Worker must message TASKS to the hotel internal WhatsApp number, or configure an approved assignment template.' } });
    const claimed = await db.housekeepingAssignment.updateMany({ where: { id: assignment.id, hotelId: worker.hotelId, deliveryStatus: 'pending' }, data: { deliveryStatus: 'sending' } });
    if (!claimed.count) return db.housekeepingAssignment.findUnique({ where: { id: assignment.id } });
    try {
      const payload = openWindow ? await packet(worker) : { template: { name: config.templateName, language: { code: config.templateLanguage }, components: [{ type: 'body', parameters: [{ type: 'text', text: worker.name }, { type: 'text', text: String(assignment.taskIds.length) }] }] } };
      const response = await send({ hotelId: worker.hotelId, targetType: 'internal', to: worker.phone, ...payload });
      await db.housekeepingAssignment.updateMany({ where: { id: assignment.id, deliveryStatus: 'sending' }, data: { deliveryStatus: response.success ? (openWindow ? 'submitted' : 'template_submitted') : response.uncertain ? 'uncertain' : 'failed', messageId: response.messageId || null, lastError: response.success ? null : 'WhatsApp delivery not confirmed. Check the connection and provider before retrying.' } });
      return db.housekeepingAssignment.findUnique({ where: { id: assignment.id } });
    } catch {
      return db.housekeepingAssignment.update({ where: { id: assignment.id }, data: { deliveryStatus: 'uncertain', lastError: 'Delivery outcome unknown. No automatic resend.' } });
    }
  }
  async function assign(user, { workerId, tasks, requestKey }) {
    if (!['manager', 'housekeeping'].includes(user.role)) failOperation('Housekeeping manager access required', 403);
    if (!Array.isArray(tasks) || !tasks.length || tasks.length > 100 || tasks.some(t => !t || typeof t.id !== 'string' || typeof t.contentHash !== 'string') || new Set(tasks.map(t => t.id)).size !== tasks.length || typeof requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(requestKey)) failOperation('Select 1–100 distinct tasks and supply a request ID');
    const previous = await db.housekeepingAssignment.findUnique({ where: { hotelId_requestKey: { hotelId: user.hotelId, requestKey } } });
    if (previous) {
      if (previous.workerId !== workerId || JSON.stringify([...previous.taskIds].sort()) !== JSON.stringify(tasks.map(t => t.id).sort())) failOperation('Request ID was reused with a different assignment', 409);
      return previous;
    }
    const source = await syncOperations(db, user);
    const worker = await db.housekeepingWorker.findFirst({ where: { id: workerId, hotelId: user.hotelId, active: true, whatsappEnabled: true } });
    if (!worker) failOperation('Select an active WhatsApp-enabled worker from this hotel');
    if (!await db.whatsAppIntegration.findFirst({ where: { hotelId: user.hotelId, status: 'connected', targetType: { in: ['internal', 'both'] } } })) failOperation('Connect the hotel internal WhatsApp number first', 409);
    signature(worker, 'preflight');
    const assignment = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${user.hotelId}`}, 0))`;
      const replay = await tx.housekeepingAssignment.findUnique({ where: { hotelId_requestKey: { hotelId: user.hotelId, requestKey } } });
      if (replay) {
        if (replay.workerId !== workerId || JSON.stringify([...replay.taskIds].sort()) !== JSON.stringify(tasks.map(t => t.id).sort())) failOperation('Request ID was reused with a different assignment', 409);
        return replay;
      }
      if (!await tx.housekeepingWorker.findFirst({ where: { id: worker.id, hotelId: user.hotelId, phone: worker.phone, active: true, whatsappEnabled: true } })) failOperation('Worker changed; refresh first', 409);
      const rows = await tx.reportTask.findMany({ where: { id: { in: tasks.map(t => t.id) }, hotelId: user.hotelId, kind: 'housekeeping', active: true, OR: [{ reportDate: source.today }, { carryForward: true }] } });
      if (rows.length !== tasks.length || rows.some(t => ['In Progress', 'Completed'].includes(t.status) || tasks.find(item => item.id === t.id).contentHash !== planToken(t))) failOperation('Tasks changed or are already started/completed. Refresh first.', 409);
      await assertCurrentSource(tx, user.hotelId, rows, source.today);
      const batch = await tx.housekeepingAssignment.create({ data: { hotelId: user.hotelId, workerId, taskIds: rows.map(t => t.id), requestKey, createdBy: user.id } });
      await tx.reportTask.updateMany({ where: { id: { in: rows.map(t => t.id) }, hotelId: user.hotelId }, data: { assignedWorkerId: workerId, assignmentId: batch.id, status: 'Assigned', assignedAt: now(), acceptedAt: null, startedAt: null, completedAt: null, problemType: null, problemNote: null } });
      await tx.reportTaskEvent.createMany({ data: rows.map(t => ({ hotelId: user.hotelId, taskId: t.id, actor: user.id, text: `Assigned to worker ${workerId}` })) });
      return batch;
    });
    const delivered = await notify(assignment, worker); publish(user.hotelId); return delivered;
  }
  async function handle(integration, message) {
    if (!['internal', 'both'].includes(integration.targetType)) return false;
    const worker = await db.housekeepingWorker.findFirst({ where: { hotelId: integration.hotelId, phone: `+${message.from}`, active: true, whatsappEnabled: true } });
    if (!worker) return false;
    const receiptId = `hk:${integration.phoneNumberId}:${message.id}`;
    try { await db.whatsAppReceipt.create({ data: { id: receiptId, hotelId: worker.hotelId, phoneNumberId: integration.phoneNumberId, sender: message.from, status: 'processing' } }); }
    catch (error) { if (error.code === 'P2002') return true; throw error; }
    const inbound = new Date(Number(message.timestamp) * 1000);
    if (!Number.isFinite(+inbound) || +inbound > +now() + 300000 || +inbound < +now() - 86400000) {
      await db.whatsAppReceipt.update({ where: { id: receiptId }, data: { status: 'done', lastError: 'Expired inbound event' } }); return true;
    }
    await db.housekeepingWorker.update({ where: { id: worker.id }, data: { lastInboundAt: inbound } });
    let response;
    try {
      const snapshot = await syncOperations(db, { hotelId: worker.hotelId, role: 'housekeeping' });
      const actionId = message.interactive?.button_reply?.id || message.button?.payload;
      const action = parse(worker, actionId);
      if (actionId && !action) response = { text: 'This action is expired or invalid. Reply TASKS for current assignments.' };
      else if (action) {
        const rows = await db.reportTask.findMany({ where: { hotelId: worker.hotelId, active: true, assignedWorkerId: worker.id, assignmentId: action.assignmentId, ...(action.taskId !== 'all' ? { id: action.taskId } : action.action === 'accept' ? { status: 'Assigned' } : {}) } });
        if (!rows.length || !validRef(action, rows)) response = { text: 'This assignment has changed. Reply TASKS for your current work.' };
        else if (action.action === 'problem') {
          await assertCurrentSource(db, worker.hotelId, rows, snapshot.today);
          const task = rows[0];
          response = { text: `${planLocation(task)}: choose the problem type. You can then describe it.`, buttons: [button(worker, action.assignmentId, planRef(task), 'dnd', 'Do not disturb'), button(worker, action.assignmentId, planRef(task), 'maintenance', 'Maintenance'), button(worker, action.assignmentId, planRef(task), 'more', 'Other blocker')] };
        } else if (action.action === 'more') {
          const task = rows[0];
          response = { text: `${planLocation(task)}: choose the blocker.`, buttons: [button(worker, task.assignmentId, planRef(task), 'inside', 'Guest inside'), button(worker, task.assignmentId, planRef(task), 'declined', 'Service declined'), button(worker, task.assignmentId, planRef(task), 'supplies', 'Missing supplies')] };
        } else {
          const target = { accept: 'Accepted', start: 'In Progress', done: 'Completed', dnd: 'Problem', maintenance: 'Problem', inside: 'Problem', declined: 'Problem', supplies: 'Problem' }[action.action];
          const from = { accept: ['Assigned'], start: ['Accepted'], done: ['In Progress'], dnd: ['Accepted', 'In Progress'], maintenance: ['Accepted', 'In Progress'], inside: ['Accepted', 'In Progress'], declined: ['Accepted', 'In Progress'], supplies: ['Accepted', 'In Progress'] }[action.action];
          let changedCount = 0;
          if (target) await db.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${worker.hotelId}`}, 0))`;
            if (!await tx.housekeepingWorker.findFirst({ where: { id: worker.id, hotelId: worker.hotelId, phone: worker.phone, active: true, whatsappEnabled: true } })) failOperation('Worker changed', 409);
            const fresh = await tx.reportTask.findMany({ where: { hotelId: worker.hotelId, active: true, assignedWorkerId: worker.id, assignmentId: action.assignmentId, ...(action.taskId !== 'all' ? { id: action.taskId } : action.action === 'accept' ? { status: 'Assigned' } : {}) } });
            if (!validRef(action, fresh)) failOperation('Instructions changed. Reply TASKS for current instructions.', 409);
            await assertCurrentSource(tx, worker.hotelId, fresh, snapshot.today);
            if (['start', 'done'].includes(action.action) && fresh.some(r => r.notBefore && +r.notBefore > +now())) failOperation('Do not enter before the recorded access time. Reply TASKS for details.', 409);
            for (const row of fresh) {
              const changes = { status: target, ...(target === 'Accepted' ? { acceptedAt: row.acceptedAt || now() } : target === 'In Progress' ? { startedAt: row.startedAt || now() } : target === 'Completed' ? { completedAt: now(), carryForward: false } : { problemType: action.action }) };
              const updated = await tx.reportTask.updateMany({ where: { id: row.id, hotelId: worker.hotelId, assignedWorkerId: worker.id, assignmentId: action.assignmentId, active: true, status: { in: from } }, data: changes });
              if (updated.count) {
                changedCount++;
                await guestWorkStatusChanged(tx, 'report', row, target, worker.id);
                await tx.reportTaskEvent.create({ data: { hotelId: worker.hotelId, taskId: row.id, actor: worker.id, text: `WhatsApp: ${target}${target === 'Problem' ? ` (${action.action})` : ''}` } });
                if (['dnd', 'inside', 'declined', 'supplies'].includes(action.action)) await draftBlocker(tx, { hotelId: worker.hotelId, kind: 'report', work: row, type: action.action === 'inside' ? 'guest_inside' : action.action, actor: worker.id, requestKey: `wa-${receiptId}` });
                if (action.action === 'maintenance') await beginHousekeepingRepair(tx, row, worker.id);
                if (target === 'Problem') await tx.housekeepingWorker.update({ where: { id: worker.id }, data: { pendingProblemTaskId: row.id } });
              }
            }
            if (target === 'Accepted' && changedCount) await tx.housekeepingAssignment.updateMany({ where: { id: action.assignmentId, hotelId: worker.hotelId, workerId: worker.id }, data: { deliveryStatus: 'accepted', lastError: null } });
          }, { timeout: 30000 });
          if (target === 'Problem' && changedCount) response = { text: action.action === 'maintenance' ? 'Maintenance ticket created and linked to this task. Reply with a short fault description for the technician, or TASKS to continue.' : 'Blocker saved. Reply with details (guest instructions, declined service/alternative, or missing items). Your coordinator will record the owner and next follow-up time. TASKS shows other work.' };
        }
      } else if (worker.pendingProblemTaskId && message.text?.body && !/^(tasks|housekeeping)$/i.test(message.text.body.trim())) {
        await db.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${worker.hotelId}`}, 0))`;
          const currentWorker = await tx.housekeepingWorker.findFirst({ where: { id: worker.id, hotelId: worker.hotelId, phone: worker.phone, active: true, whatsappEnabled: true } });
          if (!currentWorker || currentWorker.pendingProblemTaskId !== worker.pendingProblemTaskId) failOperation('Worker or pending task changed', 409);
          const problemTask = await tx.reportTask.findFirst({ where: { id: worker.pendingProblemTaskId, hotelId: worker.hotelId, assignedWorkerId: worker.id, active: true, status: 'Problem' } });
          if (problemTask?.problemType === 'maintenance') { const issue = await describeHousekeepingRepair(tx, problemTask, message.text.body.slice(0, 2000), worker.id); response = { text: `Maintenance report saved. Linked ticket: ${issue.id}. Reply TASKS for your remaining work.` }; }
          if (problemTask && problemTask.problemType !== 'maintenance') await addBlockerNote(tx, worker.hotelId, 'report', problemTask.id, worker.id, message.text.body);
          await tx.reportTask.updateMany({ where: { id: worker.pendingProblemTaskId, hotelId: worker.hotelId, assignedWorkerId: worker.id, active: true, status: 'Problem' }, data: { problemNote: message.text.body.slice(0, 2000) } });
          await tx.housekeepingWorker.update({ where: { id: worker.id }, data: { pendingProblemTaskId: null } });
        });
      }
      response ||= await packet(worker);
      await db.whatsAppReceipt.update({ where: { id: receiptId }, data: { status: 'sending', replyText: JSON.stringify(response) } });
      const delivered = await send({ hotelId: worker.hotelId, targetType: 'internal', to: worker.phone, ...response });
      await db.whatsAppReceipt.update({ where: { id: receiptId }, data: { status: delivered.success ? 'done' : 'uncertain', providerMessageId: delivered.messageId || null, lastError: delivered.success ? null : 'Reply not confirmed; worker can send TASKS again.' } });
    } catch (error) {
      if (error.status) { try { await send({ hotelId: worker.hotelId, targetType: 'internal', to: worker.phone, text: error.message }); } catch {} }
      await db.whatsAppReceipt.update({ where: { id: receiptId }, data: { status: 'uncertain', lastError: 'Operational reply interrupted. Inspect task state; no automatic replay.' } });
    }
    publish(worker.hotelId); return true;
  }
  async function change(user, id, input) {
    const saved = await saveHousekeepingChange(db, user, id, input);
    const notification = await notifyHousekeepingChange({ db, send, now }, saved);
    publish(user.hotelId); return notification;
  }
  async function reportRepair(user, id, input = {}) {
    if (!['manager', 'housekeeping', 'front-office'].includes(user.role)) failOperation('Housekeeping report access required', 403);
    if (typeof input.note !== 'string' || !input.note.trim() || input.note.length > 2000) failOperation('Describe the maintenance fault');
    const snapshot = await syncOperations(db, user);
    const issue = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${user.hotelId}`}, 0))`;
      const task = await tx.reportTask.findFirst({ where: { id, hotelId: user.hotelId, kind: 'housekeeping', active: true, OR: [{ reportDate: snapshot.today }, { carryForward: true }] } });
      if (!task) failOperation('Housekeeping task not found', 404);
      if (planToken(task) !== input.reportContentHash) failOperation('Task changed; refresh first', 409);
      if (task.status === 'Completed') failOperation('Completed work is retained. Add a new task to report a new fault.', 409);
      const result = await describeHousekeepingRepair(tx, task, input.note.trim(), user.id);
      await tx.reportTask.update({ where: { id }, data: { status: 'Problem', problemType: 'maintenance', problemNote: input.note.trim(), planVersion: { increment: 1 } } });
      return { id: result.id };
    });
    publish(user.hotelId); return issue;
  }
  return { assign, change, reportRepair, handle, button, parse, packet };
}
