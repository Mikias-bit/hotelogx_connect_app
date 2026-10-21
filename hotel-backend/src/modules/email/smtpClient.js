import { prisma } from '../../config/database.js';
import { ImapSmtpEmailAdapter } from './imap/ImapSmtpEmailAdapter.js';
import { IMAP_PROVIDERS } from './imap/mailSecurity.js';
export const smtpClient = {
  async sendSmtpGuestMail(options) {
    const integration = await prisma.emailIntegration.findUnique({ where: { hotelId: options.hotelId } });
    if (!integration || !IMAP_PROVIDERS.includes(integration.provider) || integration.status !== 'connected' || !integration.mailVerifiedAt) {
      throw Object.assign(new Error('Verify and connect IMAP/SMTP for this hotel before sending'), { definitelyNotSent: true });
    }
    return new ImapSmtpEmailAdapter(integration).send({ ...options, to: options.to || options.toEmail, bodyText: options.bodyText || options.text });
  },
};
