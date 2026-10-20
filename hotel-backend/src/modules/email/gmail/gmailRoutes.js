import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth.js';
import { config } from '../../../config/env.js';
import { prisma } from '../../../config/database.js';
import { gmailPubSubService, gmailWatchService, gmailPollingService, googleOidcVerifier, withGmailMailboxLock } from './runtime.js';

export const requireGmailManager = (req, res, next) => {
  if (req.user?.role !== 'manager' || !req.user.hotelId) return res.status(403).json({ success: false, message: 'Hotel manager access required' });
  next();
};

export function createPushHandler({ verifier, pubsub, auth }) {
  return async (req, res) => {
    try {
      await verifier.verifyAuthorizationHeader(req.headers.authorization, auth);
      await pubsub.processPushEnvelope(req.body);
      return res.status(204).end();
    } catch (error) {
      const status = [400, 401, 403, 503].includes(error.status) ? error.status : 500;
      console.warn('[Gmail push] Request failed', { status, type: error.constructor.name });
      return res.status(status).json({ success: false, message: status === 401 ? 'Invalid push identity' : 'Gmail notification not processed' });
    }
  };
}

export const gmailPushHandler = createPushHandler({ verifier: googleOidcVerifier, pubsub: gmailPubSubService,
  auth: { audience: config.googlePubSub.expectedAudience, serviceAccountEmail: config.googlePubSub.pushServiceAccount } });

export const gmailWorkerRouter = Router();
gmailWorkerRouter.use(async (req, res, next) => {
  try {
    await googleOidcVerifier.verifyAuthorizationHeader(req.headers.authorization, {
      audience: config.googlePubSub.workerAudience, serviceAccountEmail: config.googlePubSub.workerServiceAccount,
    });
    next();
  } catch (error) { res.status(error.status || 401).json({ success: false, message: 'Worker identity not authorized' }); }
});
for (const [path, run] of [
  ['/gmail-poll', () => gmailPollingService.pollConnectedMailboxes()],
  ['/gmail-watch/renew', () => gmailWatchService.renewExpiringWatches()],
  ['/subscription-renewal', () => gmailWatchService.renewExpiringWatches()],
]) {
  gmailWorkerRouter.post(path, async (req, res) => {
    try { const result = await run(); res.status(result.success ? 200 : 503).json(result); }
    catch { res.status(503).json({ success: false, message: 'Gmail worker failed; retry required' }); }
  });
}

export const gmailManagerRouter = Router();
gmailManagerRouter.use(authenticate, requireGmailManager);
gmailManagerRouter.get('/deliveries', async (req, res) => {
  try {
    const rows = await prisma.gmailInboundMessage.findMany({ where: { hotelId: req.user.hotelId, status: 'pending' },
      select: { id: true, mailbox: true, providerMessageId: true, replyStatus: true, lastError: true, receivedAt: true }, take: 100 });
    res.json({ success: true, data: rows });
  } catch { res.status(503).json({ success: false, message: 'Cannot read Gmail delivery status' }); }
});
gmailManagerRouter.post('/deliveries/:id/retry', async (req, res) => {
  if (req.body?.confirmedNotSent !== true) return res.status(400).json({ success: false, message: 'Check Gmail Sent Mail and explicitly confirm the reply was not sent' });
  try {
    await withGmailMailboxLock(req.user.hotelId, async () => {
      const updated = await prisma.gmailInboundMessage.updateMany({ where: { id: req.params.id, hotelId: req.user.hotelId,
        status: 'pending', replyStatus: { in: ['sending', 'uncertain'] } }, data: { replyStatus: 'pending', lastError: null } });
      if (!updated.count) throw new Error('No uncertain delivery for this hotel');
    });
    res.json({ success: true, message: 'Reply queued for the next Gmail sync' });
  } catch { res.status(409).json({ success: false, message: 'Delivery could not be queued; mailbox may be busy' }); }
});
for (const [path, run] of [
  ['/watch', id => gmailWatchService.registerWatchForHotel(id)],
  ['/watch/stop', id => gmailWatchService.stopWatchForHotel(id)],
]) {
  gmailManagerRouter.post(path, async (req, res) => {
    try { res.json({ success: true, data: await run(req.user.hotelId) }); }
    catch (error) { res.status(error.status || 503).json({ success: false, message: 'Gmail watch operation failed; check email status' }); }
  });
}
