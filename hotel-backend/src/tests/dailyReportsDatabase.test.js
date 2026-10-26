import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { ingestReports, readReports, reviewItem, hash } from '../modules/reports/reportService.js';

test('Neon report snapshots, tenant boundaries and persistent reviews', { skip: process.env.REPORTS_DATABASE_TESTS !== 'true' }, async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.searchParams.get('schema') || '', /^reports_test_[a-f0-9]{16}$/);
  const db = new PrismaClient();
  try {
    for (const id of ['reports-a', 'reports-b']) await db.hotel.create({ data: {
      id, name: id, legalName: id, address: '', postcode: '', city: '', country: '',
      phone: '', email: '', website: '', bookingEngine: '', whatsappNumber: '', vatNumber: '', description: '',
    } });
    const source = await db.dailyReportSource.create({ data: { hotelId: 'reports-a', engineHotelId: 'engine-a', tokenHash: hash('test-only') } });
    const user = { id: 'reviewer', hotelId: 'reports-a', role: 'manager' };
    const body = { schema_version: 1, hotel_id: 'engine-a', run_id: 'daily-run-001', generated_at: '2026-01-01T06:00:00Z', reports: [
      { kind: 'departure_bills', date: '2026-01-01', status: 'complete', rows: [{ reservation_id: 'reservation-a', amount: '25.00', currency: 'EUR', reason: 'unpaid balance' }] },
    ] };
    await ingestReports(db, source, body);
    await ingestReports(db, source, body);
    assert.equal(await db.dailyReport.count(), 1);
    let report = (await readReports(db, user, '2026-01-01')).reports.find(r => r.kind === 'departure_bills');
    const row = report.rows[0];
    await reviewItem(db, user, { ...row, kind: report.kind, reportDate: report.reportDate, status: 'done', note: 'Checked' });
    report = (await readReports(db, user, '2026-01-01')).reports.find(r => r.kind === 'departure_bills');
    assert.equal(report.rows[0].review.status, 'done');
    assert.ok((await readReports(db, { ...user, hotelId: 'reports-b' }, '2026-01-01')).reports.every(r => r.rows.length === 0));
    assert.deepEqual((await readReports(db, { ...user, role: 'housekeeping' }, '2026-01-01')).reports.map(r => r.kind), ['housekeeping']);
    await db.hotel.delete({ where: { id: 'reports-a' } });
    assert.equal(await db.dailyReport.count(), 0);
    assert.equal(await db.dailyReportReview.count(), 0);
    assert.equal(await db.dailyReportSource.count(), 0);
  } finally { await db.$disconnect(); }
});
