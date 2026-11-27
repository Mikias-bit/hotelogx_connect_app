import { createHash, timingSafeEqual } from 'node:crypto';

export function createInviteHandler({ env = process.env, request = fetch } = {}) {
  const reply = (statusCode, data) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) });
  return async (event, context) => {
    if (event.httpMethod !== 'POST') return reply(405, { definitelyNotSent: true });
    const secret = env.HOTELOGX_INVITE_BRIDGE_SECRET;
    const supplied = /^Bearer (\S+)$/.exec(event.headers?.authorization || event.headers?.Authorization || '')?.[1] || '';
    const hash = value => createHash('sha256').update(value).digest();
    if (!secret || secret.length < 32 || !timingSafeEqual(hash(secret), hash(supplied))) return reply(403, { definitelyNotSent: true });
    if (event.isBase64Encoded || (event.body || '').length > 1000) return reply(400, { definitelyNotSent: true });
    let input;
    try { input = JSON.parse(event.body || '{}'); } catch { return reply(400, { definitelyNotSent: true }); }
    if (typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return reply(400, { definitelyNotSent: true });
    // Netlify supplies this privileged operator context to its server functions.
    // It is never returned to the browser or accepted from the request body.
    const identity = context.clientContext?.identity;
    let endpoint;
    try {
      const site = new URL(env.NETLIFY_IDENTITY_SITE_URL || env.URL);
      endpoint = new URL(identity?.url);
      if (site.protocol !== 'https:' || endpoint.origin !== site.origin || endpoint.pathname.replace(/\/$/, '') !== '/.netlify/identity' || !identity?.token) throw new Error();
    } catch { return reply(503, { definitelyNotSent: true, error: 'Identity function configuration missing' }); }
    try {
      const response = await request(`${endpoint.href.replace(/\/$/, '')}/invite`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: input.email }) });
      if (!response.ok) return reply(502, { definitelyNotSent: response.status >= 400 && response.status < 500 && response.status !== 408 });
      const user = await response.json();
      if (!user.id) return reply(502, { definitelyNotSent: false });
      return reply(200, { sent: true, userId: user.id });
    } catch { return reply(502, { definitelyNotSent: false }); }
  };
}
export const handler = createInviteHandler();
