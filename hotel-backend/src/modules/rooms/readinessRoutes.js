import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middlewares/auth.js';
import { realtimeService } from '../../services/realtimeService.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { createReadinessService } from './readinessService.js';
export const readinessService = createReadinessService({ db: prisma, broadcast: (...args) => realtimeService.broadcastToHotel(...args) });
export function readinessRouter({ auth = authenticate, service = readinessService } = {}) {
  const router = Router(); router.use(auth);
  const run = fn => async (req, res) => { try { return successResponse(res, await fn(req)); } catch (err) { return errorResponse(res, err.status ? err.message : 'Room readiness is temporarily unavailable', err.status || 503); } };
  router.get('/', run(req => service.read(req.user)));
  router.patch('/:number', run(req => service.update(req.user, req.params.number, req.body)));
  return router;
}
export default readinessRouter();
