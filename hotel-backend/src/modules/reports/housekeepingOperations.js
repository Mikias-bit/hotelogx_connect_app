import { createHmac, timingSafeEqual } from 'node:crypto';
import { assertCurrentSource, failOperation, hkLabels, syncOperations } from './reportOperations.js';

export function createHousekeepingOperations({ db, send, broadcast = () => {}, env = process.env, now = () => new Date() }) {
  const publish = hotelId => broadcast(hotelId, 'reports:updated', { refresh: true });
  function signature(worker, value) {
    const key = env.PMS_MCP_CONTEXT_KEY;
    if (!key || key.length < 32) throw new Error('Operational action signing is not configured');
    return createHmac('sha256', key).update(`${worker.hotelId}:${worker.id}:${value}`).digest('base64url').slice(0, 22);
  }
  function button(worker, assignmentId, taskId, action, title) {
    const value = `hk.${assignmentId}.${taskId}.${action}.${Math.floor(+now() / 1000) + 86400}`;
    return { id: `${value}.${signature(worker, value)}`, title };
  }
  function parse(worker, value) {
    const parts = String(value || '').split('.');
    if (parts.length !== 6 || parts[0] !== 'hk' || !['accept', 'start', 'done', 'problem', 'dnd', 'maintenance', 'next'].includes(parts[3])) return null;
    const expires = Number(parts[4]);
    if (!Number.isFinite(expires) || expires < +now() / 1000 || expires > +now() / 1000 + 86410) return null;
    const expected = signature(worker, parts.slice(0, 5).join('.'));
    if (!/^[A-Za-z0-9_-]{22}$/.test(parts[5]) || !timingSafeEqual(Buffer.from(parts[5]), Buffer.from(expected))) return null;
    return { assignmentId: parts[1], taskId: parts[2], action: parts[3] };
  }
  async function packet(worker) {
    const tasks = await db.reportTask.findMany({ where: { hotelId: worker.hotelId, kind: 'housekeeping', active: true, assignedWorkerId: worker.id, status: { in: ['Assigned', 'Accepted', 'In Progress'] } }, orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }] });
    const pending = tasks.find(t => t.status === 'Assigned');
    if (pending) {
      const batch = tasks.filter(t => t.assignmentId === pending.assignmentId && t.status === 'Assigned');
      return { text: `Housekeeping — ${pending.reportDate}\nHi ${worker.name}, ${batch.length} task(s) await your acceptance.\n${batch.slice(0, 8).map(t => `Room ${t.data.room}: ${hkLabels[t.data.task] || t.data.task}`).join('\n')}${batch.length > 8 ? '\nMore tasks will follow after acceptance.' : ''}`.slice(0, 1000),
        buttons: [button(worker, pending.assignmentId, 'all', 'accept', 'Accept')] };
    }
    const task = tasks.find(t => t.status === 'In Progress') || tasks[0];
    if (!task) return { text: 'No accepted tasks are waiting. Reply TASKS to refresh your assignments.', buttons: [] };
    return { text: `Room ${task.data.room} — ${hkLabels[task.data.task] || task.data.task}\n${task.data.comment || ''}${task.data.checkoutTime ? `\nExpected checkout: ${task.data.checkoutTime}` : ''}\nStatus: ${task.status}`.slice(0, 1000),
      buttons: [button(worker, task.assignmentId, task.id, task.status === 'In Progress' ? 'done' : 'start', task.status === 'In Progress' ? 'Completed' : 'Start'), button(worker, task.assignmentId, task.id, 'problem', 'Problem')] };
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
      return await db.housekeepingAssignment.update({ where: { id: assignment.id }, data: { deliveryStatus: response.success ? (openWindow ? 'submitted' : 'template_submitted') : response.uncertain ? 'uncertain' : 'failed', messageId: response.messageId || null, lastError: response.success ? null : 'WhatsApp delivery not confirmed. Check the connection and provider before retrying.' } });
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
    const hkSource = source.reports.find(r => r.kind === 'housekeeping');
    if (!hkSource || hkSource.status !== 'complete' || hkSource.stale || hkSource.latestRunFailed) failOperation('A successful current housekeeping snapshot is required before assigning tasks', 409);
    const assignment = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${user.hotelId}`}, 0))`;
      const replay = await tx.housekeepingAssignment.findUnique({ where: { hotelId_requestKey: { hotelId: user.hotelId, requestKey } } });
      if (replay) {
        if (replay.workerId !== workerId || JSON.stringify([...replay.taskIds].sort()) !== JSON.stringify(tasks.map(t => t.id).sort())) failOperation('Request ID was reused with a different assignment', 409);
        return replay;
      }
      if (!await tx.housekeepingWorker.findFirst({ where: { id: worker.id, hotelId: user.hotelId, phone: worker.phone, active: true, whatsappEnabled: true } })) failOperation('Worker changed; refresh first', 409);
      const rows = await tx.reportTask.findMany({ where: { id: { in: tasks.map(t => t.id) }, hotelId: user.hotelId, kind: 'housekeeping', active: true, reportDate: source.today } });
      if (rows.length !== tasks.length || rows.some(t => ['In Progress', 'Completed'].includes(t.status) || tasks.find(item => item.id === t.id).contentHash !== t.contentHash)) failOperation('Tasks changed or are already started/completed. Refresh first.', 409);
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
      const current = snapshot.reports.find(report => report.kind === 'housekeeping');
      const actionId = message.interactive?.button_reply?.id || message.button?.payload;
      const action = parse(worker, actionId);
      if (!current || current.status !== 'complete' || current.stale || current.latestRunFailed) response = { text: 'The current housekeeping plan is unavailable or its latest run failed. Please contact your housekeeping manager before continuing.' };
      else if (actionId && !action) response = { text: 'This action is expired or invalid. Reply TASKS for current assignments.' };
      else if (action) {
        const rows = await db.reportTask.findMany({ where: { hotelId: worker.hotelId, active: true, assignedWorkerId: worker.id, assignmentId: action.assignmentId, ...(action.taskId !== 'all' ? { id: action.taskId } : {}) } });
        if (!rows.length) response = { text: 'This assignment has changed. Reply TASKS for your current work.' };
        else if (action.action === 'problem') {
          const task = rows[0];
          response = { text: `Room ${task.data.room}: choose the problem type. You can then describe it.`, buttons: [button(worker, action.assignmentId, task.id, 'dnd', 'Do not disturb'), button(worker, action.assignmentId, task.id, 'maintenance', 'Maintenance')] };
        } else {
          const target = { accept: 'Accepted', start: 'In Progress', done: 'Completed', dnd: 'Problem', maintenance: 'Problem' }[action.action];
          const from = { accept: ['Assigned'], start: ['Accepted'], done: ['In Progress'], dnd: ['Accepted', 'In Progress'], maintenance: ['Accepted', 'In Progress'] }[action.action];
          let changedCount = 0;
          if (target) await db.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${worker.hotelId}`}, 0))`;
            if (!await tx.housekeepingWorker.findFirst({ where: { id: worker.id, hotelId: worker.hotelId, phone: worker.phone, active: true, whatsappEnabled: true } })) failOperation('Worker changed', 409);
            await assertCurrentSource(tx, worker.hotelId, rows, snapshot.today);
            for (const row of rows) {
              const changes = { status: target, ...(target === 'Accepted' ? { acceptedAt: now() } : target === 'In Progress' ? { startedAt: now() } : target === 'Completed' ? { completedAt: now() } : { problemType: action.action }) };
              const updated = await tx.reportTask.updateMany({ where: { id: row.id, hotelId: worker.hotelId, assignedWorkerId: worker.id, assignmentId: action.assignmentId, active: true, status: { in: from } }, data: changes });
              if (updated.count) {
                changedCount++;
                await tx.reportTaskEvent.create({ data: { hotelId: worker.hotelId, taskId: row.id, actor: worker.id, text: `WhatsApp: ${target}${target === 'Problem' ? ` (${action.action})` : ''}` } });
                if (target === 'Problem') await tx.housekeepingWorker.update({ where: { id: worker.id }, data: { pendingProblemTaskId: row.id } });
              }
            }
            if (target === 'Accepted' && changedCount) await tx.housekeepingAssignment.updateMany({ where: { id: action.assignmentId, hotelId: worker.hotelId, workerId: worker.id }, data: { deliveryStatus: 'accepted', lastError: null } });
          });
          if (target === 'Problem' && changedCount) response = { text: 'Problem recorded for the housekeeping manager. Please reply with a short description, or reply TASKS to continue.' };
        }
      } else if (worker.pendingProblemTaskId && message.text?.body && !/^tasks$/i.test(message.text.body.trim())) {
        await db.$transaction(async tx => {
          await tx.reportTask.updateMany({ where: { id: worker.pendingProblemTaskId, hotelId: worker.hotelId, assignedWorkerId: worker.id, active: true, status: 'Problem' }, data: { problemNote: message.text.body.slice(0, 2000) } });
          await tx.housekeepingWorker.update({ where: { id: worker.id }, data: { pendingProblemTaskId: null } });
        });
      }
      response ||= await packet(worker);
      await db.whatsAppReceipt.update({ where: { id: receiptId }, data: { status: 'sending', replyText: JSON.stringify(response) } });
      const delivered = await send({ hotelId: worker.hotelId, targetType: 'internal', to: worker.phone, ...response });
      await db.whatsAppReceipt.update({ where: { id: receiptId }, data: { status: delivered.success ? 'done' : 'uncertain', providerMessageId: delivered.messageId || null, lastError: delivered.success ? null : 'Reply not confirmed; worker can send TASKS again.' } });
    } catch {
      await db.whatsAppReceipt.update({ where: { id: receiptId }, data: { status: 'uncertain', lastError: 'Operational reply interrupted. Inspect task state; no automatic replay.' } });
    }
    publish(worker.hotelId); return true;
  }
  return { assign, handle, button, parse, packet };
}
