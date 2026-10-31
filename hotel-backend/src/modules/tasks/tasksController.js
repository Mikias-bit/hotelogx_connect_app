import { maintenanceOperations } from '../maintenance/runtime.js';
import { createGuestTask, guestWorkStatusChanged, handoffLock } from '../operations/guestHandoffs.js';
import { prisma } from '../../config/database.js';
import { errorResponse, successResponse } from '../../utils/response.js';
import { readOperations, updateReportTask } from '../reports/reportOperations.js';
import { allowedKinds } from '../reports/reportService.js';
import { realtimeService } from '../../services/realtimeService.js';

export const getTasks = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Authentication and hotel context required', 401);
    const { department, status, source } = req.query;
    const where = { hotelId };

    if (department) where.department = department;
    if (status) where.status = status;
    if (source) where.source = source;

    const tasks = await prisma.task.findMany({
      where,
      include: {
        trail: {
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const operational = allowedKinds(req.user.role).length ? (await readOperations(prisma, req.user)).tasks.filter(t => (!department || t.department === department) && (!status || t.status === status) && (!source || t.source === source)) : [];
    return successResponse(res, [...operational, ...tasks], 'Tasks list');
  } catch (error) {
    next(error);
  }
};

export const getTaskById = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Authentication and hotel context required', 401);
    const { id } = req.params;
    if (id.startsWith('rt-')) {
      const task = (await readOperations(prisma, req.user)).tasks.find(t => t.id === id);
      return task ? successResponse(res, task) : errorResponse(res, 'Task not found', 404);
    }
    const task = await prisma.task.findFirst({
      where: { id, hotelId },
      include: { trail: true },
    });
    if (!task) {
      return errorResponse(res, 'Task not found', 404);
    }
    return successResponse(res, task, 'Task detail');
  } catch (error) {
    next(error);
  }
};

export const createTask = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Authentication and hotel context required', 401);
    const {
      title,
      detail,
      room,
      guest,
      department = 'Front Office',
      priority = 'Normal',
      due,
      assignee,
      source = 'Manager',
      conversationId,
    } = req.body;

    if (department === 'Maintenance' && assignee) return errorResponse(res, 'Use Maintenance Assignments to choose a registered technician', 400);
    if (!title) {
      return errorResponse(res, 'Task title is required', 400);
    }

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const id = `t-${Date.now()}`;

    const normalizedPriority = priority
      ? priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase()
      : 'Normal';
    const creatorName = req.user?.name || source || 'Manager';

    const task = await createGuestTask(prisma, {
      data: {
        id,
        hotelId,
        title,
        detail,
        room,
        guest,
        department,
        priority: normalizedPriority,
        createdAt: timeStr,
        due,
        assignee,
        status: assignee ? 'Assigned' : 'New',
        source,
        conversationId,
        trail: {
          create: [
            {
              at: timeStr,
              text: `Task created by ${creatorName} via ${source}${assignee ? ` and assigned to ${assignee}` : ''}`,
              via: 'dashboard',
            },
          ],
        },
      },
      include: { trail: true },
    }, req.user.id, { force: req.body.guestReported === true });

    // Record activity
    await prisma.activityItem.create({
      data: {
        id: `act-${Date.now()}`,
        hotelId,
        at: timeStr,
        kind: 'task',
        text: `New task for ${department}: "${title}"`,
        meta: room ? `Room ${room}` : undefined,
      },
    });

    if (department === 'Maintenance') realtimeService.broadcastToHotel(hotelId, 'maintenance:updated', { refresh: true });
    return successResponse(res, task, 'Task created successfully', 201);
  } catch (error) {
    next(error);
  }
};

export const updateTaskStatus = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Authentication and hotel context required', 401);
    const { id } = req.params;
    const { status, note, via = 'dashboard', assignee } = req.body;
    if (id.startsWith('rt-')) {
      try {
        if (assignee !== undefined) return errorResponse(res, 'Use the housekeeping assignment picker to assign a registered worker', 400);
        const task = await updateReportTask(prisma, req.user, id, req.body);
        realtimeService.broadcastToHotel(hotelId, 'reports:updated', { refresh: true });
        return successResponse(res, task);
      } catch (error) { if (error.status) return errorResponse(res, error.message, error.status); throw error; }
    }

    const existing = await prisma.task.findFirst({
      where: { id, hotelId },
      include: { trail: true },
    });

    if (!existing) {
      return errorResponse(res, 'Task not found', 404);
    }
    if (existing.department === 'Maintenance') {
      if (assignee !== undefined) return errorResponse(res, 'Use Maintenance Assignments to choose a registered technician', 400);
      try { return successResponse(res, await maintenanceOperations.updateStatus(req.user, 'task', id, req.body)); }
      catch (error) { if (error.status) return errorResponse(res, error.message, error.status); throw error; }
    }


    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const updated = await prisma.$transaction(async tx => {
      await handoffLock(tx, hotelId);
      const fresh = await tx.task.findFirst({ where: { id, hotelId } });
      if (!fresh || fresh.version !== existing.version) throw Object.assign(new Error('Task changed; refresh first'), { status: 409 });
      if (!['manager', 'front-office', 'housekeeping'].includes(req.user.role) || (req.user.role === 'housekeeping' && fresh.department !== 'Housekeeping')) throw Object.assign(new Error('Department access required'), { status: 403 });
      if (status && !['New', 'Assigned', 'In Progress', 'Waiting', 'Escalated', 'Completed'].includes(status)) throw Object.assign(new Error('Invalid status'), { status: 400 });
      const saved = await tx.task.update({
      where: { id },
      data: {
        version: { increment: 1 },
        status: status || existing.status,
        ...(status === 'Completed' ? { completedAt: now } : status ? { completedAt: null } : {}),
        assignee: assignee !== undefined ? assignee : existing.assignee,
        trail: {
          create: {
            at: timeStr,
            text: note || `Status updated to ${status || 'updated'}`,
            via,
          },
        },
      },
      include: { trail: true },
      });
      await guestWorkStatusChanged(tx, 'task', fresh, status || fresh.status, req.user.id);
      return saved;
    }, { timeout: 30000 });

    // Record activity
    await prisma.activityItem.create({
      data: {
        id: `act-${Date.now()}`,
        hotelId,
        at: timeStr,
        kind: 'task',
        text: `Task "${existing.title}" marked ${status}`,
        meta: via ? `via ${via}` : undefined,
      },
    });

    realtimeService.broadcastToHotel(hotelId, 'handoffs:updated', { refresh: true });
    return successResponse(res, updated, 'Task status updated');
  } catch (error) {
    if (error.status) return errorResponse(res, error.message, error.status);
    next(error);
  }
};
