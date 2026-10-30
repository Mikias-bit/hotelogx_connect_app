import { prisma } from '../../config/database.js';
import { errorResponse, successResponse } from '../../utils/response.js';

/* ----------------------------------------------------------------- GET all -- */
export const getRooms = async (req, res, next) => {
  try {
    const hotelId = req.user.hotelId;
    const { floor, status } = req.query;
    const where = { hotelId };
    if (floor) where.floor = parseInt(floor, 10);
    if (status) where.status = status;

    const rooms = await prisma.room.findMany({
      where,
      orderBy: { number: 'asc' },
    });
    return successResponse(res, rooms, 'Rooms fetched successfully');
  } catch (error) {
    next(error);
  }
};

/* --------------------------------------------------------------- GET single -- */
export const getRoomByNumber = async (req, res, next) => {
  try {
    const hotelId = req.user.hotelId;
    const { number } = req.params;
    const room = await prisma.room.findFirst({
      where: { number, hotelId },
    });
    if (!room) {
      return errorResponse(res, `Room ${number} not found`, 404);
    }
    return successResponse(res, room, 'Room fetched');
  } catch (error) {
    next(error);
  }
};

/* --------------------------------------------------------- PATCH room status -- */
export const updateRoomStatus = (req, res) => errorResponse(res,
  'Use Room Readiness to record cleaning, inspection, restrictions and Front Office release separately. This endpoint no longer completes tasks or updates PMS room status.', 409);
