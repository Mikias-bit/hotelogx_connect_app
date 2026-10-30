import { randomUUID } from 'node:crypto';
import { hash } from './reportService.js';
import { syncOperations, failOperation } from './reportOperations.js';
import { hotelTime, planData, planToken, planLocation } from './housekeepingPlan.js';

export const changeRoles = ['manager', 'housekeeping', 'front-office'];
export const changeTypes = ['departure_clean_required', 'stayover_clean', 'linen_change', 'towels', 'late_checkout', 'room_move', 'urgent_clean', 'delivery', 'public_area', 'baby_bed_requested', 'make_sofa_bed', 'other'];
export async function saveHousekeepingChange(db, user, id, input) {
  if (!changeRoles.includes(user.role)) failOperation('Housekeeping plan access required', 403);
  if (!input || !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestKey || '') || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000) failOperation('Provide a change reason and request ID');
  const requestHash = hash([id || null, input]);
  const snapshot = await syncOperations(db, user);
  const hotel = await db.hotel.findUnique({ where: { id: user.hotelId }, select: { timezone: true } });
  const timezone = hotel?.timezone || 'Europe/Amsterdam';
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${user.hotelId}`}, 0))`;
    const previous = await tx.housekeepingPlanChange.findUnique({ where: { hotelId_requestKey: { hotelId: user.hotelId, requestKey: input.requestKey } } });
    if (previous) { if (previous.requestHash !== requestHash) failOperation('Request ID already used for a different change', 409); return previous; }
    const old = id ? await tx.reportTask.findFirst({ where: { id, hotelId: user.hotelId, kind: 'housekeeping', active: true, reportDate: snapshot.today } }) : null;
    if (id && !old) failOperation('Current housekeeping task not found', 404);
    if (old && planToken(old) !== input.reportContentHash) failOperation('Task changed; refresh and review the current instructions', 409);
    if (old?.status === 'Completed') failOperation('Completed work is retained. Add a new follow-up task instead.', 409);
    if (input.cancel !== undefined && typeof input.cancel !== 'boolean') failOperation('Invalid cancellation');
    if (input.cancel && !old) failOperation('Only an existing task can be cancelled');
    if (old?.sourceReviewRequired && !input.cancel && !['keep', 'adopt'].includes(input.sourceDecision)) failOperation('Review the changed morning plan before saving', 409);
    if (input.sourceDecision === 'adopt' && (!old?.sourcePresent || !old?.pendingSourceData)) failOperation('No replacement source instructions are available');
    const oldData = old ? planData(old) : {};
    const base = input.sourceDecision === 'adopt' ? old.pendingSourceData : oldData;
    const values = input.values || {};
    const allowed = ['room', 'location', 'task', 'comment', 'priority', 'notBeforeTime', 'dueTime'];
    if (Object.keys(values).some(k => !allowed.includes(k))) failOperation('Unsupported housekeeping change');
    const data = { ...base };
    for (const key of allowed) if (Object.hasOwn(values, key)) {
      if (typeof values[key] !== 'string' || values[key].length > (key === 'comment' ? 2000 : 120)) failOperation('Invalid plan instructions');
      data[key] = values[key].trim();
    }
    if (old && (data.task !== oldData.task || data.room !== oldData.room)) {
      data.checkoutTime = ''; data.oldRoom = ''; data.newRoom = '';
    }
    // Existing engine task types can be retained, but new staff types must be known.
    if (typeof data.task !== 'string' || !data.task || (!changeTypes.includes(data.task) && data.task !== oldData.task)) failOperation('Choose a housekeeping task type');
    if ((!data.room && !data.location) || (data.room && data.location)) failOperation('Specify either a room or a public location');
    if (!['Normal', 'High', 'Urgent'].includes(data.priority || 'Normal')) failOperation('Choose a valid priority');
    const notBefore = hotelTime(snapshot.today, data.notBeforeTime, timezone), dueAt = hotelTime(snapshot.today, data.dueTime, timezone);
    if (notBefore && dueAt && +dueAt < +notBefore) failOperation('The deadline cannot be before the access time');
    const taskId = old?.id || `rt-${randomUUID()}`;
    const planVersion = (old?.planVersion || 0) + 1;
    if (old) {
      // This overlay is staff-owned; later engine snapshots cannot overwrite it.
      const updated = await tx.reportTask.updateMany({ where: { id: old.id, hotelId: user.hotelId, updatedAt: old.updatedAt, planVersion: old.planVersion },
        data: { overrides: data, notBefore, dueAt, sourceReviewRequired: false, planVersion, ...(input.cancel ? { active: false, status: 'Cancelled' } : {}) } });
      if (!updated.count) failOperation('Task changed; refresh before saving', 409);
    } else {
      await tx.reportTask.create({ data: { id: taskId, hotelId: user.hotelId, kind: 'housekeeping', reportDate: snapshot.today, itemKey: taskId, origin: 'staff', data, contentHash: hash(data), sourceGeneratedAt: new Date(), planVersion, notBefore, dueAt } });
    }
    const worker = old?.assignedWorkerId ? await tx.housekeepingWorker.findFirst({ where: { id: old.assignedWorkerId, hotelId: user.hotelId } }) : null;
    if (worker?.pendingProblemTaskId === taskId) await tx.housekeepingWorker.update({ where: { id: worker.id }, data: { pendingProblemTaskId: null } });
    const details = { reason: input.reason.trim(), before: oldData, after: data, timezone, cancelled: input.cancel === true, sourceDecision: input.sourceDecision || null };
    const change = await tx.housekeepingPlanChange.create({ data: { hotelId: user.hotelId, taskId, requestKey: input.requestKey, requestHash, planVersion,
      workerId: worker?.id, workerPhone: worker?.phone, assignmentId: old?.assignmentId, details, createdBy: user.id, deliveryStatus: worker ? 'pending' : 'not_assigned' } });
    const description = `${planLocation({ data })}: ${data.task}; priority ${data.priority || 'Normal'}${data.notBeforeTime ? `; do not enter before ${data.notBeforeTime}` : ''}${data.dueTime ? `; due ${data.dueTime}` : ''}${data.comment ? `; ${data.comment}` : ''}`;
    await tx.reportTaskEvent.create({ data: { hotelId: user.hotelId, taskId, actor: user.id, text: `${input.cancel ? 'Task cancelled' : old ? 'Plan changed' : 'Additional task created'} by ${user.role} (${user.id}): ${input.reason.trim()}\n${description}` } });
    return change;
  });
}

export async function notifyHousekeepingChange({ db, send, now }, change) {
  if (change.deliveryStatus !== 'pending') return change;
  const finish = data => db.housekeepingPlanChange.update({ where: { id: change.id }, data });
  const task = await db.reportTask.findFirst({ where: { id: change.taskId, hotelId: change.hotelId } });
  const worker = await db.housekeepingWorker.findFirst({ where: { id: change.workerId, hotelId: change.hotelId, phone: change.workerPhone, active: true, whatsappEnabled: true } });
  if (!worker || !task || task.assignedWorkerId !== worker.id || task.assignmentId !== change.assignmentId || task.planVersion !== change.planVersion || task.status === 'Completed') return finish({ deliveryStatus: 'superseded', lastError: 'Worker or instructions changed; use the current assignment.' });
  const open = worker.lastInboundAt && +worker.lastInboundAt > +now() - 23.5 * 3600000;
  const config = await db.housekeepingConfig.findUnique({ where: { hotelId: change.hotelId } });
  if (!open && !config?.changeTemplateName) return finish({ deliveryStatus: 'waiting_window', lastError: 'Ask the worker to send TASKS, or configure the approved plan-change template.' });
  const claim = await db.housekeepingPlanChange.updateMany({ where: { id: change.id, deliveryStatus: 'pending' }, data: { deliveryStatus: 'sending' } });
  if (!claim.count) return db.housekeepingPlanChange.findUnique({ where: { id: change.id } });
  const d = planData(task);
  const payload = open ? { text: `${change.details.cancelled ? 'Task cancelled — do not carry out this task' : 'Housekeeping instructions changed'} — ${planLocation(task)}\n${d.task.replaceAll('_', ' ')}\nPriority: ${d.priority || 'Normal'}${d.notBeforeTime ? `\nDo not enter before ${d.notBeforeTime} (${change.details.timezone})` : ''}${d.dueTime ? `\nNeeded by ${d.dueTime}` : ''}\n${d.comment || ''}\nReason: ${change.details.reason}\nReply TASKS for current instructions and buttons. Previous buttons no longer apply.`.slice(0, 4000) }
    : { template: { name: config.changeTemplateName, language: { code: config.templateLanguage }, components: [{ type: 'body', parameters: [{ type: 'text', text: worker.name }, { type: 'text', text: planLocation(task) }] }] } };
  try {
    const result = await send({ hotelId: change.hotelId, targetType: 'internal', to: worker.phone, ...payload });
    return finish({ deliveryStatus: result.success ? open ? 'submitted' : 'template_submitted' : result.uncertain ? 'uncertain' : 'failed', messageId: result.messageId || null, lastError: result.success ? null : 'Change saved; WhatsApp delivery was not confirmed. Contact the worker.' });
  } catch { return finish({ deliveryStatus: 'uncertain', lastError: 'Change saved; notification outcome unknown. No automatic resend.' }); }
}
