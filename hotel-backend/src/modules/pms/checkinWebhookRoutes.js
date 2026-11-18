import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '../../config/database.js';
import { checkinAutomation } from './checkinRuntime.js';
export function validCheckinSecret(received, expected) {
  return typeof expected === 'string' && expected.length >= 32 && typeof received === 'string'
    && Buffer.byteLength(received) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
export function createCheckinWebhookRouter({ db = prisma, automation = checkinAutomation, env = process.env } = {}) {
  const router = Router();
  router.post('/webhook/mews/general', async (req, res) => {
    if (!validCheckinSecret(req.get('x-webhook-secret') || req.query.secret, env.MEWS_GENERAL_WEBHOOK_SECRET)) return res.status(401).json({ error: 'Webhook authentication failed' });
    const { EnterpriseId, IntegrationId, Events } = req.body || {};
    if (typeof EnterpriseId !== 'string' || typeof IntegrationId !== 'string' || !Array.isArray(Events) || Events.length > 1000) return res.status(400).json({ error: 'Invalid Mews event batch' });
    try {
      const configs = await db.guestMessagingConfig.findMany({ where: { mewsEnterpriseId: EnterpriseId, mewsIntegrationId: IntegrationId, automaticEnabled: true }, take: 2 });
      if (configs.length !== 1) return res.status(409).json({ error: 'No unique enabled hotel mapping' });
      const ids = Events.filter(e => e?.Discriminator === 'ServiceOrderUpdated').map(e => e.Value?.Id);
      if (ids.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))) return res.status(400).json({ error: 'Invalid reservation identifier' });
      await automation.enqueue(configs[0].hotelId, ids);
      // No PMS reads or guest sends in this request: acknowledge durable work.
      return res.status(202).json({ accepted: ids.length });
    } catch { return res.status(503).json({ error: 'Could not persist webhook; retry required' }); }
  });
  router.post('/guest-messaging-worker', async (req, res) => {
    if (!validCheckinSecret(req.get('authorization')?.replace(/^Bearer /, ''), env.CHECKIN_WORKER_SECRET)) return res.status(401).json({ error: 'Worker authentication failed' });
    try { await automation.run(); return res.json({ success: true }); }
    catch { return res.status(503).json({ error: 'Worker failed; retry required' }); }
  });
  return router;
}
