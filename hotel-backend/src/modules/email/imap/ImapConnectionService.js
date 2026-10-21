import { createHash } from 'node:crypto';
import { encryptToken } from '../../../utils/tokenCrypto.js';
import { connectionSettings, IMAP_PROVIDERS } from './mailSecurity.js';
export class ImapConnectionService {
  constructor({ db, withMailboxLock, adapterFactory }) { Object.assign(this,{ db,withMailboxLock,adapterFactory }); }
  async connect(hotelId,input) {
    return this.withMailboxLock(hotelId,async check => {
      const existing = await this.db.emailIntegration.findUnique({ where: { hotelId } });
      if (existing && !IMAP_PROVIDERS.includes(existing.provider)) throw Object.assign(new Error('Disconnect the current OAuth mailbox before connecting IMAP/SMTP'),{ status: 409 });
      const settings = connectionSettings(input,existing);
      const other = await this.db.emailIntegration.findFirst({ where: { provider: { in: IMAP_PROVIDERS }, email: { equals: settings.email,mode: 'insensitive' },hotelId: { not: hotelId } } });
      if (other) throw Object.assign(new Error('This mailbox is already connected to another hotel'),{ status: 409 });
      const hotel = await this.db.hotel.findUnique({ where: { id: hotelId } });
      if (!hotel) throw new Error('Hotel not found');
      let baseline;
      try { baseline = await this.adapterFactory(settings,{ plaintext: true }).verifyConnection(); }
      catch { throw new Error('Mail connection failed. Check both server settings, TLS certificates, usernames and app passwords.'); }
      await check();
      const mailboxKey = createHash('sha256').update(JSON.stringify([settings.imapHost,settings.imapUser,settings.email])).digest('hex');
      const data = { email: settings.email, provider: 'credentials', imapHost: settings.imapHost,imapPort: settings.imapPort,imapSecurity: settings.imapSecurity,imapUser: settings.imapUser,
        smtpHost: settings.smtpHost,smtpPort: settings.smtpPort,smtpSecurity: settings.smtpSecurity,smtpUser: settings.smtpUser,
        imapPassword: encryptToken(settings.imapPassword),smtpPassword: encryptToken(settings.smtpPassword),
        imapMailboxKey: mailboxKey, mailVerifiedAt: new Date(), status: 'connected',lastError: null,
        // Re-entering credentials must not skip a failed processing batch.
        imapUidValidity: settings.sameMailbox && existing.imapUidValidity ? existing.imapUidValidity : baseline.uidValidity,
        imapLastUid: settings.sameMailbox && existing.imapUidValidity ? existing.imapLastUid : baseline.lastUid,
        imapRecoveryUntilUid: settings.sameMailbox ? existing.imapRecoveryUntilUid : null,
        accessToken: null,refreshToken: null,tokenExpiry: null,scope: null,historyId: null,lastDeltaLink: null,
        graphSubscriptionId: null,graphClientState: null,watchExpiresAt: null,watchError: null,
        ...(!settings.sameMailbox ? { lastSyncAt: null } : {}) };
      await this.db.$transaction(async tx => {
        let steps=[]; try { steps=JSON.parse(hotel.onboardingSteps || '[]'); } catch {}
        if (!Array.isArray(steps)) steps=[];
        if (!steps.includes('email')) steps.push('email');
        await tx.emailIntegration.upsert({ where: { hotelId },create: { hotelId,...data },update: data });
        await tx.hotel.update({ where: { id: hotelId },data: { email: settings.email,onboardingSteps: JSON.stringify(steps) } });
        await tx.onboardingState.upsert({ where: { hotelId },create: { hotelId,emailDone: true },update: { emailDone: true } });
      });
      return { verified: true,provider: 'credentials',email: settings.email,address: settings.email,state: 'connected',checks: { incoming: true,outgoing: true,security: true } };
    });
  }
}
