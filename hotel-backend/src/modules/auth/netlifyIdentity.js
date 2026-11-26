const fail = (message, status = 403) => Object.assign(new Error(message), { status });
export function identityIssuer(siteUrl) {
  let url;
  try { url = new URL(siteUrl); } catch { throw fail('Identity login is not configured.', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw fail('Identity login is not configured.', 503);
  return `${url.origin}/.netlify/identity`;
}

// Validate against the one configured Identity service. Never trust a decoded
// browser JWT, user_metadata role, email, tenant ID or caller-supplied issuer.
export async function verifyIdentitySession(token, { siteUrl = process.env.NETLIFY_IDENTITY_SITE_URL, request = fetch } = {}) {
  const issuer = identityIssuer(siteUrl);
  if (typeof token !== 'string' || token.length < 20 || token.length > 16000 || /\s/.test(token)) throw fail('Invalid Identity session.', 401);
  let response;
  try { response = await request(`${issuer}/user`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
  catch { throw fail('Identity service is unavailable. Please try again.', 503); }
  if (!response.ok) throw fail('Invalid or expired Identity session.', response.status >= 500 ? 503 : 401);
  let user;
  try { user = await response.json(); } catch { throw fail('Invalid Identity response.', 502); }
  if (!user?.id || typeof user.id !== 'string' || typeof user.email !== 'string' || !(user.email_confirmed_at || user.confirmed_at)
    || (user.banned_until && new Date(user.banned_until) > new Date())) throw fail('A verified invited email is required.');
  return { id: user.id, email: user.email.trim().toLowerCase(), issuer };
}

export function createIdentityAdmission({ db, verify = verifyIdentitySession, now = () => new Date() }) {
  return async token => {
    const identity = await verify(token);
    return db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`identity:${identity.email}`}))`;
      let user = await tx.user.findUnique({ where: { netlifyIdentityId: identity.id } });
      if (user) {
        if (user.netlifyIdentityIssuer !== identity.issuer || user.email !== identity.email || !user.hotelId) throw fail('Identity account mapping requires administrator review.');
      } else {
        const invite = await tx.hotelOnboardingInvite.findUnique({ where: { email: identity.email } });
        if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt <= now() || invite.role !== 'manager') throw fail('No active hotel invitation matches this verified email. Please contact Hotelogx.');
        user = await tx.user.findUnique({ where: { email: identity.email } });
        if (user && (user.hotelId !== invite.hotelId || user.role !== invite.role || user.netlifyIdentityId)) throw fail('This account requires administrator review.');
        if (!await tx.hotel.findUnique({ where: { id: invite.hotelId } })) throw fail('The approved hotel is unavailable.');
        const mapping = { netlifyIdentityId: identity.id, netlifyIdentityIssuer: identity.issuer };
        user = user ? await tx.user.update({ where: { id: user.id }, data: mapping }) : await tx.user.create({ data: {
          ...mapping, hotelId: invite.hotelId, email: invite.email, name: invite.name, role: invite.role,
          title: 'Hotel administrator', initials: invite.name.split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase(),
          passwordHash: '', whatsapp: false,
        } });
        const claimed = await tx.hotelOnboardingInvite.updateMany({ where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now() } },
          data: { acceptedAt: now(), identityId: identity.id } });
        if (claimed.count !== 1) throw fail('The invitation is no longer active. Please contact Hotelogx.');
      }
      const hotel = await tx.hotel.findUnique({ where: { id: user.hotelId } });
      if (!hotel) throw fail('The approved hotel is unavailable.');
      const { passwordHash, netlifyIdentityId, netlifyIdentityIssuer, ...safeUser } = user;
      return { user: safeUser, onboardingRequired: user.role === 'manager' && !hotel.onboardingDone };
    });
  };
}
