import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { errorResponse } from '../../utils/response.js';
import { getThreads, handleAction, verifyWebhook, handleWebhook, sendTestMessage, handleEmbeddedSignupExchange,
 replyToWhatsAppThread, handleManualConnect, getWhatsAppStatusController, disconnectWhatsAppController } from './whatsappController.js';
export const requireWhatsAppManager = (req, res, next) => {
 if (req.user?.role !== 'manager') return errorResponse(res, 'Hotel manager access required', 403);
 if (req.body?.hotelId && req.body.hotelId !== req.user.hotelId) return errorResponse(res, 'Cross-tenant access forbidden', 403);
 req.verifiedHotelId = req.user.hotelId;
 next();
};
const router = Router();
router.get('/webhook', verifyWebhook);
router.post('/webhook', handleWebhook);
router.get('/threads', authenticate, getThreads);
router.post('/threads/:id/reply', authenticate, requireWhatsAppManager, replyToWhatsAppThread);
router.post('/action', authenticate, handleAction);
router.get('/status', authenticate, requireWhatsAppManager, getWhatsAppStatusController);
router.post('/disconnect', authenticate, requireWhatsAppManager, disconnectWhatsAppController);
router.post('/send', authenticate, requireWhatsAppManager, sendTestMessage);
router.post('/embedded-signup', authenticate, requireWhatsAppManager, handleEmbeddedSignupExchange);
router.post('/connect-manual', authenticate, requireWhatsAppManager, handleManualConnect);
export default router;
