import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rememberGuestContact } from './guestContactRecognition.js';

export const checkinMethod = 'staff-checkin-code';
const fail = message => { throw Object.assign(new Error(message), { publicMessage: message, status: 409 }); };
const digest = code => createHash('sha256').update(code.toUpperCase()).digest('hex');
const transaction = (db, fn) => typeof db.$transaction === 'function' ? db.$transaction(fn, { timeout: 30000 }) : fn(db);
async function lock(db, hotelId) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`guest-messaging:${hotelId}`}))`;
}
export function normalizeMessagingContact(channel, contact) {
  if (typeof contact !== 'string') fail('Enter the guest contact details');
  const value = channel === 'email' ? contact.trim().toLowerCase() : contact.replace(/[\s().-]/g, '').replace(/^00/, '+');
  if (!(channel === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
    : channel === 'whatsapp' && /^\+[1-9]\d{7,14}$/.test(value))) fail('Enter a valid email address or international WhatsApp number');
  return value;
}
// Email clients append signatures/quoted history. Only the first nonempty line
// is a command; never extract a code from quoted invitation text.
export function checkinCode(text = '') { return /^CONNECT[ \t]+([a-f0-9]{24})[ \t]*$/i.exec(text.trimStart().split(/\r?\n/)[0])?.[1]?.toUpperCase() || null; }
export const isCheckinCodeMessage = (text = '') => /^\s*CONNECT(?:[ \t]+[a-z0-9]{12,64})?[ \t]*(?:\r?\n|$)/i.test(text);
export function publicInvite({ codeHash, ...row }) { return row; }
export function checkinRoomDecision(binding, suppliedRoom) {
  if (!binding?.currentRoom) return { replyText: 'I could not confirm your current room in Mews. Please ask Front Office to check your messaging connection before we arrange delivery.' };
  if (suppliedRoom && suppliedRoom !== 'not provided' && String(suppliedRoom) !== String(binding.currentRoom)) return {
    replyText: 'The room you mentioned does not match your checked-in reservation. Please ask Front Office to confirm the room or update your reservation before we arrange delivery.',
  };
  return { room: binding.currentRoom };
}

export function createGuestMessaging({ db, client, sendEmail, sendWhatsApp, now = () => new Date(), makeCode = () => randomBytes(12).toString('hex').toUpperCase() }) {
  async function liveStay(actor, reservationId) {
    if (!actor?.hotelId || !['manager', 'front-office'].includes(actor.role)) fail('Front Office or manager access required');
    const result = await client.callTool(actor, 'get_reservations', { reservation_ids: [reservationId] });
    if (result.isError) fail('Could not check the reservation in Mews. Try again after checking the connection');
    const data = result.structuredContent || JSON.parse(result.content?.find(c => c.type === 'text')?.text || '{}');
    const stay = data.Reservations?.find(r => r.Id === reservationId);
    if (!stay || stay.State !== 'Started' || stay.ActualEndUtc || stay.AccountType !== 'Customer' || !stay.AccountId || !stay.AssignedResourceId
      || !(new Date(stay.ScheduledEndUtc) > now())) fail('The reservation must be checked in with an assigned room and a future checkout time in Mews');
    return stay;
  }
  async function actorFor(row) {
    const actor = await db.user.findFirst({ where: { id: row.issuedBy || row.verifiedBy, hotelId: row.hotelId, role: { in: ['manager', 'front-office'] } } });
    if (!actor) fail('A Front Office colleague must reconnect guest messaging');
    return actor;
  }
  async function issue(actor, input, automatic = false) {
    if (!automatic && input.contactConfirmed !== true) fail('Confirm that this contact belongs to the checked-in guest');
    if (typeof input.reservationId !== 'string' || !input.reservationId || input.reservationId.length > 100) fail('Choose a reservation');
    const contact = normalizeMessagingContact(input.channel, input.contact);
    const stay = await liveStay(actor, input.reservationId);
    if (automatic && stay.AccountId !== input.expectedCustomerId) fail('Reservation owner changed; review guest contact');
    const config = await db.guestMessagingConfig.findUnique({ where: { hotelId: actor.hotelId } });
    if (input.channel === 'whatsapp' && !config?.whatsappTemplate) fail('Configure an approved WhatsApp invitation template first, or choose email');
    const code = makeCode();
    const row = await transaction(db, async tx => {
      await lock(tx, actor.hotelId);
      if (automatic) {
        const current = await tx.guestMessagingConfig.findUnique({ where: { hotelId: actor.hotelId } });
        if (!current?.automaticEnabled) fail('Automatic invitations are disabled');
        // Permanent reservation-level suppression: expiry, revocation, uncertain
        // delivery, different channels and repeated events never auto-resend.
        const sent = await tx.guestMessagingInvite.findFirst({ where: { hotelId: actor.hotelId, reservationId: stay.Id } });
        const bound = await tx.pmsConversationBinding.findFirst({ where: { hotelId: actor.hotelId, reservationId: stay.Id,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now() } }] } });
        if (sent || bound) return { suppressed: true, status: 'already_handled' };
      }
      const previous = await tx.guestMessagingInvite.findFirst({ where: { hotelId: actor.hotelId, reservationId: stay.Id, channel: input.channel, contact,
        revokedAt: null, OR: [{ createdAt: { gt: new Date(+now() - 60000) } }, { status: 'redeemed' }, { expiresAt: { gt: now() }, status: { in: ['sending', 'sent', 'uncertain'] } }] } });
      if (previous) fail('An invitation or connection already exists for this contact. Review or revoke it before sending another');
      return tx.guestMessagingInvite.create({ data: { hotelId: actor.hotelId, reservationId: stay.Id, customerId: stay.AccountId, channel: input.channel,
        contact, codeHash: digest(code), issuedBy: actor.id, source: automatic ? 'automatic' : 'staff', expiresAt: new Date(Math.min(+now() + 600000, +new Date(stay.ScheduledEndUtc))) } });
    });
    if (row.suppressed) return row;
    let delivery;
    try {
      delivery = input.channel === 'email' ? await sendEmail({ hotelId: actor.hotelId, toEmail: contact, subject: 'Connect your hotel guest messaging', recordMessage: false,
        text: `Welcome! Your hotel stay is checked in. To connect guest messaging, reply to this email with only:\n\nCONNECT ${code}\n\nThis single-use code expires in 10 minutes. Keep it private. If this is not your stay, please contact Front Office.` })
        : await sendWhatsApp({ hotelId: actor.hotelId, targetType: 'guest', to: contact, template: { name: config.whatsappTemplate, language: { code: config.whatsappLanguage },
          components: [{ type: 'body', parameters: [{ type: 'text', text: `CONNECT ${code}` }] }] } });
    } catch { delivery = { success: false, uncertain: true }; }
    // A transport timeout must never cause an automatic second invitation.
    const status = delivery?.success ? 'sent' : delivery?.uncertain ? 'uncertain' : 'failed';
    await db.guestMessagingInvite.updateMany({ where: { id: row.id, status: 'sending', revokedAt: null }, data: { status, providerMessageId: delivery?.messageId || null } });
    return publicInvite(await db.guestMessagingInvite.findUnique({ where: { id: row.id } }));
  }
  async function redeem(ctx, text) {
    const code = checkinCode(text);
    const invalid = 'This connection code is invalid, expired or already used. Ask Front Office for a new invitation and reply with only CONNECT followed by the code.';
    if (!code) return invalid;
    const row = await db.guestMessagingInvite.findFirst({ where: { hotelId: ctx.hotelId, codeHash: digest(code), revokedAt: null } });
    if (!row || !(row.expiresAt > now())) return invalid;
    const message = await db.message.findFirst({ where: { conversationId: ctx.conversationId, author: 'guest', ...(ctx.messageId ? { id: ctx.messageId } : {}) }, orderBy: { createdAt: 'desc' } });
    const conversation = await db.conversation.findFirst({ where: { id: ctx.conversationId, guest: { hotelId: ctx.hotelId } }, include: { guest: true } });
    if (!conversation || !message || message.body.trim() !== text.trim() || message.channel !== row.channel) return invalid;
    // The code proves possession; the destination check prevents forwarding it to a different sender.
    const senderMatches = row.channel === 'whatsapp' ? ctx.conversationId === `conv-wa-${ctx.hotelId}-${row.contact.slice(1)}`
      : ctx.sender?.trim().toLowerCase() === row.contact;
    if (!senderMatches) return invalid;
    if (row.status === 'redeemed') return row.conversationId === ctx.conversationId && row.sourceMessageId === message.id ? 'Your guest messaging is connected for this stay.' : invalid;
    if (!['sent', 'sending', 'uncertain'].includes(row.status)) return invalid;
    let stay;
    try { stay = await liveStay(await actorFor(row), row.reservationId); } catch { return 'I could not confirm an active checked-in stay. Front Office can check your reservation and reconnect messaging.'; }
    if (stay.AccountId !== row.customerId) return invalid;
    return transaction(db, async tx => {
      await lock(tx, ctx.hotelId);
      const redeemedAt = now();
      const changed = await tx.guestMessagingInvite.updateMany({ where: { id: row.id, revokedAt: null, expiresAt: { gt: now() }, status: { in: ['sent', 'sending', 'uncertain'] } },
        data: { status: 'redeemed', redeemedAt, conversationId: ctx.conversationId, sourceMessageId: message.id } });
      if (changed.count !== 1) return invalid;
      const binding = { hotelId: ctx.hotelId, reservationId: stay.Id, customerId: stay.AccountId, verifiedBy: row.issuedBy, verifiedAt: redeemedAt,
        expiresAt: new Date(stay.ScheduledEndUtc), verificationMethod: checkinMethod, checkinInviteId: row.id };
      await tx.pmsConversationBinding.upsert({ where: { conversationId: ctx.conversationId }, create: { conversationId: ctx.conversationId, ...binding }, update: binding });
      if (tx.guestContactVerification) await rememberGuestContact(tx, { hotelId: ctx.hotelId, reservationId: stay.Id, customerId: stay.AccountId,
        channel: row.channel, contact: row.contact, conversationId: ctx.conversationId, inviteId: row.id, method: 'checkin-code', verifiedBy: row.issuedBy, expiresAt: new Date(stay.ScheduledEndUtc) });
      // Close any older, incomplete self-service verification questions.
      await tx.pmsGuestVerification.deleteMany({ where: { hotelId: ctx.hotelId, conversationId: ctx.conversationId } });
      return 'Your guest messaging is connected for this stay. You can now send requests without repeating your room number. Please send your request in your next message.';
    });
  }
  async function revoke(actor, id) {
    return transaction(db, async tx => {
      await lock(tx, actor.hotelId);
      const row = await tx.guestMessagingInvite.findFirst({ where: { id, hotelId: actor.hotelId } });
      if (!row) fail('Invitation not found');
      if (tx.guestContactVerification) {
        const proofs = await tx.guestContactVerification.findMany({ where: { hotelId: actor.hotelId, inviteId: row.id } });
        await tx.guestContactVerification.updateMany({ where: { hotelId: actor.hotelId, inviteId: row.id }, data: { revokedAt: now() } });
        await tx.pmsConversationBinding.deleteMany({ where: { hotelId: actor.hotelId, contactVerificationId: { in: proofs.map(p => p.id) } } });
      }
      if (row.conversationId) await tx.pmsConversationBinding.deleteMany({ where: { hotelId: actor.hotelId, conversationId: row.conversationId,
        reservationId: row.reservationId, verificationMethod: checkinMethod, checkinInviteId: row.id } });
      return publicInvite(await tx.guestMessagingInvite.update({ where: { id }, data: { status: 'revoked', revokedAt: now(), revokedBy: actor.id } }));
    });
  }
  async function currentBinding(ctx, binding) {
    if (!binding || binding.verificationMethod !== checkinMethod) return binding;
    if (!binding.expiresAt || binding.expiresAt <= now() || !binding.checkinInviteId) return null;
    try {
      const invite = await db.guestMessagingInvite.findFirst({ where: { id: binding.checkinInviteId, hotelId: ctx.hotelId, conversationId: ctx.conversationId,
        reservationId: binding.reservationId, redeemedAt: binding.verifiedAt, status: 'redeemed', revokedAt: null } });
      if (!invite) return null;
      const latest = await db.message.findFirst({ where: { conversationId: ctx.conversationId, author: 'guest' }, orderBy: { createdAt: 'desc' } });
      if (!latest || latest.channel !== invite.channel) return null;
      if (invite.channel === 'email') {
        const provider = [['m-gmail-', 'gmailInboundMessage'], ['m-microsoft-', 'microsoftInboundMessage'], ['m-imap-', 'imapInboundMessage']].find(([prefix]) => latest.id.startsWith(prefix));
        if (!provider) return null;
        const receipt = await db[provider[1]].findFirst({ where: { id: latest.id.slice(provider[0].length), hotelId: ctx.hotelId, conversationId: ctx.conversationId } });
        if (receipt?.sender?.toLowerCase() !== invite.contact) return null;
      } else if (ctx.conversationId !== `conv-wa-${ctx.hotelId}-${invite.contact.slice(1)}`) return null;
      const stay = await liveStay(await actorFor(binding), binding.reservationId);
      if (stay.AccountId !== binding.customerId) return null;
      const room = await db.room.findFirst({ where: { hotelId: ctx.hotelId, mewsId: stay.AssignedResourceId } });
      return { ...binding, currentRoom: room?.number || null };
    } catch { return null; } // PMS unavailability never falls back to an old room.
  }
  return { issue: (actor, input) => issue(actor, input), issueAutomatic: (actor, input) => issue(actor, input, true), redeem, revoke, currentBinding, liveStay };
}

export async function captureGuestMessagingCode(db, ctx, service) {
  if (!service) {
    const { guestMessagingFor } = await import('./guestMessagingRuntime.js');
    service = guestMessagingFor(db);
  }
  const replyText = await service.redeem(ctx, ctx.messageText);
  const conversation = await db.conversation.findFirst({ where: { id: ctx.conversationId, guest: { hotelId: ctx.hotelId } } });
  if (!conversation) return null;
  const hotel = await db.hotel.findUnique({ where: { id: ctx.hotelId } });
  const config = await db.aiConfig.findUnique({ where: { hotelId: ctx.hotelId } });
  const requiresApproval = hotel?.aiMode !== 'Autonomous' || config?.autoReply === false || !['ai-handling', 'escalated'].includes(conversation.aiStatus);
  const incoming = await db.message.findFirst({ where: { conversationId: ctx.conversationId, author: 'guest' }, orderBy: { createdAt: 'desc' } });
  const message = requiresApproval ? null : await db.message.create({ data: { id: `m-info-${randomUUID()}`, conversationId: ctx.conversationId,
    author: 'ai', channel: incoming?.channel || conversation.primaryChannel, body: replyText, at: nowTime(), deliveryStatus: 'pending' } });
  return { handled: true, type: 'guest_messaging', requiresApproval, aiStatus: conversation.aiStatus, replyText, suggestedReply: replyText, message };
}
const nowTime = () => new Date().toISOString();
