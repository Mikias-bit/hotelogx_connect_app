import { prisma } from '../../config/database.js';
import { errorResponse, successResponse } from '../../utils/response.js';
import { upsellPipeline, upsellSummary } from './upsellReporting.js';

export const getUpsellReport = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) return errorResponse(res, 'Hotel context required', 401);
    const [rows, hotel] = await Promise.all([
      upsellPipeline(prisma, hotelId),
      prisma.hotel.findUnique({ where: { id: hotelId }, select: { timezone: true } }),
    ]);
    return successResponse(res, { rows, summary: upsellSummary(rows, hotel?.timezone || 'UTC') });
  } catch (error) { next(error); }
};

export const getUpsells = async (req, res, next) => {
  try {
    const hotelId = req.user?.hotelId;
    if (!hotelId) {
      return successResponse(res, [], 'Upsells pipeline');
    }
    const { status } = req.query;
    const rows = await upsellPipeline(prisma, hotelId);
    const upsells = status ? rows.filter(row => row.status === status) : rows;
    return successResponse(res, upsells, 'Upsells pipeline');
  } catch (error) {
    next(error);
  }
};

export const updateUpsellStatus = async (req, res, next) => {
  return errorResponse(res, 'Upsell status is determined by delivery and PMS posting. Use the reservation offer approval controls.', 409);
};
