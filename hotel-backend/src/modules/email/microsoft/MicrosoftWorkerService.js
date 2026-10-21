export class MicrosoftWorkerService {
  constructor({ db, polling, subscriptions }) { Object.assign(this, { db, polling, subscriptions }); }
  async runHotel(hotelId, options = {}) {
    const job = await this.db.microsoftSyncJob.findUnique({ where: { hotelId } });
    const integration = await this.db.emailIntegration.findUnique({ where: { hotelId } });
    if (integration?.provider === 'microsoft' && integration.status === 'connected') {
      if (job?.renew) await this.subscriptions.registerForHotel(hotelId);
      await this.polling.pollIntegration(hotelId, options);
    }
    // A notification arriving during processing must keep its pending work.
    if (job) await this.db.microsoftSyncJob.deleteMany({ where: { hotelId, revision: job.revision } });
    return { hotelId, success: true };
  }
  async pollConnectedMailboxes() {
    const rows = await this.db.emailIntegration.findMany({ where: { provider: 'microsoft', status: 'connected' },
      orderBy: { lastSyncAt: { sort: 'asc', nulls: 'first' } }, take: 20 });
    const deadline = Date.now() + 8 * 60000;
    const results = [];
    for (const row of rows) {
      if (Date.now() >= deadline) break;
      try { results.push(await this.runHotel(row.hotelId, { deadline })); }
      catch { results.push({ hotelId: row.hotelId, success: false }); }
    }
    return { success: results.length === rows.length && results.every(r => r.success), results };
  }
}
