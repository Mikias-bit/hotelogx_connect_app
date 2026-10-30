import { randomUUID } from 'node:crypto';
import { hash } from './reportService.js';
import { planData, planPriority, planLocation, invalidateTaskRoomApprovals } from './housekeepingPlan.js';

const faultKey = text => hash(text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
const event = (tx, hotelId, taskId, actor, text) => tx.reportTaskEvent.create({ data: { hotelId, taskId, actor, text } });

// Called inside the same hotel-locked transaction as the housekeeping problem action.
export async function beginHousekeepingRepair(tx, task, actor) {
  const links = await tx.housekeepingMaintenanceLink.findMany({ where: { hotelId: task.hotelId, reportTaskId: task.id, active: true } });
  const existing = links.length ? await tx.issue.findFirst({ where: { hotelId: task.hotelId, id: { in: links.map(l => l.issueId) }, status: { notIn: ['Completed', 'Duplicate', 'Cancelled'] } } }) : null;
  if (existing) return existing;
  const d = planData(task), id = `MT-${randomUUID()}`;
  const issue = await tx.issue.create({ data: { id, hotelId: task.hotelId, room: d.room || d.location,
    title: `Housekeeping maintenance report — ${planLocation(task)}`.slice(0, 300), detail: 'Awaiting the housekeeper’s fault description.',
    priority: planPriority(task), reportedBy: actor, via: 'Housekeeping WhatsApp', status: 'Reported', createdAt: new Date().toISOString(), housekeepingReported: true,
    updates: { create: { at: new Date().toISOString(), text: `Linked housekeeping task ${task.id}; reported by ${actor}`, via: 'whatsapp' } } } });
  await tx.housekeepingMaintenanceLink.create({ data: { hotelId: task.hotelId, reportTaskId: task.id, issueId: id } });
  await invalidateTaskRoomApprovals(tx, task.hotelId, [task]);
  await event(tx, task.hotelId, task.id, actor, `Maintenance ticket ${id} created. Cleaning cannot continue until the repair is completed.`);
  return issue;
}

export async function describeHousekeepingRepair(tx, task, note, actor) {
  let issue = await beginHousekeepingRepair(tx, task, actor);
  const key = faultKey(note);
  const candidates = await tx.issue.findMany({ where: { hotelId: task.hotelId, room: issue.room, id: { not: issue.id }, status: { notIn: ['Completed', 'Duplicate', 'Cancelled'] } } });
  // Only exact normalized fault descriptions are merged; unrelated faults in a room remain separate.
  const same = candidates.find(i => i.faultKey === key || (i.detail && faultKey(i.detail) === key) || faultKey(i.title) === key);
  if (same && !issue.assignedWorkerId && !issue.faultKey) {
    await tx.housekeepingMaintenanceLink.updateMany({ where: { hotelId: task.hotelId, reportTaskId: task.id, issueId: issue.id }, data: { active: false } });
    await tx.housekeepingMaintenanceLink.upsert({ where: { hotelId_reportTaskId_issueId: { hotelId: task.hotelId, reportTaskId: task.id, issueId: same.id } }, create: { hotelId: task.hotelId, reportTaskId: task.id, issueId: same.id }, update: { active: true } });
    await tx.issue.update({ where: { id: issue.id }, data: { status: 'Duplicate', detail: `Merged into ${same.id}: ${note}`, version: { increment: 1 } } });
    await tx.issueUpdate.create({ data: { issueId: issue.id, at: new Date().toISOString(), text: `Duplicate linked to ${same.id}; original report retained.`, via: 'whatsapp' } });
    issue = same;
  } else {
    issue = await tx.issue.update({ where: { id: issue.id }, data: { detail: note, title: note.slice(0, 200), faultKey: key, version: { increment: 1 } } });
  }
  await tx.issueUpdate.create({ data: { issueId: issue.id, at: new Date().toISOString(), text: `Housekeeping task ${task.id}: ${note} (${actor})`, via: 'whatsapp' } });
  await event(tx, task.hotelId, task.id, actor, `Maintenance ticket ${issue.id}: ${note}`);
  return issue;
}

export async function assertNoOpenRepairs(tx, hotelId, tasks) {
  const hk = tasks.filter(t => t.kind === 'housekeeping');
  if (!hk.length) return;
  const links = await tx.housekeepingMaintenanceLink.findMany({ where: { hotelId, reportTaskId: { in: hk.map(t => t.id) }, active: true } });
  const ids = [...links.map(l => l.issueId), ...hk.map(t => planData(t).sourceIssueId).filter(Boolean)];
  if (ids.length && await tx.issue.findFirst({ where: { hotelId, id: { in: ids }, status: { notIn: ['Completed', 'Duplicate', 'Cancelled'] } } })) throw Object.assign(new Error('Linked maintenance is still open. Complete the repair before continuing housekeeping.'), { status: 409 });
}

export async function repairStatusChanged(tx, issue, status, actor) {
  if (status !== 'Completed' || issue.status === 'Completed') return;
  const links = await tx.housekeepingMaintenanceLink.findMany({ where: { hotelId: issue.hotelId, issueId: issue.id, active: true } });
  if (!links.length && !issue.outOfService) return;
  const original = links.length ? await tx.reportTask.findFirst({ where: { hotelId: issue.hotelId, id: links[0].reportTaskId } }) : null;
  const room = original ? planData(original).room : (await tx.room.findFirst({ where: { hotelId: issue.hotelId, number: issue.room } }))?.number;
  const hotel = await tx.hotel.findUnique({ where: { id: issue.hotelId }, select: { timezone: true } });
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: hotel?.timezone || 'Europe/Amsterdam' }).format(new Date());
  const id = `rt-${hash(['repair-followup', issue.hotelId, issue.id, issue.repairCycle])}`;
  const data = { room: room || '', location: room ? '' : issue.room, task: 'post_repair_clean', priority: issue.priority,
    comment: `Repair completed: ${issue.title}. Check and clean the affected area, then arrange a separate room inspection.`, sourceIssueId: issue.id };
  await tx.reportTask.upsert({ where: { id }, create: { id, hotelId: issue.hotelId, kind: 'housekeeping', reportDate: date, itemKey: id, contentHash: hash(data), data, origin: 'staff', sourceGeneratedAt: new Date(), planVersion: 1 }, update: {} });
  await tx.issue.update({ where: { id: issue.id }, data: { followUpTaskId: id } });
  await invalidateTaskRoomApprovals(tx, issue.hotelId, [{ data }]);
  await tx.reportTaskEvent.create({ data: { hotelId: issue.hotelId, taskId: id, actor, text: `Repair ${issue.id} completed. Follow-up cleaning/check required; the room has not been released.` } });
  await tx.issueUpdate.create({ data: { issueId: issue.id, at: new Date().toISOString(), text: `Housekeeping follow-up ${id} created. Inspection and Front Office release remain separate.`, via: 'dashboard' } });
  for (const link of links) await event(tx, issue.hotelId, link.reportTaskId, actor, `Maintenance ${issue.id} completed. Review/reassign the original task as needed. Follow-up task: ${id}.`);
}
