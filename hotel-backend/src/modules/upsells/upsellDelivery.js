import { claimOutreach, contactDetails, invitationText, pricedProducts, outreachContext } from './upsellOutreach.js';

export const defaultUpsellConfig = { enabled: false, daysBeforeArrival: 3, channel: 'email_first', whatsappTemplate: '', whatsappLanguage: 'en_US' };
export function dueForUpsell(reservation, config, now = new Date(), timezone = 'UTC') {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const delta = (Date.parse(`${reservation.arrival}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
  // Include late bookings inside the configured window; never chase guests after arrival.
  return reservation.status === 'Confirmed' && delta >= 0 && delta <= config.daysBeforeArrival;
}
export function createUpsellDelivery({ db, client, sendEmail, sendWhatsApp, broadcast = () => {}, now = () => new Date() }) {
  async function send({ hotelId, conversationId, productIds, source = 'staff', reservationId, channel, config, text }) {
    const context = await outreachContext(db, hotelId, conversationId, reservationId);
    const contacts = contactDetails(context.conversation.guest);
    config ||= await db.upsellAutomationConfig.findUnique({ where: { hotelId } }) || defaultUpsellConfig;
    const emailConnected = contacts.email && await db.emailIntegration.findFirst({ where: { hotelId, status: 'connected' } });
    channel ||= config.channel === 'whatsapp' ? 'whatsapp' : emailConnected ? 'email' : config.channel === 'email_first' ? 'whatsapp' : 'email';
    if (channel === 'email' && !emailConnected) throw new Error('A connected mailbox and guest email are required');
    if (channel === 'whatsapp' && !contacts.phone) throw new Error('A guest WhatsApp number is required');
    const recentInbound = channel === 'whatsapp' && source === 'staff' ? await db.message.findFirst({ where: { conversationId, author: 'guest', channel: 'whatsapp', createdAt: { gt: new Date(+now() - 24 * 3600000) } } }) : null;
    // Campaigns always use an approved template. Staff may reply inside an active service window.
    const needsTemplate = channel === 'whatsapp' && !recentInbound;
    if (needsTemplate && !config.whatsappTemplate) throw new Error('Configure an approved WhatsApp upsell template before sending outside an active conversation');
    if (!['email', 'whatsapp'].includes(channel)) throw new Error('Choose email or WhatsApp');
    const products = await pricedProducts(db, client, { hotelId, conversationId }, { preArrival: source === 'campaign', text });
    const selected = productIds ? products.filter(p => productIds.includes(p.productId)) : products;
    if (!selected.length) return { status: 'skipped', reason: 'No eligible priced catalogue products' };
    const claim = await claimOutreach(db, { hotelId, conversationId, reservationId, products: selected, source, automatic: source !== 'staff' });
    if (!claim.products.length) return { status: 'skipped', reason: 'Already offered, or automation is paused for this guest' };
    const body = invitationText(claim.products);
    const at = now().toISOString();
    await db.message.create({ data: { id: claim.messageId, conversationId, author: source === 'staff' ? 'staff' : 'ai', channel, body, at, deliveryStatus: 'pending' } });
    await db.upsellOutreach.updateMany({ where: { hotelId, messageId: claim.messageId }, data: { status: 'sending' } });
    let result;
    try {
      result = channel === 'email'
        ? await sendEmail({ hotelId, conversationId, toEmail: contacts.email, subject: 'Extras for your upcoming stay', text: body, author: source === 'staff' ? 'staff' : 'ai', recordMessage: false })
        : await sendWhatsApp({ hotelId, targetType: 'guest', to: contacts.phone, text: body,
          ...(needsTemplate ? { template: { name: config.whatsappTemplate, language: { code: config.whatsappLanguage }, components: [{ type: 'body', parameters: [{ type: 'text', text: claim.products.map(p => `${p.label}: ${p.unitAmount} ${p.currency} per unit`).join('; ') }] }] } } : {}) });
    } catch (error) { result = { success: false, uncertain: !error.definitelyNotSent, error: error.message }; }
    const status = result?.success && result.dispatched !== false ? 'sent' : result?.uncertain === false ? 'failed' : 'uncertain';
    const deliveredId = channel === 'whatsapp' && status === 'sent' && result.messageId ? `m-wa-${result.messageId}` : claim.messageId;
    await db.message.update({ where: { id: claim.messageId }, data: { id: deliveredId, deliveryStatus: status } });
    await db.upsellOutreach.updateMany({ where: { hotelId, messageId: claim.messageId }, data: { messageId: deliveredId, status, lastError: status === 'sent' ? null : 'Delivery was not confirmed; review before contacting the guest' } });
    await db.conversation.update({ where: { id: conversationId }, data: { lastAt: at } });
    broadcast(hotelId, 'conversation:updated', { conversationId, channel });
    return { status, messageId: deliveredId };
  }
  async function runHotel(hotelId) {
    const config = await db.upsellAutomationConfig.findUnique({ where: { hotelId } });
    if (!config?.enabled) return { sent: 0, skipped: 0, failed: 0 };
    const hotel = await db.hotel.findUnique({ where: { id: hotelId } });
    const ai = await db.aiConfig.findUnique({ where: { hotelId } });
    if (hotel?.aiMode !== 'Autonomous' || ai?.autoReply === false) return { sent: 0, skipped: 0, failed: 0 };
    const manager = await db.user.findFirst({ where: { id: config.updatedBy, hotelId, role: 'manager' } });
    if (!manager) return { sent: 0, skipped: 0, failed: 1 };
    const reservations = await db.reservation.findMany({ where: { hotelId, status: 'Confirmed', mewsId: { not: null } }, include: { guest: true }, orderBy: { arrival: 'asc' } });
    const counts = { sent: 0, skipped: 0, failed: 0 };
    for (const reservation of reservations) {
      if (!dueForUpsell(reservation, config, now(), hotel.timezone) || reservation.guest.vip) continue;
      try {
        if (await db.upsellOutreach.findFirst({ where: { hotelId, reservationId: reservation.mewsId, source: 'campaign' } })) { counts.skipped++; continue; }
        const response = await client.callTool(manager, 'get_reservations', { reservation_ids: [reservation.mewsId] });
        if (response.isError) throw new Error('Reservation check failed');
        const live = response.structuredContent || JSON.parse(response.content?.find(c => c.type === 'text')?.text || '{}');
        const current = live.Reservations?.find(r => r.Id === reservation.mewsId);
        if (!current || current.State !== 'Confirmed' || current.AccountType !== 'Customer' || current.AccountId !== (reservation.guest.mewsId || reservation.guest.id)) { counts.skipped++; continue; }
        const arrival = current.ScheduledStartUtc || current.StartUtc;
        if (!arrival || !dueForUpsell({ status: 'Confirmed', arrival: new Intl.DateTimeFormat('en-CA', { timeZone: hotel.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(arrival)) }, config, now(), hotel.timezone)) { counts.skipped++; continue; }
        const contacts = contactDetails(reservation.guest);
        if (!contacts.email && !contacts.phone) { counts.skipped++; continue; }
        const id = `conv-upsell-${hotelId}-${reservation.mewsId}`;
        await db.conversation.upsert({ where: { id }, update: {}, create: { id, guestId: reservation.guestId, stage: 'Pre-arrival', primaryChannel: contacts.email ? 'email' : 'whatsapp', aiStatus: 'ai-handling', sentiment: 'neutral', subject: 'Extras for your upcoming stay', summary: '', suggestedReply: '', lastAt: now().toISOString() } });
        const result = await send({ hotelId, conversationId: id, reservationId: reservation.mewsId, source: 'campaign', config });
        if (result.status === 'sent') counts.sent++; else if (result.status === 'skipped') counts.skipped++; else counts.failed++;
      } catch { counts.failed++; }
    }
    return counts;
  }
  return { send, runHotel };
}
