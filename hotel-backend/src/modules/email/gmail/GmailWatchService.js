export class GmailWatchService {
  constructor({ db, adapterFactory, withMailboxLock, topic }) {
    Object.assign(this, { db, adapterFactory, withMailboxLock, topic });
  }
  async registerUnlocked(integration) {
    if (!/^projects\/[^/]+\/topics\/[^/]+$/.test(this.topic || '')) throw new Error('GOOGLE_PUBSUB_TOPIC must be a full topic resource name');
    const watch = await this.adapterFactory(integration).renewSubscription(this.topic);
    const expiresAt = new Date(Number(watch.expiration));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new Error('Invalid Gmail watch expiration');
    // Watch responses are NOT processing checkpoints, including initial watches.
    // A null cursor is recovered by the poller's full inbox scan.
    await this.db.emailIntegration.update({ where: { id: integration.id }, data: { watchExpiresAt: expiresAt, watchError: null } });
    return { hotelId: integration.hotelId, watchExpiresAt: expiresAt };
  }
  async registerWatchForHotel(hotelId) {
    return this.withMailboxLock(hotelId, async () => {
      const integration = await this.db.emailIntegration.findUnique({ where: { hotelId } });
      if (integration?.provider !== 'google' || integration.status !== 'connected') throw new Error('No connected Gmail mailbox');
      try { return await this.registerUnlocked(integration); }
      catch (error) {
        await this.db.emailIntegration.update({ where: { id: integration.id }, data: { watchError: 'Watch registration failed; verify Pub/Sub configuration' } });
        throw error;
      }
    });
  }
  async stopUnlocked(integration) {
    await this.adapterFactory(integration).stopSubscription();
    await this.db.emailIntegration.update({ where: { id: integration.id }, data: { watchExpiresAt: null, watchError: null } });
  }
  async stopWatchForHotel(hotelId) {
    return this.withMailboxLock(hotelId, async () => {
      const integration = await this.db.emailIntegration.findUnique({ where: { hotelId } });
      if (integration?.provider !== 'google') throw new Error('No Gmail mailbox');
      await this.stopUnlocked(integration);
      // Explicit stop also suspends polling and automatic renewal until reconnect.
      await this.db.emailIntegration.update({ where: { id: integration.id }, data: { status: 'paused' } });
      return { stopped: true };
    });
  }
  async renewExpiringWatches() {
    const integrations = await this.db.emailIntegration.findMany({ where: { provider: 'google', status: 'connected', OR: [
      { watchExpiresAt: null }, { watchExpiresAt: { lte: new Date(Date.now() + 48 * 3600000) } },
    ] } });
    const results = [];
    for (const integration of integrations) {
      try { results.push({ success: true, ...await this.registerWatchForHotel(integration.hotelId) }); }
      catch { results.push({ hotelId: integration.hotelId, success: false }); }
    }
    return { success: results.every(r => r.success), results };
  }
}
