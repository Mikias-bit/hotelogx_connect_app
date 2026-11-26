import { Router } from 'express';
import {
  getOnboardingStatus,
  getHotelProfile,
  saveHotelProfile,
  saveTopology,
  saveOnboardingStep,
  completeOnboarding,
  handleEmailDetect,
} from './onboardingController.js';
import { authenticate } from '../../middlewares/auth.js';
import { errorResponse } from '../../utils/response.js';

const router = Router();
router.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  return authenticate(req, res, () => req.user.role === 'manager' ? next() : errorResponse(res, 'Only a hotel manager can change onboarding settings.', 403));
});

router.get('/status', authenticate, getOnboardingStatus);
router.get('/profile', authenticate, getHotelProfile);
router.get('/email-detect', handleEmailDetect);
router.post('/profile', authenticate, saveHotelProfile);
router.post('/topology', authenticate, saveTopology);
router.post('/step', authenticate, saveOnboardingStep);
router.post('/complete', authenticate, completeOnboarding);

export default router;
