import nodemailer from 'nodemailer';
import { identityIssuer } from './netlifyIdentity.js';

export function createAccessDelivery({ db, env = process.env, request = fetch, createTransport = nodemailer.createTransport } = {}) {
  const notificationReady = () => Boolean(env.ACCESS_SMTP_HOST && env.ACCESS_SMTP_USER && env.ACCESS_SMTP_PASSWORD && env.NETLIFY_IDENTITY_SITE_URL);
  const invitationReady = () => Boolean(env.NETLIFY_IDENTITY_SITE_URL && env.HOTELOGX_INVITE_BRIDGE_SECRET?.length >= 32);
  async function notify(id) {
    if (!notificationReady()) return { status: 'pending', reason: 'Configure the operator mailbox' };
    const row = await db.hotelAccessRequest.findUnique({ where: { id } });
    if (!row || row.status !== 'pending') return { status: 'skipped' };
    const link = new URL('/manager/access-requests', identityIssuer(env.NETLIFY_IDENTITY_SITE_URL));
    const port = Number(env.ACCESS_SMTP_PORT || 465);
    if (![465, 587].includes(port)) throw new Error('Use SMTP TLS port 465 or 587');
    const claim = await db.hotelAccessRequest.updateMany({ where: { id, status: 'pending', notificationStatus: 'pending' },
      data: { notificationStatus: 'sending', notificationAttemptAt: new Date() } });
    if (claim.count !== 1) return { status: 'already_recorded' };
    let status = 'uncertain';
    const transport = createTransport({ host: env.ACCESS_SMTP_HOST, port, secure: port === 465, requireTLS: true,
      auth: { user: env.ACCESS_SMTP_USER, pass: env.ACCESS_SMTP_PASSWORD }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
    try {
      const result = await transport.sendMail({ from: env.ACCESS_SMTP_FROM || env.ACCESS_SMTP_USER,
        to: env.ACCESS_REQUEST_NOTIFY_TO || 'support@hotelogx.com', subject: 'Hotelogx One: new hotel access request',
        text: [`A hotel has requested access to Hotelogx One.`, '', `Name: ${row.name}`, `Hotel: ${row.hotelName}`, `Email: ${row.email}`,
          '', `Review and approve: ${link.href}`, '', 'Sign in with your authorized Hotelogx operator account. No access has been granted.', `Request ID: ${row.id}`].join('\n') });
      status = result.accepted?.length ? 'sent' : 'failed';
    } catch (e) { status = ['EAUTH', 'ECONNECTION', 'EDNS', 'ETLS'].includes(e.code) ? 'failed' : 'uncertain'; }
    finally { transport.close(); }
    await db.hotelAccessRequest.update({ where: { id }, data: { notificationStatus: status } });
    return { status };
  }
  async function sendInvite(id) {
    if (!invitationReady()) return { status: 'pending', reason: 'Configure the invitation service first' };
    const row = await db.hotelOnboardingInvite.findUnique({ where: { id } });
    if (!row || row.acceptedAt || row.revokedAt || row.expiresAt <= new Date()) throw new Error('Invitation is no longer active');
    const claim = await db.hotelOnboardingInvite.updateMany({ where: { id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() }, deliveryStatus: 'pending' },
      data: { deliveryStatus: 'sending', deliveryAttemptAt: new Date() } });
    if (claim.count !== 1) return { status: 'already_recorded', reason: 'Delivery already recorded; check Netlify before sending again' };
    let status = 'uncertain', providerId = null;
    try {
      const url = new URL('/.netlify/functions/hotel-invite', identityIssuer(env.NETLIFY_IDENTITY_SITE_URL));
      const response = await request(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${env.HOTELOGX_INVITE_BRIDGE_SECRET}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: row.email }) });
      const result = await response.json();
      if (response.ok && result.sent === true && typeof result.userId === 'string') { status = 'sent'; providerId = result.userId; }
      else if (result.definitelyNotSent === true) status = 'failed';
    } catch {} // A timeout may have happened after Netlify accepted the invitation.
    await db.hotelOnboardingInvite.update({ where: { id }, data: { deliveryStatus: status, deliveryMessageId: providerId } });
    return { status };
  }
  return { notify, sendInvite, notificationReady, invitationReady };
}
