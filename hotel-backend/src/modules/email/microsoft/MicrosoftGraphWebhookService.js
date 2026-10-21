import { randomUUID, timingSafeEqual } from 'node:crypto';
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length > 0 && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class MicrosoftGraphWebhookService {
  constructor({ db, enqueue }) { Object.assign(this, { db, enqueue }); }
  async accept(body) {
    if (!Array.isArray(body?.value) || !body.value.length || body.value.length > 1000) throw Object.assign(new Error('Invalid notifications'), { status: 400 });
    const jobs = new Map();
    for (const n of body.value) {
      if (typeof n.subscriptionId !== 'string') throw Object.assign(new Error('Missing subscription'), { status: 400 });
      const integration = await this.db.emailIntegration.findFirst({ where: { provider: 'microsoft', status: 'connected', graphSubscriptionId: n.subscriptionId } });
      if (!integration) continue; // Stale subscription following disconnect.
      if (!same(integration.graphClientState, n.clientState)) throw Object.assign(new Error('Invalid client state'), { status: 403 });
      const job = jobs.get(integration.hotelId) || { hotelId: integration.hotelId, revision: randomUUID() };
      if (['subscriptionRemoved', 'reauthorizationRequired'].includes(n.lifecycleEvent)) job.renew = true;
      // Every notification, including missed/removed lifecycle events, triggers delta recovery.
      jobs.set(integration.hotelId, job);
    }
    for (const job of jobs.values()) {
      await this.db.microsoftSyncJob.upsert({ where: { hotelId: job.hotelId }, create: job, update: job });
      await this.enqueue(job.hotelId); // Await dispatch, never background work after a Cloud Run response.
    }
    return { queued: jobs.size };
  }
}

export function createMicrosoftPushHandler(service) {
  return async (req, res) => {
    if (typeof req.query.validationToken === 'string') return res.status(200).type('text/plain').send(req.query.validationToken);
    try { await service.accept(req.body); return res.status(202).end(); }
    catch (error) {
      const status = [400, 403].includes(error.status) ? error.status : 503;
      console.warn('[Microsoft webhook] Rejected or retry required', { status });
      return res.status(status).json({ success: false, message: 'Microsoft notification could not be queued' });
    }
  };
}
