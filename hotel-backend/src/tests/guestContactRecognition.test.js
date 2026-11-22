import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContactRecognition, replyTokenHash } from '../modules/pms/guestContactRecognition.js';

const now = new Date('2026-11-22T12:00:00Z'), end = new Date('2026-11-25T12:00:00Z');
const token = '0123456789ABCDEF0123456789ABCDEF';
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => value && typeof value === 'object' && !(value instanceof Date)
    ? ('gt' in value ? row[key] > value.gt : 'in' in value ? value.in.includes(row[key]) : matches(row[key] || {}, value))
    : (row[key] ?? null) === value);
}
function fixture(channel = 'email') {
  const ctx = { hotelId: 'hotel', conversationId: channel === 'email' ? 'thread' : 'conv-wa-hotel-31612345678' };
  const receipt = { id: 'receipt', hotelId: 'hotel', conversationId: ctx.conversationId, sender: 'guest@example.com', subject: '' };
  const stay = { Id: 'stay', AccountId: 'customer', AccountType: 'Customer', State: 'Started', ScheduledEndUtc: end.toISOString(), AssignedResourceId: 'room-307' };
  const customer = { Email: receipt.sender, Phone: '+31612345678' };
  const proofs = [], welcomes = [], bindings = [];
  const db = {
    $executeRaw: async () => {}, $transaction: async fn => fn(db),
    conversation: { findFirst: async ({ where }) => where.guest.hotelId === 'hotel' ? {} : null },
    message: { findFirst: async () => ({ id: 'm-gmail-receipt', channel }) },
    gmailInboundMessage: { findFirst: async ({ where }) => matches(receipt, where) ? receipt : null },
    guestMessagingConfig: { findUnique: async () => ({ welcomeEnabled: true }) },
    guestContactVerification: {
      findFirst: async ({ where }) => proofs.find(p => matches(p, where)) || null,
      findMany: async ({ where, take }) => proofs.filter(p => matches(p, where)).slice(0, take),
      upsert: async ({ where, create, update }) => { let p = proofs.find(p => matches(p, where.hotelId_reservationId_channel_contact));
        if (p) Object.assign(p, update); else { p = { id: `proof-${proofs.length}`, verifiedAt: now, revokedAt: null, ...create }; proofs.push(p); } return p; },
    },
    guestWelcome: {
      findFirst: async ({ where }) => welcomes.find(w => matches(w, where)) || null,
      updateMany: async ({ where, data }) => { const rows = welcomes.filter(w => matches(w, where)); rows.forEach(w => Object.assign(w, data)); return { count: rows.length }; },
    },
    pmsConversationBinding: { upsert: async ({ create }) => { bindings.push(create); return create; } },
    room: { findFirst: async ({ where }) => ({ number: where.mewsId === 'room-307' ? '307' : '409' }) },
  };
  const reader = { reservation: async () => stay, customer: async () => customer };
  const service = createContactRecognition({ db, readerFor: async () => reader, now: () => now });
  const proof = extra => ({ id: `proof-${proofs.length}`, hotelId: 'hotel', reservationId: 'stay', customerId: 'customer', channel,
    contact: channel === 'email' ? receipt.sender : customer.Phone, conversationId: ctx.conversationId, expiresAt: end, verifiedAt: now, revokedAt: null, verifiedBy: 'staff', ...extra });
  const welcome = () => welcomes.push({ id: 'welcome', ...proof(), channel: 'email', contact: receipt.sender,
    status: 'sent', replyTokenHash: replyTokenHash(token), replyTokenUsedAt: null, recordedBy: 'staff' });
  return { ctx, receipt, stay, customer, proofs, welcomes, bindings, db, reader, service, proof, welcome };
}

test('matching PMS contact alone does not verify a guest', async () => {
  for (const channel of ['email', 'whatsapp']) { const f = fixture(channel); assert.equal(await f.service.recognize(f.ctx), null); assert.equal(f.bindings.length, 0); }
});
test('private email reply reference verifies once and only the same sender and thread can reuse proof', async () => {
  const f = fixture(); f.welcome(); f.receipt.subject = `Re: Welcome [HX-${token}]`;
  const binding = await f.service.recognize(f.ctx);
  assert.equal(binding.reservationId, 'stay'); assert.equal(f.proofs.length, 1); assert(f.welcomes[0].replyTokenUsedAt);
  f.receipt.subject = 'Re: follow up'; assert(await f.service.recognize(f.ctx));
  f.ctx.conversationId = f.receipt.conversationId = 'new-thread'; f.receipt.subject = `[HX-${token}]`;
  assert.equal(await f.service.recognize(f.ctx), null);
  f.ctx.conversationId = f.receipt.conversationId = 'thread'; f.receipt.sender = 'someone@example.com';
  assert.equal(await f.service.currentBinding(f.ctx, binding), null);
});
test('wrong recipient, tenant, or token cannot redeem a welcome', async () => {
  for (const change of [f => { f.receipt.sender = 'other@example.com'; }, f => { f.ctx.hotelId = 'other'; }, f => { f.receipt.subject = `[HX-${'A'.repeat(32)}]`; }]) {
    const f = fixture(); f.welcome(); f.receipt.subject = `[HX-${token}]`; change(f);
    assert.equal(await f.service.recognize(f.ctx), null); assert.equal(f.proofs.length, 0); assert.equal(f.welcomes[0].replyTokenUsedAt, null);
  }
});
test('revoking a reply reference while PMS validation runs prevents redemption', async () => {
  const f = fixture(); f.welcome(); f.receipt.subject = `[HX-${token}]`;
  f.reader.customer = async () => { f.welcomes[0].replyTokenHash = null; return f.customer; };
  assert.equal(await f.service.recognize(f.ctx), null);
  assert.equal(f.proofs.length, 0); assert.equal(f.welcomes[0].replyTokenUsedAt, null);
});
test('remembered WhatsApp contact follows room moves and fails closed after checkout, contact changes, revocation or PMS failure', async () => {
  const f = fixture('whatsapp'); f.proofs.push(f.proof()); const binding = await f.service.recognize(f.ctx);
  assert.equal((await f.service.currentBinding(f.ctx, binding)).currentRoom, '307');
  f.stay.AssignedResourceId = 'room-409'; assert.equal((await f.service.currentBinding(f.ctx, binding)).currentRoom, '409');
  f.stay.State = 'Confirmed'; assert.equal((await f.service.currentBinding(f.ctx, binding)).currentRoom, null);
  f.stay.State = 'Processed'; assert.equal(await f.service.currentBinding(f.ctx, binding), null);
  f.stay.State = 'Started'; f.customer.Phone = '+31699999999'; assert.equal(await f.service.currentBinding(f.ctx, binding), null);
  f.customer.Phone = '+31612345678'; f.proofs[0].revokedAt = now; assert.equal(await f.service.currentBinding(f.ctx, binding), null);
  f.proofs[0].revokedAt = null; f.reader.reservation = async () => { throw new Error('PMS unavailable'); };
  await assert.rejects(f.service.currentBinding(f.ctx, binding), /PMS unavailable/);
});
test('expired proofs and ambiguous stays cannot establish a new binding', async () => {
  const f = fixture('whatsapp'); f.proofs.push(f.proof({ expiresAt: now })); assert.equal(await f.service.recognize(f.ctx), null);
  f.proofs[0].expiresAt = end; f.proofs.push(f.proof({ reservationId: 'other-stay' })); assert.equal(await f.service.recognize(f.ctx), null);
});
