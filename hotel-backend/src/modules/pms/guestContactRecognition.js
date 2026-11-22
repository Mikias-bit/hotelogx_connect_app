import { createHash } from 'node:crypto';

export const contactBindingMethod = 'verified-stay-contact';
export const replyTokenHash = token => createHash('sha256').update(token.toUpperCase()).digest('hex');
const txRun = (db, fn) => db.$transaction ? db.$transaction(fn, { timeout: 30000 }) : fn(db);
export const contactLock = (db, hotelId) => db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`guest-messaging:${hotelId}`}))`;
const normalPhone = text => { const digits = String(text || '').replace(/[\s().-]/g, '').replace(/^00/, '+'); return /^\+?[1-9]\d{7,14}$/.test(digits) ? `+${digits.replace(/^\+/, '')}` : null; };
export async function storedGuestSender(db, ctx) {
  const conversation = await db.conversation.findFirst({ where: { id: ctx.conversationId, guest: { hotelId: ctx.hotelId } } });
  if (!conversation) return null;
  const message = await db.message.findFirst({ where: { conversationId: ctx.conversationId, author: 'guest', ...(ctx.messageId ? { id: ctx.messageId } : {}) }, orderBy: { createdAt: 'desc' } });
  if (!message) return null;
  if (message.channel === 'whatsapp') {
    const prefix = `conv-wa-${ctx.hotelId}-`;
    if (!ctx.conversationId.startsWith(prefix) || !/^\d{8,15}$/.test(ctx.conversationId.slice(prefix.length))) return null;
    return { channel: 'whatsapp', contact: `+${ctx.conversationId.slice(prefix.length)}`, message };
  }
  const provider = [['m-gmail-', 'gmailInboundMessage'], ['m-microsoft-', 'microsoftInboundMessage'], ['m-imap-', 'imapInboundMessage']].find(([prefix]) => message.id.startsWith(prefix));
  if (message.channel !== 'email' || !provider) return null;
  const receipt = await db[provider[1]].findFirst({ where: { id: message.id.slice(provider[0].length), hotelId: ctx.hotelId, conversationId: ctx.conversationId } });
  if (!receipt?.sender) return null;
  return { channel: 'email', contact: receipt.sender.trim().toLowerCase(), subject: receipt.subject || '', message };
}

export async function rememberGuestContact(db, input) {
  const { hotelId, reservationId, channel, contact } = input;
  return db.guestContactVerification.upsert({ where: { hotelId_reservationId_channel_contact: { hotelId, reservationId, channel, contact } },
    create: input, update: { ...input, inviteId: input.inviteId || null, revokedAt: null, verifiedAt: new Date() } });
}

export function createContactRecognition({ db, readerFor, now = () => new Date() }) {
  async function liveProof(proof, reader) {
    if (!proof || proof.revokedAt || proof.expiresAt <= now()) return null;
    const stay = await reader.reservation(proof.reservationId);
    if (!stay || stay.AccountId !== proof.customerId || stay.AccountType !== 'Customer' || !['Confirmed', 'Started'].includes(stay.State)
      || stay.ActualEndUtc || !(new Date(stay.ScheduledEndUtc) > now())) return null;
    const customer = await reader.customer(stay.AccountId);
    const current = proof.channel === 'email' ? customer?.Email?.trim().toLowerCase() : normalPhone(customer?.Phone);
    if (current !== proof.contact || (proof.channel === 'email' && customer?.HasOtaEmail)) return null;
    return stay;
  }
  async function bindingFor(proof, stay, conversationId, tx = db) {
    const data = { hotelId: proof.hotelId, reservationId: stay.Id, customerId: stay.AccountId, verifiedBy: proof.verifiedBy,
      verifiedAt: proof.verifiedAt, expiresAt: new Date(Math.min(+proof.expiresAt, +new Date(stay.ScheduledEndUtc))),
      verificationMethod: contactBindingMethod, contactVerificationId: proof.id, checkinInviteId: null };
    return tx.pmsConversationBinding.upsert({ where: { conversationId }, create: { conversationId, ...data }, update: data });
  }
  async function reader(hotelId) {
    const config = await db.guestMessagingConfig.findUnique({ where: { hotelId } });
    if (!config?.welcomeEnabled) return null;
    return readerFor(config);
  }
  async function recognize(ctx) {
    const sender = await storedGuestSender(db, ctx);
    if (!sender) return null;
    const token = sender.channel === 'email' && /\[HX-([A-F0-9]{32})\]/i.exec(sender.subject)?.[1];
    if (!token && !await db.guestContactVerification.findFirst({ where: { hotelId: ctx.hotelId, channel: sender.channel, contact: sender.contact, revokedAt: null, expiresAt: { gt: now() } } })) return null;
    const pms = await reader(ctx.hotelId);
    if (!pms) return null;
    // A random reply reference proves access to the email we sent. A matching
    // From address by itself never verifies a new email thread.
    if (token) {
      const welcome = await db.guestWelcome.findFirst({ where: { hotelId: ctx.hotelId, channel: 'email', contact: sender.contact,
        replyTokenHash: replyTokenHash(token), replyTokenUsedAt: null, expiresAt: { gt: now() }, status: { in: ['sending', 'sent', 'uncertain'] } } });
      if (welcome) {
        const candidate = { ...welcome, reservationId: welcome.reservationId, expiresAt: welcome.expiresAt };
        const stay = await liveProof(candidate, pms);
        if (stay) await txRun(db, async tx => {
          await contactLock(tx, ctx.hotelId);
          const claim = await tx.guestWelcome.updateMany({ where: { id: welcome.id, hotelId: ctx.hotelId, replyTokenHash: replyTokenHash(token), replyTokenUsedAt: null, expiresAt: { gt: now() } }, data: { replyTokenUsedAt: now() } });
          if (claim.count !== 1) return;
          await rememberGuestContact(tx, { hotelId: ctx.hotelId, reservationId: stay.Id, customerId: stay.AccountId, channel: 'email', contact: sender.contact,
            conversationId: ctx.conversationId, method: 'email-reply-reference', verifiedBy: welcome.recordedBy, expiresAt: new Date(stay.ScheduledEndUtc) });
        });
      }
    }
    const proofs = await db.guestContactVerification.findMany({ where: { hotelId: ctx.hotelId, channel: sender.channel, contact: sender.contact,
      revokedAt: null, expiresAt: { gt: now() }, ...(sender.channel === 'email' ? { conversationId: ctx.conversationId } : {}) }, take: 10 });
    const candidates = [];
    for (const proof of proofs) { const stay = await liveProof(proof, pms); if (stay) candidates.push({ proof, stay }); }
    const checkedIn = candidates.filter(c => c.stay.State === 'Started');
    const relevant = checkedIn.length ? checkedIn : candidates;
    if (relevant.length !== 1 || proofs.length === 10) return null; // Never guess between multiple stays.
    return txRun(db, async tx => {
      await contactLock(tx, ctx.hotelId);
      const proof = await tx.guestContactVerification.findFirst({ where: { id: relevant[0].proof.id, revokedAt: null, expiresAt: { gt: now() } } });
      return proof ? bindingFor(proof, relevant[0].stay, ctx.conversationId, tx) : null;
    });
  }
  async function currentBinding(ctx, binding) {
    if (binding?.verificationMethod !== contactBindingMethod) return binding;
    const sender = await storedGuestSender(db, ctx);
    if (!sender || !binding.contactVerificationId || !binding.expiresAt || binding.expiresAt <= now()) return null;
    const proof = await db.guestContactVerification.findFirst({ where: { id: binding.contactVerificationId, hotelId: ctx.hotelId,
      reservationId: binding.reservationId, customerId: binding.customerId, channel: sender.channel, contact: sender.contact, revokedAt: null,
      ...(sender.channel === 'email' ? { conversationId: ctx.conversationId } : {}) } });
    const pms = await reader(ctx.hotelId);
    const stay = pms && await liveProof(proof, pms);
    if (!stay) return null;
    const room = stay.State === 'Started' && stay.AssignedResourceId ? await db.room.findFirst({ where: { hotelId: ctx.hotelId, mewsId: stay.AssignedResourceId } }) : null;
    return { ...binding, currentRoom: room?.number || null, stayState: stay.State };
  }
  return { recognize, currentBinding, liveProof };
}
