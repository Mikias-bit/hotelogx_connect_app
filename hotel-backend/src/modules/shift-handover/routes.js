import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { prisma } from '../../config/database.js';
import { successResponse } from '../../utils/response.js';
import { listHandovers, createHandover, updateHandover } from './service.js';
const router = Router();
router.use(authenticate);
router.get('/', async (req, res, next) => {
  try { return successResponse(res, await listHandovers(prisma, req.user, req.query.date)); } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try { return successResponse(res, await createHandover(prisma, req.user, req.body)); } catch (error) { next(error); }
});
router.patch('/:id', async (req, res, next) => {
  try { return successResponse(res, await updateHandover(prisma, req.user, req.params.id, req.body)); } catch (error) { next(error); }
});
export default router;
