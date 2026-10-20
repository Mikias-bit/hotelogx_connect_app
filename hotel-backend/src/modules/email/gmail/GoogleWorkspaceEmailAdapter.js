const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailApiError extends Error {
  constructor(status) { super(`Gmail API returned HTTP ${status}`); this.status = status; }
}

function header(message, name) {
  return message.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

export class GoogleWorkspaceEmailAdapter {
  constructor(integration, { getToken, fetchImpl = fetch }) {
    this.integration = integration;
    this.getToken = getToken;
    this.fetch = fetchImpl;
  }

  async request(path, options = {}) {
    const { accessToken } = await this.getToken(this.integration.hotelId, { allowInactive: path === 'stop' });
    const response = await this.fetch(`${BASE}/${path}`, {
      ...options, signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new GmailApiError(response.status);
    if (response.status === 204 || path === 'stop') return {};
    return response.json();
  }

  async validateConnection() { return this.request('profile'); }
  async renewSubscription(topicName) {
    return this.request('watch', { method: 'POST', body: JSON.stringify({
      topicName, labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE',
    }) });
  }
  async stopSubscription() { return this.request('stop', { method: 'POST' }); }

  async findSentMessage(rfcMessageId) {
    const query = new URLSearchParams({ q: `in:sent rfc822msgid:${rfcMessageId}`, maxResults: '2' });
    const result = await this.request(`messages?${query}`);
    return result.messages?.[0] || null;
  }

  // Yield every page; page size is never a total-message limit. Only the final
  // page's cursor may be committed, after all pages and all messages succeed.
  async *fetchInboundChanges({ pageSize = 100 } = {}) {
    const size = Math.min(500, Math.max(1, Number(pageSize) || 100));
    let pageToken;
    if (this.integration.historyId) {
      try {
        do {
          const query = new URLSearchParams({ startHistoryId: this.integration.historyId, maxResults: String(size) });
          query.append('historyTypes', 'messageAdded');
          query.append('historyTypes', 'labelAdded');
          if (pageToken) query.set('pageToken', pageToken);
          const page = await this.request(`history?${query}`);
          const ids = new Set();
          for (const event of page.history || []) {
            for (const item of event.messagesAdded || []) if (item.message?.id) ids.add(item.message.id);
            for (const item of event.labelsAdded || []) {
              if (item.labelIds?.includes('INBOX') && item.message?.id) ids.add(item.message.id);
            }
          }
          pageToken = page.nextPageToken;
          yield { ids: [...ids], newHistoryId: pageToken ? null : String(page.historyId || this.integration.historyId), recovery: false };
        } while (pageToken);
        return;
      } catch (error) {
        // An expired history cursor requires a full inbox rescan, never a
        // truncated recent-message query. Other failures must retain the cursor.
        if (!(error instanceof GmailApiError) || error.status !== 404) throw error;
      }
    }
    const profile = await this.request('profile');
    if (!/^\d+$/.test(String(profile.historyId || ''))) throw new Error('Gmail profile missing history cursor');
    // Capture BEFORE listing: mail arriving during the scan remains in history.
    const baseline = String(profile.historyId);
    pageToken = undefined;
    do {
      const query = new URLSearchParams({ labelIds: 'INBOX', maxResults: String(size) });
      if (pageToken) query.set('pageToken', pageToken);
      const page = await this.request(`messages?${query}`);
      pageToken = page.nextPageToken;
      yield { ids: (page.messages || []).map(m => m.id), newHistoryId: pageToken ? null : baseline, recovery: true };
    } while (pageToken);
  }

  async fetchMessage(id) {
    let message;
    try { message = await this.request(`messages/${encodeURIComponent(id)}?format=full`); }
    catch (error) {
      if (error instanceof GmailApiError && error.status === 404) return null; // Deleted since notification.
      throw error;
    }
    const labels = message.labelIds || [];
    if (!labels.includes('INBOX') || labels.some(l => ['SENT', 'DRAFT', 'TRASH', 'SPAM'].includes(l))) return null;
    const from = header(message, 'From');
    const sender = (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase();
    if (sender === this.integration.email.toLowerCase()) return null;
    const bodies = { text: [], html: [] };
    const walk = async part => {
      if (!part) return;
      if (!part.filename && ['text/plain', 'text/html'].includes(part.mimeType)) {
        let data = part.body?.data;
        if (!data && part.body?.attachmentId) {
          data = (await this.request(`messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`)).data;
        }
        if (data) bodies[part.mimeType === 'text/plain' ? 'text' : 'html'].push(Buffer.from(data, 'base64url').toString('utf8'));
      }
      for (const child of part.parts || []) await walk(child);
    };
    await walk(message.payload);
    const htmlText = bodies.html.join('\n').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ');
    const automated = /^(auto-generated|auto-replied)/i.test(header(message, 'Auto-Submitted')) ||
      /^(bulk|list|junk)$/i.test(header(message, 'Precedence')) || Boolean(header(message, 'List-Id')) ||
      /^(mailer-daemon|postmaster)@/i.test(sender);
    return { id: message.id, threadId: message.threadId, from, sender,
      to: header(message, 'To'), subject: header(message, 'Subject') || '(no subject)',
      text: bodies.text.join('\n').trim() || htmlText.trim() || message.snippet || '[Email without text]',
      internetMessageId: header(message, 'Message-ID'), references: header(message, 'References'),
      receivedAt: new Date(Number(message.internalDate) || Date.now()), automated };
  }
}
