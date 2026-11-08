import { sourceReply } from './bookingOrigin.js';
import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middlewares/auth.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { createPmsMcpClient } from './pmsMcpClient.js';
import { unpackMcp } from './pmsAiTools.js';
import { reviewReservationRequest, refreshRequestOrigin } from './reservationRequests.js';
import { readOperations } from '../reports/reportOperations.js';

export function createReservationRequestRouter({ db = prisma, client = createPmsMcpClient(), authenticateStaff = authenticate } = {}) {
  const router = Router();
  router.use(authenticateStaff, (req, res, next) => req.user?.hotelId && ['manager', 'front-office'].includes(req.user.role) ? next() : errorResponse(res, 'Front Office or manager access required', 403));
  const wrap = fn => async (req, res) => { try { return successResponse(res, await fn(req)); } catch (e) { return errorResponse(res, e.status ? e.message : 'Unable to review the request. Refresh and check the PMS connection.', e.status || 409); } };
  router.get('/:conversationId', wrap(async req => {
    const where = { hotelId: req.user.hotelId, conversationId: req.params.conversationId };
    const requests = await db.reservationServiceRequest.findMany({ where, orderBy: { createdAt: 'desc' } });
    const operations = requests.some(r => r.kind === 'extra_bed') ? await readOperations(db, req.user) : null;
    const ids = requests.map(r => r.taskId).filter(Boolean);
    const tasks = ids.length ? await db.reportTask.findMany({ where: { hotelId: req.user.hotelId, id: { in: ids } }, select: { id: true, status: true, completedAt: true } }) : [];
    return { requests: requests.map(r => ({ ...r, guidance: r.kind === 'extra_bed' ? null : sourceReply(r.bookingSource || {}) })), tasks, today: operations?.today, candidates: (operations?.tasks || []).filter(t => ['extra_bed_requested', 'make_sofa_bed'].includes(t.planData?.task)) };
  }));
  router.post('/:id/origin', wrap(req => refreshRequestOrigin(db, req.user, req.params.id, { client })));
  router.post('/:id/review', wrap(async req => {
    const routed = await refreshRequestOrigin(db, req.user, req.params.id, { client });
    if (routed.kind !== 'extra_bed' && routed.status !== 'pending' && !['resolved', 'rejected'].includes(routed.status)) throw Object.assign(new Error('Booking source is not direct. Review the source guidance before continuing.'), { status: 409 });
    let live;
    if (req.body.action === 'approve') {
      const request = await db.reservationServiceRequest.findFirst({ where: { id: req.params.id, hotelId: req.user.hotelId } });
      if (!request) throw Object.assign(new Error('Request not found'), { status: 404 });
      const binding = await db.pmsConversationBinding.findFirst({ where: { hotelId: req.user.hotelId, conversationId: request.conversationId } });
      if (binding) {
        const result = unpackMcp(await client.callTool(req.user, 'get_reservations', { reservation_ids: [binding.reservationId] }));
        live = result.Reservations?.find(r => r.Id === binding.reservationId);
      }
    }
    return reviewReservationRequest(db, req.user, req.params.id, req.body, live);
  }));
  return router;
}
