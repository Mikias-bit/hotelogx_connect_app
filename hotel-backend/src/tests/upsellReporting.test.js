import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsellPipeline, upsellSummary } from '../modules/upsells/upsellReporting.js';

const now = new Date('2026-11-06T12:00:00Z');
function fixture(offers, messages = [], outreach = []) {
  return { pmsUpsellOffer: { findMany: async () => offers }, upsellOutreach: { findMany: async () => outreach },
    conversation: { findMany: async () => [{ id: 'c', primaryChannel: 'email', guest: { name: 'Guest' } }] },
    message: { findMany: async ({ where }) => { assert.deepEqual(where.conversationId.in, ['c']); return messages; } } };
}
const offer = (id, extra = {}) => ({ id, hotelId: 'h', conversationId: 'c', reservationId: 'r', productId: id, name: id, totalAmount: 50, currency: 'EUR', status: 'offered', createdAt: new Date('2026-10-20'), expiresAt: new Date('2026-11-10'), ...extra });

test('acceptance awaiting approval counts in conversion but not posted value; unsent expiry/rejection does not inflate sent count', async () => {
  const rows = await upsellPipeline(fixture([
    offer('accepted', { status: 'pending_approval', acceptedMessageId: 'guest-accept', acceptedAt: new Date('2026-11-05') }),
    offer('posted', { status: 'posted', acceptedMessageId: 'guest-posted', postedAt: new Date('2026-11-06') }),
    offer('sent'), offer('draft-expired', { expiresAt: new Date('2026-11-01') }), offer('draft-rejected', { status: 'rejected' }),
  ], [{ id: 'm-sent', conversationId: 'c', author: 'staff', body: 'ACCEPT SENT', deliveryStatus: 'sent', createdAt: new Date('2026-11-01') }]), 'h', now);
  const summary = upsellSummary(rows, 'Europe/Amsterdam', now);
  assert.equal(summary.sent, 3); assert.equal(summary.accepted, 2); assert.equal(summary.conversion, 67);
  assert.equal(rows.find(r => r.id === 'accepted').status, 'Accepted');
  assert.equal(rows.find(r => r.id === 'posted').status, 'Posted');
  assert.deepEqual(summary.postedTotals, { EUR: 50 });
  assert(rows.every(r => r.paymentStatus === 'Not tracked'));
});

test('incoming acceptance text alone is not counted as a sent or validated accepted offer', async () => {
  const rows = await upsellPipeline(fixture([offer('abc')], [{ id: 'unvalidated', conversationId: 'c', author: 'guest', body: 'ACCEPT ABC', deliveryStatus: 'sent', createdAt: now }]), 'h', now);
  assert.equal(rows[0].wasSent, false); assert.equal(rows[0].guestAccepted, false);
  assert.equal(upsellSummary(rows, 'UTC', now).conversion, 0);
});

test('a delivered invitation stays in conversion denominator when its subsequent quote is still a draft', async () => {
  const rows = await upsellPipeline(fixture([offer('abc')], [], [{ id: 'invite', conversationId: 'c', reservationId: 'r', productId: 'abc', status: 'sent', createdAt: now }]), 'h', now);
  assert.equal(rows.length, 1); assert.equal(rows[0].wasSent, true); assert.equal(rows[0].guestAccepted, false);
});

test('calendar week uses actual posting time in hotel timezone, not creation or browser/server time', () => {
  const base = { wasSent: true, guestAccepted: true, postingStatus: 'posted', value: 30, currency: 'EUR' };
  const rows = [
    { ...base, date: '2026-10-20T10:00:00Z', postedAt: '2026-11-01T23:30:00Z' }, // Monday in Amsterdam
    { ...base, date: '2026-11-04T10:00:00Z', postedAt: '2026-11-01T22:00:00Z' }, // previous local week
    { ...base, postedAt: null }, // old posting, date unknown
    { ...base, postingStatus: 'pending_approval', postedAt: null },
    { ...base, postedAt: '2026-11-08T10:00:00Z' }, // future, not counted
  ];
  const summary = upsellSummary(rows, 'Europe/Amsterdam', now);
  assert.equal(summary.week.start, '2026-11-02'); assert.equal(summary.week.end, '2026-11-08');
  assert.deepEqual(summary.week.totals, { EUR: 30 }); assert.equal(summary.week.postedCount, 1);
  assert.deepEqual(summary.week.days[0].totals, { EUR: 30 }); assert.equal(summary.undatedPostingCount, 1);
  assert.deepEqual(summary.postedTotals, { EUR: 120 });
});

test('weekly totals keep currencies separate and avoid decimal rounding errors', () => {
  const row = { wasSent: true, guestAccepted: true, postingStatus: 'posted', postedAt: '2026-11-06T10:00:00Z' };
  const summary = upsellSummary([{ ...row, value: 0.1, currency: 'EUR' }, { ...row, value: 0.2, currency: 'EUR' }, { ...row, value: 50, currency: 'USD' }], 'UTC', now);
  assert.deepEqual(summary.week.totals, { EUR: 0.3, USD: 50 });
  assert.equal(summary.week.days.length, 7);
});

test('accepted offer remains an acceptance after staff rejection or uncertain posting', async () => {
  const rows = await upsellPipeline(fixture([offer('rejected', { status: 'rejected', acceptedMessageId: 'm1' }), offer('uncertain', { status: 'uncertain', acceptedMessageId: 'm2' })]), 'h', now);
  assert.equal(rows.find(r => r.id === 'uncertain').status, 'Uncertain');
  const summary = upsellSummary(rows, 'UTC', now);
  assert.equal(summary.accepted, 2); assert.equal(summary.conversion, 100); assert.deepEqual(summary.postedTotals, {});
});
