import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { maintenanceOperations } from './runtime.js';

export function createMaintenanceRouter({ service = maintenanceOperations, auth = authenticate } = {}) {
  const router = Router();
  router.use(auth, (req, res, next) => req.user?.hotelId && ['manager', 'maintenance'].includes(req.user.role)
    ? next() : errorResponse(res, 'Maintenance manager access required', 403));
  const run = fn => async (req, res) => {
    try { return successResponse(res, await fn(req)); }
    catch (error) { return errorResponse(res, error.code === 'P2002' ? 'That phone or assignment request already exists. Refresh before retrying.' : error.status ? error.message : 'Maintenance operations are temporarily unavailable.', error.code === 'P2002' ? 409 : error.status || 503); }
  };
  router.get('/', run(req => service.read(req.user)));
  router.post('/workers', run(req => service.saveWorker(req.user, null, req.body)));
  router.patch('/workers/:id', run(req => service.saveWorker(req.user, req.params.id, req.body)));
  router.put('/config', run(req => service.saveConfig(req.user, req.body)));
  router.post('/assignments', run(req => service.assign(req.user, req.body)));
  router.patch('/work/:kind/:id', run(req => service.updateStatus(req.user, req.params.kind, req.params.id, req.body)));
  return router;
}
export default createMaintenanceRouter();
