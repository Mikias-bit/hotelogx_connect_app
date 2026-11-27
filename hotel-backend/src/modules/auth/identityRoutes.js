import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { signToken } from '../../utils/jwt.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { createIdentityAdmission } from './netlifyIdentity.js';
import { createAccessDelivery } from './accessDelivery.js';

export function createIdentityRouter({ db = prisma, admit = createIdentityAdmission({ db }), sign = signToken, delivery = createAccessDelivery({ db }) } = {}) {
  const router = Router(), requests = new Map();
  router.use(['/identity', '/request-access'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const now = Date.now(), key = req.ip || 'unknown';
    for (const [ip, value] of requests) if (value.until < now) requests.delete(ip);
    const value = requests.get(key) || { count: 0, until: now + 900000 };
    if (value.count >= 30 || (!requests.has(key) && requests.size >= 10000)) return errorResponse(res, 'Please try again later.', 429);
    value.count++; requests.set(key, value); next();
  });
  router.post('/identity', async (req, res) => {
    try {
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
      const result = await admit(token);
      const { id, hotelId, role, name, email } = result.user;
      return successResponse(res, { ...result, token: sign({ id, hotelId, role, name, email, authProvider: 'netlify' }, '30m') });
    } catch (error) { return errorResponse(res, error.status ? error.message : 'Could not verify hotel access. Please try again.', error.status || 503); }
  });
  router.post('/request-access', async (req, res) => {
    const { name, hotelName, email } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || typeof hotelName !== 'string' || !hotelName.trim() || hotelName.length > 200
      || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return errorResponse(res, 'Enter your name, hotel and work email.', 400);
    try {
      const record = await db.hotelAccessRequest.upsert({ where: { email: email.trim().toLowerCase() }, update: {},
        create: { email: email.trim().toLowerCase(), name: name.trim(), hotelName: hotelName.trim() } });
      // Request remains durable even when the operator mailbox is unavailable.
      try { await delivery.notify(record.id); } catch { console.warn('Access request notification needs operator review'); }
      return successResponse(res, { received: true }, 'Your request has been recorded. Access requires approval.', 202);
    } catch { return errorResponse(res, 'Could not record your request. Please try again.', 503); }
  });
  return router;
}
