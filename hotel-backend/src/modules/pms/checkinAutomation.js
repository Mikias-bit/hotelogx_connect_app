import { randomUUID } from 'node:crypto';
import { normalizeMessagingContact, checkinMethod } from './guestMessaging.js';

const proxy = /(?:^|[.@-])(booking\.com|guest\.booking\.com|expedia\.com|agoda\.com|airbnb\.com|guest\.trip\.com)$/i;
const email = value => { try { return normalizeMessagingContact('email', value); } catch { return null; } };
const phone = value => { try { return normalizeMessagingContact('whatsapp', value); } catch { return null; } };
export function chooseCheckinContact(config, customer, booker) {
  if (!customer) return { reason: 'Guest profile missing; confirm contact with the guest' };
  const address = email(customer.Email), number = phone(customer.Phone);
  if (booker && ((address && address === email(booker.Email)) || (number && number === phone(booker.Phone)))) return { reason: 'Contact is shared with a separate booker; Front Office must verify the staying guest' };
  if (customer.HasOtaEmail || (address && proxy.test(address))) return { reason: 'Booking-channel proxy address; Front Office must confirm a guest contact' };
  if (config.automaticChannel !== 'whatsapp' && address) return { channel: 'email', contact: address };
  if (config.automaticChannel !== 'email' && number && config.whatsappTemplate) return { channel: 'whatsapp', contact: number };
  return { reason: 'No suitable guest contact or approved WhatsApp template; Front Office review needed' };
}
export function eligibleCheckin(stay, config, now) {
  // Check-in method is deliberately irrelevant: reception, online and kiosk
  // all qualify once the PMS actually transitions the stay to Started.
  return stay?.State === 'Started' && stay.AccountType === 'Customer' && !!stay.AccountId && !!stay.AssignedResourceId && !stay.ActualEndUtc
    && new Date(stay.ActualStartUtc) >= config.enabledSince && new Date(stay.ActualStartUtc) <= now && new Date(stay.ScheduledEndUtc) > now;
}
export function createCheckinAutomation({ db, readerFor, messagingFor, welcomeFor, now = () => new Date() }) {
  async function enqueue(hotelId, ids) {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    await db.$transaction(async tx => {
      await tx.guestMessagingJob.createMany({ data: unique.map(reservationId => ({ hotelId, reservationId, availableAt: now() })), skipDuplicates: true });
      await tx.guestMessagingJob.updateMany({ where: { hotelId, reservationId: { in: unique } }, data: { revision: { increment: 1 }, status: 'pending', availableAt: now() } });
    });
  }
  async function process(config, reader, job) {
    const stay = await reader.reservation(job.reservationId);
    if (!stay) return { status: 'review', reason: 'Reservation missing from the configured accommodation service' };
    const welcomeStage = config.welcomeEnabled && stay.State === 'Confirmed' ? 'confirmation' : 'checkin';
    const confirmation = config.welcomeEnabled && welcomeStage === 'confirmation';
    if ((!confirmation && stay.State !== 'Started') || stay.ActualEndUtc || new Date(stay.ScheduledEndUtc) <= now()) {
      // Fresh PMS authority also invalidates pending codes at checkout/cancellation.
      await db.pmsConversationBinding.deleteMany({ where: { hotelId: config.hotelId, reservationId: stay.Id, verificationMethod: { in: [checkinMethod, 'verified-stay-contact'] } } });
      await db.guestMessagingInvite.updateMany({ where: { hotelId: config.hotelId, reservationId: stay.Id, revokedAt: null },
        data: { status: 'revoked', revokedAt: now(), revokedBy: 'pms-state-change' } });
      if (db.guestContactVerification && (['Processed', 'Canceled'].includes(stay.State) || stay.ActualEndUtc || new Date(stay.ScheduledEndUtc) <= now())) {
        await db.guestContactVerification.updateMany({ where: { hotelId: config.hotelId, reservationId: stay.Id }, data: { revokedAt: now() } });
        await db.guestWelcome.updateMany({ where: { hotelId: config.hotelId, reservationId: stay.Id }, data: { replyTokenHash: null, expiresAt: now() } });
      }
      return { status: 'done', reason: 'Reservation is not currently checked in' };
    }
    if (confirmation) {
      if (config.confirmationSender !== 'hotelogx') return { status: 'done', reason: 'Booking welcome is managed by PMS or staff' };
      if (stay.AccountType !== 'Customer' || !stay.AccountId || !config.welcomeSince || !(new Date(stay.CreatedUtc) >= config.welcomeSince)) return { status: 'done', reason: 'Existing reservation predates welcome automation; no backfill sent' };
    } else if (!eligibleCheckin(stay, config, now())) return { status: 'review', reason: 'Check-in time or room is missing, predates enabling automation, or is not current; review in PMS' };
    if (config.welcomeEnabled && welcomeStage === 'checkin' && config.checkinSender !== 'hotelogx') return { status: 'done', reason: 'Check-in welcome is managed by PMS or staff' };
    const previous = !confirmation && await db.guestMessagingInvite.findFirst({ where: { hotelId: config.hotelId, reservationId: stay.Id } });
    if (previous) return { status: ['failed', 'uncertain', 'sending'].includes(previous.status) ? 'review' : 'done', reason: 'Invitation already recorded; review delivery or use manual resend if needed' };
    const customer = await reader.customer(stay.AccountId);
    if (!customer || customer.Id !== stay.AccountId) return { status: 'review', reason: 'Could not match the staying guest profile' };
    const booker = stay.BookerId && stay.BookerId !== stay.AccountId ? await reader.customer(stay.BookerId) : null;
    if (stay.BookerId && stay.BookerId !== stay.AccountId && !booker) return { status: 'review', reason: 'Separate booker could not be checked; confirm contact at Front Office' };
    const contact = chooseCheckinContact(config.welcomeEnabled ? { ...config, whatsappTemplate: welcomeStage === 'confirmation' ? config.bookingWelcomeTemplate : config.checkinWelcomeTemplate } : config, customer, booker);
    if (contact.reason) return { status: 'review', reason: contact.reason };
    const actor = await db.user.findFirst({ where: { id: config.updatedBy, hotelId: config.hotelId, role: { in: ['manager', 'front-office'] } } });
    if (!actor) return { status: 'review', reason: 'A manager must re-save automation settings to authorise PMS access' };
    if (config.welcomeEnabled && welcomeFor) {
      const result = await welcomeFor().send({ config, reader, stage: welcomeStage, stay, customer, contact, actor });
      return { status: ['sent', 'already_handled', 'external', 'disabled'].includes(result.status) ? 'done' : 'review', reason: result.reason || `Welcome: ${result.status}` };
    }
    const result = await messagingFor().issueAutomatic(actor, { reservationId: stay.Id, expectedCustomerId: stay.AccountId, ...contact });
    return { status: ['sent', 'redeemed', 'already_handled'].includes(result.status) ? 'done' : 'review', reason: `Invitation: ${result.status}` };
  }
  async function runHotel(hotelId) {
    const token = randomUUID();
    const claimed = await db.guestMessagingConfig.updateMany({ where: { hotelId, automaticEnabled: true,
      OR: [{ workerUntil: null }, { workerUntil: { lt: now() } }] }, data: { workerToken: token, workerUntil: new Date(+now() + 300000) } });
    if (claimed.count !== 1) return;
    const owned = { hotelId, workerToken: token };
    try {
      const config = await db.guestMessagingConfig.findUnique({ where: { hotelId } });
      const reader = await readerFor(config);
      const start = new Date(Math.max(+config.enabledSince, +(config.lastScannedAt || config.enabledSince) - 120000));
      const end = config.scanEnd || new Date(Math.min(+now(), +start + 86400000));
      let cursor = config.scanCursor;
      let recoveryFailed = false;
      // Persist every page only after its jobs are durable. A failed page never
      // advances the checkpoint; bounded windows catch up after long outages.
      try { for (let page = 0; page < 5; page++) {
        const data = await reader.updated(start, end, cursor);
        await enqueue(hotelId, data.reservations.map(r => r.Id));
        if (data.cursor && data.cursor === cursor) throw new Error('PMS cursor did not advance');
        cursor = data.cursor;
        await db.guestMessagingConfig.updateMany({ where: owned, data: cursor ? { scanEnd: end, scanCursor: cursor } : { lastScannedAt: end, scanEnd: null, scanCursor: null } });
        if (!cursor) break;
      } } catch { recoveryFailed = true; }
      const jobs = await db.guestMessagingJob.findMany({ where: { hotelId, status: 'pending', availableAt: { lte: now() },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now() } }] }, orderBy: { availableAt: 'asc' }, take: 10 });
      for (const job of jobs) {
        if (!(await db.guestMessagingConfig.findUnique({ where: { hotelId } }))?.automaticEnabled) break;
        const jobToken = randomUUID();
        const claim = await db.guestMessagingJob.updateMany({ where: { hotelId, reservationId: job.reservationId, revision: job.revision,
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now() } }] }, data: { leaseToken: jobToken, leaseUntil: new Date(+now() + 120000), attempts: { increment: 1 } } });
        if (claim.count !== 1) continue;
        let outcome;
        try { outcome = await process(config, reader, job); }
        catch { outcome = { status: 'pending', reason: 'PMS or sending check failed; retry queued', availableAt: new Date(+now() + 300000) }; }
        await db.guestMessagingJob.updateMany({ where: { hotelId, reservationId: job.reservationId, revision: job.revision, leaseToken: jobToken }, data: outcome });
        await db.guestMessagingJob.updateMany({ where: { hotelId, reservationId: job.reservationId, leaseToken: jobToken }, data: { leaseToken: null, leaseUntil: null } });
      }
      await db.guestMessagingConfig.updateMany({ where: owned, data: { automationError: recoveryFailed ? 'PMS recovery scan failed; its checkpoint is retained. Webhook jobs are still being processed.' : null } });
    } catch {
      await db.guestMessagingConfig.updateMany({ where: owned, data: { automationError: 'PMS recovery check failed. Verify connection and automation settings; queued work is retained.' } });
    } finally { await db.guestMessagingConfig.updateMany({ where: owned, data: { workerToken: null, workerUntil: null } }); }
  }
  async function run() {
    for (const row of await db.guestMessagingConfig.findMany({ where: { automaticEnabled: true } })) await runHotel(row.hotelId);
  }
  return { enqueue, process, runHotel, run };
}
