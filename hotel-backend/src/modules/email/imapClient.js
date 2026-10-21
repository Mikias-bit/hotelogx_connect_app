import { prisma } from '../../config/database.js';
import { ImapSmtpEmailAdapter } from './imap/ImapSmtpEmailAdapter.js';
export const imapClient = {
  async verifyImapAuth({ host, port=993, username, password }) {
    const adapter = new ImapSmtpEmailAdapter({ imapHost:host,imapPort:port,imapUser:username,imapPassword:password },{ plaintext:true });
    try { await adapter.withInbox(async () => {}); return { ok:true }; }
    catch { return { ok:false,error:'IMAP authentication or TLS verification failed' }; }
  },
  async fetchRecentImapMessages(hotelId,maxResults=50) {
    const integration=await prisma.emailIntegration.findUnique({ where:{ hotelId } });
    if (!integration || !['credentials','hostinger'].includes(integration.provider) || integration.status!=='connected' || !integration.mailVerifiedAt) throw new Error('Verified IMAP connection required');
    const batch=await new ImapSmtpEmailAdapter(integration).fetchBatch({ limit:maxResults });
    return batch.messages.map(m=>({ ...m,bodyText:m.text,date:m.receivedAt.toISOString() }));
  },
};
