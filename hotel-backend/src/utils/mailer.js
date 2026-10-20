import { prisma } from '../config/database.js';
import { config } from '../config/env.js';
import { gmailClient } from '../modules/email/gmailClient.js';
import { microsoftClient } from '../modules/email/microsoftClient.js';
import { smtpClient } from '../modules/email/smtpClient.js';

export function createInvitationMailer({ db = prisma, google = gmailClient, microsoft = microsoftClient, smtp = smtpClient, settings = config } = {}) {
return async function sendStaffInvitationEmail({ hotelId, toEmail, toName, title, hotelName, temporaryPassword }) {
  const integration = await db.emailIntegration.findUnique({ where: { hotelId } });
  if (integration?.status !== 'connected') throw new Error('Hotel mailbox is not connected.');
  const loginUrl = new URL('/login', settings.frontendUrl);
  if (settings.nodeEnv === 'production' && (loginUrl.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(loginUrl.hostname))) {
    throw new Error('Configure FRONTEND_BASE_URL with the deployed frontend URL.');
  }
  const bodyText = [
    `Hi ${toName || toEmail},`, '',
    `You have been invited to ${hotelName} on Hotelogx Connect as ${title}.`,
    `Sign in: ${loginUrl.href}`, `Email: ${toEmail}`,
    temporaryPassword ? `Your initial password: ${temporaryPassword}` : 'Your account already exists. Sign in with your existing password.',
    '', 'Hotelogx Connect',
  ].join('\n');
  const message = { hotelId, to: toEmail, subject: `Invitation to ${String(hotelName).replace(/[\r\n]/g, ' ')} - Hotelogx Connect`, bodyText };
  let result;
  switch (integration.provider) {
    case 'google': result = await google.sendGuestGmail(message); break;
    case 'microsoft': result = await microsoft.sendGuestMicrosoftMail(message); break;
    case 'credentials':
    case 'hostinger': result = await smtp.sendSmtpGuestMail(message); break;
    default: throw new Error('Unsupported invitation email provider.');
  }
  if (!result?.success) throw new Error('Invitation was not accepted by the email provider.');
  console.info('[Staff Invitation] Provider accepted message', { provider: integration.provider, messageId: result.messageId || null });
  return result;
}

}

export const sendStaffInvitationEmail = createInvitationMailer();
