export class GmailPollingService {
  constructor({ db, adapterFactory, processor, withMailboxLock }) {
    Object.assign(this, { db, adapterFactory, processor, withMailboxLock });
  }

  async pollIntegration(integrationOrHotelId, options = {}) {
    const hotelId = typeof integrationOrHotelId === 'string' ? integrationOrHotelId : integrationOrHotelId.hotelId;
    return this.withMailboxLock(hotelId, async checkLease => {
      const assertOwned = async () => {
        if (options.deadline && Date.now() >= options.deadline) throw new Error('Worker time budget reached; retry required');
        await checkLease();
      };
      // Never use a stale integration/cursor from notification lookup.
      const integration = await this.db.emailIntegration.findUnique({ where: { hotelId } });
      if (!integration || integration.provider !== 'google' || integration.status !== 'connected') {
        return { success: true, ignored: true, processed: 0, failed: 0 };
      }
      const adapter = this.adapterFactory(integration);
      const result = { success: false, hotelId, fetched: 0, processed: 0, duplicates: 0, failed: 0, recovery: false };
      let newHistoryId = null;
      try {
        // Retry durable work even if the original mail was deleted or moved
        // out of the inbox after the previous attempt.
        if (this.processor.resumePending) await this.processor.resumePending(integration, assertOwned);
        for await (const page of adapter.fetchInboundChanges(options)) {
          result.recovery ||= page.recovery;
          for (const id of page.ids) {
            await assertOwned();
            if (this.processor.isProcessed && await this.processor.isProcessed(integration, id)) { result.duplicates++; continue; }
            const message = await adapter.fetchMessage(id);
            if (!message) continue;
            result.fetched++;
            const outcome = await this.processor.process(integration, message, { assertOwned, recovery: page.recovery });
            if (outcome.duplicate) result.duplicates++;
            else result.processed++;
          }
          if (page.newHistoryId) newHistoryId = page.newHistoryId;
        }
        await assertOwned();
        if (!/^\d+$/.test(newHistoryId || '')) throw new Error('No complete Gmail history cursor returned');
        // Never regress the cursor for delayed/out-of-order notifications.
        if (integration.historyId && BigInt(newHistoryId) < BigInt(integration.historyId)) throw new Error('Gmail returned an older cursor');
        const committed = await this.db.emailIntegration.updateMany({
          where: { id: integration.id, historyId: integration.historyId, provider: 'google', status: 'connected' },
          data: { historyId: newHistoryId, lastSyncAt: new Date(), lastError: null },
        });
        if (committed.count !== 1) throw new Error('Mailbox changed during sync; retry required');
        return { ...result, success: true, lastHistoryId: newHistoryId };
      } catch (error) {
        // Persist a safe operational error, never message bodies/tokens/provider responses.
        await this.db.emailIntegration.updateMany({ where: { id: integration.id }, data: { lastError: 'Gmail ingestion failed; history cursor retained for retry' } });
        error.syncResult = { ...result, failed: 1, lastHistoryId: integration.historyId };
        throw error; // HTTP must be non-2xx so Pub/Sub redelivers.
      }
    });
  }

  async pollConnectedMailboxes() {
    const integrations = await this.db.emailIntegration.findMany({ where: { provider: 'google', status: 'connected' }, orderBy: { lastSyncAt: { sort: 'asc', nulls: 'first' } }, take: 20 });
    const results = [];
    const deadline = Date.now() + 8 * 60 * 1000;
    for (const integration of integrations) {
      if (Date.now() > deadline) break;
      try { results.push(await this.pollIntegration(integration, { deadline })); }
      catch { results.push({ hotelId: integration.hotelId, success: false }); }
    }
    return { success: results.length === integrations.length && results.every(r => r.success), results };
  }
}
