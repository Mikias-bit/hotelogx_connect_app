import { storedGuestSender } from './guestContactRecognition.js';
import { captureGuestMessagingCode } from './guestMessaging.js';

export async function rememberWelcomeGuest(db, ctx) {
  if (!db.guestContactVerification) return null;
  const config = await db.guestMessagingConfig.findUnique({ where: { hotelId: ctx.hotelId } });
  if (!config?.welcomeEnabled) return null;
  const { contactRecognitionFor } = await import('./guestWelcomeRuntime.js');
  const recognition = contactRecognitionFor(db);
  // Fail closed on PMS errors, but leave public hotel questions available.
  let binding;
  try { binding = await recognition.recognize(ctx); } catch {}
  if (!/^VERIFY[.!]?$/i.test(ctx.messageText.trim())) return null;
  const respond = text => captureGuestMessagingCode(db, ctx, { redeem: async () => text });
  if (binding) return respond('Your reservation is connected to this conversation. How can we help?');
  const sender = await storedGuestSender(db, ctx);
  if (sender?.channel !== 'whatsapp') return respond('Please reply to your hotel welcome email in its original thread, or ask Front Office to verify your contact.');
  const welcomes = await db.guestWelcome.findMany({ where: { hotelId: ctx.hotelId, channel: sender.channel, contact: sender.contact,
    expiresAt: { gt: new Date() }, status: { in: ['sent', 'uncertain'] } }, take: 10 });
  const { checkinPmsReader } = await import('./checkinPmsReader.js');
  const reader = await checkinPmsReader(db, config);
  const candidates = [];
  for (const row of welcomes) {
    const stay = await recognition.liveProof(row, reader);
    if (stay?.State === 'Started' && !candidates.some(c => c.reservationId === stay.Id)) candidates.push(row);
  }
  if (candidates.length !== 1 || welcomes.length === 10) return respond('Front Office needs to confirm which reservation belongs to you before connecting this contact.');
  const row = candidates[0];
  const actor = await db.user.findFirst({ where: { id: config.updatedBy, hotelId: ctx.hotelId, role: { in: ['manager', 'front-office'] } } });
  if (!actor) return respond('Please ask Front Office to verify your contact.');
  const claim = await db.guestWelcome.updateMany({ where: { id: row.id, OR: [{ verifyMessageId: null }, { verifyMessageId: { not: sender.message.id } }] }, data: { verifyMessageId: sender.message.id } });
  if (claim.count === 1) {
    try {
      const { guestMessagingFor } = await import('./guestMessagingRuntime.js');
      await guestMessagingFor(db).issue(actor, { reservationId: row.reservationId, channel: row.channel, contact: row.contact, contactConfirmed: true });
    } catch { return respond('Please use the connection code already sent to this number, or ask Front Office for a new code if it has expired.'); }
  }
  return respond('Please reply with the CONNECT code sent to this WhatsApp number. You only need to verify this contact once for this stay.');
}
