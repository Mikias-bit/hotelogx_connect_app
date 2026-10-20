import { inviteStaff } from './invitationService.js';
import { prisma } from '../../config/database.js';
import { successResponse, errorResponse } from '../../utils/response.js';

const VALID_ROLES = ['manager', 'front-office', 'housekeeping', 'maintenance'];

const ROLE_DEFAULT_TITLES = {
  manager: 'Hotel Manager',
  'front-office': 'Front Office Receptionist',
  housekeeping: 'Housekeeping Supervisor',
  maintenance: 'Lead Technician',
};

export const getUsers = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Authentication and hotel context required', 401);

    const users = await prisma.user.findMany({
      where: { hotelId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        title: true,
        phone: true,
        initials: true,
        lastActive: true,
        whatsapp: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return successResponse(res, users, 'Users retrieved successfully');
  } catch (error) {
    next(error);
  }
};

export const inviteUser = async (req, res, next) => {
  try {
    const user = await inviteStaff(req.user, req.body);
    return successResponse(res, user, 'Invitation accepted by email provider', 201);
  } catch (error) { next(error); }
};

export const updateUserRole = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) {
      return errorResponse(res, 'Unauthorized - Missing hotel identification', 401);
    }

    const { id } = req.params;
    const { role } = req.body;

    const cleanRole = role ? role.toLowerCase() : '';
    if (!VALID_ROLES.includes(cleanRole)) {
      return errorResponse(res, `Invalid role. Allowed roles: ${VALID_ROLES.join(', ')}`, 400);
    }

    // Tenant-isolated check
    const user = await prisma.user.findFirst({
      where: { id, hotelId },
    });

    if (!user) {
      return errorResponse(res, 'User not found or access denied', 404);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role: cleanRole },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        title: true,
        phone: true,
        initials: true,
        lastActive: true,
        whatsapp: true,
        createdAt: true,
      },
    });

    return successResponse(res, updated, 'User role updated successfully');
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) {
      return errorResponse(res, 'Unauthorized - Missing hotel identification', 401);
    }

    const { id } = req.params;

    // Tenant-isolated check
    const user = await prisma.user.findFirst({
      where: { id, hotelId },
    });

    if (!user) {
      return errorResponse(res, 'User not found or access denied', 404);
    }

    await prisma.user.delete({
      where: { id },
    });

    return successResponse(res, null, 'User removed successfully');
  } catch (error) {
    next(error);
  }
};
