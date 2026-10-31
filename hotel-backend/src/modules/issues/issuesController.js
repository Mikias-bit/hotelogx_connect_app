import { randomUUID } from 'node:crypto';
import { ensureGuestHandoff } from '../operations/guestHandoffs.js';
import { maintenanceOperations } from '../maintenance/runtime.js';
import { realtimeService } from '../../services/realtimeService.js';
import { prisma } from '../../config/database.js';
import { errorResponse, successResponse } from '../../utils/response.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeNow() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Normalize backend status → frontend status.
 * Backend default is "Reported", frontend uses "Open".
 */
function normalizeStatus(status) {
  if (status === 'Reported') return 'Open';
  return status;
}

/** Map a Prisma Issue row to the frontend Issue shape. */
function formatIssue(i) {
  return {
    assignedWorkerId: i.assignedWorkerId, assignmentId: i.assignmentId, assignedAt: i.assignedAt,
    acceptedAt: i.acceptedAt, startedAt: i.startedAt, completedAt: i.completedAt, problemNote: i.problemNote, version: i.version,
    followUpTaskId: i.followUpTaskId,
    id: i.id,
    room: i.room,
    title: i.title,
    detail: i.detail || undefined,
    priority: i.priority,
    reportedBy: i.reportedBy,
    via: i.via,
    createdAt: i.createdAt,
    assignee: i.assignee || undefined,
    status: normalizeStatus(i.status),
    outOfService: Boolean(i.outOfService),
    updates: Array.isArray(i.updates)
      ? i.updates.map((u) => ({ at: u.at, text: u.text, via: u.via || 'dashboard' }))
      : [],
  };
}

// ─── GET /api/issues ───────────────────────────────────────────────────────────

export const getIssues = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Authentication and hotel context required', 401);
    const { status, room } = req.query;
    const where = { hotelId, status: { not: 'Duplicate' } };
    if (status) {
      if (status.toLowerCase() === 'open' || status.toLowerCase() === 'reported') {
        where.status = { in: ['Reported', 'Open'] };
      } else {
        where.status = status;
      }
    }
    if (room) where.room = room;

    const issues = await prisma.issue.findMany({
      where,
      include: { updates: { orderBy: { id: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return successResponse(res, issues.map(formatIssue), 'Issues list');
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/issues ──────────────────────────────────────────────────────────

export const createIssue = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Authentication and hotel context required', 401);
    const {
      room,
      title,
      detail,
      priority = 'Normal',
      reportedBy,
      via = 'Dashboard',
      assignee,
      outOfService,
    } = req.body;

    if (assignee) return errorResponse(res, 'Assign a registered technician from Maintenance Assignments', 400);
    if (typeof room !== 'string' || !room.trim() || room.length > 200 || typeof title !== 'string' || !title.trim() || title.length > 300 || (detail !== undefined && typeof detail !== 'string') || (detail || '').length > 4000 || !['Urgent', 'High', 'Normal', 'Low'].includes(priority)) {
      return errorResponse(res, 'Room and title are required', 400);
    }

    // Use authenticated user name as reporter if not provided
    const reporter = reportedBy || req.user?.name || 'Staff';

    // Determine outOfService: explicit body value OR priority is Urgent
    const isOos = outOfService !== undefined ? Boolean(outOfService) : priority === 'Urgent';

    const at = timeNow();

    const id = `MT-${randomUUID()}`;

    // All writes in a single transaction
    const issue = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reports:${hotelId}`}, 0))`;
      const created = await tx.issue.create({
        data: {
          id,
          hotelId,
          room,
          title,
          detail: detail || null,
          priority,
          reportedBy: reporter,
          via,
          createdAt: at,
          assignee: null,
          status: 'Reported',
          outOfService: isOos,
          updates: {
            create: [{ at, text: `Reported by ${reporter} via ${via}`, via: 'dashboard' }],
          },
        },
        include: { updates: true },
      });

      // Activity log
      await tx.activityItem.create({
        data: {
          id: `act-${randomUUID()}`,
          hotelId,
          at,
          kind: 'maintenance',
          text: `New issue ${id} — ${title} (Room ${room})`,
          meta: `Priority: ${priority}`,
        },
      });

      if (req.body.guestReported === true) await ensureGuestHandoff(tx, 'issue', created, req.user.id, { force: true, conversationId: req.body.conversationId });
      return created;
    });

    realtimeService.broadcastToHotel(hotelId, 'maintenance:updated', { refresh: true });
    realtimeService.broadcastToHotel(hotelId, 'readiness:updated', { refresh: true });
    return successResponse(res, formatIssue(issue), 'Issue created successfully', 201);
  } catch (error) {
    next(error);
  }
};

// ─── PATCH /api/issues/:id/status ─────────────────────────────────────────────

export const updateIssueStatus = async (req, res, next) => {
  try {
    const issue = await maintenanceOperations.updateStatus(req.user, 'issue', req.params.id, req.body);
    return successResponse(res, formatIssue(issue), 'Issue updated');
  } catch (error) {
    if (error.status) return errorResponse(res, error.message, error.status);
    next(error);
  }
};

export const assignIssue = (req, res) => errorResponse(res,
  'Use Maintenance Assignments to select a registered technician and send an acceptance request.', 409);
