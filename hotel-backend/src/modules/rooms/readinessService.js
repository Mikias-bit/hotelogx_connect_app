import { hash } from '../reports/reportService.js';
import { planData } from '../reports/housekeepingPlan.js';
import { syncOperations } from '../reports/reportOperations.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const operationsLock = (tx, hotelId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${hotelId}`}, 0))`;
const roles = ['manager', 'front-office', 'housekeeping', 'maintenance'];
const closed = status => ['Completed', 'Cancelled', 'Duplicate'].includes(status);
export async function invalidateRoomReadiness(db, hotelId, numbers) {
  if (!numbers.length) return;
  await db.roomReadiness.updateMany({ where: { hotelId, roomNumber: { in: numbers } }, data: { inspectedAt: null, inspectedBy: null, inspectionHash: null, releasedAt: null, releasedBy: null, releaseHash: null, cleaningConfirmedAt: null, version: { increment: 1 } } });
}
export async function readinessContext(db, hotelId) {
  const [hotel, rooms, states, reportTasks, tasks, issues, blockers] = await Promise.all([
    db.hotel.findUnique({ where: { id: hotelId }, select: { timezone: true } }),
    db.room.findMany({ where: { hotelId }, orderBy: { number: 'asc' } }),
    db.roomReadiness.findMany({ where: { hotelId } }),
    db.reportTask.findMany({ where: { hotelId, kind: 'housekeeping', active: true } }),
    db.task.findMany({ where: { hotelId, department: { in: ['Housekeeping', 'Maintenance'] } } }),
    db.issue.findMany({ where: { hotelId, status: { not: 'Duplicate' } } }),
    db.operationalBlocker.findMany({ where: { hotelId, resolvedAt: null } }),
  ]);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: hotel?.timezone || 'Europe/Amsterdam' }).format(new Date());
  const numbers = new Set([...rooms.map(r => r.number), ...reportTasks.map(r => planData(r).room).filter(Boolean)]);
  return [...numbers].sort().map(number => {
    const room = rooms.find(r => r.number === number), saved = states.find(r => r.roomNumber === number);
    const hk = reportTasks.filter(r => planData(r).room === number && (r.reportDate === today || !closed(r.status)));
    const allLegacy = tasks.filter(r => r.room === number);
    const legacy = allLegacy.filter(r => !closed(r.status));
    const repairs = issues.filter(r => r.room === number && !closed(r.status));
    const maintenanceTasks = legacy.filter(r => r.department === 'Maintenance');
    const roomBlockers = blockers.filter(b => b.workKind === 'report' ? hk.some(t => t.id === b.workId) : b.workKind === 'issue' ? issues.some(i => i.id === b.workId && i.room === number) : allLegacy.some(t => t.id === b.workId));
    const open = [...hk.filter(r => !closed(r.status)), ...legacy.filter(r => r.department === 'Housekeeping')];
    const contextHash = hash([today, room && [room.status, room.guestStatus, room.arrivalTime], hk.map(r => [r.id, r.status, r.planVersion, r.updatedAt]).sort(), allLegacy.map(r => [r.id, r.status, r.version]).sort(), issues.filter(r => r.room === number).map(r => [r.id, r.status, r.version]).sort()]);
    const pmsOccupied = !!room && ['Occupied', 'In House', 'In-House', 'Departing'].includes(room.guestStatus);
    const pmsDnd = room?.status === 'DND', pmsBlocked = ['Maintenance', 'Blocked'].includes(room?.status);
    const restrictions = [
      ...roomBlockers.map(b => `${b.type.replaceAll('_', ' ')}: ${b.followUpLocal ? `${b.followUpLocal.replace('T', ' ')} (${b.timezone}), ${b.ownerName}` : 'needs follow-up scheduling'}`),
      ...(saved?.occupied || pmsOccupied ? ['Occupied / guest inside'] : []),
      ...(saved?.dnd || pmsDnd || hk.some(r => r.status === 'Problem' && r.problemType === 'dnd') ? ['Do not disturb'] : []),
      ...(saved?.maintenanceBlocked || repairs.length || maintenanceTasks.length ? ['Maintenance restriction'] : []),
      ...(pmsBlocked ? ['PMS room restriction — clear in PMS and sync'] : []),
      ...(saved?.otherRestriction ? [saved.otherRestriction] : []),
      ...(hk.some(r => r.notBefore && +r.notBefore > Date.now() && !closed(r.status)) ? ['Access time not reached'] : []),
    ];
    const inspected = !!saved?.inspectedAt && saved.inspectionHash === contextHash && !open.length;
    const cleaning = open.some(r => r.status === 'In Progress');
    const hasCompleted = hk.length > 0 && !open.length;
    const cleanliness = saved?.needsCleaning ? 'Needs cleaning' : inspected ? 'Inspected' : cleaning ? 'Cleaning' : open.length ? 'Needs cleaning' : hasCompleted || saved?.cleaningConfirmedAt || ['Clean', 'Inspected'].includes(room?.status) ? 'Awaiting inspection' : 'Needs cleaning';
    const ready = !saved?.needsCleaning && inspected && !restrictions.length && !!saved?.releasedAt && saved.releaseHash === contextHash;
    return { number, floor: room?.floor, arrivalTime: room?.arrivalTime, guestStatus: room?.guestStatus, cleanliness, ready, restrictions,
      releaseStatus: ready ? 'Ready for Front Office' : restrictions.length ? 'Restricted' : inspected ? 'Awaiting release approval' : 'Not ready',
      token: hash([contextHash, saved?.version || 0]), contextHash, version: saved?.version || 0,
      occupied: saved?.occupied || false, dnd: saved?.dnd || false, maintenanceBlocked: saved?.maintenanceBlocked || false, otherRestriction: saved?.otherRestriction || '',
      inspectedAt: inspected ? saved.inspectedAt : null, inspectedBy: inspected ? saved.inspectedBy : null,
      releasedAt: ready ? saved.releasedAt : null, releasedBy: ready ? saved.releasedBy : null,
      openTasks: open.map(t => ({ id: t.id, title: t.title || planData(t).task?.replaceAll('_', ' '), status: t.status })),
      issues: repairs.map(i => ({ id: i.id, title: i.title, status: i.status })),
      canInspect: cleanliness === 'Awaiting inspection' && !restrictions.length,
    };
  });
}

export function createReadinessService({ db, broadcast = () => {} }) {
  const authorize = user => { if (!user?.hotelId || !roles.includes(user.role)) fail('Room readiness access denied', 403); };
  async function read(user) {
    authorize(user);
    if (user.role !== 'maintenance') await syncOperations(db, user);
    const rooms = await readinessContext(db, user.hotelId);
    const events = await db.roomReadinessEvent.findMany({ where: { hotelId: user.hotelId }, orderBy: { at: 'desc' }, take: 300 });
    return { rooms: rooms.map(({ contextHash, ...room }) => ({ ...room, history: events.filter(e => e.roomNumber === room.number).slice(0, 20) })) };
  }
  async function update(user, number, input = {}) {
    authorize(user);
    const { action, token, note = '' } = input;
    if (!['manager', 'front-office', 'housekeeping'].includes(user.role)) fail('Room readiness changes require Front Office or housekeeping management', 403);
    if (!['cleaned', 'needs_cleaning', 'inspect', 'release', 'revoke', 'restrictions'].includes(action) || typeof token !== 'string' || typeof note !== 'string' || !note.trim() || note.length > 2000) fail('Choose an action and enter a reason');
    if (['cleaned', 'inspect', 'needs_cleaning'].includes(action) && !['manager', 'housekeeping'].includes(user.role)) fail('Housekeeping inspection access required', 403);
    if (['release', 'revoke'].includes(action) && !['manager', 'front-office'].includes(user.role)) fail('Front Office release approval required', 403);
    await syncOperations(db, user);
    await db.$transaction(async tx => {
      await operationsLock(tx, user.hotelId);
      const row = (await readinessContext(tx, user.hotelId)).find(r => r.number === number);
      if (!row) fail('Room not found', 404);
      if (row.token !== token) fail('Room or work changed. Refresh before continuing.', 409);
      if (action === 'cleaned' && row.openTasks.length) fail('Complete the individual housekeeping tasks first', 409);
      if (action === 'inspect' && !row.canInspect) fail('Complete cleaning and resolve room restrictions before inspection', 409);
      if (action === 'release' && (row.cleanliness !== 'Inspected' || row.restrictions.length)) fail('Room requires a current inspection with no restrictions before release', 409);
      let data = { version: { increment: 1 } };
      const reset = { inspectedAt: null, inspectedBy: null, inspectionHash: null, releasedAt: null, releasedBy: null, releaseHash: null };
      if (action === 'restrictions') {
        const r = input.restrictions;
        if (!r || ['occupied', 'dnd', 'maintenanceBlocked'].some(k => typeof r[k] !== 'boolean') || typeof r.otherRestriction !== 'string' || r.otherRestriction.length > 500) fail('Enter valid room restrictions');
        data = { ...data, ...reset, occupied: r.occupied, dnd: r.dnd, maintenanceBlocked: r.maintenanceBlocked, otherRestriction: r.otherRestriction.trim() };
      } else if (action === 'cleaned') data = { ...data, ...reset, cleaningConfirmedAt: new Date(), needsCleaning: false };
      else if (action === 'needs_cleaning') data = { ...data, ...reset, cleaningConfirmedAt: null, needsCleaning: true };
      else if (action === 'inspect') data = { ...data, inspectedAt: new Date(), inspectedBy: user.id, inspectionHash: row.contextHash, releasedAt: null, releasedBy: null, releaseHash: null };
      else if (action === 'release') data = { ...data, releasedAt: new Date(), releasedBy: user.id, releaseHash: row.contextHash };
      else data = { ...data, releasedAt: null, releasedBy: null, releaseHash: null };
      await tx.roomReadiness.upsert({ where: { hotelId_roomNumber: { hotelId: user.hotelId, roomNumber: number } }, create: { hotelId: user.hotelId, roomNumber: number, ...data, version: 1 }, update: data });
      await tx.roomReadinessEvent.create({ data: { hotelId: user.hotelId, roomNumber: number, actor: user.id, action, note: note.trim() } });
    }, { timeout: 30000 });
    broadcast(user.hotelId, 'readiness:updated', { refresh: true });
    return { saved: true };
  }
  return { read, update };
}
