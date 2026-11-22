import { randomBytes, randomUUID } from 'node:crypto';
import { contactLock, replyTokenHash } from './guestContactRecognition.js';
import { transaction, upsellLock, eligibleProducts, pricedProducts, invitationText, contactDetails } from '../upsells/upsellOutreach.js';
import { dueForUpsell, defaultUpsellConfig } from '../upsells/upsellDelivery.js';

export function safeWelcomeUrl(value) {
  if (!value) return '';
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export function welcomeText({ stage, hotel, customer, stay, config, verified, extras = '' }) {
  const date = value => new Intl.DateTimeFormat('en-GB', { timeZone: hotel.timezone, dateStyle: 'long' }).format(new Date(value));
  const time = value => new Intl.DateTimeFormat('en-GB', { timeZone: hotel.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
  const name = String(customer.FirstName || '').replace(/[\r\n]/g, ' ').trim();
  if (stage === 'checkin' && !verified) return `Welcome to ${hotel.name}!\n\nReply here for hotel information or assistance. For reservation-specific help, reply to this email in the same thread, or reply VERIFY on WhatsApp so we can securely connect your stay.\n\nEnjoy your stay!\n${hotel.name} team`;
  if (stage === 'checkin') return `Dear ${name || 'guest'},\nWelcome to ${hotel.name}!\n\nYour checkout is on ${date(stay.ScheduledEndUtc)} by ${time(stay.ScheduledEndUtc)}.\n\nDuring your stay, simply reply here for hotel information or assistance. We are happy to help.\n\nEnjoy your stay!\n${hotel.name} team`;
  const lines = [`Dear ${name || 'guest'},`, `Thank you for booking ${hotel.name}. We look forward to welcoming you on ${date(stay.ScheduledStartUtc)}.`,
    '', `Check-in is available from ${hotel.checkIn}.`, config.arrivalInstructions || ''];
  if (safeWelcomeUrl(config.onlineCheckinUrl)) lines.push('', `Online check-in: ${safeWelcomeUrl(config.onlineCheckinUrl)}`);
  if (extras) lines.push('', extras);
  else if (safeWelcomeUrl(config.catalogueUrl)) lines.push('', `Explore extras for your stay: ${safeWelcomeUrl(config.catalogueUrl)}`);
  lines.push('', 'Reply here if you have any questions.', `${hotel.name} team`);
  return lines.filter((line, index, all) => line || all[index - 1]).join('\n');
}
export function createGuestWelcome({ db, client, sendEmail, sendWhatsApp, now = () => new Date() }) {
  async function conversation(hotelId, stay, customer) {
    const guestId = `g-welcome-${hotelId}-${stay.AccountId}`, id = `conv-welcome-${hotelId}-${stay.Id}`;
    const details = { name: [customer.FirstName, customer.LastName].filter(Boolean).join(' ') || 'Guest', email: customer.Email || null, phone: customer.Phone || null };
    await db.guest.upsert({ where: { id: guestId }, create: { id: guestId, hotelId, mewsId: stay.AccountId, ...details, country: '', language: customer.LanguageCode || 'en' }, update: details });
    return db.conversation.upsert({ where: { id }, create: { id, guestId, stage: stay.State === 'Started' ? 'In-house' : 'Pre-arrival', primaryChannel: 'email', aiStatus: 'ai-handling', sentiment: 'neutral',
      subject: 'Welcome to your hotel', summary: '', suggestedReply: '', unread: 0, lastAt: now().toISOString() }, update: {} });
  }
  async function extrasFor({ config, stay, customer, hotel, conv, actor, messageId }) {
    if (!config.welcomeUpsells) return [];
    const campaign = await db.upsellAutomationConfig.findUnique({ where: { hotelId: config.hotelId } }) || defaultUpsellConfig;
    const arrival = new Intl.DateTimeFormat('en-CA', { timeZone: hotel.timezone }).format(new Date(stay.ScheduledStartUtc));
    if (!dueForUpsell({ status: 'Confirmed', arrival }, campaign, now(), hotel.timezone)) return [];
    const products = await pricedProducts(db, client, { hotelId: config.hotelId, conversationId: conv.id }, { preArrival: true, staff: actor });
    return transaction(db, async tx => {
      await upsellLock(tx, config.hotelId);
      const ai = await tx.aiConfig.findUnique({ where: { hotelId: config.hotelId } });
      const rule = await tx.aiRule.findFirst({ where: { hotelId: config.hotelId, topic: 'Upsells' } });
      if (hotel.aiMode !== 'Autonomous' || ai?.autoReply === false || (rule && rule.mode !== 'Autonomous') || customer.Classifications?.includes('VIP')) return [];
      const contacts = contactDetails({ email: customer.Email, phone: customer.Phone });
      const related = await tx.conversation.findMany({ where: { guest: { hotelId: config.hotelId }, OR: [{ id: conv.id }, { guest: { mewsId: stay.AccountId } },
        ...(contacts.email ? [{ guest: { email: contacts.email } }, { guest: { tags: { contains: contacts.email } } }] : []),
        ...(contacts.phone ? [{ id: `conv-wa-${config.hotelId}-${contacts.phone}` }, { guest: { phone: { in: [contacts.phone, `+${contacts.phone}`] } } }, { guest: { tags: { contains: contacts.phone } } }] : []),
      ] } });
      if (related.some(c => ['human-takeover', 'escalated'].includes(c.aiStatus))) return [];
      const eligible = (await eligibleProducts(tx, { hotelId: config.hotelId, reservation: { mewsId: stay.Id, createdAt: new Date(stay.CreatedUtc) }, conversationIds: related.map(c => c.id) }, products)).slice(0, 3);
      for (const p of eligible) await tx.upsellOutreach.create({ data: { id: randomUUID(), hotelId: config.hotelId, reservationId: stay.Id,
        productId: p.productId, conversationId: conv.id, source: 'welcome', messageId, name: p.label, unitAmount: p.unitAmount, currency: p.currency, status: 'sending' } });
      return eligible;
    });
  }
  async function send({ config, reader, stage, stay, customer, contact, actor }) {
    const hotelId = config.hotelId;
    const hotel = await db.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) throw new Error('Hotel unavailable');
    const sender = stage === 'confirmation' ? config.confirmationSender : config.checkinSender;
    if (sender !== 'hotelogx') return { status: 'external', reason: 'Welcome handled by PMS or staff' };
    const proof = await db.guestContactVerification.findFirst({ where: { hotelId, reservationId: stay.Id, customerId: stay.AccountId,
      channel: contact.channel, contact: contact.contact, revokedAt: null, expiresAt: { gt: now() } } });
    const template = stage === 'confirmation' ? config.bookingWelcomeTemplate : config.checkinWelcomeTemplate;
    if (contact.channel === 'whatsapp' && !template) return { status: 'review', reason: 'Configure an approved welcome template for this stage' };
    const conv = await conversation(hotelId, stay, customer);
    const id = randomUUID(), messageId = `m-welcome-${id}`, replyToken = randomBytes(16).toString('hex').toUpperCase();
    const row = await transaction(db, async tx => {
      await contactLock(tx, hotelId);
      const current = await tx.guestMessagingConfig.findUnique({ where: { hotelId } });
      if (!current?.automaticEnabled || !current.welcomeEnabled || (stage === 'confirmation' ? current.confirmationSender : current.checkinSender) !== 'hotelogx') return null;
      const existing = await tx.guestWelcome.findUnique({ where: { hotelId_reservationId_stage: { hotelId, reservationId: stay.Id, stage } } });
      if (existing) return { duplicate: true, ...existing };
      if (stage === 'checkin' && await tx.guestMessagingInvite.findFirst({ where: { hotelId, reservationId: stay.Id } })) return { duplicate: true, status: 'existing_invitation' };
      return tx.guestWelcome.create({ data: { id, hotelId, reservationId: stay.Id, customerId: stay.AccountId, stage, ...contact,
        recordedBy: actor.id, conversationId: conv.id, messageId, expiresAt: new Date(stay.ScheduledEndUtc),
        replyTokenHash: contact.channel === 'email' ? replyTokenHash(replyToken) : null } });
    });
    if (!row) return { status: 'disabled' };
    if (row.duplicate) return { status: ['sending', 'uncertain', 'failed'].includes(row.status) ? 'review' : 'already_handled', reason: `Welcome already recorded: ${row.status}` };
    let products = [];
    // A catalogue failure must not erase the booking welcome. Claims, when
    // present, remain authoritative even if delivery later becomes uncertain.
    if (stage === 'confirmation') { try { products = await extrasFor({ config, stay, customer, hotel, conv, actor, messageId }); } catch {} }
    let body = welcomeText({ stage, hotel, customer, stay, config, verified: Boolean(proof), extras: products.length ? invitationText(products) : '' });
    await db.message.create({ data: { id: messageId, conversationId: conv.id, author: 'ai', channel: contact.channel, body, at: now().toISOString(), deliveryStatus: 'pending' } });
    let result;
    try {
      const fresh = await reader.reservation(stay.Id);
      const latestConfig = await db.guestMessagingConfig.findUnique({ where: { hotelId } });
      if (!latestConfig?.automaticEnabled || !latestConfig.welcomeEnabled || !fresh || fresh.AccountId !== stay.AccountId || fresh.State !== stay.State
        || (stage === 'confirmation' ? latestConfig.confirmationSender : latestConfig.checkinSender) !== 'hotelogx'
        || fresh.ActualEndUtc || new Date(fresh.ScheduledEndUtc) <= now()) throw Object.assign(new Error('Reservation or settings changed'), { definitelyNotSent: true });
      const freshCustomer = await reader.customer(stay.AccountId);
      const freshContacts = contactDetails({ email: freshCustomer?.Email, phone: freshCustomer?.Phone });
      if (!freshCustomer || freshCustomer.HasOtaEmail || (contact.channel === 'email' ? freshContacts.email : `+${freshContacts.phone}`) !== contact.contact) throw Object.assign(new Error('Guest contact changed'), { definitelyNotSent: true });
      const freshProof = await db.guestContactVerification.findFirst({ where: { hotelId, reservationId: stay.Id, customerId: stay.AccountId,
        channel: contact.channel, contact: contact.contact, revokedAt: null, expiresAt: { gt: now() } } });
      body = welcomeText({ stage, hotel, customer: freshCustomer, stay: fresh, config: latestConfig, verified: Boolean(freshProof), extras: products.length ? invitationText(products) : '' });
      await db.message.update({ where: { id: messageId }, data: { body } });
      await db.guestWelcome.update({ where: { id }, data: { expiresAt: new Date(fresh.ScheduledEndUtc) } });
      if (contact.channel === 'whatsapp' && body.replace(/\s+/g, ' ').length > 1000) throw Object.assign(new Error('Welcome is too long for the template; shorten arrival instructions'), { definitelyNotSent: true });
      result = contact.channel === 'email' ? await sendEmail({ hotelId, toEmail: contact.contact, conversationId: conv.id, recordMessage: false,
        subject: `${stage === 'confirmation' ? 'Your booking' : 'Welcome'} - ${hotel.name} [HX-${replyToken}]`, text: body })
        : await sendWhatsApp({ hotelId, targetType: 'guest', to: contact.contact, template: { name: template, language: { code: config.whatsappLanguage },
          components: [{ type: 'body', parameters: [{ type: 'text', text: body.replace(/\s+/g, ' ').trim() }] }] } });
    } catch (error) { result = { success: false, uncertain: !error.definitelyNotSent }; }
    const status = result?.success && result.dispatched !== false ? 'sent' : result?.uncertain === false ? 'failed' : 'uncertain';
    await db.guestWelcome.update({ where: { id }, data: { status, providerMessageId: result?.messageId || null } });
    await db.message.update({ where: { id: messageId }, data: { deliveryStatus: status } });
    await db.upsellOutreach.updateMany({ where: { hotelId, messageId }, data: { status } });
    await db.conversation.update({ where: { id: conv.id }, data: { lastAt: now().toISOString(), primaryChannel: contact.channel } });
    return { status, reason: `Welcome: ${status}` };
  }
  async function recordExternal(actor, input) {
    if (!['confirmation', 'checkin'].includes(input.stage) || !input.reservationId || !['manager', 'front-office'].includes(actor.role)) throw new Error('Choose reservation and welcome stage');
    return transaction(db, async tx => {
      await contactLock(tx, actor.hotelId);
      const previous = await tx.guestWelcome.findUnique({ where: { hotelId_reservationId_stage: { hotelId: actor.hotelId, reservationId: input.reservationId, stage: input.stage } } });
      if (previous) return previous;
      return tx.guestWelcome.create({ data: { hotelId: actor.hotelId, reservationId: input.reservationId, customerId: input.customerId,
        stage: input.stage, channel: 'external', contact: '', source: 'staff_recorded', recordedBy: actor.id, status: 'external', expiresAt: input.expiresAt } });
    });
  }
  return { send, recordExternal };
}
