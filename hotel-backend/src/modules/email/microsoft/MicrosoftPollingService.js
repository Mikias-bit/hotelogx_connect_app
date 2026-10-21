import { graphRetryAt } from './MicrosoftGraphEmailAdapter.js';
export class MicrosoftPollingService {
  constructor({ db, adapterFactory, processor, withMailboxLock }) { Object.assign(this, { db, adapterFactory, processor, withMailboxLock }); }
  async pollIntegration(hotelId, { deadline = Date.now() + 8 * 60000, pageSize } = {}) {
    return this.withMailboxLock(hotelId, async check => {
      const assertOwned = async () => { if (Date.now() >= deadline) throw new Error('Sync deadline reached'); await check(); };
      const integration = await this.db.emailIntegration.findUnique({ where: { hotelId } });
      if (!integration || integration.provider !== 'microsoft' || integration.status !== 'connected') return { success: true, ignored: true };
      if (integration.microsoftRetryAt && integration.microsoftRetryAt > new Date()) throw new Error('Microsoft throttling backoff active');
      let cursor;
      let processed = 0;
      try {
        await this.processor.resumePending(integration, assertOwned);
        for await (const page of this.adapterFactory(integration).fetchInboundChanges({ pageSize, assertOwned })) {
          for (const message of page.messages) {
            await assertOwned();
            // Initial/expired-cursor recovery imports historical mail for staff review.
            // Mail received after OAuth connection can still receive an automatic reply.
            const recovery = page.expiredCursor || (page.recovery && (!integration.microsoftConnectedAt || message.receivedAt < integration.microsoftConnectedAt));
            const outcome = await this.processor.process(integration, message, { assertOwned, recovery });
            if (!outcome.duplicate) processed++;
          }
          if (page.deltaLink) cursor = page.deltaLink;
        }
        await assertOwned();
        if (!cursor) throw new Error('No complete Microsoft delta cursor');
        const result = await this.db.emailIntegration.updateMany({ where: { id: integration.id, provider: 'microsoft', status: 'connected', lastDeltaLink: integration.lastDeltaLink },
          data: { lastDeltaLink: cursor, lastSyncAt: new Date(), lastError: null, microsoftRetryAt: null } });
        if (result.count !== 1) throw new Error('Mailbox changed during sync');
        return { success: true, hotelId, processed };
      } catch (error) {
        await this.db.emailIntegration.updateMany({ where: { id: integration.id }, data: { lastError: 'Microsoft sync failed; delta cursor retained for retry', microsoftRetryAt: graphRetryAt(error) } });
        throw error;
      }
    });
  }
}
