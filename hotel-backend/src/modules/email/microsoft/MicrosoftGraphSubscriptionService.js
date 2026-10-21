import { randomBytes } from 'node:crypto';
import { graphRetryAt } from './MicrosoftGraphEmailAdapter.js';
export class MicrosoftGraphSubscriptionService {
  constructor({ db, adapterFactory, withMailboxLock, notificationUrl }) { Object.assign(this, { db, adapterFactory, withMailboxLock, notificationUrl }); }
  async registerForHotel(hotelId) {
    return this.withMailboxLock(hotelId, async () => {
      const integration = await this.db.emailIntegration.findUnique({ where: { hotelId } });
      if (!integration || integration.provider !== 'microsoft' || integration.status !== 'connected') throw new Error('Microsoft mailbox is not connected');
      return this.registerUnlocked(integration);
    });
  }
  async registerUnlocked(integration) {
    const adapter = this.adapterFactory(integration);
    const expirationDateTime = new Date(Date.now() + 144 * 3600000).toISOString();
    let subscription;
    let clientState = integration.graphClientState || randomBytes(32).toString('hex');
    try {
      if (integration.graphSubscriptionId) {
        try { subscription = await adapter.request(`/subscriptions/${encodeURIComponent(integration.graphSubscriptionId)}`, { method: 'PATCH', body: { expirationDateTime } }); }
        catch (error) { if (error.status !== 404 && error.status !== 410) throw error; }
      }
      if (!subscription) {
        if (!this.notificationUrl?.startsWith('https://')) throw new Error('Microsoft webhook must use HTTPS');
        // Save state first. If create succeeds but persistence fails, recover the
        // matching remote subscription on the next renewal instead of duplicating it.
        await this.db.emailIntegration.update({ where: { id: integration.id }, data: { graphClientState: clientState } });
        const existing = await adapter.request('/subscriptions');
        subscription = existing.value?.find(s => s.clientState === clientState && s.notificationUrl === this.notificationUrl);
        if (!subscription) subscription = await adapter.request('/subscriptions', { method: 'POST', body: {
          changeType: 'created', resource: "me/mailFolders('inbox')/messages", notificationUrl: this.notificationUrl,
          lifecycleNotificationUrl: this.notificationUrl, expirationDateTime, clientState, latestSupportedTlsVersion: 'v1_2',
        } });
      }
      if (!subscription.id || !subscription.expirationDateTime) throw new Error('Incomplete Graph subscription response');
      await this.db.emailIntegration.update({ where: { id: integration.id }, data: { graphSubscriptionId: subscription.id, graphClientState: clientState,
        watchExpiresAt: new Date(subscription.expirationDateTime), watchError: null } });
      return { subscriptionId: subscription.id, watchExpiresAt: subscription.expirationDateTime };
    } catch (error) {
      await this.db.emailIntegration.update({ where: { id: integration.id }, data: { watchError: 'Microsoft subscription registration/renewal pending; worker will retry', microsoftRetryAt: graphRetryAt(error) } });
      throw error;
    }
  }
  async stopUnlocked(integration) {
    if (integration.graphSubscriptionId) {
      try { await this.adapterFactory(integration).request(`/subscriptions/${encodeURIComponent(integration.graphSubscriptionId)}`, { method: 'DELETE' }); }
      catch (error) { if (![404, 410].includes(error.status)) throw error; }
    }
    await this.db.emailIntegration.update({ where: { id: integration.id }, data: { graphSubscriptionId: null, graphClientState: null, watchExpiresAt: null, watchError: null } });
  }
  async renewExpiringSubscriptions() {
    const rows = await this.db.emailIntegration.findMany({ where: { provider: 'microsoft', status: 'connected', OR: [
      { graphSubscriptionId: null }, { watchExpiresAt: null }, { watchExpiresAt: { lte: new Date(Date.now() + 48 * 3600000) } },
    ] }, orderBy: { watchExpiresAt: { sort: 'asc', nulls: 'first' } }, take: 20 });
    const results = [];
    const deadline = Date.now() + 8 * 60000;
    for (const row of rows) {
      if (Date.now() >= deadline) break;
      try { await this.registerForHotel(row.hotelId); results.push({ hotelId: row.hotelId, success: true }); }
      catch { results.push({ hotelId: row.hotelId, success: false }); }
    }
    return { success: results.length === rows.length && results.every(r => r.success), results };
  }
}
