import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuestVerification, parseVerificationAnswer, requiresGuestVerification } from '../modules/pms/guestVerification.js';
import { runPmsAiTools } from '../modules/pms/pmsAiTools.js';

function fixture() {
  let row, binding, message, clock = new Date('2026-10-27T10:00:00Z'), sequence = 0;
  const sent = []; const matches = []; let matched = true; let failSend = false;
  const ctx = { hotelId: 'hotel-a', conversationId: 'conv-a' };
  const db = {
    conversation: { findFirst: async ({ where }) => where.guest.hotelId === 'hotel-a' ? { id: 'conv-a' } : null },
    message: { findFirst: async () => message },
    pmsConversationBinding: {
      findFirst: async () => binding && (!binding.expiresAt || binding.expiresAt > clock) ? structuredClone(binding) : null,
      upsert: async ({ create }) => { binding = create; return binding; },
    },
    pmsGuestVerification: {
      findUnique: async () => row ? structuredClone(row) : null,
      create: async ({ data }) => { row = { version: 0, sendCount: 0, createdAt: clock, updatedAt: clock, ...data }; return structuredClone(row); },
      aggregate: async () => ({ _sum: { sendCount: row.sendCount } }),
      updateMany: async ({ where, data }) => {
        if (where.version !== row.version || where.hotelId !== row.hotelId || (where.status && where.status !== row.status) || (where.codeExpiresAt && row.codeExpiresAt <= where.codeExpiresAt.gt)) return { count: 0 };
        for (const [key, value] of Object.entries(data)) row[key] = value?.increment !== undefined ? row[key] + value.increment : value;
        row.updatedAt = new Date(+clock + sequence); return { count: 1 };
      },
    },
    $executeRaw: async () => 1,
    $transaction: async fn => fn(db),
  };
  const service = createGuestVerification({ db, now: () => clock, env: { PMS_MCP_CONTEXT_KEY: 'secret'.repeat(10) },
    encrypt: text => `encrypted:${Buffer.from(text).toString('base64')}`, decrypt: value => Buffer.from(value.slice(10), 'base64').toString(), makeCode: () => '123456',
    client: { matchGuestForVerification: async (context, args) => { matches.push({ context, args }); return { structuredContent: matched ? { matched: true, reservation_id: 'reservation-a', customer_id: 'customer-a', email: args.email, expires_at: new Date(+clock + 3600000).toISOString() } : { matched: false } }; } },
    sendCode: async args => { sent.push(args); if (failSend) throw new Error('uncertain transport'); return { success: true, dispatched: true }; },
  });
  async function input(text, start = false) { message = { id: `m-${++sequence}`, body: text }; return start ? service.ensure(ctx, text) : service.handle(ctx, text); }
  async function collect() {
    await input('Can I have late checkout?', true);
    for (const text of ['Jane Doe', '2026-10-26', '2026-10-28', '2', 'JANE@example.com', '+31612345678']) await input(text);
  }
  return { service, ctx, input, collect, sent, matches, row: () => row, binding: () => binding, changeMatch: value => { matched = value; }, failSend: () => { failSend = true; }, advance: ms => { clock = new Date(+clock + ms); } };
}

test('collects all requested details, verifies email ownership, rechecks PMS and binds only this conversation', async () => {
  const f = fixture(); await f.collect();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].toEmail, 'jane@example.com');
  assert.equal(f.sent[0].conversationId, undefined); assert.equal(f.binding(), undefined);
  assert.equal(f.row().status, 'challenge'); assert(!f.row().encryptedData.includes('Jane')); assert(!f.row().codeHash.includes('123456'));
  assert.deepEqual(f.matches[0].args, { full_name: 'Jane Doe', check_in: '2026-10-26', check_out: '2026-10-28', guest_count: 2, email: 'jane@example.com', whatsapp: '+31612345678' });
  const verified = await f.input('123456');
  assert.equal(verified.verified, true); assert.equal(verified.resumeRequest, 'Can I have late checkout?');
  assert.equal(f.matches.length, 2); assert.equal(f.binding().reservationId, 'reservation-a');
  assert.equal(f.binding().hotelId, 'hotel-a'); assert.equal(f.binding().verificationMethod, 'email-code');
  assert.equal(f.row().codeHash, null);
  assert.equal(await f.service.ensure(f.ctx, 'another request'), null);
});
test('incorrect, expired, changed-booking and foreign-hotel verification never creates a binding', async () => {
  for (const scenario of ['attempts', 'expiry', 'changed']) {
    const f = fixture(); await f.collect();
    if (scenario === 'attempts') for (let i = 0; i < 5; i++) await f.input('000000');
    if (scenario === 'expiry') { f.advance(600001); await f.input('123456'); }
    if (scenario === 'changed') { f.changeMatch(false); await f.input('123456'); }
    assert.equal(f.binding(), undefined); assert.equal(f.row().status, 'blocked'); assert.equal(f.row().codeHash, null);
  }
  const f = fixture(); await f.collect();
  await assert.rejects(f.service.handle({ ...f.ctx, hotelId: 'other' }, '123456'), /mismatch/);
});
test('replayed messages and uncertain email sends never send duplicate codes', async () => {
  const f = fixture(); await f.collect();
  await f.service.handle(f.ctx, '+31612345678'); assert.equal(f.sent.length, 1);
  const g = fixture(); g.failSend(); await g.collect();
  await g.input('123456'); assert.equal(g.sent.length, 1); assert.equal(g.binding(), undefined);
});
test('general questions remain available and cancellation clears verification secrets', async () => {
  const f = fixture(); await f.input('Can I have late checkout?', true);
  assert.equal(await f.input('What are the breakfast hours?'), null);
  assert.equal(f.row().step, 0);
  await f.input('CANCEL VERIFICATION'); assert.equal(f.row().status, 'cancelled'); assert.equal(f.row().codeHash, null);
  assert.equal(requiresGuestVerification('What are breakfast hours?'), false);
  assert.equal(requiresGuestVerification('Can I have late check out?'), true);
  assert.equal(parseVerificationAnswer(1, '2026-02-30'), null);
  assert.equal(parseVerificationAnswer(2, '2026-10-25', { check_in: '2026-10-26' }), null);
  assert.equal(parseVerificationAnswer(3, 'two'), null);
  assert.equal(parseVerificationAnswer(5, '0612345678'), null);
});
test('OpenAI cannot bypass verification by requesting a quote tool', async () => {
  let writes = 0;
  const response = await runPmsAiTools({ hotelId: 'hotel-a', conversationId: 'conv-a', messageText: 'Please add two breakfasts', env: { OPENAI_API_KEY: 'test' },
    verification: { shouldVerify: () => false, ensure: async () => ({ status: 'verification', replyText: 'Full booking name?' }) },
    client: { listConversationTools: async () => ({ tools: [{ name: 'quote_upsell', inputSchema: { type: 'object' } }] }), callConversationTool: async () => { writes++; } },
    request: async () => ({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'a', function: { name: 'quote_upsell', arguments: JSON.stringify({ product_id: 'p', quantity: 2, consumption_utc: '2026-10-28T08:00:00Z' }) } }] } }] }) }),
  });
  assert.equal(response.status, 'verification'); assert.equal(writes, 0);
});
