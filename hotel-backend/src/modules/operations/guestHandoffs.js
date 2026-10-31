import { randomUUID } from 'node:crypto';
import { planData, invalidateTaskRoomApprovals } from '../reports/housekeepingPlan.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const model = kind => kind === 'report' ? 'reportTask' : kind;
export const handoffLock = (tx, hotelId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${hotelId}`}, 0))`;
const readRoles = ['manager', 'front-office', 'housekeeping', 'maintenance'];
function authorize(user, write = false) {
  if (!user?.hotelId || !(write ? ['manager', 'front-office'] : readRoles).includes(user.role)) fail('Front Office or manager access required', 403);
}
const reset = { workCompletedAt: null, workCompletedBy: null, foInformedAt: null, foInformedBy: null, contactStatus: 'pending', contactedAt: null, contactedBy: null, contactChannel: null, contactNote: null, resolvedAt: null, resolvedBy: null, resolutionNote: null };
export const isGuestDepartmentTask = row => ['Maintenance', 'Housekeeping'].includes(row.department) && !!row.conversationId;
export async function createGuestTask(db, args, actor = 'ai', options = {}) {
  const create = async tx => {
    await handoffLock(tx, args.data.hotelId);
    if (args.data.conversationId) await conversationFor(tx, args.data.hotelId, args.data.conversationId);
    const task = await tx.task.create(args);
    await ensureGuestHandoff(tx, 'task', task, actor, options);
    return task;
  };
  return db.$transaction ? db.$transaction(create, { timeout: 30000 }) : create(db);
}
async function loadWork(db, hotelId, kind, id) {
  if (!['task', 'issue', 'report'].includes(kind) || typeof id !== 'string') fail('Invalid work reference');
  const work = await db[model(kind)].findFirst({ where: { id, hotelId, ...(kind === 'report' ? { kind: 'housekeeping' } : {}) } });
  if (!work) fail('Work not found', 404);
  return work;
}
async function conversationFor(db, hotelId, id) {
  if (!id) return null;
  const conversation = await db.conversation.findFirst({ where: { id, guest: { hotelId } } });
  if (!conversation) fail('Conversation not found in this hotel', 404);
  return conversation;
}
async function event(db, row, actor, action, note, data = {}) {
  const at = new Date();
  await db.guestHandoffEvent.create({ data: { hotelId: row.hotelId, handoffId: row.id, cycle: row.cycle, actor, action, note, data: JSON.parse(JSON.stringify(data)), at } });
  const text = `Guest follow-up: ${action} (${actor}) - ${note}`;
  if (row.workKind === 'report') await db.reportTaskEvent.create({ data: { hotelId: row.hotelId, taskId: row.workId, actor, text } });
  else await db[row.workKind === 'issue' ? 'issueUpdate' : 'taskTrail'].create({ data: { [row.workKind === 'issue' ? 'issueId' : 'taskId']: row.workId, at: at.toISOString(), text, via: 'dashboard' } });
  if (row.conversationId && await conversationFor(db, row.hotelId, row.conversationId)) await db.message.create({ data: { id: `m-${randomUUID()}`, conversationId: row.conversationId, author: 'system', channel: 'internal', body: text, at: at.toISOString() } });
}
async function escalate(db, row, reason) {
  if (!row.conversationId) return;
  const conv = await conversationFor(db, row.hotelId, row.conversationId);
  let existing; try { existing = JSON.parse(conv.escalation || 'null'); } catch {}
  await db.conversation.update({ where: { id: conv.id }, data: { aiStatus: 'escalated', escalation: JSON.stringify(existing?.kind && existing.kind !== 'guest_follow_up' ? existing : { kind: 'guest_follow_up', reason, urgency: 'High', raisedAt: new Date().toISOString(), suggested: 'Review department work, contact the guest as appropriate, and record resolution or reopen.' }) } });
}

// Call in the task-creation transaction. Explicit marking also supports phone/in-person reports.
export async function ensureGuestHandoff(db, kind, work, actor, { force = false, conversationId } = {}) {
  const key = { hotelId: work.hotelId, workKind: kind, workId: work.id };
  const existing = await db.guestHandoff.findUnique({ where: { hotelId_workKind_workId: key } });
  if (existing) return existing;
  if (!force && !(kind === 'task' && isGuestDepartmentTask(work))) return null;
  const linkedId = conversationId || work.conversationId || null;
  await conversationFor(db, work.hotelId, linkedId);
  const row = await db.guestHandoff.upsert({ where: { hotelId_workKind_workId: key }, update: {}, create: { ...key, conversationId: linkedId, ...(work.status === 'Completed' ? { state: 'handoff', workCompletedAt: work.completedAt, workCompletedBy: actor } : {}) } });
  await event(db, row, actor, 'Guest follow-up opened', work.status === 'Completed' ? 'Department work is completed; guest outcome still needs review.' : 'Guest-reported work requires a separate Front Office follow-up.');
  if (work.status === 'Completed') await escalate(db, row, 'Department work completed; Front Office guest follow-up pending');
  return row;
}

// Called under the shared hotel lock, in the same transaction as department status.
export async function guestWorkStatusChanged(db, kind, before, status, actor) {
  if (before.status === status || (status !== 'Completed' && before.status !== 'Completed')) return;
  const row = await ensureGuestHandoff(db, kind, before, actor);
  if (!row) return;
  if (status === 'Completed') {
    const saved = await db.guestHandoff.update({ where: { id: row.id }, data: { workCompletedAt: new Date(), workCompletedBy: actor, state: 'handoff', resolvedAt: null, resolvedBy: null, resolutionNote: null, version: { increment: 1 } } });
    await event(db, saved, actor, 'Department work completed', 'Front Office must acknowledge the handoff and verify the guest outcome.');
    await escalate(db, saved, 'Department work completed; Front Office guest follow-up pending');
  } else if (before.status === 'Completed') {
    const saved = await db.guestHandoff.update({ where: { id: row.id }, data: { ...reset, state: 'reopened', cycle: { increment: 1 }, version: { increment: 1 } } });
    await event(db, saved, actor, 'Department reopened work', 'Previous completion and contact history retained.', { previous: row });
    await escalate(db, saved, 'Department reopened guest work; follow-up required');
  }
}

export async function assertGuestHandoffsResolved(db, hotelId, conversationId) {
  if (await db.guestHandoff.findFirst({ where: { hotelId, conversationId, state: { not: 'resolved' } } })) fail('Resolve the guest follow-ups before closing this conversation.', 409);
}
export async function guestReplyNeedsReview(db, hotelId, conversationId, message) {
  const open = await db.guestHandoff.findFirst({ where: { hotelId, conversationId, state: { in: ['handoff', 'reopened'] } } });
  if (open) return true;
  // Only route explicit recurrence language to a person. Never infer guest
  // confirmation from a thank-you, or choose which of several repairs to reopen.
  if (!/\b(still (?:not|broken|leaking|noisy|cold|hot|doesn.t|isn.t)|not (?:fixed|resolved)|same (?:problem|issue)|problem (?:continues|is back)|(?:broken|leaking) again)\b/i.test(message)) return false;
  return !!await db.guestHandoff.findFirst({ where: { hotelId, conversationId, state: 'resolved' } });
}

export function createGuestHandoffService({ db, broadcast = () => {} }) {
  const publish = hotelId => { for (const name of ['handoffs:updated', 'maintenance:updated', 'reports:updated', 'readiness:updated']) broadcast(hotelId, name, { refresh: true }); };
  async function read(user) {
    authorize(user);
    const rows = await db.guestHandoff.findMany({ where: { hotelId: user.hotelId }, orderBy: { updatedAt: 'desc' } });
    const history = rows.length ? await db.guestHandoffEvent.findMany({ where: { hotelId: user.hotelId, handoffId: { in: rows.map(r => r.id) } }, orderBy: { at: 'desc' } }) : [];
    const result = [];
    for (const row of rows) {
      const work = await loadWork(db, user.hotelId, row.workKind, row.workId);
      const department = row.workKind === 'issue' ? 'Maintenance' : row.workKind === 'report' ? 'Housekeeping' : work.department;
      if (['housekeeping', 'maintenance'].includes(user.role) && department.toLowerCase() !== user.role) continue;
      result.push({ ...row, department, workStatus: work.status, title: row.workKind === 'report' ? planData(work).task.replaceAll('_', ' ') : work.title, room: row.workKind === 'report' ? planData(work).room || planData(work).location : work.room,
        awaitingFrontOffice: row.state !== 'resolved' && (work.status === 'Completed' || row.state === 'reopened'), history: history.filter(e => e.handoffId === row.id) });
    }
    return result;
  }
  async function enable(user, input = {}) {
    authorize(user, true);
    const result = await db.$transaction(async tx => {
      await handoffLock(tx, user.hotelId);
      const work = await loadWork(tx, user.hotelId, input.workKind, input.workId);
      if (['Cancelled', 'Duplicate'].includes(work.status)) fail('This work is closed', 409);
      return ensureGuestHandoff(tx, input.workKind, work, user.id, { force: true, conversationId: input.conversationId });
    }, { timeout: 30000 });
    publish(user.hotelId); return result;
  }
  async function act(user, id, input = {}) {
    authorize(user, true);
    const { action, note, version, channel } = input;
    if (!['inform', 'contact', 'not_required', 'unreachable', 'resolve', 'reopen'].includes(action) || typeof note !== 'string' || !note.trim() || note.length > 2000) fail('Choose an action and record what happened');
    if (['contact', 'unreachable'].includes(action) && !['phone', 'in_person', 'whatsapp', 'email'].includes(channel)) fail('Choose the contact channel');
    const result = await db.$transaction(async tx => {
      await handoffLock(tx, user.hotelId);
      const row = await tx.guestHandoff.findFirst({ where: { id, hotelId: user.hotelId } });
      if (!row) fail('Guest follow-up not found', 404);
      if (row.version !== version) fail('Guest follow-up changed. Refresh before continuing.', 409);
      if (row.state === 'resolved' && action !== 'reopen') fail('Guest issue is already resolved', 409);
      const work = await loadWork(tx, user.hotelId, row.workKind, row.workId), now = new Date();
      let data;
      if (action === 'inform') {
        if (work.status !== 'Completed') fail('Department work must be completed before acknowledging the handoff', 409);
        if (row.foInformedAt) fail('Front Office already acknowledged this work cycle', 409);
        data = { foInformedAt: now, foInformedBy: user.id };
      } else if (['contact', 'unreachable', 'not_required'].includes(action)) {
        if (!row.foInformedAt) fail('Acknowledge the Front Office handoff first', 409);
        data = { contactStatus: action === 'contact' ? 'contacted' : action, contactedAt: now, contactedBy: user.id, contactChannel: action === 'not_required' ? null : channel, contactNote: note.trim() };
      } else if (action === 'resolve') {
        if (work.status !== 'Completed' || !row.foInformedAt || !['contacted', 'not_required'].includes(row.contactStatus)) fail('Department completion, Front Office acknowledgment and guest contact or a justified exception are required', 409);
        if (await tx.operationalBlocker.findFirst({ where: { hotelId: user.hotelId, workKind: row.workKind, workId: row.workId, resolvedAt: null } })) fail('Resolve the operational blocker first', 409);
        data = { state: 'resolved', resolvedAt: now, resolvedBy: user.id, resolutionNote: note.trim() };
      } else {
        if (work.status !== 'Completed' && row.state !== 'resolved') fail('Work is already open with the department', 409);
        // Return the same work to its department without silently reassigning an off-shift worker.
        const changes = { status: row.workKind === 'issue' ? 'Open' : 'New', assignedWorkerId: null, assignmentId: null, assignedAt: null, acceptedAt: null, startedAt: null, completedAt: null,
          ...(row.workKind === 'report' ? { active: true, carryForward: true, carryReviewedDate: null, planVersion: { increment: 1 } } : { assignee: null, version: { increment: 1 } }),
          ...(row.workKind === 'issue' ? { repairCycle: { increment: 1 }, followUpTaskId: null } : {}) };
        await tx[model(row.workKind)].update({ where: { id: work.id }, data: changes });
        await invalidateTaskRoomApprovals(tx, user.hotelId, [{ data: { room: row.workKind === 'report' ? planData(work).room : work.room } }]);
        data = { ...reset, state: 'reopened', cycle: { increment: 1 } };
      }
      const saved = await tx.guestHandoff.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await event(tx, saved, user.id, { inform: 'Front Office informed', contact: 'Guest contacted', unreachable: 'Guest contact attempted; no response', not_required: 'Guest contact not required', resolve: 'Guest issue resolved', reopen: 'Guest issue reopened; returned to department' }[action], note.trim(), action === 'reopen' ? { previous: row, previousWork: work } : { channel });
      if (action === 'reopen') await escalate(tx, saved, 'Guest reports the problem continues; department work reopened');
      return saved;
    }, { timeout: 30000 });
    publish(user.hotelId); return result;
  }
  return { read, enable, act };
}
