import { IMAP_PROVIDERS } from './mailSecurity.js';
export class ImapPollingService {
  constructor({ db,adapterFactory,processor,withMailboxLock }) { Object.assign(this,{ db,adapterFactory,processor,withMailboxLock }); }
  async pollIntegration(hotelId,{ deadline = Date.now()+8*60000,limit=50 } = {}) {
    return this.withMailboxLock(hotelId,async check => {
      const assertOwned=async () => { if (Date.now() >= deadline) throw new Error('IMAP worker deadline reached'); await check(); };
      const i=await this.db.emailIntegration.findUnique({ where: { hotelId } });
      if (!i || !IMAP_PROVIDERS.includes(i.provider) || i.status !== 'connected') return { success:true,ignored:true };
      try {
        if (!i.mailVerifiedAt || !i.imapPassword || !i.smtpPassword) throw new Error('Verify IMAP and SMTP credentials again before polling');
        await this.processor.resumePending(i,assertOwned);
        const batch=await this.adapterFactory(i).fetchBatch({ limit,assertOwned });
        let processed=0;
        for (const message of batch.messages) {
          await assertOwned();
          const result=await this.processor.process(i,message,{ assertOwned,recovery:message.recovery });
          if (!result.duplicate) processed++;
        }
        await assertOwned();
        const updated=await this.db.emailIntegration.updateMany({ where: { id:i.id,provider:i.provider,status:'connected',imapUidValidity:i.imapUidValidity,imapLastUid:i.imapLastUid,imapMailboxKey:i.imapMailboxKey },
          data: { imapUidValidity:batch.uidValidity,imapLastUid:batch.lastUid,imapRecoveryUntilUid:batch.recoveryUntilUid,lastSyncAt:new Date(),lastError:null } });
        if (updated.count !== 1) throw new Error('Mailbox changed during IMAP sync');
        return { success:true,hotelId,processed,hasMore:batch.hasMore };
      } catch(error) {
        await this.db.emailIntegration.updateMany({ where:{ id:i.id },data:{ lastError: !i.mailVerifiedAt ? 'Reconnect and verify both IMAP and SMTP before polling' : 'IMAP sync failed; UID cursor retained for retry. Check pending deliveries and mail server configuration.' } });
        throw error;
      }
    });
  }
  async pollConnectedMailboxes() {
    const rows=await this.db.emailIntegration.findMany({ where:{ provider:{ in:IMAP_PROVIDERS },status:'connected' },orderBy:{ updatedAt:'asc' },take:20 });
    const deadline=Date.now()+8*60000;
    const results=[];
    for(const row of rows) {
      if(Date.now() >= deadline) break;
      try { results.push(await this.pollIntegration(row.hotelId,{ deadline })); }
      catch { results.push({ hotelId:row.hotelId,success:false }); }
    }
    return { success:results.length===rows.length && results.every(r=>r.success),results };
  }
}
