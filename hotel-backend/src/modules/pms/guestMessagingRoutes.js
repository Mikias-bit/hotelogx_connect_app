import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middlewares/auth.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { guestMessagingFor } from './guestMessagingRuntime.js';
import { publicInvite } from './guestMessaging.js';
import { checkinPmsReader } from './checkinPmsReader.js';

export function createGuestMessagingRouter({ db = prisma, authenticateStaff = authenticate, service = guestMessagingFor(db), readerFor = config => checkinPmsReader(db, config) } = {}) {
  const router = Router();
  router.use(authenticateStaff, (req, res, next) => req.user.hotelId && ['manager', 'front-office'].includes(req.user.role) ? next() : errorResponse(res, 'Front Office or manager access required', 403));
  const wrap = fn => async (req, res) => { try { return successResponse(res, await fn(req)); }
    catch (error) { return errorResponse(res, error.publicMessage || 'Guest messaging could not be updated. Check the PMS connection and try again.', error.status || 409); } };
  router.get('/', wrap(async req => {
    const [config, invitations] = await Promise.all([
      db.guestMessagingConfig.findUnique({ where: { hotelId: req.user.hotelId } }),
      db.guestMessagingInvite.findMany({ where: { hotelId: req.user.hotelId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    return { config: config || { whatsappTemplate: '', whatsappLanguage: 'en' }, invitations: invitations.map(publicInvite) };
  }));
  router.get('/reservations', wrap(async req => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const reservations = await db.reservation.findMany({ where: { hotelId: req.user.hotelId, mewsId: { not: null },
      ...(q ? { OR: [{ number: { contains: q, mode: 'insensitive' } }, { assignedRoom: { contains: q } }, { guest: { name: { contains: q, mode: 'insensitive' } } }] }
        : { status: { in: ['Started', 'CheckedIn', 'Checked in', 'InHouse', 'In-house', 'In House'] } }) },
      include: { guest: { select: { name: true } } }, orderBy: { arrival: 'desc' }, take: 50 });
    return reservations.map(r => ({ reservationId: r.mewsId, number: r.number, name: r.guest.name, room: r.assignedRoom, arrival: r.arrival, departure: r.departure, status: r.status }));
  }));
  router.post('/invitations', wrap(req => service.issue(req.user, req.body)));
  router.post('/invitations/:id/revoke', wrap(req => service.revoke(req.user, req.params.id)));
  router.get('/automation', wrap(async req => {
    const config = await db.guestMessagingConfig.findUnique({ where: { hotelId: req.user.hotelId } });
    const jobs = await db.guestMessagingJob.findMany({ where: { hotelId: req.user.hotelId, status: { in: ['review', 'pending'] } }, orderBy: { updatedAt: 'desc' }, take: 100 });
    return { enabled: config?.automaticEnabled || false, channel: config?.automaticChannel || 'email_first',
      enterpriseId: config?.mewsEnterpriseId || '', integrationId: config?.mewsIntegrationId || '', serviceId: config?.stayServiceId || '',
      lastScannedAt: config?.lastScannedAt, error: config?.automationError, jobs };
  }));
  router.put('/automation', wrap(async req => {
    const reject = message => { throw Object.assign(new Error(message), { publicMessage: message, status: 400 }); };
    if (req.user.role !== 'manager') throw Object.assign(new Error(), { publicMessage: 'Manager access required', status: 403 });
    const { enabled, channel, enterpriseId, integrationId, serviceId, guestContactsConfirmed } = req.body;
    if (typeof enabled !== 'boolean' || !['email', 'email_first', 'whatsapp'].includes(channel)) reject('Choose automatic invitation settings');
    const previous = await db.guestMessagingConfig.findUnique({ where: { hotelId: req.user.hotelId } });
    const data = { automaticEnabled: enabled, automaticChannel: channel, updatedBy: req.user.id };
    if (enabled) {
      if (guestContactsConfirmed !== true) reject('Confirm that staying-guest profiles contain their own contact details');
      if (![enterpriseId, integrationId, serviceId].every(v => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v))) reject('Enter valid Mews enterprise, integration and accommodation service IDs');
      if (channel === 'whatsapp' && !previous?.whatsappTemplate) reject('Save an approved WhatsApp invitation template first');
      const mapping = { mewsEnterpriseId: enterpriseId, mewsIntegrationId: integrationId, stayServiceId: serviceId };
      try { await (await readerFor({ hotelId: req.user.hotelId, ...mapping })).validateService(); }
      catch { reject('Could not verify the enterprise and accommodation service using this hotel’s Mews connection'); }
      if (await db.guestMessagingConfig.findFirst({ where: { ...{ mewsEnterpriseId: enterpriseId, mewsIntegrationId: integrationId }, hotelId: { not: req.user.hotelId }, automaticEnabled: true } })) reject('This Mews integration is already mapped to another hotel');
      Object.assign(data, mapping);
      if (!previous?.automaticEnabled || previous.mewsEnterpriseId !== enterpriseId || previous.stayServiceId !== serviceId) Object.assign(data, {
        enabledSince: new Date(), lastScannedAt: new Date(), scanEnd: null, scanCursor: null,
      });
    }
    await db.guestMessagingConfig.upsert({ where: { hotelId: req.user.hotelId }, create: { hotelId: req.user.hotelId, ...data }, update: data });
    return { success: true };
  }));
  router.post('/automation/review/:reservationId', wrap(async req => {
    if (!['retry', 'dismiss'].includes(req.body.action)) throw Object.assign(new Error(), { publicMessage: 'Choose retry or dismiss', status: 400 });
    await db.guestMessagingJob.updateMany({ where: { hotelId: req.user.hotelId, reservationId: req.params.reservationId },
      data: { status: req.body.action === 'retry' ? 'pending' : 'done', revision: { increment: 1 }, availableAt: new Date(), reason: `${req.body.action} by ${req.user.id}` } });
    return { success: true };
  }));
  router.put('/config', wrap(async req => {
    if (req.user.role !== 'manager') throw Object.assign(new Error(), { publicMessage: 'Only managers can configure invitation templates', status: 403 });
    const { whatsappTemplate, whatsappLanguage } = req.body;
    if (typeof whatsappTemplate !== 'string' || !/^(|[a-z0-9_]{1,100})$/.test(whatsappTemplate)
      || typeof whatsappLanguage !== 'string' || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(whatsappLanguage)) throw Object.assign(new Error(), { publicMessage: 'Enter a valid approved template name and language', status: 400 });
    const data = { whatsappTemplate, whatsappLanguage, updatedBy: req.user.id };
    return db.guestMessagingConfig.upsert({ where: { hotelId: req.user.hotelId }, create: { hotelId: req.user.hotelId, ...data }, update: data });
  }));
  return router;
}
