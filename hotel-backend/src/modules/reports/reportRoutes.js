import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../config/database.js';
import { authenticate } from '../../middlewares/auth.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { allowedKinds, hash, ingestReports, readReports, reviewItem } from './reportService.js';
import { realtimeService } from '../../services/realtimeService.js';
export function reportRouter({ db = prisma, auth = authenticate, broadcast = (...args) => realtimeService.broadcastToHotel(...args) } = {}) {
  const router = Router();
  const run = fn => async (req, res) => {
    try { await fn(req, res); } catch (err) {
      if (err.code === 'P2002') return errorResponse(res, 'This engine hotel ID is already connected to another hotel', 409);
      if (!err.status) console.error('[Daily reports] Request failed', { code: err.code || err.constructor.name });
      return errorResponse(res, err.status ? err.message : 'Daily reports are temporarily unavailable', err.status || 503);
    }
  };
  router.post('/ingest', run(async (req, res) => {
    const token = req.headers.authorization?.match(/^Bearer (hxr_[a-f0-9]{64})$/)?.[1];
    if (!token) return errorResponse(res, 'Report source authorization required', 401);
    const source = await db.dailyReportSource.findUnique({ where: { tokenHash: hash(token) } });
    if (!source?.enabled) return errorResponse(res, 'Invalid report source credential', 401);
    const result = await ingestReports(db, source, req.body);
    // No report content is broadcast to roles that cannot access it.
    broadcast(source.hotelId, 'reports:updated', { refresh: true });
    return successResponse(res, result);
  }));
  router.use(auth);
  router.use((req, res, next) => {
    if (!req.user?.hotelId || !allowedKinds(req.user.role).length) return errorResponse(res, 'Daily report access denied', 403);
    next();
  });
  router.get('/', run(async (req, res) => successResponse(res, await readReports(db, req.user, req.query.date))));
  router.patch('/review', run(async (req, res) => {
    const review = await reviewItem(db, req.user, req.body);
    broadcast(req.user.hotelId, 'reports:updated', { refresh: true });
    return successResponse(res, { status: review.status, updatedAt: review.updatedAt });
  }));
  router.get('/source', run(async (req, res) => {
    if (req.user.role !== 'manager') return errorResponse(res, 'Manager access required', 403);
    const source = await db.dailyReportSource.findUnique({ where: { hotelId: req.user.hotelId }, select: { engineHotelId: true, enabled: true, updatedAt: true } });
    return successResponse(res, source || { enabled: false });
  }));
  router.post('/source', run(async (req, res) => {
    if (req.user.role !== 'manager') return errorResponse(res, 'Manager access required', 403);
    const engineHotelId = req.body.engineHotelId;
    if (typeof engineHotelId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(engineHotelId)) return errorResponse(res, 'Enter a valid engine hotel ID', 400);
    const token = `hxr_${randomBytes(32).toString('hex')}`;
    await db.dailyReportSource.upsert({ where: { hotelId: req.user.hotelId }, create: { hotelId: req.user.hotelId, engineHotelId, tokenHash: hash(token) }, update: { engineHotelId, tokenHash: hash(token), enabled: true } });
    res.setHeader('Cache-Control', 'no-store');
    return successResponse(res, { engineHotelId, token }, 'Save this key in the engine secret configuration; it is shown only once. Previous keys are revoked.');
  }));
  return router;
}
export default reportRouter();
