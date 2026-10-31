import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middlewares/auth.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { realtimeService } from '../../services/realtimeService.js';
import { createGuestHandoffService } from './guestHandoffs.js';
export const guestHandoffService = createGuestHandoffService({ db: prisma, broadcast: (...args) => realtimeService.broadcastToHotel(...args) });
export function guestHandoffRouter({ auth = authenticate, service = guestHandoffService } = {}) {
  const router = Router(); router.use(auth);
  const run = fn => async (req, res) => { try { return successResponse(res, await fn(req)); } catch (err) { return errorResponse(res, err.status ? err.message : 'Guest follow-up unavailable', err.status || 503); } };
  router.get('/', run(req => service.read(req.user)));
  router.post('/', run(req => service.enable(req.user, req.body)));
  router.post('/:id/actions', run(req => service.act(req.user, req.params.id, req.body)));
  return router;
}
export default guestHandoffRouter();
