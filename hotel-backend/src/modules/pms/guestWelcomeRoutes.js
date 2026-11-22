import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middlewares/auth.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { guestWelcomeFor } from './guestWelcomeRuntime.js';
import { checkinPmsReader } from './checkinPmsReader.js';
import { safeWelcomeUrl } from './guestWelcome.js';
import { rememberGuestContact, contactLock } from './guestContactRecognition.js';
import { normalizeMessagingContact } from './guestMessaging.js';

export function createGuestWelcomeRouter({ db = prisma, authenticateStaff = authenticate, readerFor = config => checkinPmsReader(db, config), welcomeFor = () => guestWelcomeFor(db) } = {}) {
  const router = Router();
  router.use(authenticateStaff, (req, res, next) => req.user.hotelId && ['manager', 'front-office'].includes(req.user.role) ? next() : errorResponse(res, 'Staff access required', 403));
  const fail = message => { throw Object.assign(new Error(message), { publicMessage: message }); };
  const wrap = fn => async (req, res) => { try { return successResponse(res, await fn(req)); } catch (e) { return errorResponse(res, e.publicMessage || 'Could not complete welcome setup. Check PMS connection and selected reservation.', 409); } };
  router.get('/', wrap(async req => {
    const hotelId = req.user.hotelId;
    const config = await db.guestMessagingConfig.findUnique({ where: { hotelId } });
    const welcomes = await db.guestWelcome.findMany({ where: { hotelId }, orderBy: { createdAt: 'desc' }, take: 100 });
    const contacts = await db.guestContactVerification.findMany({ where: { hotelId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { verifiedAt: 'desc' }, take: 100 });
    return { config: { enabled: config?.welcomeEnabled || false, confirmationSender: config?.confirmationSender || 'pms', checkinSender: config?.checkinSender || 'hotelogx',
      arrivalInstructions: config?.arrivalInstructions || '', onlineCheckinUrl: config?.onlineCheckinUrl || '', catalogueUrl: config?.catalogueUrl || '', welcomeUpsells: config?.welcomeUpsells ?? true,
      bookingWelcomeTemplate: config?.bookingWelcomeTemplate || '', checkinWelcomeTemplate: config?.checkinWelcomeTemplate || '' },
      welcomes: welcomes.map(({ replyTokenHash, ...row }) => row), contacts };
  }));
  router.put('/config', wrap(async req => {
    if (req.user.role !== 'manager') fail('Only managers can configure welcome messages');
    const b = req.body;
    if (typeof b.enabled !== 'boolean' || typeof b.welcomeUpsells !== 'boolean' || !['hotelogx', 'pms'].includes(b.confirmationSender) || !['hotelogx', 'pms'].includes(b.checkinSender)) fail('Choose who sends each welcome');
    if (typeof b.arrivalInstructions !== 'string' || b.arrivalInstructions.length > 500) fail('Arrival instructions must be at most 500 characters');
    for (const key of ['onlineCheckinUrl', 'catalogueUrl']) if (typeof b[key] !== 'string' || b[key].length > 1000 || (b[key] && !safeWelcomeUrl(b[key]))) fail('Use a valid HTTPS hotel link without embedded credentials');
    for (const key of ['bookingWelcomeTemplate', 'checkinWelcomeTemplate']) if (typeof b[key] !== 'string' || !/^(|[a-z0-9_]{1,100})$/.test(b[key])) fail('Enter valid approved WhatsApp template names');
    const previous = await db.guestMessagingConfig.findUnique({ where: { hotelId: req.user.hotelId } });
    if (!previous) fail('Configure the Mews connection and automatic messaging first');
    if (b.enabled && b.senderResponsibilityConfirmed !== true) fail('Confirm that the PMS and staff will not duplicate welcomes assigned to Hotelogx');
    const data = { welcomeEnabled: b.enabled, confirmationSender: b.confirmationSender, checkinSender: b.checkinSender, arrivalInstructions: b.arrivalInstructions,
      onlineCheckinUrl: b.onlineCheckinUrl, catalogueUrl: b.catalogueUrl, welcomeUpsells: b.welcomeUpsells, bookingWelcomeTemplate: b.bookingWelcomeTemplate,
      checkinWelcomeTemplate: b.checkinWelcomeTemplate, updatedBy: req.user.id, ...(!previous.welcomeEnabled && b.enabled ? { welcomeSince: new Date() } : {}) };
    return db.guestMessagingConfig.update({ where: { hotelId: req.user.hotelId }, data });
  }));
  const reservation = async req => {
    if (typeof req.body.reservationId !== 'string') fail('Select a reservation');
    const config = await db.guestMessagingConfig.findUnique({ where: { hotelId: req.user.hotelId } });
    const reader = await readerFor(config);
    const stay = await reader.reservation(req.body.reservationId);
    if (!stay || stay.AccountType !== 'Customer' || !['Confirmed', 'Started'].includes(stay.State) || stay.ActualEndUtc || new Date(stay.ScheduledEndUtc) <= new Date()) fail('Select an active reservation in this hotel');
    return { reader, stay };
  };
  router.post('/record-external', wrap(async req => {
    if (req.body.sentConfirmed !== true) fail('Confirm the welcome has already been sent');
    const { stay } = await reservation(req);
    return welcomeFor().recordExternal(req.user, { reservationId: stay.Id, stage: req.body.stage, customerId: stay.AccountId, expiresAt: new Date(stay.ScheduledEndUtc) });
  }));
  router.post('/verify-contact', wrap(async req => {
    if (req.body.identityAndContactConfirmed !== true) fail('Confirm identity and ownership of the contact at reception');
    const { stay, reader } = await reservation(req);
    if (stay.State !== 'Started') fail('Reception verification requires an actual checked-in guest');
    const contact = normalizeMessagingContact(req.body.channel, req.body.contact);
    const customer = await reader.customer(stay.AccountId);
    const stored = normalizeMessagingContact(req.body.channel, req.body.channel === 'email' ? customer?.Email : customer?.Phone);
    if (stored !== contact || (req.body.channel === 'email' && customer?.HasOtaEmail)) fail('Update the staying guest’s own contact in Mews before confirming it here');
    return db.$transaction(async tx => {
      await contactLock(tx, req.user.hotelId);
      return rememberGuestContact(tx, { hotelId: req.user.hotelId, reservationId: stay.Id, customerId: stay.AccountId, channel: req.body.channel, contact,
        conversationId: null, method: 'reception-confirmed', verifiedBy: req.user.id, expiresAt: new Date(stay.ScheduledEndUtc) });
    });
  }));
  router.post('/contacts/:id/revoke', wrap(async req => db.$transaction(async tx => {
    await contactLock(tx, req.user.hotelId);
    const proof = await tx.guestContactVerification.findFirst({ where: { id: req.params.id, hotelId: req.user.hotelId } });
    if (!proof) fail('Verified contact not found');
    await tx.guestContactVerification.update({ where: { id: proof.id }, data: { revokedAt: new Date() } });
    await tx.pmsConversationBinding.deleteMany({ where: { hotelId: req.user.hotelId, reservationId: proof.reservationId,
      OR: [{ contactVerificationId: proof.id }, ...(proof.conversationId ? [{ conversationId: proof.conversationId }] : [])] } });
    await tx.guestWelcome.updateMany({ where: { hotelId: req.user.hotelId, reservationId: proof.reservationId, channel: proof.channel, contact: proof.contact }, data: { replyTokenHash: null } });
    return { success: true };
  })));
  return router;
}
