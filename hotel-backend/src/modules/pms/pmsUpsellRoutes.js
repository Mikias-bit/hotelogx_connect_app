import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middlewares/auth.js';
import { createPmsMcpClient } from './pmsMcpClient.js';
import { unpackMcp } from './pmsAiTools.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { upsellCategories, claimOutreach } from '../upsells/upsellOutreach.js';
import { defaultUpsellConfig } from '../upsells/upsellDelivery.js';
import { catalogueIdeas } from '../upsells/upsellRecommendations.js';

export function createUpsellRouter({ db = prisma, client = createPmsMcpClient(), authenticateStaff = authenticate, delivery } = {}) {
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
  const sender = async () => delivery || (await import('../upsells/upsellRuntime.js')).upsellDelivery;
  router.get('/automation', wrap(async req => await db.upsellAutomationConfig.findUnique({ where: { hotelId: req.user.hotelId } }) || defaultUpsellConfig));
  router.put('/automation', wrap(async req => {
    requireValue(req.user.role === 'manager', 'Only managers can configure automatic offers');
    const b = req.body;
    requireValue(typeof b.enabled === 'boolean' && Number.isInteger(b.daysBeforeArrival) && b.daysBeforeArrival >= 0 && b.daysBeforeArrival <= 365, 'Choose a whole number of days from 0 to 365');
    requireValue(['email_first', 'email', 'whatsapp'].includes(b.channel), 'Choose a supported channel');
    requireValue(typeof b.whatsappTemplate === 'string' && /^(|[a-z0-9_]{1,100})$/.test(b.whatsappTemplate) && typeof b.whatsappLanguage === 'string' && /^[a-z]{2,3}(_[A-Z]{2})?$/.test(b.whatsappLanguage), 'Enter a valid approved WhatsApp template and language');
    requireValue(b.channel !== 'whatsapp' || b.whatsappTemplate, 'WhatsApp campaigns require an approved template');
    const data = { enabled: b.enabled, daysBeforeArrival: b.daysBeforeArrival, channel: b.channel, whatsappTemplate: b.whatsappTemplate, whatsappLanguage: b.whatsappLanguage, updatedBy: req.user.id };
    return db.upsellAutomationConfig.upsert({ where: { hotelId: req.user.hotelId }, create: { hotelId: req.user.hotelId, ...data }, update: data });
  }));
  router.post('/automation/run', wrap(async req => {
    requireValue(req.user.role === 'manager', 'Only managers can run automatic offers');
    return (await sender()).runHotel(req.user.hotelId);
  }));
  router.get('/recommendations/:conversationId', wrap(async req => {
    await conversation(req, req.params.conversationId);
    const messages = await db.message.findMany({ where: { conversationId: req.params.conversationId, author: 'guest' }, orderBy: { createdAt: 'desc' }, take: 8 });
    return catalogueIdeas(db, client, req.user.hotelId, req.params.conversationId, messages.map(m => m.body).join('\n'), req.user);
  }));
  router.post('/recommendations/:conversationId/send', wrap(async req => {
    await conversation(req, req.params.conversationId);
    requireValue(typeof req.body.productId === 'string' && req.body.productId.length > 0, 'Select a catalogue product');
    requireValue(['email', 'whatsapp'].includes(req.body.channel), 'Choose email or WhatsApp');
    return (await sender()).send({ hotelId: req.user.hotelId, conversationId: req.params.conversationId, productIds: [req.body.productId], channel: req.body.channel, source: 'staff' });
  }));
  router.post('/recommendations/:conversationId/record', wrap(async req => {
    await conversation(req, req.params.conversationId);
    requireValue(typeof req.body.productId === 'string' && req.body.productId.length > 0, 'Choose a configured catalogue product');
    requireValue(typeof req.body.note === 'string' && req.body.note.trim().length >= 5 && req.body.note.length <= 1000, 'Record where and when staff already offered this extra');
    const product = await db.pmsUpsellProduct.findFirst({ where: { hotelId: req.user.hotelId, productId: req.body.productId, active: true } });
    requireValue(product, 'Choose a configured catalogue product');
    const claim = await claimOutreach(db, { hotelId: req.user.hotelId, conversationId: req.params.conversationId, products: [product], source: 'staff_external' });
    await db.upsellOutreach.updateMany({ where: { hotelId: req.user.hotelId, messageId: claim.messageId }, data: { status: 'recorded', lastError: `Recorded by ${req.user.id}: ${req.body.note.trim()}` } });
    return { status: 'recorded' };
  }));
  router.get('/', wrap(async req => {
    const conversationId = req.query.conversationId;
    if (conversationId !== undefined) {
      requireValue(typeof conversationId === 'string' && conversationId.length > 0, 'Choose a conversation');
      await conversation(req, conversationId);
    }
    const where = { hotelId: req.user.hotelId, ...(conversationId ? { conversationId } : {}) };
    return {
      products: conversationId ? [] : await db.pmsUpsellProduct.findMany({ where: { hotelId: req.user.hotelId } }),
      offers: await db.pmsUpsellOffer.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }),
      bindings: await db.pmsConversationBinding.findMany({ where }),
    };
  }));
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
      verifiedBy: req.user.id, verifiedAt: new Date(), verificationMethod: 'staff', expiresAt: null };
    return db.pmsConversationBinding.upsert({ where: { conversationId: req.params.conversationId },
      create: { conversationId: req.params.conversationId, ...values }, update: values });
  }));
  router.put('/products/:productId', wrap(async req => {
    requireValue(req.user.role === 'manager', 'Only managers can configure product pricing and autonomy');
    const b = req.body;
    requireValue(typeof b.label === 'string' && b.label.trim().length > 0 && b.label.length <= 200, 'Enter a product label');
    requireValue(upsellCategories.includes(b.category) && ['pms', 'knowledge'].includes(b.priceSource), 'Invalid product category or price source');
    requireValue(b.keywords === undefined || (typeof b.keywords === 'string' && b.keywords.length <= 500), 'Keywords must be under 500 characters');
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
      active: b.active !== false, preArrival: b.preArrival === true, keywords: b.keywords || '', updatedBy: req.user.id };
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
