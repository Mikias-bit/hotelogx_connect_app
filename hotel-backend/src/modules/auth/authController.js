import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';
import { signToken } from '../../utils/jwt.js';
import { errorResponse, successResponse } from '../../utils/response.js';

export const register = (req, res) => errorResponse(res, 'Registration is invitation-only. Please request access.', 403);

export const login = async (req, res, next) => {
  try {
    const { email, password, userId } = req.body;

    const user = typeof email === 'string'
      ? await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } })
      : typeof userId === 'string' ? await prisma.user.findUnique({ where: { id: userId } }) : null;
    if (!user || typeof password !== 'string' || !user.passwordHash || !await bcrypt.compare(password, user.passwordHash)) {
      return errorResponse(res, 'Invalid credentials', 401);
    }

    const token = signToken({
      id: user.id,
      role: user.role,
      email: user.email,
      hotelId: user.hotelId,
      name: user.name,
    });

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      title: user.title,
      phone: user.phone,
      initials: user.initials,
      lastActive: user.lastActive,
      whatsapp: user.whatsapp,
      hotelId: user.hotelId,
    };

    return successResponse(res, { token, user: safeUser }, 'Login successful');
  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.body?.token) {
      token = req.body.token;
    }

    if (!token) {
      return errorResponse(res, 'Token is required for refresh', 400);
    }

    const { verifyToken } = await import('../../utils/jwt.js');
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      return errorResponse(res, 'Invalid or expired token', 401);
    }

    if (decoded?.authProvider === 'netlify') return errorResponse(res, 'Please renew your Identity session.', 401);
    if (!decoded || !decoded.id) {
      return errorResponse(res, 'Invalid token payload', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
    });

    if (!user) {
      return errorResponse(res, 'User no longer exists', 401);
    }

    const newToken = signToken({
      id: user.id,
      role: user.role,
      email: user.email,
      hotelId: user.hotelId,
      name: user.name,
    });

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      title: user.title,
      phone: user.phone,
      initials: user.initials,
      lastActive: user.lastActive,
      whatsapp: user.whatsapp,
      hotelId: user.hotelId,
    };

    return successResponse(res, { token: newToken, user: safeUser }, 'Token refreshed successfully');
  } catch (error) {
    next(error);
  }
};

export const getMe = async (req, res) => {
  return successResponse(res, { user: req.user }, 'Profile fetched');
};

export const getStaffList = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) {
      return errorResponse(res, 'Tenant context missing', 401);
    }
    const staff = await prisma.user.findMany({
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
      },
    });
    return successResponse(res, staff, 'Staff accounts list');
  } catch (error) {
    next(error);
  }
};
