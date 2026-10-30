import { hash } from './reportService.js';

export const planData = row => ({ ...row.data, ...(row.overrides || {}) });
export const planToken = row => row.planVersion ? hash([row.contentHash, row.planVersion]) : row.contentHash;
export const planRef = row => `${row.id}~${row.planVersion || 0}`;
export const batchRef = rows => `all~${hash(rows.map(r => [r.id, r.planVersion || 0]).sort((a, b) => a[0].localeCompare(b[0]))).slice(0, 16)}`;
export const planLocation = row => { const d = planData(row); return d.location || `Room ${d.room}`; };
export async function invalidateTaskRoomApprovals(tx, hotelId, rows) {
  const rooms = [...new Set(rows.map(r => planData(r).room).filter(Boolean))];
  if (rooms.length) await tx.roomReadiness.updateMany({ where: { hotelId, roomNumber: { in: rooms } }, data: {
    inspectedAt: null, inspectedBy: null, inspectionHash: null, releasedAt: null, releasedBy: null, releaseHash: null, version: { increment: 1 },
  } });
}
export const planPriority = row => planData(row).priority || (['departure_clean_required', 'late_checkout', 'room_move'].includes(planData(row).task) ? 'High' : 'Normal');
export const planOrder = (a, b) => ({ Urgent: 0, High: 1, Normal: 2 }[planPriority(a)] - { Urgent: 0, High: 1, Normal: 2 }[planPriority(b)]) || ((a.dueAt ? +new Date(a.dueAt) : Infinity) - (b.dueAt ? +new Date(b.dueAt) : Infinity)) || a.id.localeCompare(b.id);
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

// Times entered by staff refer to the hotel's work date and timezone, not the browser's timezone.
// Reject nonexistent or ambiguous DST times instead of silently moving an access restriction.
export function hotelTime(date, time, timezone) {
  if (!time) return null;
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('Enter a valid hotel-local time (HH:mm)');
  const target = `${date} ${time}`, center = Date.parse(`${date}T${time}:00Z`);
  const format = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const matches = [];
  for (let minutes = -840; minutes <= 840; minutes += 15) {
    const instant = new Date(center + minutes * 60000);
    if (format.format(instant) === target) matches.push(instant);
  }
  if (matches.length !== 1) fail('This hotel-local time is ambiguous or unavailable due to a clock change; choose another time');
  return matches[0];
}

// Reconcile the engine's immutable snapshot without replacing staff decisions or execution history.
export async function reconcileHousekeeping(tx, report, existing, hotelId) {
  const ids = new Set();
  const byId = new Map(existing.map(r => [r.id, r]));
  const protectedRooms = new Set(existing.filter(r => r.origin !== 'staff' && (r.assignedWorkerId || r.status === 'Completed' || Object.keys(r.overrides || {}).length)).map(r => planData(r).room));
  for (const row of report.rows.filter(r => r.task !== 'stayover_no_cleaning')) {
    const id = `rt-${hash([hotelId, report.kind, report.reportDate, row.itemKey])}`;
    ids.add(id);
    const old = byId.get(id), { review, ...data } = row;
    const source = { hotelId, kind: 'housekeeping', reportDate: report.reportDate, itemKey: row.itemKey, contentHash: row.contentHash, sourceGeneratedAt: new Date(report.generatedAt) };
    if (!old) {
      const related = protectedRooms.has(data.room);
      await tx.reportTask.create({ data: { id, ...source, data, sourceReviewRequired: related, status: review?.status === 'done' ? 'Completed' : 'New' } });
      await invalidateTaskRoomApprovals(tx, hotelId, [{ data }]);
    } else if (old.contentHash !== row.contentHash || !old.sourcePresent) {
      const preserve = old.assignedWorkerId || old.status !== 'New' || Object.keys(old.overrides || {}).length;
      await tx.reportTask.update({ where: { id }, data: { ...source, sourcePresent: true, active: old.status !== 'Cancelled', planVersion: { increment: 1 },
        ...(preserve ? { pendingSourceData: data, sourceReviewRequired: !['Completed', 'Cancelled'].includes(old.status) } : { data, sourceReviewRequired: false }) } });
      await tx.reportTaskEvent.create({ data: { hotelId, taskId: id, actor: 'report-engine', text: preserve ? 'Morning plan changed. Execution and assignment retained; review the new instructions before continuing open work.' : 'Morning plan instructions updated before assignment.' } });
      await invalidateTaskRoomApprovals(tx, hotelId, [old, { data }]);
    }
  }
  for (const old of existing.filter(r => r.origin !== 'staff' && r.sourcePresent && !ids.has(r.id))) {
    const preserve = old.assignedWorkerId || old.status !== 'New' || Object.keys(old.overrides || {}).length;
    await tx.reportTask.update({ where: { id: old.id }, data: { sourcePresent: false, active: Boolean(preserve && old.status !== 'Cancelled'), sourceReviewRequired: Boolean(preserve && !['Completed', 'Cancelled'].includes(old.status)), planVersion: { increment: 1 } } });
    await tx.reportTaskEvent.create({ data: { hotelId, taskId: old.id, actor: 'report-engine', text: 'Task removed from the morning plan. Existing work and assignment history retained.' } });
    await invalidateTaskRoomApprovals(tx, hotelId, [old]);
  }
  // Yesterday's records remain stored with their history but are not today's assignments.
  await tx.reportTask.updateMany({ where: { hotelId, kind: 'housekeeping', origin: 'report', reportDate: { lt: report.reportDate }, active: true }, data: { active: false } });
}
