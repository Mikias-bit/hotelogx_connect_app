import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middlewares/auth.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { realtimeService } from '../../services/realtimeService.js';
import { allowedKinds } from './reportService.js';
import { readOperations, updateReportTask, failOperation } from './reportOperations.js';
import { housekeepingOperations } from './operationsRuntime.js';

export function operationsRouter({ db = prisma, auth = authenticate, service = housekeepingOperations, broadcast = (...args) => realtimeService.broadcastToHotel(...args) } = {}) {
  const router = Router();
  router.use(auth, (req, res, next) => req.user?.hotelId && allowedKinds(req.user.role).length ? next() : errorResponse(res, 'Operational access denied', 403));
  const run = fn => async (req, res) => {
    try { return successResponse(res, await fn(req)); }
    catch (err) { return errorResponse(res, err.code === 'P2002' ? 'This phone or request is already registered; refresh before retrying' : err.status ? err.message : 'Operations are temporarily unavailable', err.code === 'P2002' ? 409 : err.status || 503); }
  };
  const manager = user => { if (!['manager', 'housekeeping'].includes(user.role)) failOperation('Housekeeping manager access required', 403); };
  router.get('/', run(req => readOperations(db, req.user)));
  router.patch('/tasks/:id', run(async req => {
    const task = await updateReportTask(db, req.user, req.params.id, req.body);
    broadcast(req.user.hotelId, 'reports:updated', { refresh: true }); return task;
  }));
  router.post('/assignments', run(req => service.assign(req.user, req.body)));
  router.get('/assignments', run(async req => { manager(req.user); return db.housekeepingAssignment.findMany({ where: { hotelId: req.user.hotelId }, orderBy: { createdAt: 'desc' }, take: 50 }); }));
  const saveWorker = async req => {
    manager(req.user);
    const { name, phone, active = true, whatsappEnabled = false, language = 'en' } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || !/^\+[1-9]\d{7,14}$/.test(phone || '') || typeof active !== 'boolean' || typeof whatsappEnabled !== 'boolean' || !/^[a-z]{2}(?:[_-][A-Z]{2})?$/.test(language)) failOperation('Enter a name, international phone (+country code), and valid worker settings');
    const data = { name: name.trim(), phone, active, whatsappEnabled, language };
    const worker = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${req.user.hotelId}`}, 0))`;
      if (!req.params.id) return tx.housekeepingWorker.create({ data: { ...data, hotelId: req.user.hotelId } });
      const old = await tx.housekeepingWorker.findFirst({ where: { id: req.params.id, hotelId: req.user.hotelId } });
      if (!old) failOperation('Worker not found', 404);
      // Changed contact details must open a new WhatsApp conversation. Stable ID retains history.
      return tx.housekeepingWorker.update({ where: { id: old.id }, data: { ...data, ...(phone !== old.phone ? { lastInboundAt: null, pendingProblemTaskId: null } : {}) } });
    });
    broadcast(req.user.hotelId, 'reports:updated', { refresh: true }); return worker;
  };
  router.post('/workers', run(saveWorker));
  router.patch('/workers/:id', run(saveWorker));
  router.get('/config', run(async req => { manager(req.user); return await db.housekeepingConfig.findUnique({ where: { hotelId: req.user.hotelId } }) || { templateName: '', templateLanguage: 'en_US' }; }));
  router.put('/config', run(async req => {
    manager(req.user); const { templateName = '', templateLanguage = 'en_US' } = req.body;
    if (!/^[a-z0-9_]{0,512}$/.test(templateName) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(templateLanguage)) failOperation('Enter a valid approved Meta template name and language');
    const data = { templateName: templateName || null, templateLanguage };
    return db.housekeepingConfig.upsert({ where: { hotelId: req.user.hotelId }, create: { hotelId: req.user.hotelId, ...data }, update: data });
  }));
  return router;
}
export default operationsRouter();
