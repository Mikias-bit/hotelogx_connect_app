import { prisma } from '../../config/database.js';
import { errorResponse, successResponse } from '../../utils/response.js';
import { pmsService } from '../pms/pmsService.js';
import { realtimeService } from '../../services/realtimeService.js';
import { processGuestMessageAI } from '../conversations/aiService.js';
import { whatsappConnections } from './whatsappOAuth.js';
import { createMetaClient } from './MetaClient.js';
import { WhatsAppMessagingService } from './WhatsAppMessagingService.js';
import { WhatsAppWebhookService, verifyMetaSignature } from './WhatsAppWebhookService.js';
import { withGmailMailboxLock } from '../email/gmail/runtime.js';
const messaging = new WhatsAppMessagingService({ db: prisma, request: createMetaClient() });
const webhook = new WhatsAppWebhookService({ db: prisma, withLock: withGmailMailboxLock, automate: processGuestMessageAI,
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
export const handleAction = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId || req.body?.hotelId;
    if (!hotelId) {
      return errorResponse(res, 'hotelId is required', 400);
    }
    const { threadId, messageId, label, staffName, room, actionType } = req.body;
    const ownedThread = await prisma.waThread.findFirst({ where: { id: threadId, hotelId } });
    if (!ownedThread) return errorResponse(res, 'Thread not found', 404);
    const phone = ownedThread.phone;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // If messageId provided, mark chosen label
    if (messageId) {
      await prisma.waMessage.updateMany({
        where: { id: messageId, hotelId },
        data: { chosen: label },
      }).catch(() => {});
    }

    const roomNum = room || label?.match(/\d{3}/)?.[0];

    // Multi-tenant Room Validation
    if (roomNum) {
      const roomRecord = await prisma.room.findFirst({
        where: { number: roomNum, hotelId },
      });

      if (roomRecord) {
        if (actionType === 'room_clean' || label === 'Cleaned' || label === 'Needs Inspection') {
          await prisma.room.updateMany({
            where: { number: roomNum, hotelId },
            data: { status: 'Clean', cleaner: staffName || roomRecord.cleaner || 'Staff', updatedAt: timeStr },
          });

          // Complete any active cleaning task in this hotel
          await prisma.task.updateMany({
            where: { room: roomNum, hotelId, department: 'Housekeeping', status: { not: 'Completed' } },
            data: { status: 'Completed' },
          });

          // Sync room status back to Mews space in background
          pmsService.syncRoomStatusToMews(hotelId, roomNum, 'Clean').catch(() => {});
        } else if (label === 'Start Cleaning' || label?.toLowerCase().includes('start cleaning')) {
          await prisma.room.updateMany({
            where: { number: roomNum, hotelId },
            data: { status: 'Cleaning', cleaner: staffName || roomRecord.cleaner || 'Staff', updatedAt: timeStr },
          });
        } else if (label === 'Maintenance Issue') {
          await prisma.room.updateMany({
            where: { number: roomNum, hotelId },
            data: { status: 'Maintenance', note: `Issue reported via WhatsApp by ${staffName || 'Housekeeping'}` },
          });

          // Sync room status back to Mews space in background
          pmsService.syncRoomStatusToMews(hotelId, roomNum, 'Maintenance').catch(() => {});

          const issueId = `MT-${Date.now().toString().slice(-4)}`;
          await prisma.issue.create({
            data: {
              id: issueId,
              hotelId,
              room: roomNum,
              title: `Issue reported in ${roomNum} during cleaning`,
              detail: `Reported by ${staffName || 'Housekeeper'} via WhatsApp. Awaiting technician assessment.`,
              priority: 'High',
              reportedBy: staffName || 'Housekeeper via WhatsApp',
              via: 'WhatsApp',
              createdAt: timeStr,
              status: 'Open',
              outOfService: true,
            },
          }).catch(() => {});
        } else if (label === 'DND' || label === 'Guest Inside') {
          await prisma.room.updateMany({
            where: { number: roomNum, hotelId },
            data: { status: label === 'DND' ? 'DND' : 'Guest Inside', updatedAt: timeStr },
          });
        }
      }
    }

    if (label?.toLowerCase().includes('delivered') || label?.toLowerCase().includes('done')) {
      const matchingTask = await prisma.task.findFirst({
        where: {
          hotelId,
          department: 'Housekeeping',
          status: { not: 'Completed' },
          ...(roomNum ? { room: roomNum } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });

      if (matchingTask) {
        await prisma.task.updateMany({
          where: { id: matchingTask.id, hotelId },
          data: { status: 'Completed' },
        });

        if (matchingTask.conversationId) {
          await prisma.message.create({
            data: {
              id: `m-${Date.now()}`,
              conversationId: matchingTask.conversationId,
              author: 'ai',
              channel: 'whatsapp',
              body: `Our housekeeping team has delivered this to Room ${matchingTask.room || roomNum || ''}. Please let us know if you need anything else.`,
              at: timeStr,
              confidence: 0.98,
            },
          }).catch(() => {});
        }

        await prisma.activityItem.create({
          data: {
            id: `act-${Date.now()}`,
            hotelId,
            at: timeStr,
            kind: 'task',
            text: `Task completed via WhatsApp: "${matchingTask.title}"`,
            meta: staffName || 'Housekeeping',
          },
        }).catch(() => {});
      }
    }

    // Append outbound confirmation message in the database thread if thread exists
    if (threadId) {
      const threadExists = await prisma.waThread.findFirst({ where: { id: threadId, hotelId } }).catch(() => null);
      if (threadExists) {
        await prisma.waMessage.create({
          data: {
            id: `wam-${Date.now()}`,
            threadId,
            hotelId,
            from: 'staff',
            body: label || 'Action confirmed',
            at: timeStr,
          },
        }).catch(() => {});
      }
    }

    // If phone number exists, dispatch live Meta WhatsApp message safely
    if (phone) {
      await sendMetaWhatsAppMessage(phone, `Action confirmed: ${label || 'Task completed'}`, [], hotelId, 'internal');
    }

    return successResponse(res, { success: true, at: timeStr }, 'WhatsApp action processed');
  } catch (error) {
    next(error);
  }
};

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
