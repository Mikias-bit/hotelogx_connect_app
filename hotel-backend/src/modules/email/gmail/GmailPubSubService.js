export class GmailPubSubService {
  constructor({ db, polling, subscription }) { Object.assign(this, { db, polling, subscription }); }
  decodePushEnvelope(body) {
    if (this.subscription && body?.subscription !== this.subscription) throw Object.assign(new Error('Unexpected Pub/Sub subscription'), { status: 400 });
    let notification;
    try {
      const data = body?.message?.data;
      if (typeof data !== 'string' || data.length > 16384 || !/^[A-Za-z0-9_+/=-]+$/.test(data)) throw new Error();
      notification = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
      // Push IDs are hints only. Accept numeric JSON IDs without allowing
      // rounded, unsafe integers to become valid identifiers.
      if (Number.isSafeInteger(notification.historyId) && notification.historyId >= 0) {
        notification.historyId = String(notification.historyId);
      }
      if (typeof notification.emailAddress !== 'string' || !notification.emailAddress.includes('@') ||
        typeof notification.historyId !== 'string' || !/^\d+$/.test(notification.historyId)) throw new Error();
    } catch { throw Object.assign(new Error('Invalid Gmail Pub/Sub envelope'), { status: 400 }); }
    return { emailAddress: notification.emailAddress.trim().toLowerCase(), historyId: notification.historyId };
  }
  async processPushEnvelope(body) {
    const notification = this.decodePushEnvelope(body);
    const integrations = await this.db.emailIntegration.findMany({ where: {
      provider: 'google', status: 'connected', email: { equals: notification.emailAddress, mode: 'insensitive' },
    } });
    if (!integrations.length) return { ignored: true };
    if (integrations.length !== 1) throw new Error('Ambiguous Gmail mailbox ownership');
    // Notification historyId is only a hint, never a checkpoint.
    return this.polling.pollIntegration(integrations[0]);
  }
}
