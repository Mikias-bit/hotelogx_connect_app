import { Router } from 'express';
export function createUpsellWorkerRouter({ verify, run, env = process.env }) {
  const router = Router();
  router.post('/upsell-campaigns', async (req, res) => {
    if (!env.UPSELL_WORKER_AUDIENCE || !env.UPSELL_WORKER_SERVICE_ACCOUNT) return res.status(503).json({ success: false, message: 'Upsell worker identity is not configured' });
    try { await verify(req.headers.authorization, { audience: env.UPSELL_WORKER_AUDIENCE, serviceAccountEmail: env.UPSELL_WORKER_SERVICE_ACCOUNT }); }
    catch { return res.status(401).json({ success: false, message: 'Worker identity not authorized' }); }
    try { await run(); return res.json({ success: true }); }
    catch { return res.status(503).json({ success: false, message: 'Upsell campaign check failed' }); }
  });
  return router;
}
