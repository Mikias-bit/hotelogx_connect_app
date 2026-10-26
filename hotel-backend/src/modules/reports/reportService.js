import { createHash } from 'node:crypto';
export const kinds = ['housekeeping', 'vip', 'departure_bills'];
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const allowedKinds = role => ['manager', 'front-office'].includes(role) ? kinds : role === 'housekeeping' ? ['housekeeping'] : [];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const str = (value, max = 2000) => value == null ? '' : String(value).slice(0, max);
const textList = value => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v : v.name || v.full_name || '').filter(Boolean).join(', ') : str(value);
export function normalizeRows(kind, rows) {
  if (!Array.isArray(rows) || rows.length > 10000) fail('Report rows must be an array of at most 10000 items');
  const keys = new Set();
  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail('Invalid report row');
    let data, identity;
    if (kind === 'housekeeping') {
      const room = str(row.room_number || row.room || row.old_room || row.new_room || row.raw_room_id, 120);
      const task = str(row.task || row.type, 120);
      if (!room || !task) fail('Housekeeping rows require a room and task');
      data = { room, task, comment: str(row.comment || row.note || row.reason), oldRoom: str(row.old_room), newRoom: str(row.new_room), checkoutTime: str(row.expected_checkout || row.checkout_time) };
      identity = [room, task];
    } else if (kind === 'vip') {
      const reservation = str(row.reservation_id || row.confirmation_no, 160);
      if (!reservation || !row.vip_type) fail('VIP rows require a reservation and VIP classification');
      data = { reservationId: str(row.reservation_id), confirmation: str(row.confirmation_no), guest: str(row.guest_name), additionalGuests: textList(row.additional_guest_names || row.additional_guests), type: str(row.vip_type), nights: str(row.nights), benefits: textList(row.benefits), room: str(row.room) };
      identity = [reservation, data.type];
    } else {
      const reservation = str(row.reservation_id || row.confirmation_no, 160), amount = str(row.amount, 80), currency = str(row.currency, 3).toUpperCase();
      if (!reservation || !/^-?\d+(?:\.\d+)?$/.test(amount) || !/^[A-Z]{3}$/.test(currency)) fail('Departure bills require reservation, decimal amount, and currency');
      const numeric = Number(amount);
      if (!Number.isFinite(numeric) || numeric === 0) fail('Departure bills must contain a non-zero balance');
      const reason = str(row.reason);
      if (!['unpaid balance', 'overpayment', 'overcharge'].includes(reason)) fail('Unrecognized departure bill reason');
      if ((reason === 'unpaid balance' && numeric < 0) || (reason === 'overpayment' && numeric > 0)) fail('Balance sign does not match the reported reason');
      data = { reservationId: str(row.reservation_id), confirmation: str(row.confirmation_no), guest: str(row.guest_name), room: str(row.room), channel: str(row.channel), bookingKind: str(row.booking_kind), billOwner: str(row.bill_owner_type), billId: str(row.bill_id), amount, currency, reason, amountFor: str(row.amount_for, 12000) };
      identity = [reservation, data.billId || data.billOwner, currency];
    }
    const itemKey = hash([kind, ...identity]);
    if (keys.has(itemKey)) fail('Duplicate report item identity; refusing ambiguous rows');
    keys.add(itemKey);
    return { itemKey, contentHash: hash(data), ...data };
  });
}
export function validateEnvelope(body, source) {
  if (body?.schema_version !== 1 || body.hotel_id !== source.engineHotelId) fail('Report source hotel does not match its credential', 403);
  if (typeof body.run_id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.run_id)) fail('Invalid report run ID');
  const generatedAt = new Date(body.generated_at);
  if (!body.generated_at || !Number.isFinite(generatedAt.getTime()) || generatedAt.getTime() > Date.now() + 300000) fail('Invalid report generation timestamp');
  if (!Array.isArray(body.reports) || !body.reports.length || body.reports.length > 3) fail('Expected one to three reports');
  const seen = new Set();
  return body.reports.map(report => {
    if (!kinds.includes(report.kind) || seen.has(report.kind) || !validDate(report.date)) fail('Invalid report kind/date or duplicate kind');
    seen.add(report.kind);
    if (!['complete', 'failed'].includes(report.status)) fail('Report status must be complete or failed');
    const rows = report.status === 'complete' ? normalizeRows(report.kind, report.rows) : [];
    return { hotelId: source.hotelId, kind: report.kind, reportDate: report.date, runId: body.run_id, generatedAt, status: report.status, checksum: hash({ status: report.status, rows }), rows };
  });
}
export async function ingestReports(db, source, body) {
  const reports = validateEnvelope(body, source);
  return db.$transaction(async tx => {
    for (const report of reports) {
      const key = { hotelId: report.hotelId, kind: report.kind, reportDate: report.reportDate, runId: report.runId };
      // Serialize duplicate deliveries by a unique-key upsert, then compare immutable content.
      const saved = await tx.dailyReport.upsert({ where: { hotelId_kind_reportDate_runId: key }, create: report, update: {} });
      if (saved.checksum !== report.checksum || saved.generatedAt.getTime() !== report.generatedAt.getTime()) fail('Run ID already exists with different content', 409);
    }
    return { accepted: reports.length };
  });
}
export async function readReports(db, user, requestedDate) {
  if (requestedDate && !validDate(requestedDate)) fail('Invalid report date');
  const hotel = await db.hotel.findUnique({ where: { id: user.hotelId }, select: { timezone: true } });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: hotel?.timezone || 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const reports = [];
  for (const kind of allowedKinds(user.role)) {
    const where = { hotelId: user.hotelId, kind, reportDate: requestedDate || { lte: today } };
    const latest = await db.dailyReport.findFirst({ where, orderBy: [{ reportDate: 'desc' }, { generatedAt: 'desc' }, { receivedAt: 'desc' }] });
    const complete = latest?.status === 'complete' ? latest : await db.dailyReport.findFirst({ where: { ...where, status: 'complete' }, orderBy: [{ reportDate: 'desc' }, { generatedAt: 'desc' }, { receivedAt: 'desc' }] });
    if (!complete) { reports.push({ kind, status: latest ? 'failed' : 'missing', rows: [], reportDate: latest?.reportDate || null }); continue; }
    const reviews = await db.dailyReportReview.findMany({ where: { hotelId: user.hotelId, kind, reportDate: complete.reportDate } });
    const byKey = new Map(reviews.map(review => [review.itemKey, review]));
    reports.push({ id: complete.id, kind, reportDate: complete.reportDate, generatedAt: complete.generatedAt, receivedAt: complete.receivedAt, stale: complete.reportDate !== today, latestRunFailed: latest?.status === 'failed', status: 'complete', rows: complete.rows.map(row => {
      const review = byKey.get(row.itemKey), changed = Boolean(review && review.contentHash !== row.contentHash);
      return { ...row, review: review ? { status: changed ? 'pending' : review.status, note: review.note, updatedAt: review.updatedAt, sourceChanged: changed } : { status: 'pending', note: '' } };
    }) });
  }
  return { today, reports };
}
export async function reviewItem(db, user, input) {
  if (!allowedKinds(user.role).includes(input.kind)) fail('Report access denied', 403);
  if (!validDate(input.reportDate) || !['pending', 'in-progress', 'done'].includes(input.status) || typeof input.note !== 'string' || input.note.length > 2000) fail('Invalid checklist update');
  const latest = await db.dailyReport.findFirst({ where: { hotelId: user.hotelId, kind: input.kind, reportDate: input.reportDate, status: 'complete' }, orderBy: [{ generatedAt: 'desc' }, { receivedAt: 'desc' }] });
  const row = latest?.rows.find(row => row.itemKey === input.itemKey);
  if (!row || row.contentHash !== input.contentHash) fail('Report changed; refresh before updating this item', 409);
  const key = { hotelId: user.hotelId, kind: input.kind, reportDate: input.reportDate, itemKey: row.itemKey };
  return db.dailyReportReview.upsert({ where: { hotelId_kind_reportDate_itemKey: key }, create: { ...key, contentHash: row.contentHash, status: input.status, note: input.note, updatedBy: user.id }, update: { contentHash: row.contentHash, status: input.status, note: input.note, updatedBy: user.id } });
}
