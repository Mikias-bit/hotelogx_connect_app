import { Router } from 'express';
import { authenticate, optionalAuth } from '../../middlewares/auth.js';
import { verifyToken } from '../../utils/jwt.js';
import {
  verifyOAuthState,
  isTokenConsumedPersistent,
  acquireTokenLock,
  releaseTokenLock,
} from '../../utils/tokenCrypto.js';
import { prisma } from '../../config/database.js';
import { errorResponse } from '../../utils/response.js';
import {
  getThreads,
  handleAction,
  verifyWebhook,
  handleWebhook,
  sendTestMessage,
  handleEmbeddedSignupExchange,
  handleOAuthCallback,
  handleManualConnect,
  getWhatsAppStatusController,
  disconnectWhatsAppController,
} from './whatsappController.js';

const router = Router();

/**
 * Middleware: Resolve WhatsApp Authentication and Tenant Context
 * Supports authenticated users (Bearer JWT) and legitimate onboarding sessions (HMAC-signed onboarding token with purpose).
 * Strictly prevents unauthenticated access, tenant tampering, cross-tenant access, nonexistent hotels, and token replay.
 */
export const resolveWhatsAppAuth = async (req, res, next) => {
  try {
    let verifiedHotelId = null;
    let authSource = null;
    let stateTokenId = null;

    // 1. Check Bearer token from header or query
    let bearerToken = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      bearerToken = authHeader.split(' ')[1].trim();
    } else if (req.query && req.query.token) {
      bearerToken = req.query.token;
    }

    // 2. Check explicit onboarding token from header or request body (never from req.body.state)
    const onboardingToken =
      req.headers['x-onboarding-token'] ||
      req.body?.onboardingToken;

    // 3. Try Bearer token as JWT first
    if (bearerToken) {
      try {
        const decoded = verifyToken(bearerToken);
        if (decoded && decoded.id && decoded.hotelId) {
          verifiedHotelId = decoded.hotelId;
          authSource = 'jwt';
          req.user = {
            id: decoded.id,
            name: decoded.name,
            email: decoded.email,
            role: decoded.role,
            hotelId: decoded.hotelId,
          };
        }
      } catch (_) {
        // Not a valid JWT; may be an HMAC-signed onboarding token passed as Bearer
      }

      // If Bearer token is not a JWT, attempt to verify it as an HMAC-signed onboarding token with purpose
      if (!verifiedHotelId) {
        const stateResult = verifyOAuthState(bearerToken, 'whatsapp_embedded_signup');
        if (stateResult && stateResult.valid && stateResult.payload?.hotelId) {
          stateTokenId = stateResult.payload.nonce;
          if (await isTokenConsumedPersistent(stateTokenId)) {
            return errorResponse(res, 'Onboarding token has already been consumed and cannot be reused', 401);
          }
          if (!acquireTokenLock(stateTokenId)) {
            return errorResponse(res, 'A request with this onboarding token is currently in progress', 409);
          }
          verifiedHotelId = stateResult.payload.hotelId;
          authSource = 'onboarding_state';
          req.user = {
            id: `onboarding-${verifiedHotelId}`,
            role: 'manager',
            hotelId: verifiedHotelId,
            isOnboarding: true,
          };
        }
      }
    }

    // 4. If no valid Bearer token, attempt to verify explicit onboarding token with purpose
    if (!verifiedHotelId && onboardingToken) {
      const stateResult = verifyOAuthState(onboardingToken, 'whatsapp_embedded_signup');
      if (stateResult && stateResult.valid && stateResult.payload?.hotelId) {
        stateTokenId = stateResult.payload.nonce;
        if (await isTokenConsumedPersistent(stateTokenId)) {
          return errorResponse(res, 'Onboarding token has already been consumed and cannot be reused', 401);
        }
        if (!acquireTokenLock(stateTokenId)) {
          return errorResponse(res, 'A request with this onboarding token is currently in progress', 409);
        }
        verifiedHotelId = stateResult.payload.hotelId;
        authSource = 'onboarding_state';
        req.user = {
          id: `onboarding-${verifiedHotelId}`,
          role: 'manager',
          hotelId: verifiedHotelId,
          isOnboarding: true,
        };
      } else {
        return errorResponse(res, stateResult?.error || 'Invalid or expired onboarding session token', 401);
      }
    }

    // 5. If bearerToken was supplied but failed all validation checks
    if (!verifiedHotelId && bearerToken) {
      return errorResponse(res, 'Invalid or expired authentication token', 401);
    }

    // 6. If no authentication token was provided at all
    if (!verifiedHotelId) {
      return errorResponse(res, 'Authentication required: Missing session token or signed onboarding token', 401);
    }

    // Attach stateTokenId to request for lifecycle consumption upon successful exchange
    if (stateTokenId) {
      req.onboardingTokenIdentifier = stateTokenId;
    }

    // 7. Multi-Tenant isolation: Check if body explicitly supplied a conflicting hotelId
    if (req.body?.hotelId && req.body.hotelId !== verifiedHotelId) {
      if (stateTokenId) releaseTokenLock(stateTokenId);
      return errorResponse(res, 'Cross-tenant access forbidden: Cannot connect WhatsApp for another hotel', 403);
    }

    // 8. Multi-Tenant isolation: Check if body supplied a conflicting onboarding token
    if (req.body?.onboardingToken && typeof req.body.onboardingToken === 'string' && req.body.onboardingToken.includes('.')) {
      const tokenCheck = verifyOAuthState(req.body.onboardingToken, 'whatsapp_embedded_signup');
      if (tokenCheck.valid && tokenCheck.payload?.hotelId && tokenCheck.payload.hotelId !== verifiedHotelId) {
        if (stateTokenId) releaseTokenLock(stateTokenId);
        return errorResponse(res, 'Cross-tenant access forbidden: Onboarding token belongs to another hotel', 403);
      }
    }

    // 9. Hotel existence verification: Ensure hotel entity exists in database
    const hotel = await prisma.hotel.findUnique({
      where: { id: verifiedHotelId },
      select: { id: true, name: true },
    }).catch(() => null);

    if (!hotel) {
      if (stateTokenId) releaseTokenLock(stateTokenId);
      return errorResponse(res, `Hotel entity not found: "${verifiedHotelId}" does not exist`, 404);
    }

    req.verifiedHotelId = verifiedHotelId;
    return next();
  } catch (error) {
    if (req?.onboardingTokenIdentifier) releaseTokenLock(req.onboardingTokenIdentifier);
    return errorResponse(res, error.message || 'Authentication error', 401);
  }
};

router.get('/status', optionalAuth, getWhatsAppStatusController);
router.post('/disconnect', optionalAuth, disconnectWhatsAppController);
router.get('/threads', authenticate, getThreads);
router.post('/action', authenticate, handleAction);
router.get('/webhook', verifyWebhook);
router.post('/webhook', handleWebhook);
router.post('/send', authenticate, sendTestMessage);
router.post('/embedded-signup', resolveWhatsAppAuth, handleEmbeddedSignupExchange);
router.post('/connect-manual', optionalAuth, handleManualConnect);
router.get('/oauth/callback', handleOAuthCallback);

export default router;


