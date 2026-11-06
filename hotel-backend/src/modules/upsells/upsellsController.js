import { prisma } from '../../config/database.js';
import { errorResponse, successResponse } from '../../utils/response.js';
import { upsellPipeline } from './upsellReporting.js';

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
