import reportRoutes from './modules/reports/reportRoutes.js';
import operationsRoutes from './modules/reports/operationsRoutes.js';
import { gmailPushHandler, gmailWorkerRouter, gmailManagerRouter } from './modules/email/gmail/gmailRoutes.js';
import { verifyWebhook, handleWebhook } from './modules/whatsapp/whatsappController.js';
import { googleOAuthCallbackController, microsoftOAuthCallbackController } from './modules/email/emailController.js';
import { Router } from 'express';
import authRoutes from './modules/auth/authRoutes.js';
import roomsRoutes from './modules/rooms/roomsRoutes.js';
import knowledgeRoutes from './modules/knowledge/knowledgeRoutes.js';
import tasksRoutes from './modules/tasks/tasksRoutes.js';
import issuesRoutes from './modules/issues/issuesRoutes.js';
import conversationsRoutes from './modules/conversations/conversationsRoutes.js';
import managerRoutes from './modules/manager/managerRoutes.js';
import upsellsRoutes from './modules/upsells/upsellsRoutes.js';
import whatsappRoutes from './modules/whatsapp/whatsappRoutes.js';
import onboardingRoutes from './modules/onboarding/onboardingRoutes.js';
import { handleEmailDetect } from './modules/onboarding/onboardingController.js';
import usersRoutes from './modules/users/userRoutes.js';
import billingRoutes from './modules/billing/billingRoutes.js';
import pmsRoutes from './modules/pms/pmsRoutes.js';
import realtimeRoutes from './modules/realtime/realtimeRoutes.js';
import emailRoutes from './modules/email/emailRoutes.js';

import { microsoftPushHandler } from './modules/email/microsoft/runtime.js';
import { microsoftWorkerRouter, microsoftManagerRouter } from './modules/email/microsoft/microsoftRoutes.js';
import { imapWorkerRouter,imapManagerRouter } from './modules/email/imap/imapRoutes.js';
const router = Router();
router.use('/workers/email',imapWorkerRouter);
router.use('/email-workers',imapWorkerRouter);
router.use('/email/imap',imapManagerRouter);
router.post('/webhooks/email/microsoft/notifications', microsoftPushHandler);
router.post('/email-provider-webhooks/microsoft/notifications', microsoftPushHandler);
router.use('/workers/email', microsoftWorkerRouter);
router.use('/email-workers', microsoftWorkerRouter);
router.use('/email/microsoft', microsoftManagerRouter);

router.get('/health', async (req, res) => {
  try {
    const { prisma } = await import('./config/database.js');
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected', service: 'hotelogx-connect-backend', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected', error: err.message });
  }
});


router.get('/email-detect', handleEmailDetect);

router.use('/auth', authRoutes);
router.use('/rooms', roomsRoutes);
router.use('/reports', reportRoutes);
router.use('/operations', operationsRoutes);
router.use('/tasks', tasksRoutes);
router.use('/issues', issuesRoutes);
router.use('/conversations', conversationsRoutes);
router.use('/manager', managerRoutes);
router.use('/upsells', upsellsRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/onboarding', onboardingRoutes);
router.use('/knowledge', knowledgeRoutes);
router.use('/users', usersRoutes);
router.use('/billing', billingRoutes);
router.use('/pms', pmsRoutes);
router.use('/realtime', realtimeRoutes);
router.post('/email-provider-webhooks/google/pubsub', gmailPushHandler);
router.use('/email-workers', gmailWorkerRouter);
// Preserve the old backend's Cloud Pub/Sub and worker URL prefixes.
router.post('/webhooks/email/google/pubsub', gmailPushHandler);
router.use('/workers/email', gmailWorkerRouter);
router.use('/email/gmail', gmailManagerRouter);
router.use('/email', emailRoutes);
// Preserve callback URLs registered for the original Cloud Run backend.
router.get('/email-integrations/google/callback', googleOAuthCallbackController);
router.get('/email-integrations/microsoft/callback', microsoftOAuthCallbackController);
// Tenant routing remains based on the verified provider payload, not the URL parameter.
router.get('/webhooks/whatsapp/:hotelId', verifyWebhook);
router.post('/webhooks/whatsapp/:hotelId', handleWebhook);

export default router;
