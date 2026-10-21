const BASE = 'https://graph.microsoft.com/v1.0';
const fields = 'id,conversationId,internetMessageId,subject,from,sender,body,bodyPreview,receivedDateTime,isDraft,internetMessageHeaders';
export function graphRetryAt(error) {
  if (error.status !== 429) return undefined;
  const value = error.retryAfter;
  const timestamp = /^\d+$/.test(value || '') ? Date.now() + Number(value) * 1000 : Date.parse(value);
  return new Date(Number.isFinite(timestamp) && timestamp > Date.now() ? timestamp : Date.now() + 60000);
}

export class MicrosoftGraphEmailAdapter {
  constructor(integration, { getToken, fetchImpl = fetch }) { Object.assign(this, { integration, getToken, fetchImpl }); }

  async request(path, { method = 'GET', body, timeout = 30000 } = {}) {
    if (this.integration.microsoftRetryAt && this.integration.microsoftRetryAt > new Date()) throw new Error('Microsoft Retry-After interval has not elapsed');
    const url = new URL(path.startsWith('https:') ? path : `${BASE}${path}`);
    // Delta links are opaque but must never forward bearer tokens to another host.
    if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/') || url.username || url.password) throw new Error('Invalid Graph URL');
    const { accessToken } = await this.getToken(this.integration.hotelId);
    const res = await this.fetchImpl(url.toString(), { method, redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!res.ok) {
      const error = new Error(`Microsoft Graph request failed (${res.status})`);
      error.status = res.status;
      error.definitelyNotSent = res.status >= 400 && res.status < 500 && res.status !== 408;
      error.retryAfter = res.headers?.get('Retry-After');
      throw error; // Worker retry handles 429/5xx. Never blindly retry a send.
    }
    return res.status === 204 || res.status === 202 ? {} : res.json();
  }

  async *fetchInboundChanges({ pageSize = 50, assertOwned = async () => {} } = {}) {
    const initial = `${BASE}/me/mailFolders/inbox/messages/delta?$select=${fields}&$top=${Math.max(1, Math.min(Number(pageSize) || 50, 100))}`;
    let next = this.integration.lastDeltaLink || initial;
    let recovery = !this.integration.lastDeltaLink;
    let restarted = false;
    const seen = new Set();
    while (next) {
      await assertOwned();
      if (seen.has(next)) throw new Error('Graph repeated a delta page');
      seen.add(next);
      let data;
      try { data = await this.request(next); }
      catch (error) {
        if (error.status === 410 && !restarted) { next = initial; recovery = true; restarted = true; seen.clear(); continue; }
        throw error;
      }
      if (!Array.isArray(data.value)) throw new Error('Invalid Graph delta response');
      const messages = data.value.filter(m => !m['@removed'] && !m.isDraft).map(m => this.normalize(m))
        .filter(m => m.sender !== this.integration.email.toLowerCase());
      yield { messages, recovery, expiredCursor: restarted, deltaLink: data['@odata.nextLink'] ? null : data['@odata.deltaLink'] };
      next = data['@odata.nextLink'] || null;
      if (!next && !data['@odata.deltaLink']) throw new Error('Graph returned no complete delta cursor');
    }
  }

  normalize(item) {
    if (!item.id) throw new Error('Graph message has no ID');
    const sender = (item.from?.emailAddress?.address || item.sender?.emailAddress?.address || '').toLowerCase();
    const headers = Object.fromEntries((item.internetMessageHeaders || []).map(h => [h.name.toLowerCase(), h.value]));
    let text = item.body?.content || item.bodyPreview || '';
    if (item.body?.contentType?.toLowerCase() === 'html') text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    const receivedAt = new Date(item.receivedDateTime);
    if (!Number.isFinite(receivedAt.getTime())) throw new Error('Invalid Graph message date');
    return { id: item.id, threadId: item.conversationId || item.id, sender, from: item.from?.emailAddress?.name ? `${item.from.emailAddress.name} <${sender}>` : sender,
      subject: item.subject || 'Guest inquiry', text, receivedAt, internetMessageId: item.internetMessageId,
      automated: Boolean(headers['list-id'] || (headers['auto-submitted'] && headers['auto-submitted'].toLowerCase() !== 'no') || /bulk|list|junk/i.test(headers.precedence || '')) };
  }

  async reply({ targetMessageId, bodyText }) {
    await this.request(`/me/messages/${encodeURIComponent(targetMessageId)}/reply`, { method: 'POST', body: { message: { body: { contentType: 'Text', content: bodyText } } } });
    return { success: true, messageId: null };
  }
}
