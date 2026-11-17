import { randomUUID } from 'node:crypto';
const shifts = ['Morning', 'Evening', 'Night'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function access(user) {
  if (!user?.hotelId || !user.id || !['front-office', 'manager'].includes(user.role)) fail('Front Office or manager access required', 403);
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('Valid shift date required');
  return value;
}
function text(value, max, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail('Invalid or missing handover text');
  return value.trim();
}
export function nextShift(shiftDate, shift) {
  date(shiftDate);
  if (!shifts.includes(shift)) fail('Invalid shift');
  const next = new Date(`${shiftDate}T12:00:00Z`);
  if (shift === 'Night') next.setUTCDate(next.getUTCDate() + 1);
  return { targetDate: next.toISOString().slice(0, 10), targetShift: shifts[(shifts.indexOf(shift) + 1) % 3] };
}
export async function listHandovers(db, user, shiftDate) {
  access(user); date(shiftDate);
  return db.shiftHandover.findMany({ where: { hotelId: user.hotelId, OR: [
    { shiftDate }, { targetDate: shiftDate }, { status: { not: 'Completed' }, targetDate: { lte: shiftDate } },
  ] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
}
export async function createHandover(db, user, input) {
  access(user);
  const target = nextShift(input.shiftDate, input.shift);
  if (!['Normal', 'High', 'Urgent'].includes(input.priority)) fail('Invalid priority');
  return db.shiftHandover.create({ data: {
    id: randomUUID(), hotelId: user.hotelId, shiftDate: input.shiftDate, shift: input.shift, ...target,
    title: text(input.title, 160), body: text(input.body, 10000), room: text(input.room || '', 40, false) || null,
    priority: input.priority, authorId: user.id, authorName: user.name || 'Reception',
    events: [{ action: 'Created', actorId: user.id, actorName: user.name || 'Reception', at: new Date().toISOString() }],
  } });
}
export async function updateHandover(db, user, id, input) {
  access(user);
  if (!Number.isInteger(input.version) || !['Acknowledge', 'Complete', 'Reopen', 'Comment'].includes(input.action)) fail('Invalid handover update');
  const note = text(input.note || '', 4000, ['Comment', 'Complete', 'Reopen'].includes(input.action));
  const row = await db.shiftHandover.findFirst({ where: { id, hotelId: user.hotelId } });
  if (!row) fail('Handover not found', 404);
  if (row.version !== input.version) fail('Handover changed. Refresh before updating.', 409);
  if (input.action === 'Acknowledge' && row.status !== 'Open') fail('Only open items can be acknowledged', 409);
  if (input.action === 'Complete' && row.status === 'Completed') fail('Already completed', 409);
  if (input.action === 'Reopen' && row.status !== 'Completed') fail('Only completed items can be reopened', 409);
  const status = { Acknowledge: 'Acknowledged', Complete: 'Completed', Reopen: 'Open' }[input.action] || row.status;
  const saved = await db.shiftHandover.updateMany({ where: { id, hotelId: user.hotelId, version: input.version }, data: {
    status, version: { increment: 1 }, events: [...row.events, { action: input.action, note,
      actorId: user.id, actorName: user.name || 'Reception', at: new Date().toISOString() }],
  } });
  if (saved.count !== 1) fail('Handover changed. Refresh before updating.', 409);
  return { id, status };
}
