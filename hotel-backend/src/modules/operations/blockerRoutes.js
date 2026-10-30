import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middlewares/auth.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { realtimeService } from '../../services/realtimeService.js';
import { createBlockerService } from './blockers.js';
export const blockerService = createBlockerService({ db: prisma, broadcast: (...args) => realtimeService.broadcastToHotel(...args) });
export function blockerRouter({ auth = authenticate, service = blockerService } = {}) {
  const router = Router(); router.use(auth);
  const run = fn => async (req, res) => { try { return successResponse(res, await fn(req)); } catch (err) { return errorResponse(res, err.code === 'P2002' ? 'This blocker already exists. Refresh and update it.' : err.status ? err.message : 'Follow-ups are temporarily unavailable', err.code === 'P2002' ? 409 : err.status || 503); } };
  router.get('/', run(req => service.read(req.user)));
  router.post('/', run(req => service.save(req.user, null, req.body)));
  router.patch('/:id', run(req => service.save(req.user, req.params.id, req.body)));
  router.post('/:id/resolve', run(req => service.resolve(req.user, req.params.id, req.body)));
  router.post('/carry/:id/review', run(req => service.reviewCarry(req.user, req.params.id, req.body)));
  return router;
}
export default blockerRouter();
