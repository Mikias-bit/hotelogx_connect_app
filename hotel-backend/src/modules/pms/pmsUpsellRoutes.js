import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middlewares/auth.js';
import { createPmsMcpClient } from './pmsMcpClient.js';
import { unpackMcp } from './pmsAiTools.js';
import { successResponse, errorResponse } from '../../utils/response.js';

export function createUpsellRouter({ db = prisma, client = createPmsMcpClient(), authenticateStaff = authenticate } = {}) {
  const router = Router();
  router.use(authenticateStaff, (req, res, next) => ['manager', 'front-office'].includes(req.user.role)
    ? next() : errorResponse(res, 'Staff access required', 403));
  const wrap = fn => async (req, res) => { try { return successResponse(res, await fn(req)); }
    catch (error) { return errorResponse(res, error.publicMessage || 'PMS request could not be completed; check the connection and request details', error.status || 409); } };
  const requireValue = (value, message) => { if (!value) throw Object.assign(new Error(message), { publicMessage: message, status: 400 }); };
  const conversation = async (req, id) => {
    const row = await db.conversation.findFirst({ where: { id, guest: { hotelId: req.user.hotelId } } });
    requireValue(row, 'Conversation not found in this hotel'); return row;
  };
  router.get('/', wrap(async req => ({
    products: await db.pmsUpsellProduct.findMany({ where: { hotelId: req.user.hotelId } }),
    offers: await db.pmsUpsellOffer.findMany({ where: { hotelId: req.user.hotelId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    bindings: await db.pmsConversationBinding.findMany({ where: { hotelId: req.user.hotelId } }),
  })));
  router.get('/products/search', wrap(async req => {
    requireValue(typeof req.query.q === 'string' && req.query.q.length > 0 && req.query.q.length <= 200, 'Enter a product search');
    return unpackMcp(await client.callTool(req.user, 'search_upsell_products', { query: req.query.q }));
  }));
  router.put('/bindings/:conversationId', wrap(async req => {
    await conversation(req, req.params.conversationId);
    requireValue(req.body.identityVerified === true && typeof req.body.reservationId === 'string', 'Verify the guest identity before linking a reservation');
    const data = unpackMcp(await client.callTool(req.user, 'get_reservations', { reservation_ids: [req.body.reservationId] }));
    const reservation = data.Reservations?.find(row => row.Id === req.body.reservationId);
    requireValue(reservation?.AccountType === 'Customer' && ['Confirmed', 'Started'].includes(reservation.State), 'An active guest reservation is required');
    const values = { hotelId: req.user.hotelId, reservationId: reservation.Id, customerId: reservation.AccountId,
      verifiedBy: req.user.id, verifiedAt: new Date() };
    return db.pmsConversationBinding.upsert({ where: { conversationId: req.params.conversationId },
      create: { conversationId: req.params.conversationId, ...values }, update: values });
  }));
  router.put('/products/:productId', wrap(async req => {
    requireValue(req.user.role === 'manager', 'Only managers can configure product pricing and autonomy');
    const b = req.body;
    requireValue(typeof b.label === 'string' && b.label.trim().length > 0 && b.label.length <= 200, 'Enter a product label');
    requireValue(['other', 'breakfast', 'late_checkout', 'early_checkin'].includes(b.category) && ['pms', 'knowledge'].includes(b.priceSource), 'Invalid product category or price source');
    const data = unpackMcp(await client.callTool(req.user, 'get_products', { service_id: b.serviceId }));
    const product = data.Products?.find(row => row.Id === req.params.productId && row.ServiceId === b.serviceId && row.IsActive);
    requireValue(product, 'Product must be active and belong to this hotel');
    if (b.priceSource === 'knowledge') {
      requireValue(typeof b.knowledgeDocId === 'string' && b.knowledgeDocId.length > 0, 'Select a source document');
      requireValue(Number.isFinite(Number(b.unitAmount)) && Number(b.unitAmount) > 0 && Number(b.unitAmount) <= 10000 && /^\d+(\.\d{1,2})?$/.test(String(b.unitAmount)), 'Enter a positive price with up to two decimals');
      requireValue(b.currency === product.Price?.Currency, 'Currency must match the PMS product');
      requireValue(await db.knowledgeDoc.findFirst({ where: { id: b.knowledgeDocId, hotelId: req.user.hotelId, aiReady: true, status: 'indexed' } }), 'Select an indexed knowledge document for this hotel');
    }
    const values = { serviceId: product.ServiceId, label: b.label.trim(), category: b.category, priceSource: b.priceSource,
      unitAmount: b.priceSource === 'knowledge' ? b.unitAmount : null, currency: b.priceSource === 'knowledge' ? b.currency : null,
      knowledgeDocId: b.priceSource === 'knowledge' ? b.knowledgeDocId : null, autoPost: b.autoPost === true,
      active: b.active !== false, updatedBy: req.user.id };
    return db.pmsUpsellProduct.upsert({ where: { hotelId_productId: { hotelId: req.user.hotelId, productId: product.Id } },
      create: { hotelId: req.user.hotelId, productId: product.Id, ...values }, update: values });
  }));
  router.post('/offers/:id/approve', wrap(async req => {
    requireValue(typeof req.body.note === 'string' && req.body.note.trim().length >= 5 && req.body.note.length <= 1000, 'Record the approval reason and any availability check');
    const offer = await db.pmsUpsellOffer.findFirst({ where: { id: req.params.id, hotelId: req.user.hotelId } });
    requireValue(offer, 'Offer not found');
    await conversation(req, offer.conversationId);
    requireValue(['offered', 'pending_approval'].includes(offer.status) && offer.expiresAt > new Date(), 'Offer is closed, expired, or already processing');
    const changed = await db.pmsUpsellOffer.updateMany({ where: { id: offer.id, hotelId: req.user.hotelId, status: { in: ['offered', 'pending_approval'] }, expiresAt: { gt: new Date() } },
      data: { approvedBy: req.user.id, approvedAt: new Date(), approvalNote: req.body.note.trim() } });
    requireValue(changed.count === 1, 'Offer changed; refresh before proceeding');
    return unpackMcp(await client.callStaffConversationTool(req.user, offer.conversationId, 'post_accepted_upsell', { offer_id: offer.id }));
  }));
  router.post('/offers/:id/reject', wrap(async req => {
    const result = await db.pmsUpsellOffer.updateMany({ where: { id: req.params.id, hotelId: req.user.hotelId, status: { in: ['offered', 'pending_approval'] } }, data: { status: 'rejected' } });
    requireValue(result.count === 1, 'Only open offers can be rejected'); return { rejected: true };
  }));
  return router;
}
