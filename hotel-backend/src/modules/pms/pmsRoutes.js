import { Router } from 'express';
import { createPmsMcpClient } from './pmsMcpClient.js';
import { createUpsellRouter } from './pmsUpsellRoutes.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import {
  connectPmsController,
  disconnectPmsController,
  getPmsStatusController,
  syncPmsController,
  checkAvailabilityController,
  mewsWebhookController,
  getPmsRoomsController,
  getPmsReservationsController,
  updatePmsRoomStatusController,
  getPmsServicesController,
} from './pmsController.js';
import { authenticate } from '../../middlewares/auth.js';

const router = Router();
router.use('/upsells', createUpsellRouter());

// Authenticated staff diagnostic. No caller-supplied hotel IDs or tool names.
router.get('/mcp/status', authenticate, async (req, res) => {
  if (!['manager', 'front-office'].includes(req.user.role)) return errorResponse(res, 'Manager or front-office access required', 403);
  try {
    const result = await createPmsMcpClient().callTool(req.user, 'check_connection');
    if (result.isError) return errorResponse(res, result.content?.find(item => item.type === 'text')?.text || 'Mews connection check failed', 409);
    return successResponse(res, result.structuredContent || result.content);
  } catch { return errorResponse(res, 'PMS MCP connection is unavailable', 503); }
});

// Authenticated PMS management endpoints
router.post('/connect', authenticate, connectPmsController);
router.post('/disconnect', authenticate, disconnectPmsController);
router.post('/verify', authenticate, connectPmsController);
router.get('/status', authenticate, getPmsStatusController);
router.post('/sync', authenticate, syncPmsController);
router.get('/availability', checkAvailabilityController);

// Live room, reservation, and services endpoints
router.get('/rooms', authenticate, getPmsRoomsController);
router.get('/reservations', authenticate, getPmsReservationsController);
router.patch('/rooms/:number/status', authenticate, updatePmsRoomStatusController);
router.put('/rooms/:number/status', authenticate, updatePmsRoomStatusController);
router.get('/services', authenticate, getPmsServicesController);

// Public Mews Webhook Receiver (validated via payload/headers inside controller)
router.post('/webhook', mewsWebhookController);
router.post('/webhook/mews', mewsWebhookController);

export default router;

