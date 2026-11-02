import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middlewares/auth.js';
import { createPmsMcpClient } from './pmsMcpClient.js';
import { unpackMcp } from './pmsAiTools.js';
import { savePmsHandoff } from './pmsHandoff.js';
import { successResponse, errorResponse } from '../../utils/response.js';

const requireValue = (condition, text) => { if (!condition) throw Object.assign(new Error(text), { publicMessage: text, status: 400 }); };
export function createBookingRouter({ db = prisma, client = createPmsMcpClient(), authenticateStaff = authenticate } = {}) {
  const router = Router();
  router.use(authenticateStaff, (req, res, next) => req.user?.hotelId && ['manager', 'front-office'].includes(req.user.role) ? next() : errorResponse(res, 'Front Office or manager access required', 403));
  const wrap = fn => async (req, res) => {
    try { return successResponse(res, await fn(req)); }
    catch (error) { return errorResponse(res, error.publicMessage || 'Booking request could not be confirmed. Check Mews before retrying a reservation.', error.status || 409); }
  };
  const conversation = async (req, id) => {
    requireValue(typeof id === 'string' && id.length > 0, 'Choose a conversation');
    requireValue(await db.conversation.findFirst({ where: { id, guest: { hotelId: req.user.hotelId } } }), 'Conversation not found in this hotel');
  };
  router.get('/config', wrap(async req => db.pmsBookingConfig.findUnique({ where: { hotelId: req.user.hotelId } })));
  router.post('/disable', wrap(async req => {
    requireValue(req.user.role === 'manager', 'Only a manager can disable chat bookings');
    await db.pmsBookingConfig.updateMany({ where: { hotelId: req.user.hotelId }, data: { enabled: false, autoBook: false, updatedBy: req.user.id } });
    return { disabled: true };
  }));
  router.get('/catalog', wrap(async req => {
    requireValue(typeof req.query.serviceId === 'string', 'Select a service');
    return unpackMcp(await client.callTool(req.user, 'get_booking_catalog', { service_id: req.query.serviceId }));
  }));
  router.get('/services', wrap(async req => unpackMcp(await client.callTool(req.user, 'get_booking_catalog', { service_id: '' }))));
  router.put('/config', wrap(async req => {
    requireValue(req.user.role === 'manager', 'Only a manager can enable bookings or change booking policy');
    const b = req.body;
    requireValue(typeof b.enabled === 'boolean' && typeof b.autoBook === 'boolean', 'Choose booking and approval settings');
    requireValue(typeof b.serviceId === 'string' && Array.isArray(b.categoryIds) && b.categoryIds.length > 0 && b.categoryIds.length <= 3 && new Set(b.categoryIds).size === b.categoryIds.length, 'Choose 1–3 room categories');
    requireValue(b.rateTerms && !Array.isArray(b.rateTerms) && typeof b.rateTerms === 'object' && Object.keys(b.rateTerms).length > 0 && Object.keys(b.rateTerms).length <= 2 && Object.values(b.rateTerms).every(v => typeof v === 'string' && v.trim().length >= 10 && v.length <= 1200), 'Choose 1–2 rates and describe their cancellation, inclusion and extra-charge terms');
    requireValue([b.arrivalTime, b.departureTime].every(v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)), 'Enter hotel check-in/check-out times');
    requireValue(typeof b.paymentInstructions === 'string' && b.paymentInstructions.trim().length >= 10 && b.paymentInstructions.length <= 1000, 'Describe how staff arrange payment; do not request card details in chat');
    requireValue(b.paymentProcedureReviewed === true, 'Confirm these rates allow booking before staff arrange payment and review any Mews payment automations');
    const catalogue = unpackMcp(await client.callTool(req.user, 'get_booking_catalog', { service_id: b.serviceId }));
    requireValue(b.categoryIds.every(id => catalogue.categories?.some(c => c.id === id)) && Object.keys(b.rateTerms).every(id => catalogue.rates?.some(r => r.id === id)), 'Selected rooms/rates must be active and available for this hotel');
    const data = { enabled: b.enabled, autoBook: b.autoBook, serviceId: b.serviceId, categoryIds: b.categoryIds, rateTerms: b.rateTerms, arrivalTime: b.arrivalTime, departureTime: b.departureTime, paymentInstructions: b.paymentInstructions.trim(), updatedBy: req.user.id };
    return db.pmsBookingConfig.upsert({ where: { hotelId: req.user.hotelId }, create: { hotelId: req.user.hotelId, ...data }, update: data });
  }));
  router.get('/offers', wrap(async req => {
    await conversation(req, req.query.conversationId);
    return db.pmsBookingOffer.findMany({ where: { hotelId: req.user.hotelId, conversationId: req.query.conversationId }, orderBy: { createdAt: 'desc' }, take: 30 });
  }));
  const offer = async req => {
    const row = await db.pmsBookingOffer.findFirst({ where: { id: req.params.id, hotelId: req.user.hotelId } });
    requireValue(row, 'Booking request not found'); await conversation(req, row.conversationId); return row;
  };
  router.post('/offers/:id/approve', wrap(async req => {
    const row = await offer(req);
    requireValue(typeof req.body.note === 'string' && req.body.note.trim().length >= 10 && req.body.note.length <= 1000 && req.body.restrictionsChecked === true, 'Check occupancy, Mews rate restrictions, guest details and payment procedure; record your approval');
    requireValue(['offered', 'pending_approval'].includes(row.status) && row.expiresAt > new Date(), 'Only an open, unexpired request can be approved; the guest must also accept');
    const changed = await db.pmsBookingOffer.updateMany({ where: { id: row.id, hotelId: req.user.hotelId, status: { in: ['offered', 'pending_approval'] }, expiresAt: { gt: new Date() } }, data: { approvedBy: req.user.id, approvedAt: new Date(), approvalNote: req.body.note.trim() } });
    requireValue(changed.count === 1, 'Request changed; refresh');
    const result = unpackMcp(await client.callStaffConversationTool(req.user, row.conversationId, 'create_accepted_booking', { offer_id: row.id }));
    await savePmsHandoff(db, { hotelId: req.user.hotelId, conversationId: row.conversationId, raisedAt: new Date().toISOString() }, { status: result.status });
    await db.conversation.updateMany({ where: { id: row.conversationId, guest: { hotelId: req.user.hotelId } }, data: { suggestedReply: result.reply_text } });
    return result;
  }));
  router.post('/offers/:id/reject', wrap(async req => {
    const row = await offer(req);
    const changed = await db.pmsBookingOffer.updateMany({ where: { id: row.id, hotelId: req.user.hotelId, status: { in: ['offered', 'pending_approval'] } }, data: { status: 'rejected' } });
    requireValue(changed.count === 1, 'Only an open request can be rejected'); return { rejected: true };
  }));
  router.post('/offers/:id/payment-follow-up', wrap(async req => {
    const row = await offer(req);
    requireValue(row.status === 'booked' && typeof req.body.note === 'string' && req.body.note.trim().length >= 10 && req.body.note.length <= 1000, 'Record how staff handled the payment follow-up; never include card details');
    return db.pmsBookingOffer.update({ where: { id: row.id }, data: { paymentStatus: 'handled_by_staff', paymentFollowUpBy: req.user.id, paymentFollowUpAt: new Date(), paymentFollowUpNote: req.body.note.trim() } });
  }));
  return router;
}
