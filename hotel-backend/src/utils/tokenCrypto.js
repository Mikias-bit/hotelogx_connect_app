import crypto from 'node:crypto';

/**
 * Token Encryption & Decryption Utility using AES-256-GCM
 * Securely encrypts access_token and refresh_token at rest in MySQL.
 */

function getEncryptionKey() {
  const rawKey = process.env.DB_ENCRYPTION_KEY || process.env.JWT_SECRET || 'hotelogx-connect-default-secure-encryption-key-32b';
  // Derive 32-byte key using SHA-256
  return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Encrypt a plaintext token (accessToken / refreshToken)
 * Returns format: "iv_hex:auth_tag_hex:encrypted_data_hex"
 */
export function encryptToken(plainText) {
  if (!plainText || typeof plainText !== 'string') return null;

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('[TokenCrypto] Encryption error:', err.message);
    throw new Error('Failed to encrypt credential token');
  }
}

/**
 * Decrypt an encrypted token
 */
export function decryptToken(encryptedString) {
  if (!encryptedString || typeof encryptedString !== 'string') return null;

  // Support plain format fallback if unencrypted during development
  if (!encryptedString.includes(':')) {
    return encryptedString;
  }

  try {
    const [ivHex, authTagHex, encryptedDataHex] = encryptedString.split(':');
    if (!ivHex || !authTagHex || !encryptedDataHex) {
      return null;
    }

    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[TokenCrypto] Decryption error:', err.message);
    return null;
  }
}

/**
 * In-memory single-use token and concurrency tracking
 */
const consumedTokens = new Map(); // tokenId -> { hotelId, purpose, consumedAt, expiresAt }
const inFlightTokens = new Set(); // tokenId

export function isTokenConsumed(tokenId) {
  if (!tokenId) return false;
  const entry = consumedTokens.get(tokenId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    consumedTokens.delete(tokenId);
    return false;
  }
  return true;
}

export function acquireTokenLock(tokenId) {
  if (!tokenId) return false;
  if (isTokenConsumed(tokenId)) return false;
  if (inFlightTokens.has(tokenId)) return false;
  inFlightTokens.add(tokenId);
  return true;
}

export function releaseTokenLock(tokenId) {
  if (!tokenId) return;
  inFlightTokens.delete(tokenId);
}

export function consumeToken(tokenId, hotelId = null, purpose = null, ttlMs = 15 * 60 * 1000) {
  if (!tokenId) return;
  inFlightTokens.delete(tokenId);
  consumedTokens.set(tokenId, {
    hotelId,
    purpose,
    consumedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Custom storage driver interface for testing or external storage backends.
 * Must implement:
 *   - hasToken(tokenId): Promise<boolean>
 *   - insertToken({ id, tokenHash, hotelId, purpose, expiresAt, consumedAt }): Promise<void>
 */
let customStorageDriver = null;

export function setTokenStorageDriver(driver) {
  customStorageDriver = driver;
}

export function clearTokenMemory() {
  consumedTokens.clear();
  inFlightTokens.clear();
}

/**
 * Checks if a token has already been consumed in shared durable storage.
 * Enforces FAIL-CLOSED: if durable storage fails or is unavailable, an error is
 * thrown rather than silently allowing a potentially replayed token.
 */
export async function isTokenConsumedPersistent(tokenId) {
  if (!tokenId) return false;

  // 1. Check local fast-path in-memory map
  if (isTokenConsumed(tokenId)) return true;

  // 2. Delegate to custom driver if registered
  if (customStorageDriver) {
    try {
      const consumed = await customStorageDriver.hasToken(tokenId);
      if (consumed) {
        consumeToken(tokenId);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[TokenCrypto] Persistent token verification failed:', err.message);
      throw new Error(`Durable token verification storage unavailable: ${err.message}`);
    }
  }

  // 3. Query Prisma PostgreSQL durable storage (FAIL CLOSED on error)
  const { prisma } = await import('../config/database.js');
  try {
    const row = await prisma.consumedOAuthToken.findUnique({ where: { tokenHash: tokenId } });
    const rows = row ? [row] : [];
    if (Array.isArray(rows) && rows.length > 0) {
      const expiresAt = new Date(rows[0].expiresAt).getTime();
      if (Date.now() <= expiresAt) {
        consumeToken(tokenId);
        return true;
      }
      return false; // Token in DB has expired
    }
    return false;
  } catch (err) {
    // FAIL CLOSED: do not silently trust an unverified token if durable storage fails
    console.error('[TokenCrypto] Persistent token verification failed:', err.message);
    throw new Error(`Durable token verification storage unavailable: ${err.message}`);
  }
}

/**
 * Atomically consumes a token in shared durable storage using database unique constraint.
 * Enforces FAIL-CLOSED:
 *   - If token was already consumed (unique constraint collision), throws error to block replay.
 *   - If durable storage is down or unavailable, throws error to prevent unrecorded state.
 */
export async function consumeTokenPersistent(tokenId, hotelId = null, purpose = null, ttlMs = 15 * 60 * 1000) {
  if (!tokenId) throw new Error('Token identifier required for consumption');

  const now = new Date();
  const expiresAt = new Date(Date.now() + ttlMs);
  const id = `consumed-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  // 1. Delegate to custom driver if registered
  if (customStorageDriver) {
    try {
      await customStorageDriver.insertToken({
        id,
        tokenHash: tokenId,
        hotelId: hotelId || 'unknown',
        purpose: purpose || 'oauth',
        expiresAt,
        consumedAt: now,
      });
      consumeToken(tokenId, hotelId, purpose, ttlMs);
      return { success: true };
    } catch (err) {
      const isDuplicate =
        err.code === 'P2002' ||
        err.code === 'ER_DUP_ENTRY' ||
        err.message?.includes('1062') ||
        err.message?.includes('Duplicate entry') ||
        err.message?.includes('ER_DUP_ENTRY');

      if (isDuplicate) {
        consumeToken(tokenId, hotelId, purpose, ttlMs);
        throw new Error('Onboarding token has already been consumed and cannot be reused');
      }
      throw err;
    }
  }

  // 2. Database durable insert using unique constraint on tokenHash (FAIL CLOSED)
  const { prisma } = await import('../config/database.js');
  try {
    await prisma.consumedOAuthToken.create({ data: {
      id, tokenHash: tokenId, hotelId: hotelId || 'unknown',
      purpose: purpose || 'oauth', expiresAt, consumedAt: now,
    } });
    consumeToken(tokenId, hotelId, purpose, ttlMs);
    return { success: true };
  } catch (err) {
    const isDuplicate =
      err.code === 'P2002' ||
      err.message?.includes('1062') ||
      err.message?.includes('Duplicate entry') ||
      err.message?.includes('ER_DUP_ENTRY');

    if (isDuplicate) {
      consumeToken(tokenId, hotelId, purpose, ttlMs);
      throw new Error('Onboarding token has already been consumed and cannot be reused');
    }

    // FAIL CLOSED on database/infrastructure error
    console.error('[TokenCrypto] Failed to persist consumed token to durable storage:', err.message);
    throw new Error(`Durable token storage failed: ${err.message}`);
  }
}

// Periodic cleanup of expired in-memory consumed tokens
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of consumedTokens.entries()) {
      if (now > val.expiresAt) {
        consumedTokens.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref?.();
}

/**
 * Generates a signed OAuth state token containing hotelId, purpose, timestamp, and HMAC signature
 */
export function generateOAuthState(hotelId, redirectBack = '/onboarding', frontendOrigin = null, purpose = 'oauth_flow') {
  if (!hotelId) throw new Error('hotelId is required for OAuth state generation');
  const payload = {
    hotelId,
    redirectBack,
    frontendOrigin,
    purpose: purpose || 'oauth_flow',
    ts: Date.now(),
    nonce: crypto.randomBytes(8).toString('hex'),
  };

  const payloadStr = JSON.stringify(payload);
  const payloadBase64 = Buffer.from(payloadStr, 'utf8').toString('base64url');
  const secret = process.env.JWT_SECRET || process.env.DB_ENCRYPTION_KEY || 'oauth-state-secret-key';
  const hmac = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');

  return `${payloadBase64}.${hmac}`;
}

/**
 * Generates a signed WhatsApp-specific onboarding token for Embedded Signup
 */
export function generateWhatsAppOnboardingToken(hotelId, frontendOrigin = null) {
  return generateOAuthState(hotelId, '/onboarding', frontendOrigin, 'whatsapp_embedded_signup');
}

/**
 * Verifies and decodes a signed OAuth state token, with optional purpose verification
 */
export function verifyOAuthState(stateString, expectedPurpose = null) {
  if (!stateString || typeof stateString !== 'string' || !stateString.includes('.')) {
    return { valid: false, error: 'Malformed state parameter' };
  }

  try {
    const [payloadBase64, providedHmac] = stateString.split('.');
    const secret = process.env.JWT_SECRET || process.env.DB_ENCRYPTION_KEY || 'oauth-state-secret-key';
    const expectedHmac = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');

    if (!crypto.timingSafeEqual(Buffer.from(providedHmac), Buffer.from(expectedHmac))) {
      return { valid: false, error: 'OAuth state signature mismatch' };
    }

    const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);

    // Max 15 minutes validity for OAuth state
    if (Date.now() - payload.ts > 15 * 60 * 1000) {
      return { valid: false, error: 'OAuth state has expired' };
    }

    // Purpose binding check
    if (expectedPurpose) {
      if (!payload.purpose) {
        return { valid: false, error: `Token missing required purpose: "${expectedPurpose}"` };
      }
      if (payload.purpose !== expectedPurpose) {
        return {
          valid: false,
          error: `Token purpose mismatch: expected "${expectedPurpose}", received "${payload.purpose}"`,
        };
      }
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: `Invalid state: ${err.message}` };
  }
}
