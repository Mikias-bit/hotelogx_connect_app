import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuestMessaging, checkinCode, checkinMethod, checkinRoomDecision, normalizeMessagingContact } from '../modules/pms/guestMessaging.js';

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(w => matches(row, w));
    if (key === 'guest') return row.guest.hotelId === value.hotelId;
    if (value instanceof Date) return +row[key] === +value;
    if (value && typeof value === 'object') return (!value.in || value.in.includes(row[key])) && (!value.gt || row[key] > value.gt);
    return value === null ? row[key] == null : row[key] === value;
  });
}
function fixture(channel = 'whatsapp') {
  let clock = new Date('2026-11-18T10:00:00Z'), binding = null, sequence = 0, lockQueue = Promise.resolve();
  const actor = { id: 'staff', hotelId: 'hotel-a', role: 'front-office' };
  const contact = channel === 'email' ? 'guest@example.com' : '+31612345678';
  const ctx = { hotelId: actor.hotelId, conversationId: channel === 'email' ? 'conv-email' : 'conv-wa-hotel-a-31612345678', sender: contact };
  const stay = { Id: 'stay-1', AccountId: 'customer-1', AccountType: 'Customer', State: 'Started', AssignedResourceId: 'resource-307', ScheduledEndUtc: '2026-11-20T11:00:00Z' };
  const rows = [], sent = [], calls = [];
  const message = { id: channel === 'email' ? 'm-gmail-in-1' : 'm-wa-in-1', channel, author: 'guest', conversationId: ctx.conversationId, body: '' };
  const conversation = { id: ctx.conversationId, guest: { hotelId: actor.hotelId } };
  const receipt = { id: 'in-1', hotelId: ctx.hotelId, conversationId: ctx.conversationId, sender: contact };
  let template = { whatsappTemplate: 'guest_connection', whatsappLanguage: 'en', automaticEnabled: true }, delivery = { success: true, messageId: 'provider-1' }, pmsFailure = false;
  const db = {
    guestMessagingConfig: { findUnique: async () => template },
    guestMessagingInvite: {
      findFirst: async ({ where }) => structuredClone(rows.find(r => matches(r, where)) || null),
      findUnique: async ({ where }) => structuredClone(rows.find(r => matches(r, where)) || null),
      create: async ({ data }) => { const row = { id: `invite-${++sequence}`, status: 'sending', revokedAt: null, createdAt: clock, ...data }; rows.push(row); return structuredClone(row); },
      updateMany: async ({ where, data }) => { const found = rows.filter(r => matches(r, where)); found.forEach(r => Object.assign(r, data)); return { count: found.length }; },
      update: async ({ where, data }) => { const row = rows.find(r => matches(r, where)); Object.assign(row, data); return structuredClone(row); },
    },
    user: { findFirst: async ({ where }) => matches(actor, where) ? actor : null },
    room: { findFirst: async ({ where }) => where.hotelId === 'hotel-a' ? { number: stay.AssignedResourceId === 'resource-307' ? '307' : '409' } : null },
    conversation: { findFirst: async ({ where }) => matches(conversation, where) ? conversation : null },
    message: { findFirst: async ({ where }) => matches(message, where) ? message : null },
    gmailInboundMessage: { findFirst: async ({ where }) => matches(receipt, where) ? receipt : null },
    microsoftInboundMessage: { findFirst: async ({ where }) => matches(receipt, where) ? receipt : null },
    imapInboundMessage: { findFirst: async ({ where }) => matches(receipt, where) ? receipt : null },
    pmsConversationBinding: {
      findFirst: async ({ where }) => binding && matches(binding, where) ? binding : null,
      upsert: async ({ create, update }) => { binding = binding ? { ...binding, ...update } : create; return binding; },
      deleteMany: async ({ where }) => { if (binding && matches(binding, where)) { binding = null; return { count: 1 }; } return { count: 0 }; },
    },
    pmsGuestVerification: { deleteMany: async () => ({ count: 0 }) },
    $executeRaw: async () => 1,
    $transaction: fn => { const result = lockQueue.then(() => fn({ ...db, $transaction: undefined })); lockQueue = result.catch(() => {}); return result; },
  };
  const service = createGuestMessaging({ db, now: () => clock, client: { callTool: async (user, name, args) => {
    calls.push({ user, name, args }); if (pmsFailure) throw new Error('offline'); return { structuredContent: { Reservations: user.hotelId === 'hotel-a' ? [stay] : [] } };
  } }, sendEmail: async args => { sent.push(args); return delivery; }, sendWhatsApp: async args => { sent.push(args); return delivery; } });
  const issue = (extra = {}) => service.issue(actor, { reservationId: stay.Id, channel, contact, contactConfirmed: true, ...extra });
  const redeem = async (context = ctx) => { message.body = channel === 'email' ? /^CONNECT .+$/m.exec(sent.at(-1).text)[0] : sent.at(-1).template.components[0].parameters[0].text; return service.redeem(context, message.body); };
  return { db, actor, ctx, stay, rows, sent, calls, message, receipt, issue, redeem, service, binding: () => binding,
    advance: ms => { clock = new Date(+clock + ms); }, noTemplate: () => { template = null; }, delivery: result => { delivery = result; }, offline: () => { pmsFailure = true; } };
}

test('checked-in invitation sends once, stores no plaintext code and binds only after redemption', async () => {
  const f = fixture(); const invite = await f.issue();
  assert.equal(invite.status, 'sent'); assert.equal(invite.codeHash, undefined); assert.equal(f.binding(), null);
  assert.equal(f.sent[0].targetType, 'guest'); assert.equal(f.sent[0].template.name, 'guest_connection');
  const command = f.sent[0].template.components[0].parameters[0].text;
  assert(!JSON.stringify(f.rows).includes(command.slice(8)));
  await assert.rejects(f.issue(), /already exists/); assert.equal(f.sent.length, 1);
  assert.match(await f.redeem(), /connected/); assert.equal(f.binding().verificationMethod, checkinMethod);
  assert.equal(f.binding().expiresAt.toISOString(), f.stay.ScheduledEndUtc.replace('Z', '.000Z'));
  assert.equal(f.calls.at(-1).args.reservation_ids[0], 'stay-1');
  assert.match(await f.redeem(), /connected/); // Same provider receipt is idempotent.
  f.message.id = 'new-message'; assert.match(await f.redeem(), /already used/);
});
test('only checked-in, assigned and unexpired customer reservations qualify', async () => {
  for (const change of [{ State: 'Confirmed' }, { State: 'Canceled' }, { State: 'Processed' }, { AssignedResourceId: null }, { AccountType: 'Company' }, { ActualEndUtc: '2026-11-18T09:00:00Z' }, { ScheduledEndUtc: '2026-11-18T09:00:00Z' }]) {
    const f = fixture(); Object.assign(f.stay, change); await assert.rejects(f.issue(), /checked in/); assert.equal(f.sent.length, 0);
  }
  const f = fixture(); await assert.rejects(f.issue({ contactConfirmed: false }), /Confirm/);
  await assert.rejects(f.service.issue({ ...f.actor, role: 'housekeeping' }, { reservationId: 'stay-1', channel: 'email', contact: 'g@e.com', contactConfirmed: true }), /access/);
});
test('WhatsApp requires a configured template; ambiguous delivery never auto-resends', async () => {
  const f = fixture(); f.noTemplate(); await assert.rejects(f.issue(), /template/); assert.equal(f.sent.length, 0);
  const g = fixture(); g.delivery({ success: false, uncertain: true }); assert.equal((await g.issue()).status, 'uncertain');
  await assert.rejects(g.issue(), /already exists/); assert.equal(g.sent.length, 1);
  assert.match(await g.redeem(), /connected/); // A message can arrive despite a sender timeout.
});
test('concurrent sends and code redemption cannot duplicate delivery or create multiple links', async () => {
  const f = fixture(); const issues = await Promise.allSettled([f.issue(), f.issue()]);
  assert.equal(issues.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.sent.length, 1);
  const replies = await Promise.all([f.redeem(), f.redeem()]);
  assert.equal(replies.filter(r => r.includes('connected')).length, 1); assert.equal(f.rows.filter(r => r.status === 'redeemed').length, 1);
});
test('expiry, different hotel/contact/channel and checkout before redemption fail closed', async () => {
  for (const scenario of ['expired', 'hotel', 'sender', 'channel', 'checkout', 'customer', 'offline']) {
    const f = fixture(); await f.issue();
    let ctx = f.ctx;
    if (scenario === 'expired') f.advance(600001);
    if (scenario === 'hotel') ctx = { ...ctx, hotelId: 'hotel-b' };
    if (scenario === 'sender') ctx = { ...ctx, conversationId: 'conv-wa-hotel-a-31999999999' };
    if (scenario === 'channel') f.message.channel = 'email';
    if (scenario === 'checkout') f.stay.State = 'Processed';
    if (scenario === 'customer') f.stay.AccountId = 'someone-else';
    if (scenario === 'offline') f.offline();
    assert.doesNotMatch(await f.redeem(ctx), /^Your guest messaging is connected/); assert.equal(f.binding(), null);
  }
});
test('email redemption uses the actual inbound sender, handles reply quotes, and verifies all provider receipts', async () => {
  const f = fixture('email'); await f.issue();
  assert.equal(f.sent[0].recordMessage, false);
  assert.match(await f.redeem({ ...f.ctx, sender: 'other@example.com' }), /invalid/);
  assert.match(await f.redeem(), /connected/);
  for (const prefix of ['m-gmail-', 'm-microsoft-', 'm-imap-']) {
    f.message.id = `${prefix}in-1`;
    assert.equal((await f.service.currentBinding(f.ctx, f.binding())).currentRoom, '307');
  }
  f.receipt.sender = 'someone-else@example.com';
  assert.equal(await f.service.currentBinding(f.ctx, f.binding()), null);
  const code = '0123456789ABCDEF01234567';
  assert.equal(checkinCode(`CONNECT ${code}\n\nOn Tuesday reception wrote:\nhello`), code);
  assert.equal(checkinCode(`Hello\n> CONNECT ${code}`), null);
});
test('live room moves are followed; conflicting rooms, checkout and PMS outages never use a stale room', async () => {
  const f = fixture(); await f.issue(); await f.redeem();
  assert.deepEqual(checkinRoomDecision(await f.service.currentBinding(f.ctx, f.binding()), 'not provided'), { room: '307' });
  f.stay.AssignedResourceId = 'resource-409';
  const moved = await f.service.currentBinding(f.ctx, f.binding()); assert.equal(moved.currentRoom, '409');
  assert.match(checkinRoomDecision(moved, '307').replyText, /does not match/);
  f.stay.State = 'Processed'; assert.equal(await f.service.currentBinding(f.ctx, f.binding()), null);
  assert.match(checkinRoomDecision(null, '307').replyText, /could not confirm/);
  f.stay.State = 'Started'; f.offline(); assert.equal(await f.service.currentBinding(f.ctx, f.binding()), null);
});
test('revocation is tenant-scoped and removes only the binding created by that invitation', async () => {
  const f = fixture(); const row = await f.issue(); await f.redeem();
  await assert.rejects(f.service.revoke({ ...f.actor, hotelId: 'hotel-b' }, row.id), /not found/);
  assert(f.binding()); await f.service.revoke(f.actor, row.id); assert.equal(f.binding(), null);
  assert.match(await f.redeem(), /invalid/);
  f.advance(61000); const next = await f.issue(); await f.redeem();
  await f.service.revoke(f.actor, row.id); assert(f.binding()); assert.notEqual(next.id, row.id);
});
test('normalizes contacts without accepting malformed international numbers', () => {
  assert.equal(normalizeMessagingContact('whatsapp', '0031 6 1234 5678'), '+31612345678');
  assert.equal(normalizeMessagingContact('email', ' Guest@Example.com '), 'guest@example.com');
  assert.throws(() => normalizeMessagingContact('whatsapp', '0612345678'), /valid/);
  assert.throws(() => normalizeMessagingContact('sms', '+31612345678'), /valid/);
});

test('automatic and staff sending share a permanent reservation-level duplicate guard', async () => {
  const f = fixture();
  const input = { reservationId: 'stay-1', expectedCustomerId: 'customer-1', channel: 'whatsapp', contact: '+31612345678' };
  await Promise.all([f.service.issueAutomatic(f.actor, input), f.service.issueAutomatic(f.actor, input)]);
  assert.equal(f.sent.length, 1); assert.equal(f.rows[0].source, 'automatic');
  await f.service.revoke(f.actor, f.rows[0].id); f.advance(700000);
  assert.equal((await f.service.issueAutomatic(f.actor, { ...input, channel: 'email', contact: 'guest@example.com' })).status, 'already_handled');
  assert.equal(f.sent.length, 1);
  const g = fixture(); await g.issue();
  assert.equal((await g.service.issueAutomatic(g.actor, input)).status, 'already_handled');
  assert.equal(g.sent.length, 1);
});
