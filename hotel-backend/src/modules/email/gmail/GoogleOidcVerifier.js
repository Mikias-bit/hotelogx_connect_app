import { createPublicKey, verify } from 'node:crypto';

export class GoogleOidcVerifier {
  constructor({ fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.fetch = fetchImpl; this.now = now; this.keys = null; this.expiresAt = 0;
  }
  async getKeys(force = false) {
    if (!force && this.keys && this.expiresAt > this.now()) return this.keys;
    const res = await this.fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw Object.assign(new Error('Google signing keys unavailable'), { status: 503 });
    const body = await res.json();
    if (!Array.isArray(body.keys)) throw Object.assign(new Error('Google signing keys unavailable'), { status: 503 });
    this.keys = body.keys;
    const seconds = Number(res.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 3600);
    this.expiresAt = this.now() + Math.max(0, seconds - 60) * 1000;
    return this.keys;
  }
  async verifyAuthorizationHeader(authorization, { audience, serviceAccountEmail }) {
    if (!audience || !serviceAccountEmail) throw Object.assign(new Error('Google OIDC authentication is not configured'), { status: 503 });
    const fail = () => Object.assign(new Error('Invalid Google OIDC identity'), { status: 401 });
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/i.exec(authorization || '');
    if (!match || match[1].length > 16384) throw fail();
    const parts = match[1].split('.');
    if (parts.length !== 3) throw fail();
    let header, payload;
    try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); payload = JSON.parse(Buffer.from(parts[1], 'base64url')); }
    catch { throw fail(); }
    const now = this.now() / 1000;
    if (header.alg !== 'RS256' || !header.kid || !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) ||
      payload.aud !== audience || payload.email !== serviceAccountEmail || payload.email_verified !== true ||
      typeof payload.sub !== 'string' || !payload.sub || typeof payload.exp !== 'number' || payload.exp <= now ||
      typeof payload.iat !== 'number' || payload.iat > now + 60 || (payload.nbf && payload.nbf > now + 60)) throw fail();
    let keys = await this.getKeys();
    let key = keys.find(k => k.kid === header.kid && k.kty === 'RSA');
    if (!key) { keys = await this.getKeys(true); key = keys.find(k => k.kid === header.kid && k.kty === 'RSA'); }
    if (!key) throw fail();
    if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw fail();
    return { verified: true, subject: payload.sub };
  }
}
