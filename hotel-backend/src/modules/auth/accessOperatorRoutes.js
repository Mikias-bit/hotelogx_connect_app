import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middlewares/auth.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { createAccessDelivery } from './accessDelivery.js';
import { approveHotelAccess } from './hotelAccessApproval.js';

export function createAccessOperatorRouter({ db = prisma, auth = authenticate, env = process.env, delivery = createAccessDelivery({ db, env }) } = {}) {
  const router = Router();
  router.use(auth, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const ids = (env.HOTELOGX_OPERATOR_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.includes(req.user.id)) return errorResponse(res, 'Hotelogx operator access required.', 403);
    next();
  });
  const wrap = fn => async (req, res) => { try { return successResponse(res, await fn(req)); } catch { return errorResponse(res, 'Could not complete this action. Check existing account, hotel and invitation status before retrying.', 409); } };
  router.get('/permission', (req, res) => successResponse(res, { allowed: true }));
  router.get('/', wrap(async () => ({
    requests: await db.hotelAccessRequest.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 100 }),
    invitations: await db.hotelOnboardingInvite.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    notificationReady: delivery.notificationReady(), invitationReady: delivery.invitationReady(),
  })));
  router.post('/approve', wrap(async req => {
    if (req.body.confirmed !== true) throw new Error('Confirm approval');
    // Only the authenticated operator can select the hotel. Requesters cannot.
    const input = { email: req.body.email, name: req.body.name, hotelName: req.body.hotelName, hotelId: req.body.hotelId,
      linkExistingUser: req.body.linkExistingUser === true, approvedBy: req.user.id };
    const result = await approveHotelAccess(db, input);
    const deliveryResult = await delivery.sendInvite(result.invitationId);
    return { ...result, delivery: deliveryResult };
  }));
  router.post('/invitations/:id/send', wrap(req => {
    if (req.body.confirmed !== true) throw new Error('Confirm sending');
    return delivery.sendInvite(req.params.id);
  }));
  router.post('/requests/:id/notify', wrap(req => delivery.notify(req.params.id)));
  router.post('/requests/:id/reject', wrap(req => db.hotelAccessRequest.updateMany({ where: { id: req.params.id, status: 'pending' }, data: { status: 'rejected' } })));
  return router;
}
