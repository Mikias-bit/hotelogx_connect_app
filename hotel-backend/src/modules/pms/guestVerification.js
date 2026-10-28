import crypto from 'node:crypto';
import { prisma } from '../../config/database.js';
import { encryptToken, decryptToken } from '../../utils/tokenCrypto.js';
import { emailService } from '../email/emailService.js';
import { createPmsMcpClient } from './pmsMcpClient.js';
import { unpackMcp } from './pmsAiTools.js';

const fields = ['full_name', 'check_in', 'check_out', 'guest_count', 'email', 'whatsapp'];
const questions = [
  'Before I access your reservation, please tell me the full name on the booking. I will also ask for your stay dates, guest count and booking contact details, then verify a code sent to the booking email. You can reply CANCEL VERIFICATION at any time.',
  'What is your check-in date? Please use YYYY-MM-DD.',
  'What is your check-out date? Please use YYYY-MM-DD.',
  'How many guests are included in this reservation, including children? Please reply with the total number.',
  'What email address is recorded on the booking?',
  'What WhatsApp phone number is recorded on the booking? Include the country code, for example +31612345678.',
];
const staffReply = 'I could not complete secure verification. Please contact the front desk to verify your reservation. I have not shared reservation details or added anything to your folio.';
const codeReply = 'Please check the booking email for a six-digit verification code and enter it here within 10 minutes. Only enter a code for a request you started. If you cannot access that email, contact the front desk.';
const busyReply = 'Verification is being processed. Please wait a moment. If no code arrives, contact the front desk; I will not send duplicate codes automatically.';
const result = (replyText, extra = {}) => ({ replyText, status: 'verification', ...extra });

export function requiresGuestVerification(text) {
  return /\b(my|our)\s+(reservation|booking|bill|folio|room number|balance)\b|\b(late check[ -]?out|early check[ -]?in|extend (my |our |the )?stay|accept [a-f0-9]{12})\b/i.test(text);
}
export function parseVerificationAnswer(step, text, data = {}) {
  const value = text.trim();
  if (value.length > 254) return null;
  if (step === 0) return value.length >= 2 && value.length <= 120 && !/[\d?@\n]/.test(value) ? value : null;
  if (step === 1 || step === 2) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    if (step === 2 && (!(value > data.check_in) || (date - new Date(`${data.check_in}T00:00:00Z`)) / 86400000 > 366)) return null;
    return value;
  }
  if (step === 3) return /^\d{1,3}$/.test(value) && +value >= 1 && +value <= 100 ? +value : null;
  if (step === 4) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : null;
  const phone = value.replace(/[\s().-]/g, '').replace(/^00/, '+');
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export function createGuestVerification({ db = prisma, client = createPmsMcpClient(), env = process.env,
  now = () => new Date(), makeCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0'),
  encrypt = encryptToken, decrypt = decryptToken,
  sendCode = args => emailService.sendGuestEmail(args) } = {}) {
  function hash(value) {
    const key = env.PMS_MCP_CONTEXT_KEY;
    if (!key || key.length < 32) throw new Error('Verification signing key is unavailable');
    return crypto.createHmac('sha256', key).update(value).digest('hex');
  }
  const codeHash = (ctx, code) => hash(`guest-code:${ctx.hotelId}:${ctx.conversationId}:${code}`);
  async function scope(ctx) {
    if (!await db.conversation.findFirst({ where: { id: ctx.conversationId, guest: { hotelId: ctx.hotelId } } })) throw new Error('Conversation hotel mismatch');
  }
  async function validBinding(ctx) {
    return db.pmsConversationBinding.findFirst({ where: { conversationId: ctx.conversationId, hotelId: ctx.hotelId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now() } }] } });
  }
  async function latest(ctx, text) {
    const message = await db.message.findFirst({ where: { conversationId: ctx.conversationId, author: 'guest' }, orderBy: { createdAt: 'desc' } });
    if (!message || message.body !== text) throw new Error('Verification requires the stored inbound guest message');
    return message;
  }
  async function change(row, data) {
    const updated = await db.pmsGuestVerification.updateMany({ where: { conversationId: row.conversationId, hotelId: row.hotelId, version: row.version },
      data: { ...data, version: { increment: 1 } } });
    if (updated.count !== 1) throw new Error('Verification changed concurrently');
    Object.assign(row, data, { version: row.version + 1 });
  }
  async function block(row) {
    await change(row, { status: 'blocked', encryptedData: encrypt('{}'), codeHash: null, lastReply: staffReply });
    return result(staffReply, { staffReview: true });
  }
  async function ensure(ctx, text) {
    await scope(ctx);
    if (await validBinding(ctx)) return null;
    const message = await latest(ctx, text);
    let row = await db.pmsGuestVerification.findUnique({ where: { conversationId: ctx.conversationId } });
    if (row && row.hotelId !== ctx.hotelId) throw new Error('Verification hotel mismatch');
    if (row && row.expiresAt > now() && !['verified', 'cancelled'].includes(row.status)) return result(row.lastReply);
    const data = { hotelId: ctx.hotelId, status: 'collecting', step: 0, attempts: 0, codeHash: null, codeExpiresAt: null,
      ...(row && row.expiresAt <= now() ? { sendCount: 0, emailHash: null } : {}),
      encryptedData: encrypt(JSON.stringify({ request: text })), lastMessageId: message.id, lastReply: questions[0], expiresAt: new Date(+now() + 3600000) };
    if (row) await change(row, data);
    else {
      try { row = await db.pmsGuestVerification.create({ data: { conversationId: ctx.conversationId, ...data } }); }
      catch (error) { if (error.code !== 'P2002') throw error; row = await db.pmsGuestVerification.findUnique({ where: { conversationId: ctx.conversationId } }); }
    }
    return result(row.lastReply);
  }
  async function handle(ctx, text) {
    await scope(ctx);
    const row = await db.pmsGuestVerification.findUnique({ where: { conversationId: ctx.conversationId } });
    if (!row) return null;
    if (row.hotelId !== ctx.hotelId) throw new Error('Verification hotel mismatch');
    if (row.status === 'verified') return /^\s*(verify\s+)?\d{6}\s*$/i.test(text) ? result('Your reservation is already verified for this conversation.') : null;
    if (row.status === 'cancelled') return null;
    if (await validBinding(ctx)) {
      await change(row, { status: 'cancelled', encryptedData: encrypt('{}'), codeHash: null }); return null;
    }
    const message = await latest(ctx, text);
    if (row.lastMessageId === message.id) return result(row.lastReply);
    if (/^cancel verification$/i.test(text.trim())) {
      await change(row, { status: 'cancelled', codeHash: null, encryptedData: encrypt('{}'), lastMessageId: message.id, lastReply: 'Verification cancelled. I can still answer general hotel questions.' });
      return result(row.lastReply);
    }
    // General hotel questions can be answered without completing verification.
    if (/\?|\b(what|where|when|how)\b/i.test(text) && /\b(wifi|wi-fi|breakfast|restaurant|parking|pool|directions|opening|hours)\b/i.test(text) && !requiresGuestVerification(text)) return null;
    if (row.expiresAt <= now()) {
      if (requiresGuestVerification(text) || /^start verification$/i.test(text.trim())) return ensure(ctx, text);
      await block(row); return result('This verification session expired. Please repeat your reservation request to start again.');
    }
    if (row.status === 'blocked') return result(staffReply, { staffReview: true });
    if (['matching', 'sending', 'checking'].includes(row.status)) return result(busyReply);
    const data = JSON.parse(decrypt(row.encryptedData) || '{}');
    if (row.status === 'challenge') {
      if (row.attempts >= 5 || !row.codeExpiresAt || row.codeExpiresAt <= now()) return block(row);
      const supplied = text.trim().replace(/^verify\s+/i, '');
      await change(row, { attempts: row.attempts + 1, lastMessageId: message.id, lastReply: 'That code could not be verified. Please enter the six-digit code from the booking email.' });
      const candidateHash = codeHash(ctx, supplied);
      if (!/^\d{6}$/.test(supplied) || !row.codeHash || !crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(row.codeHash))) {
        if (row.attempts >= 5) return block(row);
        return result(row.lastReply);
      }
      await change(row, { status: 'checking', lastReply: busyReply });
      try {
        const fresh = unpackMcp(await client.matchGuestForVerification(ctx, Object.fromEntries(fields.map(key => [key, data[key]]))));
        if (!fresh.matched || fresh.reservation_id !== data.candidate.reservation_id || fresh.customer_id !== data.candidate.customer_id) return block(row);
        const expiresAt = new Date(fresh.expires_at);
        if (!Number.isFinite(+expiresAt) || expiresAt <= now() || expiresAt > new Date(+now() + 86401000)) return block(row);
        await db.$transaction(async tx => {
          const claim = await tx.pmsGuestVerification.updateMany({ where: { conversationId: ctx.conversationId, hotelId: ctx.hotelId,
            version: row.version, status: 'checking', codeExpiresAt: { gt: now() } },
          data: { status: 'verified', codeHash: null, encryptedData: encrypt('{}'), version: { increment: 1 }, lastReply: 'Your reservation is verified for this conversation.' } });
          if (claim.count !== 1) throw new Error('Verification expired or changed');
          const binding = { hotelId: ctx.hotelId, reservationId: fresh.reservation_id, customerId: fresh.customer_id,
            verifiedBy: 'guest-email-code', verificationMethod: 'email-code', verifiedAt: now(), expiresAt };
          await tx.pmsConversationBinding.upsert({ where: { conversationId: ctx.conversationId }, create: { conversationId: ctx.conversationId, ...binding }, update: binding });
        });
        return result('Your reservation is verified for this conversation. How can I help with your stay?', { verified: true, resumeRequest: data.request });
      } catch { return block(row); }
    }
    const answer = parseVerificationAnswer(row.step, text, data);
    if (answer === null) return result(questions[row.step]);
    data[fields[row.step]] = answer;
    const step = row.step + 1;
    await change(row, { step, encryptedData: encrypt(JSON.stringify(data)), lastMessageId: message.id,
      status: step === fields.length ? 'matching' : 'collecting', lastReply: questions[step] || busyReply });
    if (step < fields.length) return result(row.lastReply);
    try {
      const emailHash = hash(`guest-email:${ctx.hotelId}:${data.email}`);
      const reserved = await db.$transaction(async tx => {
        // Serialize the budget across conversations for the same hotel/contact.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${emailHash}, 0))`;
        const recent = await tx.pmsGuestVerification.aggregate({ where: { hotelId: ctx.hotelId, emailHash, updatedAt: { gt: new Date(+now() - 3600000) } }, _sum: { sendCount: true } });
        if ((recent._sum.sendCount || 0) >= 3 || row.sendCount >= 3) return false;
        const claimed = await tx.pmsGuestVerification.updateMany({ where: { conversationId: ctx.conversationId, hotelId: ctx.hotelId, version: row.version, status: 'matching' },
          data: { emailHash, sendCount: { increment: 1 }, version: { increment: 1 } } });
        if (claimed.count !== 1) throw new Error('Verification changed concurrently');
        return true;
      });
      if (!reserved) return block(row);
      row.version++; row.sendCount++; row.emailHash = emailHash;
      const match = unpackMcp(await client.matchGuestForVerification(ctx, Object.fromEntries(fields.map(key => [key, data[key]]))));
      if (!match.matched || match.email?.trim().toLowerCase() !== data.email) return block(row);
      const code = makeCode();
      data.candidate = { reservation_id: match.reservation_id, customer_id: match.customer_id };
      await change(row, { status: 'sending', encryptedData: encrypt(JSON.stringify(data)), codeHash: codeHash(ctx, code), codeExpiresAt: new Date(+now() + 600000) });
      // No conversationId: do not put the secret code in the AI transcript or dashboard.
      const sent = await sendCode({ hotelId: ctx.hotelId, toEmail: match.email, subject: 'Verify your hotel reservation request',
        text: `Your Hotelogx reservation verification code is ${code}. It expires in 10 minutes. Enter it only in the hotel conversation where you requested verification. If you did not request this, ignore this email.`, author: 'system' });
      if (!sent?.success || !sent.dispatched) return block(row);
      await change(row, { status: 'challenge', lastReply: codeReply });
      return result(codeReply);
    } catch { return block(row); }
  }
  async function historySince(ctx) {
    const row = await db.pmsGuestVerification.findUnique({ where: { conversationId: ctx.conversationId } });
    return row?.hotelId === ctx.hotelId ? row.updatedAt : null;
  }
  return { ensure, handle, validBinding, historySince, shouldVerify: requiresGuestVerification };
}
