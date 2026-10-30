import { assertUnblocked, carryNeedsReview, workBlockers } from '../operations/blockers.js';
import { assertNoOpenRepairs } from './housekeepingRepairs.js';
import { readReports, allowedKinds, hash } from './reportService.js';
import { planData, planToken, planPriority, reconcileHousekeeping } from './housekeepingPlan.js';
export const hkLabels = { post_repair_clean: 'Post-repair cleaning / check', departure_clean_required: 'Departure clean', linen_change: 'Linen change', stayover_clean: 'Stayover clean', stayover_no_cleaning: 'No cleaning required', baby_bed_requested: 'Prepare baby bed', make_sofa_bed: 'Prepare sofa bed', late_checkout: 'Late checkout preparation', extension: 'Stay extension preparation', extension_with_room_change: 'Extension with room move', room_move: 'Room move', towels: 'Replace towels' };
export const failOperation = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const executionId = (hotelId, kind, date, key) => `rt-${hash([hotelId, kind, date, key])}`;
export async function assertCurrentSource(tx, hotelId, rows, today) {
  if (rows.some(r => (r.reportDate !== today && !r.carryForward) || carryNeedsReview(r, today) || r.sourceReviewRequired)) failOperation('The plan needs staff review or belongs to another day. Refresh before continuing.', 409);
  await assertNoOpenRepairs(tx, hotelId, rows);
  await assertUnblocked(tx, hotelId, 'report', rows.filter(r => r.kind === 'housekeeping').map(r => r.id));
  rows = rows.filter(r => r.origin !== 'staff' && !(r.carryForward && r.reportDate < today && r.carryReviewedDate === today));
  for (const kind of new Set(rows.map(row => row.kind))) {
    const latest = await tx.dailyReport.findFirst({ where: { hotelId, kind, reportDate: { lte: today } }, orderBy: [{ reportDate: 'desc' }, { generatedAt: 'desc' }, { receivedAt: 'desc' }] });
    if (!latest || latest.status !== 'complete' || latest.reportDate !== today || rows.filter(row => row.kind === kind).some(row => row.reportDate !== today || (row.sourcePresent !== false ? !latest.rows.some(item => item.itemKey === row.itemKey && item.contentHash === row.contentHash) : latest.rows.some(item => item.itemKey === row.itemKey)))) failOperation('The source changed or is not current. Refresh before continuing.', 409);
  }
}
const actionable = (kind, row) => kind !== 'housekeeping' || row.task !== 'stayover_no_cleaning';

// Source rows decide what exists. Execution state is separate and survives identical reruns.
export async function syncOperations(db, user) {
  const snapshot = await readReports(db, user);
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${user.hotelId}`}, 0))`;
    for (const report of snapshot.reports) {
      if (report.status !== 'complete') continue;
      const current = await tx.dailyReport.findFirst({ where: { hotelId: user.hotelId, kind: report.kind, status: 'complete', reportDate: { lte: snapshot.today } }, orderBy: [{ reportDate: 'desc' }, { generatedAt: 'desc' }, { receivedAt: 'desc' }] });
      if (current?.id !== report.id) continue; // A newer ingest won while this view was being prepared.
      const existing = await tx.reportTask.findMany({ where: { hotelId: user.hotelId, kind: report.kind, reportDate: report.reportDate } });
      if (report.kind === 'housekeeping') { await reconcileHousekeeping(tx, report, existing, user.hotelId); continue; }
      const byId = new Map(existing.map(row => [row.id, row]));
      const ids = [], creates = [];
      for (const row of report.rows.filter(row => actionable(report.kind, row))) {
        const id = executionId(user.hotelId, report.kind, report.reportDate, row.itemKey); ids.push(id);
        const old = byId.get(id);
        const { review, ...data } = row;
        const source = { hotelId: user.hotelId, kind: report.kind, reportDate: report.reportDate, itemKey: row.itemKey, contentHash: row.contentHash, data, sourceGeneratedAt: new Date(report.generatedAt), active: true };
        if (!old) {
          creates.push({ id, ...source, status: review?.status === 'done' ? 'Completed' : review?.status === 'in-progress' ? 'In Progress' : 'New' });
        } else if (old.contentHash !== row.contentHash || !old.active) {
          await tx.reportTask.update({ where: { id }, data: { ...source, status: 'New', assignmentId: null, assignedWorkerId: null, assignedAt: null, acceptedAt: null, startedAt: null, completedAt: null, problemType: null, problemNote: null } });
          await tx.reportTaskEvent.create({ data: { hotelId: user.hotelId, taskId: id, actor: 'report-engine', text: 'Source changed; task reopened for review and assignment.' } });
        }
      }
      if (creates.length) await tx.reportTask.createMany({ data: creates });
      await tx.reportTask.updateMany({ where: { hotelId: user.hotelId, kind: report.kind, active: true, id: { notIn: ids } }, data: { active: false } });
    }
  }, { timeout: 60000 });
  return snapshot;
}

export function taskView(row, worker, today) {
  const d = planData(row);
  const kind = row.kind;
  const title = kind === 'housekeeping' ? hkLabels[d.task] || d.task.replaceAll('_', ' ')
    : kind === 'vip' ? `Prepare VIP welcome${d.guest ? ` — ${d.guest}` : ''}`
      : `${d.reason === 'unpaid balance' ? 'Review open balance' : d.reason === 'overpayment' ? 'Review credit balance' : 'Review reported overcharge'} — ${d.amount} ${d.currency}`;
  const detail = kind === 'housekeeping' ? [d.comment, d.notBeforeTime && `Do not enter before ${d.notBeforeTime} (hotel time)`, d.dueTime && `Needed by ${d.dueTime} (hotel time)`, d.oldRoom && `Room move: ${d.oldRoom} → ${d.newRoom}`, d.checkoutTime && `Expected checkout: ${d.checkoutTime}`].filter(Boolean).join('\n')
    : kind === 'vip' ? [d.type.replaceAll('_', ' '), d.benefits, d.confirmation && `Reservation ${d.confirmation}`].filter(Boolean).join('\n')
      : [d.guest, d.confirmation && `Reservation ${d.confirmation}`, d.amountFor, 'Staff review only; no payment, refund or correction has been made.'].filter(Boolean).join('\n');
  return { id: row.id, title, detail, room: d.room || undefined, location: d.location || undefined, guest: kind !== 'housekeeping' ? d.guest : undefined,
    department: kind === 'housekeeping' ? 'Housekeeping' : kind === 'vip' ? 'VIP' : 'Billing',
    priority: kind === 'housekeeping' ? planPriority(row) : 'High',
    status: row.status === 'Accepted' ? 'Assigned' : row.status === 'Problem' ? 'Escalated' : row.status,
    executionStatus: row.status, assignee: worker?.name || undefined, assignedWorkerId: row.assignedWorkerId,
    createdAt: row.reportDate, source: row.origin === 'staff' ? 'Operational change' : 'Daily report', reportDate: row.reportDate, reportContentHash: planToken(row),
    sourceIssueId: d.sourceIssueId, planVersion: row.planVersion, planData: d, sourceReviewRequired: row.sourceReviewRequired, sourcePresent: row.sourcePresent, pendingSourceData: row.pendingSourceData, notBefore: row.notBefore, dueAt: row.dueAt,
    carryForward: row.carryForward, carriedFrom: row.carryForward && row.reportDate < today ? row.reportDate : null, carryReviewRequired: carryNeedsReview(row, today),
    stale: row.reportDate !== today && !row.carryForward, trail: [], assignedAt: row.assignedAt, acceptedAt: row.acceptedAt,
    startedAt: row.startedAt, completedAt: row.completedAt, problemType: row.problemType, problemNote: row.problemNote };
}

export async function readOperations(db, user) {
  const snapshot = await syncOperations(db, user);
  const rows = await db.reportTask.findMany({ where: { hotelId: user.hotelId, active: true, kind: { in: allowedKinds(user.role) }, OR: [{ origin: 'report' }, { origin: 'staff', reportDate: snapshot.today }, { carryForward: true, status: { notIn: ['Completed', 'Cancelled'] } }] }, orderBy: [{ reportDate: 'desc' }, { id: 'asc' }] });
  const workers = ['manager', 'housekeeping', 'front-office'].includes(user.role) ? await db.housekeepingWorker.findMany({ where: { hotelId: user.hotelId }, orderBy: { name: 'asc' } }) : [];
  const tasks = rows.map(row => taskView(row, workers.find(w => w.id === row.assignedWorkerId), snapshot.today));
  const events = rows.length ? await db.reportTaskEvent.findMany({ where: { hotelId: user.hotelId, taskId: { in: rows.map(row => row.id) } }, orderBy: { at: 'asc' } }) : [];
  const trails = new Map();
  for (const event of events) { if (!trails.has(event.taskId)) trails.set(event.taskId, []); trails.get(event.taskId).push({ at: event.at.toISOString(), text: event.text, via: event.text.startsWith('WhatsApp:') ? 'whatsapp' : 'dashboard' }); }
  for (const task of tasks) task.trail = trails.get(task.id) || [];
  const notices = rows.length ? await db.housekeepingPlanChange.findMany({ where: { hotelId: user.hotelId, taskId: { in: rows.map(r => r.id) } }, orderBy: { createdAt: 'desc' } }) : [];
  for (const task of tasks) { const notice = notices.find(n => n.taskId === task.id); if (notice) task.planNotification = { status: notice.deliveryStatus, error: notice.lastError }; }
  const links = rows.length ? await db.housekeepingMaintenanceLink.findMany({ where: { hotelId: user.hotelId, reportTaskId: { in: rows.map(r => r.id) }, active: true } }) : [];
  const issues = links.length ? await db.issue.findMany({ where: { hotelId: user.hotelId, id: { in: links.map(l => l.issueId) } }, select: { id: true, title: true, status: true, followUpTaskId: true } }) : [];
  for (const task of tasks) task.linkedRepairs = links.filter(l => l.reportTaskId === task.id).map(l => issues.find(i => i.id === l.issueId)).filter(Boolean);
  const blockers = await workBlockers(db, user.hotelId, 'report', rows.map(r => r.id));
  for (const task of tasks) task.blockers = blockers.filter(b => b.workId === task.id);
  const housekeeping = tasks.filter(t => t.department === 'Housekeeping');
  const completed = housekeeping.filter(t => t.executionStatus === 'Completed');
  const durations = completed.filter(t => t.startedAt && t.completedAt).map(t => (+new Date(t.completedAt) - +new Date(t.startedAt)) / 60000).filter(n => n >= 0);
  const roomNumbers = [...new Set(housekeeping.map(t => t.room).filter(Boolean))];
  const housekeepingSource = snapshot.reports.find(r => r.kind === 'housekeeping');
  const hotel = await db.hotel.findUnique({ where: { id: user.hotelId }, select: { timezone: true } });
  return { today: snapshot.today, timezone: hotel?.timezone || 'Europe/Amsterdam', sources: snapshot.reports.map(({ rows, ...metadata }) => metadata), tasks, workers: ['manager', 'housekeeping'].includes(user.role) ? workers : [],
    vips: snapshot.reports.find(r => r.kind === 'vip')?.rows.map(row => ({ ...row, taskId: executionId(user.hotelId, 'vip', snapshot.reports.find(r => r.kind === 'vip').reportDate, row.itemKey) })) || [],
    housekeeping: { tasks: housekeeping, noCleaningRooms: housekeepingSource?.rows.filter(r => r.task === 'stayover_no_cleaning').map(r => r.room) || [],
      roomCount: roomNumbers.length, completed: completed.length, inProgress: housekeeping.filter(t => t.executionStatus === 'In Progress').length,
      unassigned: housekeeping.filter(t => !t.assignedWorkerId && t.executionStatus !== 'Completed').length,
      unaccepted: housekeeping.filter(t => t.executionStatus === 'Assigned').length, problems: housekeeping.filter(t => t.executionStatus === 'Problem').length,
      averageMinutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      completedRooms: housekeepingSource?.stale || housekeepingSource?.latestRunFailed ? [] : roomNumbers.filter(room => housekeeping.filter(t => t.room === room).every(t => t.executionStatus === 'Completed')) },
    briefing: snapshot.reports.map(report => report.status !== 'complete' ? `${report.kind.replaceAll('_', ' ')}: awaiting a successful engine run.`
      : `${report.kind.replaceAll('_', ' ')} (${report.reportDate}): ${report.rows.length} source entries${report.stale ? '; previous snapshot, not today' : ''}${report.latestRunFailed ? '; latest run failed' : ''}.`) };
}

export async function updateReportTask(db, user, id, input) {
  const snapshot = await syncOperations(db, user);
  const row = await db.reportTask.findFirst({ where: { id, hotelId: user.hotelId, active: true, kind: { in: allowedKinds(user.role) } } });
  if (!row) failOperation('Task not found', 404);
  if (planToken(row) !== input.reportContentHash) failOperation('Source changed; refresh before updating this task', 409);
  if (!['New', 'In Progress', 'Waiting', 'Completed', 'Escalated'].includes(input.status)) failOperation('Invalid task status');
  if (row.kind === 'housekeeping' && !['manager', 'housekeeping'].includes(user.role)) failOperation('Housekeeping manager access required', 403);
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${user.hotelId}`}, 0))`;
    await assertCurrentSource(tx, user.hotelId, [row], snapshot.today);
    if (row.kind === 'housekeeping' && ['In Progress', 'Completed'].includes(input.status) && row.notBefore && +row.notBefore > Date.now()) failOperation('Do not enter before the recorded access time', 409);
    if (row.kind === 'housekeeping' && row.status === 'Completed') failOperation('Completed work is retained. Add a new follow-up task instead.', 409);
    const changed = await tx.reportTask.updateMany({ where: { id, hotelId: user.hotelId, active: true, contentHash: row.contentHash, planVersion: row.planVersion, updatedAt: row.updatedAt }, data: { status: input.status, ...(row.kind === 'housekeeping' && input.status === 'Completed' ? { carryForward: false } : row.kind === 'housekeeping' && ['Waiting', 'Escalated'].includes(input.status) ? { carryForward: true } : {}),
      ...(input.status === 'New' ? { assignmentId: null, assignedWorkerId: null, assignedAt: null, acceptedAt: null, startedAt: null, problemType: null, problemNote: null } : {}),
      ...(input.status === 'In Progress' && !row.startedAt ? { startedAt: new Date() } : {}), completedAt: input.status === 'Completed' ? new Date() : null } });
    if (changed.count !== 1) failOperation('Task changed; refresh first', 409);
    await tx.reportTaskEvent.create({ data: { hotelId: user.hotelId, taskId: id, actor: user.id, text: String(input.note || `Marked ${input.status}`).slice(0, 2000) } });
  });
  return taskView(await db.reportTask.findUnique({ where: { id } }), row.assignedWorkerId ? await db.housekeepingWorker.findFirst({ where: { id: row.assignedWorkerId, hotelId: user.hotelId } }) : null, snapshot.today);
}
