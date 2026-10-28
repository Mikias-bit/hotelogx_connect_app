import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hash, normalizeRows, validateEnvelope, ingestReports, readReports, reviewItem } from '../modules/reports/reportService.js';
import { reportRouter } from '../modules/reports/reportRoutes.js';
const source = { hotelId: 'hotel-a', engineHotelId: 'Mercier0001', enabled: true };
const bill = { reservation_id: 'r1', confirmation_no: '1234', amount: '123.45', currency: 'EUR', reason: 'unpaid balance', bill_owner_type: 'company' };
const envelope = (rows = [bill]) => ({ schema_version: 1, hotel_id: 'Mercier0001', run_id: 'run-12345678', generated_at: '2026-01-01T06:00:00Z', reports: [{ kind: 'departure_bills', date: '2026-01-01', status: 'complete', rows }] });
function fixture() {
  const records = [], reviews = [];
  const matches = (record, where) => Object.entries(where).every(([k, value]) => typeof value === 'object' && value !== null ? (!value.lte || record[k] <= value.lte) : record[k] === value);
  const db = {
    $executeRaw: async () => 1,
    hotel: { findUnique: async () => ({ timezone: 'Europe/Amsterdam' }) },
    dailyReport: {
      upsert: async ({ where, create }) => { const key = where.hotelId_kind_reportDate_runId; let existing = records.find(r => matches(r, key)); if (!existing) { existing = { ...create, id: 'report-' + records.length, receivedAt: new Date() }; records.push(existing); } return existing; },
      findFirst: async ({ where }) => records.filter(r => matches(r, where)).sort((a,b) => b.reportDate.localeCompare(a.reportDate) || b.generatedAt - a.generatedAt)[0] || null,
    },
    dailyReportReview: {
      findMany: async ({ where }) => reviews.filter(r => matches(r, where)),
      upsert: async ({ where, create, update }) => { let row = reviews.find(r => matches(r, where.hotelId_kind_reportDate_itemKey)); if (row) Object.assign(row, update); else { row = create; reviews.push(row); } return row; },
    },
  };
  db.$transaction = async work => work(db);
  return { db, records, reviews };
}
test('source credentials cannot import another engine hotel', () => {
  assert.throws(() => validateEnvelope({ ...envelope(), hotel_id: 'other' }, source), /does not match/);
});
test('failed snapshots cannot smuggle rows or become all-clear', () => {
  const body = envelope(); body.reports[0].status = 'failed';
  const [report] = validateEnvelope(body, source); assert.equal(report.status, 'failed'); assert.deepEqual(report.rows, []);
});
test('dates, duplicate identities and decimal amounts are validated', () => {
  const badDate = envelope(); badDate.reports[0].date = '2026-02-30'; assert.throws(() => validateEnvelope(badDate, source));
  assert.throws(() => normalizeRows('departure_bills', [bill, bill]), /Duplicate/);
  assert.throws(() => normalizeRows('departure_bills', [{ ...bill, amount: 'NaN' }]));
  assert.throws(() => normalizeRows('departure_bills', [{ ...bill, amount: '-123.45' }]), /sign/);
  const [row] = normalizeRows('departure_bills', [{ ...bill, amount: '-123.4500', reason: 'overpayment' }]);
  assert.equal(row.amount, '-123.4500'); assert.equal(row.reason, 'overpayment');
});
test('VIP extra guest names and housekeeping room moves use actual engine fields', () => {
  const [vip] = normalizeRows('vip', [{ confirmation_no: 'r1', vip_type: 'long_stay', additional_guest_names: ['Guest B'], benefits: ['welcome card'] }]);
  assert.equal(vip.additionalGuests, 'Guest B'); assert.equal(vip.benefits, 'welcome card');
  const [hk] = normalizeRows('housekeeping', [{ task: 'room_move', old_room: '101', new_room: '102' }]); assert.equal(hk.room, '101');
});
test('identical run replay is idempotent; changed content with the same run is rejected', async () => {
  const f = fixture(); await ingestReports(f.db, source, envelope()); await ingestReports(f.db, source, envelope()); assert.equal(f.records.length, 1);
  await assert.rejects(ingestReports(f.db, source, envelope([{ ...bill, amount: '999' }])), /different content/);
});
test('reads enforce hotel and role scope including finance exclusion for housekeeping', async () => {
  const f = fixture(); await ingestReports(f.db, source, envelope());
  const a = await readReports(f.db, { hotelId: 'hotel-a', role: 'manager' }); assert.equal(a.reports.find(r => r.kind === 'departure_bills').rows.length, 1);
  const b = await readReports(f.db, { hotelId: 'hotel-b', role: 'manager' }); assert.ok(b.reports.every(r => !r.rows.length));
  const hk = await readReports(f.db, { hotelId: 'hotel-a', role: 'housekeeping' }); assert.deepEqual(hk.reports.map(r => r.kind), ['housekeeping']);
});
test('failed latest run shows the prior report and cannot clear billing alerts', async () => {
  const f = fixture(); await ingestReports(f.db, source, envelope());
  const failed = envelope(); failed.run_id = 'run-failed-123'; failed.generated_at = '2026-01-02T06:00:00Z'; failed.reports[0].date = '2026-01-02'; failed.reports[0].status = 'failed';
  await ingestReports(f.db, source, failed);
  const view = (await readReports(f.db, { hotelId: 'hotel-a', role: 'front-office' })).reports.find(r => r.kind === 'departure_bills');
  assert.equal(view.latestRunFailed, true); assert.equal(view.reportDate, '2026-01-01'); assert.equal(view.rows.length, 1);
});
test('older arrivals do not replace newer snapshots; successful empty reports do clear old exceptions', async () => {
  const f = fixture(); const empty = envelope([]); empty.run_id = 'new-run-123'; empty.generated_at = '2026-01-01T08:00:00Z';
  await ingestReports(f.db, source, empty); await ingestReports(f.db, source, envelope());
  const view = (await readReports(f.db, { hotelId: 'hotel-a', role: 'manager' })).reports.find(r => r.kind === 'departure_bills'); assert.equal(view.rows.length, 0);
});
test('reviews survive reruns, but changed balances require review again', async () => {
  const f = fixture(); await ingestReports(f.db, source, envelope()); const row = f.records[0].rows[0];
  const user = { id: 'manager-1', hotelId: 'hotel-a', role: 'manager' };
  const input = { kind: 'departure_bills', reportDate: '2026-01-01', itemKey: row.itemKey, contentHash: row.contentHash, status: 'done', note: 'Checked PMS' };
  await reviewItem(f.db, user, input);
  let view = (await readReports(f.db, user)).reports.find(r => r.kind === 'departure_bills'); assert.equal(view.rows[0].review.status, 'done');
  const updated = envelope([{ ...bill, amount: '150.00' }]); updated.run_id = 'updated-run-123'; updated.generated_at = '2026-01-01T09:00:00Z'; await ingestReports(f.db, source, updated);
  view = (await readReports(f.db, user)).reports.find(r => r.kind === 'departure_bills'); assert.equal(view.rows[0].review.status, 'pending'); assert.equal(view.rows[0].review.sourceChanged, true);
  await assert.rejects(reviewItem(f.db, user, input), /changed/);
  await assert.rejects(reviewItem(f.db, { ...user, hotelId: 'hotel-b' }, input));
  await assert.rejects(reviewItem(f.db, { ...user, role: 'housekeeping' }, input), /denied/);
});
test('HTTP ingestion requires the scoped source token and ignores caller-supplied hotel context', async () => {
  const f = fixture(), token = 'hxr_' + 'a'.repeat(64);
  f.db.dailyReportSource = { findUnique: async ({ where }) => where.tokenHash === hash(token) ? source : null };
  const app = express(); app.use(express.json()); app.use('/reports', reportRouter({ db: f.db, auth: (req,res,next) => { req.user = { id: 'staff', hotelId: 'hotel-a', role: 'housekeeping' }; next(); }, broadcast() {} }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/reports`;
    assert.equal((await fetch(url + '/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope()) })).status, 401);
    const accepted = await fetch(url + '/ingest', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...envelope(), hotelId: 'hotel-b' }) });
    assert.equal(accepted.status, 200); assert.equal(f.records[0].hotelId, 'hotel-a');
    const denied = await fetch(url + '/source'); assert.equal(denied.status, 403);
    const visible = await (await fetch(url)).json(); assert.deepEqual(visible.data.reports.map(r => r.kind), ['housekeeping']);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
