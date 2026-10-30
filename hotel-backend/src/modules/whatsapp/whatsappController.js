import { prisma } from '../../config/database.js';
import { errorResponse, successResponse } from '../../utils/response.js';
import { realtimeService } from '../../services/realtimeService.js';
import { processGuestMessageAI } from '../conversations/aiService.js';
import { whatsappConnections } from './whatsappOAuth.js';
import { createMetaClient } from './MetaClient.js';
import { WhatsAppMessagingService } from './WhatsAppMessagingService.js';
import { WhatsAppWebhookService, verifyMetaSignature } from './WhatsAppWebhookService.js';
import { withGmailMailboxLock } from '../email/gmail/runtime.js';
import { housekeepingOperations } from '../reports/operationsRuntime.js';
import { maintenanceOperations } from '../maintenance/runtime.js';
const messaging = new WhatsAppMessagingService({ db: prisma, request: createMetaClient() });
const webhook = new WhatsAppWebhookService({ db: prisma, withLock: withGmailMailboxLock, automate: processGuestMessageAI,
 handleOperations: async (integration, message) => await maintenanceOperations.handle(integration, message) || housekeepingOperations.handle(integration, message),
 send: options => messaging.send(options), broadcast: (...args) => realtimeService.broadcastToHotel(...args) });
export const sanitizePhoneNumber = phone => String(phone || '').replace(/\D/g, '');
export const sendMetaWhatsAppMessage = (to, text, buttons = [], hotelId = null, targetType = 'guest') => messaging.send({ to, text, buttons, hotelId, targetType });
export const sendWhatsAppTemplate = (to, name, languageCode = 'en_US', components = [], hotelId = null) => messaging.send({ to, hotelId, template: { name, language: { code: languageCode }, components } });
export const getThreads = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId || req.query?.hotelId;
    if (!hotelId) {
      return errorResponse(res, 'Hotel context is required', 400);
    }
    const threads = await prisma.waThread.findMany({
      where: { hotelId },
      include: {
        messages: { orderBy: { at: 'asc' } },
      },
    }).catch((err) => {
      console.warn('[WhatsApp Threads Warning]', err.message);
      return [];
    });

    const parsed = threads.map((t) => ({
      ...t,
      messages: t.messages.map((m) => {
        let buttons = [];
        try {
          buttons = typeof m.buttons === 'string' ? JSON.parse(m.buttons) : (m.buttons || []);
        } catch {}
        return {
          ...m,
          body: m.text || m.body || '',
          buttons,
        };
      }),
    }));

    return successResponse(res, parsed, 'WhatsApp threads');
  } catch (error) {
    next(error);
  }
};

/**
 * Endpoint: POST /api/whatsapp/action
 */
export const handleAction = (req, res) => errorResponse(res,
  'Use the signed task buttons sent to the assigned worker. Room inspection and release must be approved in Room Readiness.', 409);

export const verifyWebhook = (req, res) => {
 const expected = (process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.VERIFY_TOKEN || '').trim();
 if (!expected) return res.sendStatus(503);
 if (req.query['hub.mode'] !== 'subscribe' || req.query['hub.verify_token'] !== expected || typeof req.query['hub.challenge'] !== 'string') return res.sendStatus(403);
 return res.status(200).type('text/plain').send(req.query['hub.challenge']);
};
export const handleWebhook = async (req, res) => {
 const secret = (process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '').trim();
 if (!secret) return res.sendStatus(503);
 if (!verifyMetaSignature(req.rawBody, req.headers['x-hub-signature-256'], secret)) return res.sendStatus(401);
 try { await webhook.accept(req.body); return res.sendStatus(200); }
 catch (error) { console.warn('[WhatsApp webhook] Processing failed', { type: error.constructor.name }); return res.sendStatus(error.status === 400 ? 400 : 503); }
};
export const sendTestMessage = async (req, res, next) => {
 try {
  const { to, message, targetType = 'guest', template } = req.body;
  if (!['guest', 'internal'].includes(targetType)) return errorResponse(res, 'Invalid connection purpose', 400);
  const result = await messaging.send({ hotelId: req.user.hotelId, targetType, to, text: message, template });
  if (!result.success) return errorResponse(res, result.error || 'Meta did not accept the message', 502);
  return successResponse(res, result, 'Meta accepted the message; delivery is confirmed by webhook receipts');
 } catch (error) { next(error); }
};
const connect = async (req, res, next, embedded) => {
 try {
  const { code, accessToken, wabaId, phoneNumberId, targetType = 'guest', pin, onboardingMode = 'standard' } = req.body;
  if (embedded && !code) return errorResponse(res, 'Meta authorization code required', 400);
  const row = await whatsappConnections.connect({ hotelId: req.user.hotelId, targetType, wabaId, phoneNumberId, pin, onboardingMode, ...(embedded ? { code } : { accessToken }) });
  return successResponse(res, { integration: { hotelId: row.hotelId, targetType: row.targetType, phoneNumberId: row.phoneNumberId, wabaId: row.wabaId, displayPhoneNumber: row.displayPhoneNumber, status: row.status, verifiedAt: row.verifiedAt } }, 'WhatsApp authorization verified');
 } catch (error) { return errorResponse(res, error.code === 'P2002' ? 'Phone number already assigned' : error.message, 400); }
};
export const handleEmbeddedSignupExchange = (req, res, next) => connect(req, res, next, true);
export const handleManualConnect = (req, res, next) => connect(req, res, next, false);
export const getWhatsAppStatusController = async (req, res, next) => {
 try {
  const connections = await whatsappConnections.status(req.user.hotelId);
  const selected = connections.find(c => c.connected && c.targetType !== 'internal') || connections.find(c => c.connected);
  return successResponse(res, { ...(selected || { connected: false, number: '', waba: '', quality: 'Unknown', templates: 0 }), connections });
 } catch (error) { next(error); }
};
export const disconnectWhatsAppController = async (req, res, next) => {
 try {
  await prisma.whatsAppIntegration.updateMany({ where: { hotelId: req.user.hotelId }, data: { status: 'disconnected', accessToken: null, verifiedAt: null, phoneNumberId: null } });
  await prisma.onboardingState.updateMany({ where: { hotelId: req.user.hotelId }, data: { guestWaDone: false, internalWaDone: false } });
  return successResponse(res, { disconnected: true });
 } catch (error) { next(error); }
};

export const replyToWhatsAppThread = async (req, res, next) => {
 try {
  const hotelId = req.user.hotelId;
  const thread = await prisma.waThread.findFirst({ where: { id: req.params.id, hotelId } });
  if (!thread) return errorResponse(res, 'Thread not found', 404);
  const text = req.body.message;
  const result = await messaging.send({ hotelId, targetType: 'internal', to: thread.phone, text });
  if (!result.success) return errorResponse(res, result.error || 'Meta did not accept the reply', 502);
  await prisma.waMessage.create({ data: { id: `wa-out-${result.messageId}`, hotelId, threadId: thread.id, from: 'hotelogx', body: text, at: new Date().toISOString() } });
  realtimeService.broadcastToHotel(hotelId, 'whatsapp:updated', { threadId: thread.id });
  return successResponse(res, result, 'Meta accepted the reply');
 } catch (error) { next(error); }
};
