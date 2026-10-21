import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth.js';
import { config } from '../../../config/env.js';
import { prisma } from '../../../config/database.js';
import { googleOidcVerifier } from '../gmail/runtime.js';
import { requireGmailManager } from '../gmail/gmailRoutes.js';
import { microsoftWorker, microsoftSubscriptions, withMicrosoftMailboxLock } from './runtime.js';

export const microsoftWorkerRouter = Router();
// Middleware applies only to Microsoft paths: Gmail has a separate configured identity.
for (const [path, run] of [
  ['/microsoft-process', req => { if (typeof req.body?.hotelId !== 'string' || !req.body.hotelId) throw new Error('hotelId required'); return microsoftWorker.runHotel(req.body.hotelId); }],
  ['/microsoft-poll', () => microsoftWorker.pollConnectedMailboxes()],
  ['/microsoft-subscriptions/renew', () => microsoftSubscriptions.renewExpiringSubscriptions()],
]) {
  microsoftWorkerRouter.post(path, async (req, res) => {
    try { await googleOidcVerifier.verifyAuthorizationHeader(req.headers.authorization, { audience: config.microsoftGraph.workerAudience, serviceAccountEmail: config.microsoftGraph.workerServiceAccount }); }
    catch (error) { return res.status(error.status || 401).json({ success: false, message: 'Worker identity not authorized' }); }
    try { const result = await run(req); res.status(result.success ? 200 : 503).json(result); }
    catch { res.status(503).json({ success: false, message: 'Microsoft worker failed; retry required' }); }
  });
}
export const microsoftManagerRouter = Router();
microsoftManagerRouter.use(authenticate, requireGmailManager);
microsoftManagerRouter.post('/subscription', async (req, res) => {
  try { res.json({ success: true, data: await microsoftSubscriptions.registerForHotel(req.user.hotelId) }); }
  catch { res.status(503).json({ success: false, message: 'Subscription registration pending' }); }
});
microsoftManagerRouter.get('/deliveries', async (req, res) => {
  try { res.json({ success: true, data: await prisma.microsoftInboundMessage.findMany({ where: { hotelId: req.user.hotelId, status: 'pending' },
    select: { id: true, mailbox: true, providerMessageId: true, replyStatus: true, lastError: true, receivedAt: true }, take: 100 }) }); }
  catch { res.status(503).json({ success: false }); }
});
microsoftManagerRouter.post('/deliveries/:id/retry', async (req, res) => {
  if (req.body?.confirmedNotSent !== true) return res.status(400).json({ success: false, message: 'Check Outlook Sent Items and confirm the reply was not sent' });
  try {
    await withMicrosoftMailboxLock(req.user.hotelId, async () => {
      const result = await prisma.microsoftInboundMessage.updateMany({ where: { id: req.params.id, hotelId: req.user.hotelId, status: 'pending', replyStatus: { in: ['sending', 'uncertain'] } }, data: { replyStatus: 'pending', lastError: null } });
      if (!result.count) throw new Error('No uncertain delivery');
    });
    res.json({ success: true });
  } catch { res.status(409).json({ success: false }); }
});
microsoftManagerRouter.post('/deliveries/:id/confirm-sent', async (req, res) => {
  if (req.body?.confirmedSent !== true) return res.status(400).json({ success: false, message: 'Verify this reply in Outlook Sent Items before confirming' });
  try {
    await withMicrosoftMailboxLock(req.user.hotelId, async () => {
      const result = await prisma.microsoftInboundMessage.updateMany({ where: { id: req.params.id, hotelId: req.user.hotelId, status: 'pending', replyStatus: { in: ['sending', 'uncertain'] } }, data: { replyStatus: 'sent', lastError: null } });
      if (!result.count) throw new Error('No uncertain delivery');
    });
    res.json({ success: true });
  } catch { res.status(409).json({ success: false }); }
});
