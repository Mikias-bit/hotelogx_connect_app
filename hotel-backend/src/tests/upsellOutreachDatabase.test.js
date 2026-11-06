import { test } from 'node:test';
import assert from 'node:assert/strict';
import pkg from '@prisma/client';
import { claimOutreach, reserveStaffOffers, outreachContext } from '../modules/upsells/upsellOutreach.js';
import { createUpsellDelivery } from '../modules/upsells/upsellDelivery.js';
import { reserveQuoteDelivery } from '../modules/upsells/upsellRecommendations.js';
import { createUpsellPmsTriggers } from '../modules/upsells/upsellPmsTriggers.js';

test('persistent upsell claims, cross-channel staff suppression and uncertain delivery', { skip: !process.env.UPSELL_TEST_DATABASE_URL }, async t => {
  const url = new URL(process.env.UPSELL_TEST_DATABASE_URL);
  assert.match(url.searchParams.get('schema'), /^upsells_test_[a-f0-9]{16}$/);
  const prisma = new pkg.PrismaClient({ datasources: { db: { url: url.toString() } } });
  const policy = { hotel: { findUnique: async () => ({ aiMode: 'Autonomous', timezone: 'Europe/Amsterdam' }) }, aiConfig: { findUnique: async () => ({ autoReply: true }) }, aiRule: { findFirst: async () => null }, emailIntegration: { findFirst: async () => ({ status: 'connected' }) } };
  policy.user = { findFirst: async () => ({ id: 'staff', hotelId: 'h', role: 'manager' }) };
  const wrap = tx => new Proxy(tx, { get: (target, key) => key in policy ? policy[key] : key === '$transaction' ? undefined : target[key] });
  const db = new Proxy(prisma, { get: (target, key) => key in policy ? policy[key] : key === '$transaction' ? fn => prisma.$transaction(tx => fn(wrap(tx)), { timeout: 30000 }) : target[key] });
  const product = { productId: 'wine', serviceId: 'service', label: 'Wine in room', category: 'wine', unitAmount: 30, currency: 'EUR', keywords: '' };
  const date = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  try {
    await prisma.guest.createMany({ data: [
      { id: 'pms-guest', hotelId: 'h', name: 'Guest', email: 'guest@example.com', phone: '31612345678', country: 'NL', language: 'en' },
      { id: 'email-guest', hotelId: 'h', name: 'Guest email', tags: '["guest@example.com"]', country: 'NL', language: 'en' },
      { id: 'g-wa-h-31612345678', hotelId: 'h', name: 'Guest WA', country: 'NL', language: 'en' },
    ] });
    await prisma.reservation.create({ data: { hotelId: 'h', number: 'R1', mewsId: 'reservation', guestId: 'pms-guest', arrival: date(3), departure: date(7), nights: 2, adults: 2, roomType: 'Double', rate: '150', createdAt: new Date('2026-01-01') } });
    for (const [id, guestId, primaryChannel] of [['email-conv', 'email-guest', 'email'], ['wa-conv', 'g-wa-h-31612345678', 'whatsapp']]) await prisma.conversation.create({ data: { id, guestId, primaryChannel, stage: 'Pre-arrival', aiStatus: 'ai-handling', sentiment: 'neutral', subject: '', summary: '', suggestedReply: '', lastAt: '10:00' } });
    await prisma.pmsUpsellProduct.create({ data: { ...product, hotelId: 'h', updatedBy: 'staff', preArrival: true } });
    await prisma.upsellAutomationConfig.create({ data: { hotelId: 'h', enabled: true, daysBeforeArrival: 3, whatsappTemplate: 'extras', whatsappLanguage: 'en_US', updatedBy: 'staff' } });
    const reset = async () => { await prisma.upsellOutreach.deleteMany(); await prisma.message.deleteMany(); };
    await t.test('parallel staff and AI attempts on different channels claim exactly once', async () => {
      const results = await Promise.all([
        claimOutreach(db, { hotelId: 'h', conversationId: 'email-conv', products: [product], source: 'staff' }),
        claimOutreach(db, { hotelId: 'h', conversationId: 'wa-conv', products: [product], source: 'ai', automatic: true }),
      ]);
      assert.equal(results.reduce((n, r) => n + r.products.length, 0), 1);
      assert.equal(await prisma.upsellOutreach.count(), 1);
      assert.equal((await prisma.upsellOutreach.findFirst()).reservationId, 'reservation');
    });
    await t.test('historical staff email suppresses WhatsApp offer using PMS contacts', async () => {
      await reset();
      await prisma.message.create({ data: { id: 'staff-mail', conversationId: 'email-conv', author: 'staff', channel: 'email', body: 'Would you like wine in the room for EUR 30?', at: '10:00', deliveryStatus: 'sent' } });
      assert.equal((await claimOutreach(db, { hotelId: 'h', conversationId: 'wa-conv', products: [product], source: 'ai' })).products.length, 0);
    });
    await t.test('foreign tenant and ambiguous reservations fail closed without a send claim', async () => {
      await reset();
      await assert.rejects(outreachContext(db, 'other', 'email-conv'), /Conversation not found/);
      await prisma.reservation.create({ data: { hotelId: 'h', number: 'R2', mewsId: 'second', guestId: 'pms-guest', arrival: date(10), departure: date(12), nights: 2, adults: 2, roomType: 'Double', rate: '150' } });
      await assert.rejects(outreachContext(db, 'h', 'email-conv'), /no unique synced reservation/);
      await prisma.reservation.delete({ where: { hotelId_number: { hotelId: 'h', number: 'R2' } } });
    });
    await t.test('uncertain provider acceptance is never resent through another channel', async () => {
      await reset(); let sends = 0;
      const delivery = createUpsellDelivery({ db, client: { callConversationTool: async () => ({ structuredContent: { products: [{ product_id: 'wine', name: 'Wine in room', unit_amount: 30, currency: 'EUR' }] } }) }, sendEmail: async () => { sends++; throw new Error('timeout after acceptance'); }, sendWhatsApp: async () => { sends++; return { success: true }; } });
      assert.equal((await delivery.send({ hotelId: 'h', conversationId: 'email-conv', productIds: ['wine'], channel: 'email' })).status, 'uncertain');
      assert.equal((await delivery.send({ hotelId: 'h', conversationId: 'wa-conv', productIds: ['wine'], channel: 'whatsapp' })).status, 'skipped');
      assert.equal(sends, 1); assert.equal((await prisma.message.findFirst()).deliveryStatus, 'uncertain');
    });
    await t.test('free-text staff offer claims before sending and repeat is rejected', async () => {
      await reset();
      await reserveStaffOffers(db, { hotelId: 'h', conversationId: 'email-conv', body: 'Would you like wine in the room?', messageId: 'staff-pending' });
      await assert.rejects(reserveStaffOffers(db, { hotelId: 'h', conversationId: 'wa-conv', body: 'Would you like wine in the room?', messageId: 'other' }), /already been offered/);
      assert.equal(await prisma.upsellOutreach.count(), 1);
    });
    await t.test('staff takeover prevents scheduled outreach without burning the product claim', async () => {
      await reset();
      await prisma.conversation.update({ where: { id: 'email-conv' }, data: { aiStatus: 'human-takeover' } });
      assert.equal((await claimOutreach(db, { hotelId: 'h', conversationId: 'wa-conv', products: [product], source: 'campaign', automatic: true })).products.length, 0);
      assert.equal(await prisma.upsellOutreach.count(), 0);
      await prisma.conversation.update({ where: { id: 'email-conv' }, data: { aiStatus: 'ai-handling' } });
    });
    await t.test('scheduled campaign checks live reservation, sends email once and ignores later schedule changes', async () => {
      await reset(); let sends = 0, state = 'Confirmed';
      const delivery = createUpsellDelivery({ db, client: {
        callTool: async (user, tool) => { assert.equal(user.hotelId, 'h'); assert.equal(tool, 'get_reservations'); return { structuredContent: { Reservations: [{ Id: 'reservation', State: state, AccountType: 'Customer', AccountId: 'pms-guest', ScheduledStartUtc: `${date(3)}T14:00:00Z` }] } }; },
        callConversationTool: async () => ({ structuredContent: { products: [{ product_id: 'wine', name: 'Wine in room', unit_amount: 30, currency: 'EUR' }] } }),
      }, sendEmail: async args => { sends++; assert.equal(args.toEmail, 'guest@example.com'); assert.equal(args.recordMessage, false); return { success: true }; }, sendWhatsApp: async () => assert.fail('Email should be preferred') });
      assert.equal((await delivery.runHotel('h')).sent, 1);
      await prisma.upsellAutomationConfig.update({ where: { hotelId: 'h' }, data: { daysBeforeArrival: 7 } });
      assert.equal((await delivery.runHotel('h')).sent, 0); assert.equal(sends, 1);
      await reset(); state = 'Canceled';
      assert.equal((await delivery.runHotel('h')).sent, 0); assert.equal(sends, 1);
    });
    await t.test('short-lead booking sends once after confirmation, not while optional or again on repeated confirmation', async () => {
      await reset(); let sends = 0;
      const where = { hotelId_number: { hotelId: 'h', number: 'R1' } };
      await prisma.upsellAutomationConfig.update({ where: { hotelId: 'h' }, data: { daysBeforeArrival: 3 } });
      await prisma.reservation.update({ where, data: { arrival: date(1), status: 'Optional' } });
      const delivery = createUpsellDelivery({ db, client: {
        callTool: async () => ({ structuredContent: { Reservations: [{ Id: 'reservation', State: 'Confirmed', AccountType: 'Customer', AccountId: 'pms-guest', ScheduledStartUtc: `${date(1)}T14:00:00Z` }] } }),
        callConversationTool: async () => ({ structuredContent: { products: [{ product_id: 'wine', name: 'Wine in room', unit_amount: 30, currency: 'EUR' }] } }),
      }, sendEmail: async () => { sends++; return { success: true }; } });
      const trigger = createUpsellPmsTriggers({ db, run: id => delivery.runHotel(id) });
      await trigger.afterSync('h'); assert.equal(sends, 0);
      await prisma.reservation.update({ where, data: { status: 'Confirmed' } });
      await trigger.afterSync('h'); assert.equal(sends, 1);
      await trigger.afterSync('h'); assert.equal(sends, 1);
      await prisma.reservation.update({ where, data: { arrival: date(3) } });
    });
    await t.test('WhatsApp fallback uses a template and keeps provider delivery linked to the offer', async () => {
      await reset(); let sent;
      policy.emailIntegration.findFirst = async () => null;
      const delivery = createUpsellDelivery({ db, client: { callConversationTool: async () => ({ structuredContent: { products: [{ product_id: 'wine', name: 'Wine in room', unit_amount: 30, currency: 'EUR' }] } }) }, sendEmail: async () => assert.fail('No email provider'), sendWhatsApp: async args => { sent = args; return { success: true, messageId: 'provider-id' }; } });
      assert.equal((await delivery.send({ hotelId: 'h', conversationId: 'wa-conv', source: 'campaign' })).status, 'sent');
      assert.equal(sent.template.name, 'extras'); assert.match(sent.template.components[0].parameters[0].text, /30 EUR/);
      assert.equal((await prisma.upsellOutreach.findFirst()).messageId, 'm-wa-provider-id');
      assert.equal((await prisma.message.findUnique({ where: { id: 'm-wa-provider-id' } })).deliveryStatus, 'sent');
      policy.emailIntegration.findFirst = async () => ({ status: 'connected' });
    });
    await t.test('quote delivery claim prevents a race between staff and AI', async () => {
      await reset();
      await prisma.pmsUpsellOffer.create({ data: { id: 'abcdef123456', hotelId: 'h', conversationId: 'email-conv', bindingVerifiedAt: new Date(), reservationId: 'reservation', customerId: 'pms-guest', productId: 'wine', serviceId: 'service', name: 'Wine', category: 'wine', priceSource: 'pms', priceHash: 'hash', quantity: 1, unitAmount: 30, totalAmount: 30, currency: 'EUR', taxCodes: [], consumptionUtc: new Date(), requestKey: 'test', expiresAt: new Date(Date.now() + 3600000) } });
      const results = await Promise.all(['ai', 'staff'].map(id => reserveQuoteDelivery(db, 'h', 'email-conv', 'abcdef123456', id)));
      assert.equal(results.filter(Boolean).length, 1);
    });
  } finally { await prisma.$disconnect(); }
});
