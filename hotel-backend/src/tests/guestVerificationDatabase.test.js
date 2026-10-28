import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { createGuestVerification } from '../modules/pms/guestVerification.js';

test('Neon verification state, rate budget, single-use code and expiring binding', { skip: process.env.VERIFICATION_DATABASE_TESTS !== 'true' }, async () => {
  assert.match(new URL(process.env.DATABASE_URL).searchParams.get('schema') || '', /^verification_test_[a-f0-9]{16}$/);
  const db = new PrismaClient(); const sent = []; let sequence = 0;
  try {
    await db.hotel.create({ data: { id: 'verify-hotel', name: 'Test', legalName: 'Test', address: '', postcode: '', city: '', country: '', phone: '', email: '', website: '', bookingEngine: '', whatsappNumber: '', vatNumber: '', description: '' } });
    await db.guest.create({ data: { id: 'verify-guest', hotelId: 'verify-hotel', name: 'Test Guest', country: '', language: 'en' } });
    await db.conversation.create({ data: { id: 'verify-conv', guestId: 'verify-guest', stage: 'Pre-arrival', primaryChannel: 'whatsapp', aiStatus: 'ai-handling', sentiment: 'neutral', subject: '', summary: '', suggestedReply: '', lastAt: '10:00' } });
    const ctx = { hotelId: 'verify-hotel', conversationId: 'verify-conv' };
    const service = createGuestVerification({ db, env: { PMS_MCP_CONTEXT_KEY: 'test'.repeat(12) }, makeCode: () => '123456',
      client: { matchGuestForVerification: async (_, args) => ({ structuredContent: { matched: true, reservation_id: 'res', customer_id: 'customer', email: args.email, expires_at: new Date(Date.now() + 3600000).toISOString() } }) },
      sendCode: async args => { sent.push(args); return { success: true, dispatched: true }; } });
    async function input(text, start = false) {
      await db.message.create({ data: { id: `v-${++sequence}`, conversationId: ctx.conversationId, author: 'guest', channel: 'whatsapp', body: text, at: '10:00' } });
      return start ? service.ensure(ctx, text) : service.handle(ctx, text);
    }
    await input('Can I have late checkout?', true);
    for (const value of ['Test Guest', '2026-10-27', '2026-10-28', '2', 'test@example.com', '+31612345678']) await input(value);
    assert.equal(sent.length, 1);
    let session = await db.pmsGuestVerification.findUnique({ where: { conversationId: ctx.conversationId } });
    assert.equal(session.status, 'challenge'); assert.equal(session.sendCount, 1);
    assert(!session.encryptedData.includes('test@example.com'));
    assert.equal(await db.pmsConversationBinding.count(), 0);
    // Simultaneous processing of the same persisted code cannot complete twice.
    await db.message.create({ data: { id: 'code', conversationId: ctx.conversationId, author: 'guest', channel: 'whatsapp', body: '123456', at: '10:01' } });
    const attempts = await Promise.allSettled([service.handle(ctx, '123456'), service.handle(ctx, '123456')]);
    assert(attempts.some(a => a.status === 'fulfilled' && a.value?.verified));
    assert.equal(await db.pmsConversationBinding.count(), 1);
    session = await db.pmsGuestVerification.findUnique({ where: { conversationId: ctx.conversationId } });
    assert.equal(session.status, 'verified'); assert.equal(session.codeHash, null);
    const binding = await service.validBinding(ctx); assert.equal(binding.verificationMethod, 'email-code');
    await db.pmsConversationBinding.update({ where: { conversationId: ctx.conversationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await service.validBinding(ctx), null);
    await assert.rejects(service.ensure({ ...ctx, hotelId: 'other' }, 'Can I have late checkout?'), /mismatch/);
  } finally { await db.$disconnect(); }
});
