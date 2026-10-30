import { hash, validDate } from '../reports/reportService.js';
import { hotelTime, planData, planToken, invalidateTaskRoomApprovals } from '../reports/housekeepingPlan.js';

export const blockerTypes = { dnd: 'Do not disturb', guest_inside: 'Guest still inside', declined: 'Guest declined service', supplies: 'Missing linen / supplies', parts: 'Waiting for parts', contractor: 'Contractor required', repair_failed: 'Repair unsuccessful' };
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const model = kind => kind === 'report' ? 'reportTask' : kind;
const closed = row => ['Completed', 'Cancelled', 'Duplicate'].includes(row.status);
const roles = ['manager', 'housekeeping', 'maintenance', 'front-office'];
export const blockerLock = (tx, hotelId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${hotelId}`}, 0))`;
export const carryNeedsReview = (row, today) => row.carryForward && row.reportDate < today && row.carryReviewedDate !== today;
export async function hotelDay(db, hotelId) {
  const hotel = await db.hotel.findUnique({ where: { id: hotelId }, select: { timezone: true } });
  const timezone = hotel?.timezone || 'Europe/Amsterdam';
  return { timezone, today: new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()) };
}
export async function blockerWork(db, hotelId, kind, id) {
  if (!['report', 'issue', 'task'].includes(kind) || typeof id !== 'string' || !id) fail('Invalid work reference');
  const row = await db[model(kind)].findFirst({ where: { hotelId, id, ...(kind === 'report' ? { kind: 'housekeeping' } : kind === 'task' ? { department: 'Maintenance' } : {}) } });
  if (!row) fail('Work not found', 404);
  return row;
}
function authorize(user, kind) {
  if (!user?.hotelId || !(kind === 'report' ? ['manager', 'housekeeping', 'front-office'] : ['manager', 'maintenance']).includes(user.role)) fail('Department coordinator access required', 403);
}
export async function assertUnblocked(db, hotelId, kind, ids) {
  if (!ids.length) return;
  const blocker = await db.operationalBlocker.findFirst({ where: { hotelId, workKind: kind, workId: { in: ids }, resolvedAt: null } });
  if (blocker) fail(`${blockerTypes[blocker.type]} is unresolved. Review the blocker and record its resolution before continuing.`, 409);
}
async function record(db, row, actor, action, data) {
  await db.operationalBlockerEvent.create({ data: { hotelId: row.hotelId, blockerId: row.id, actor, action, data: JSON.parse(JSON.stringify(data)) } });
  const text = `${blockerTypes[row.type]}: ${action} (${actor})${data.note ? ` — ${data.note}` : ''}`;
  if (row.workKind === 'report') await db.reportTaskEvent.create({ data: { hotelId: row.hotelId, taskId: row.workId, actor, text } });
  else await db[row.workKind === 'issue' ? 'issueUpdate' : 'taskTrail'].create({ data: { [row.workKind === 'issue' ? 'issueId' : 'taskId']: row.workId, at: new Date().toISOString(), text, via: 'dashboard' } });
}
async function holdWork(tx, row, work) {
  const data = row.workKind === 'report' ? { status: 'Problem', problemType: row.type, carryForward: true, active: true, planVersion: { increment: 1 } }
    : { status: row.type === 'parts' ? row.workKind === 'issue' ? 'Waiting Parts' : 'Waiting' : 'Escalated', version: { increment: 1 } };
  await tx[model(row.workKind)].update({ where: { id: work.id }, data });
  await invalidateTaskRoomApprovals(tx, row.hotelId, [{ data: { room: row.workKind === 'report' ? planData(work).room : work.room } }]);
}
function cleanText(value, label, max = 1000, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`Enter ${label}`);
  return value.trim();
}
export function validateBlocker(input, timezone) {
  if (!Object.hasOwn(blockerTypes, input.type)) fail('Choose a blocker type');
  const description = cleanText(input.description, 'a description', 2000);
  const ownerName = cleanText(input.ownerName, 'the follow-up owner', 120);
  const department = cleanText(input.department, 'the responsible department', 120);
  const nextAction = cleanText(input.nextAction, 'the next action', 1000);
  if (typeof input.followUpLocal !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.followUpLocal) || !validDate(input.followUpLocal.slice(0, 10))) fail('Enter the follow-up date and time in the hotel timezone');
  const followUpAt = hotelTime(input.followUpLocal.slice(0, 10), input.followUpLocal.slice(11), timezone);
  const fields = { dnd: [], guest_inside: [], declined: ['service', 'alternative'], supplies: ['item'], parts: ['part'], contractor: ['contractor'], repair_failed: ['remainingFault'] }[input.type];
  const details = {};
  for (const key of fields) details[key] = cleanText(input.details?.[key], key === 'alternative' ? 'the requested alternative (or “None requested”)' : key, 1000);
  return { type: input.type, description, ownerName, department, nextAction, details, followUpAt, followUpLocal: input.followUpLocal, timezone, needsDetails: false };
}

// Workers may report a blocker before an ETA/owner is known. It remains visible as
// Needs scheduling until a coordinator fills the structured fields; never invent an ETA.
export async function draftBlocker(tx, { hotelId, kind, work, type, actor, requestKey, description = '' }) {
  if (!Object.hasOwn(blockerTypes, type)) fail('Invalid blocker type');
  const existing = await tx.operationalBlocker.findFirst({ where: { hotelId, workKind: kind, workId: work.id, type, resolvedAt: null } });
  if (existing) return existing;
  const { timezone } = await hotelDay(tx, hotelId);
  const row = await tx.operationalBlocker.create({ data: { hotelId, workKind: kind, workId: work.id, type, description,
    department: kind === 'report' ? 'Housekeeping' : 'Maintenance', timezone, requestKey, requestHash: hash([kind, work.id, type, requestKey]), createdBy: actor } });
  await holdWork(tx, row, work);
  await record(tx, row, actor, 'Reported; coordinator must schedule follow-up', { note: description });
  return row;
}
export async function addBlockerNote(tx, hotelId, kind, workId, actor, note) {
  const row = await tx.operationalBlocker.findFirst({ where: { hotelId, workKind: kind, workId, resolvedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!row) return;
  await tx.operationalBlocker.update({ where: { id: row.id }, data: { description: note.slice(0, 2000), version: { increment: 1 } } });
  await record(tx, row, actor, 'Worker added details', { note: note.slice(0, 2000) });
}
export async function workBlockers(db, hotelId, kind, ids) {
  return ids.length ? db.operationalBlocker.findMany({ where: { hotelId, workKind: kind, workId: { in: ids }, resolvedAt: null }, orderBy: [{ followUpAt: 'asc' }, { createdAt: 'asc' }] }) : [];
}

export function createBlockerService({ db, broadcast = () => {}, now = () => new Date() }) {
  const publish = hotelId => { for (const event of ['reports:updated', 'maintenance:updated', 'readiness:updated', 'blockers:updated']) broadcast(hotelId, event, { refresh: true }); };
  async function read(user) {
    if (!user?.hotelId || !roles.includes(user.role)) fail('Operational access required', 403);
    const { today, timezone } = await hotelDay(db, user.hotelId);
    const rows = await db.operationalBlocker.findMany({ where: { hotelId: user.hotelId, ...(user.role === 'housekeeping' ? { workKind: 'report' } : user.role === 'maintenance' ? { workKind: { in: ['issue', 'task'] } } : {}), OR: [{ resolvedAt: null }, { resolvedAt: { gte: new Date(+now() - 7 * 86400000) } }] }, orderBy: [{ resolvedAt: 'asc' }, { followUpAt: 'asc' }, { createdAt: 'desc' }] });
    const history = rows.length ? await db.operationalBlockerEvent.findMany({ where: { hotelId: user.hotelId, blockerId: { in: rows.map(r => r.id) } }, orderBy: { at: 'desc' } }) : [];
    const result = [];
    for (const row of rows) {
      const work = await blockerWork(db, user.hotelId, row.workKind, row.workId);
      result.push({ ...row, title: row.workKind === 'report' ? planData(work).task.replaceAll('_', ' ') : work.title, location: row.workKind === 'report' ? planData(work).room || planData(work).location : work.room,
        workStatus: work.status, carriedFrom: row.workKind === 'report' && work.reportDate < today ? work.reportDate : null,
        history: history.filter(e => e.blockerId === row.id), due: row.resolvedAt ? 'Resolved' : row.needsDetails ? 'Needs scheduling' : +row.followUpAt <= +now() ? 'Due now' : 'Scheduled' });
    }
    return { today, timezone, blockers: result };
  }
  async function save(user, id, input = {}) {
    if (!user?.hotelId || !roles.includes(user.role)) fail('Operational access required', 403);
    const { timezone } = await hotelDay(db, user.hotelId);
    const result = await db.$transaction(async tx => {
      await blockerLock(tx, user.hotelId);
      const old = id ? await tx.operationalBlocker.findFirst({ where: { id, hotelId: user.hotelId } }) : null;
      if (id && !old) fail('Blocker not found', 404);
      const kind = old?.workKind || input.workKind; authorize(user, kind);
      if (old && (old.resolvedAt || old.version !== input.version)) fail('Blocker changed or is resolved; refresh first', 409);
      const workId = old?.workId || input.workId, work = await blockerWork(tx, user.hotelId, kind, workId);
      if (closed(work)) fail('Completed or cancelled work cannot be blocked', 409);
      const values = validateBlocker({ ...input, type: old?.type || input.type }, timezone);
      if (old) {
        const saved = await tx.operationalBlocker.update({ where: { id }, data: { ...values, version: { increment: 1 } } });
        await holdWork(tx, saved, work); await record(tx, saved, user.id, 'Follow-up updated', { before: old, after: values }); return saved;
      }
      if (typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestKey)) fail('Supply a request ID');
      const requestHash = hash(input), previous = await tx.operationalBlocker.findUnique({ where: { hotelId_requestKey: { hotelId: user.hotelId, requestKey: input.requestKey } } });
      if (previous) { if (previous.requestHash !== requestHash) fail('Request ID was reused', 409); return previous; }
      if (await tx.operationalBlocker.findFirst({ where: { hotelId: user.hotelId, workKind: kind, workId, type: values.type, resolvedAt: null } })) fail('This blocker already exists. Update its follow-up instead.', 409);
      if ((kind === 'report' ? planToken(work) !== input.reportContentHash : work.version !== input.workVersion)) fail('Work changed; refresh first', 409);
      const saved = await tx.operationalBlocker.create({ data: { ...values, hotelId: user.hotelId, workKind: kind, workId, requestKey: input.requestKey, requestHash, createdBy: user.id } });
      await holdWork(tx, saved, work); await record(tx, saved, user.id, 'Blocker recorded', { after: values }); return saved;
    }, { timeout: 30000 });
    publish(user.hotelId); return result;
  }
  async function resolve(user, id, input = {}) {
    if (!user?.hotelId || !roles.includes(user.role)) fail('Operational access required', 403);
    const { today } = await hotelDay(db, user.hotelId);
    const note = cleanText(input.note, 'the resolution and next step', 2000);
    const result = await db.$transaction(async tx => {
      await blockerLock(tx, user.hotelId);
      const row = await tx.operationalBlocker.findFirst({ where: { id, hotelId: user.hotelId } });
      if (!row) fail('Blocker not found', 404); authorize(user, row.workKind);
      if (row.resolvedAt || row.version !== input.version) fail('Blocker changed or already resolved', 409);
      if (['dnd', 'guest_inside'].includes(row.type) && row.followUpAt && +row.followUpAt > +now()) fail('The next permitted contact/entry time has not arrived. Update the schedule with confirmed instructions first.', 409);
      const work = await blockerWork(tx, user.hotelId, row.workKind, row.workId);
      const saved = await tx.operationalBlocker.update({ where: { id }, data: { resolvedAt: now(), resolvedBy: user.id, resolutionNote: note, version: { increment: 1 } } });
      const remaining = await tx.operationalBlocker.count({ where: { hotelId: user.hotelId, workKind: row.workKind, workId: row.workId, resolvedAt: null } });
      if (!remaining && !closed(work)) {
        const status = work.assignedWorkerId ? work.acceptedAt ? 'Accepted' : 'Assigned' : row.workKind === 'report' || row.workKind === 'task' ? 'New' : 'Open';
        await tx[model(row.workKind)].update({ where: { id: work.id }, data: { status, problemNote: null, ...(row.workKind === 'report' ? { problemType: null, planVersion: { increment: 1 }, carryForward: true, carryReviewedDate: today, active: true } : { version: { increment: 1 } }) } });
      }
      await record(tx, saved, user.id, 'Resolved; work still requires completion', { note });
      await invalidateTaskRoomApprovals(tx, user.hotelId, [{ data: { room: row.workKind === 'report' ? planData(work).room : work.room } }]);
      return saved;
    });
    publish(user.hotelId); return result;
  }
  async function reviewCarry(user, id, input = {}) {
    authorize(user, 'report'); const { today } = await hotelDay(db, user.hotelId); const note = cleanText(input.note, 'confirmation that the work is still appropriate for this room/guest', 2000);
    await db.$transaction(async tx => {
      await blockerLock(tx, user.hotelId);
      const row = await blockerWork(tx, user.hotelId, 'report', id);
      if (!row.carryForward || closed(row) || planToken(row) !== input.reportContentHash) fail('Carried work changed; refresh first', 409);
      await tx.reportTask.update({ where: { id }, data: { active: true, carryReviewedDate: today, planVersion: { increment: 1 } } });
      await tx.reportTaskEvent.create({ data: { hotelId: user.hotelId, taskId: id, actor: user.id, text: `Carried work reviewed for ${today}: ${note}` } });
    });
    publish(user.hotelId); return { reviewed: true };
  }
  return { read, save, resolve, reviewCarry };
}
