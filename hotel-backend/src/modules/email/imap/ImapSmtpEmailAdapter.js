import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import net from 'node:net';
import tls from 'node:tls';
import { resolveMailHost, decryptMailPassword } from './mailSecurity.js';

const singleId = value => typeof value === 'string' && /^<[^\s<>]+@[^\s<>]+>$/.test(value) ? value : null;
export class ImapSmtpEmailAdapter {
  constructor(integration, { resolveHost = resolveMailHost, createImap = options => new ImapFlow(options), createSmtp = options => nodemailer.createTransport(options), parse = simpleParser, plaintext = false,
    socketFactory = (options,secure) => secure ? tls.connect(options) : net.connect(options) } = {}) {
    Object.assign(this,{ integration,resolveHost,createImap,createSmtp,parse,plaintext,socketFactory });
  }
  password(kind) {
    const value = this.integration[`${kind}Password`] || this.integration.accessToken;
    return this.plaintext ? value : decryptMailPassword(value);
  }
  async imap() {
    const i = this.integration;
    const remote = await this.resolveHost(i.imapHost);
    const secure = (i.imapPort || 993) === 993;
    const client = this.createImap({ host: remote.address, servername: remote.servername, port: i.imapPort || 993, secure,
      ...(secure ? {} : { doSTARTTLS: true }), tls: { servername: remote.servername, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      auth: { user: i.imapUser || i.email, pass: this.password('imap') },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000, logger: false, emitLogs: false, disableAutoIdle: true });
    // ImapFlow can emit errors after connect; they must not crash the server.
    client.on('error', () => {});
    return client;
  }
  async smtp() {
    const i = this.integration;
    const remote = await this.resolveHost(i.smtpHost);
    const secure = (i.smtpPort || 465) === 465;
    const sockets = new Set();
    const transporter = this.createSmtp({ host: remote.address, port: i.smtpPort || 465, secure, requireTLS: !secure,
      tls: { servername: remote.servername, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      auth: { user: i.smtpUser || i.email, pass: this.password('smtp') },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000, logger: false, debug: false,
      disableFileAccess: true, disableUrlAccess: true,
      getSocket: (_,callback) => {
        const socket = this.socketFactory({ host:remote.address,port:i.smtpPort || 465,servername:remote.servername,rejectUnauthorized:true,minVersion:'TLSv1.2' },secure);
        sockets.add(socket);
        let settled = false;
        const timeout = setTimeout(() => socket.destroy(new Error('SMTP connection timed out')),15000);
        const finish = (error) => { if (settled) return; settled=true;clearTimeout(timeout);callback(error,error?undefined:{connection:socket,secured:secure}); };
        socket.once(secure?'secureConnect':'connect',()=>finish(null));
        socket.on('error',error=>finish(error));
        socket.once('close',()=>{sockets.delete(socket);finish(new Error('SMTP connection closed'));});
      } });
    // Nodemailer's non-pooled close() does not destroy in-flight sockets itself.
    const close = transporter.close.bind(transporter);
    transporter.close = () => { for (const socket of sockets) socket.destroy(); close(); };
    return transporter;
  }
  async withInbox(work) {
    const client = await this.imap();
    let lock;
    let timedOut = false;
    // Bound the entire network session, including a server that trickles data.
    const timer = setTimeout(() => { timedOut = true; client.close(); },120000);
    try { await client.connect(); lock = await client.getMailboxLock('INBOX',{ readOnly: true }); const result = await work(client); if (timedOut) throw new Error('IMAP operation timed out'); return result; }
    finally { lock?.release(); client.close(); clearTimeout(timer); }
  }
  async verifyConnection() {
    const baseline = await this.withInbox(async client => ({ uidValidity: String(client.mailbox.uidValidity), lastUid: String(Number(client.mailbox.uidNext) - 1) }));
    if (!/^\d+$/.test(baseline.uidValidity) || !/^\d+$/.test(baseline.lastUid)) throw new Error('IMAP server did not return a valid UID baseline');
    const smtp = await this.smtp();
    const timer = setTimeout(() => smtp.close(),45000);
    try { await smtp.verify(); } finally { clearTimeout(timer); smtp.close(); }
    return baseline; // Authentication only: no test email is sent.
  }
  async fetchBatch({ limit = 50, assertOwned = async () => {} } = {}) {
    return this.withInbox(async client => {
      const i = this.integration;
      const uidValidity = String(client.mailbox.uidValidity);
      const upper = Number(client.mailbox.uidNext) - 1;
      if (!/^\d+$/.test(uidValidity) || !Number.isSafeInteger(upper) || upper < 0) throw new Error('Invalid IMAP mailbox state');
      const reset = i.imapUidValidity !== uidValidity;
      const last = reset ? 0 : Number(i.imapLastUid || 0);
      const recoveryUntil = reset ? upper : Number(i.imapRecoveryUntilUid || 0);
      if (!Number.isSafeInteger(last) || last < 0 || last > upper) throw new Error('Invalid IMAP UID cursor');
      const found = last < upper ? await client.search({ uid: `${last + 1}:${upper}` },{ uid: true }) : [];
      const candidates = [...new Set((found || []).map(Number))].filter(uid => Number.isSafeInteger(uid) && uid > last && uid <= upper).sort((a,b) => a-b);
      const selected = candidates.slice(0,Math.max(1,Math.min(Number(limit) || 50,100)));
      const messages = [];
      let batchBytes = 0, lastScanned = last, sizeLimited = false;
      for (const uid of selected) {
        await assertOwned();
        const meta = await client.fetchOne(String(uid),{ uid: true, size: true, flags: true, internalDate: true },{ uid: true });
        if (!meta) { lastScanned = uid; continue; } // Expunged after search.
        const flags = [...(meta.flags || [])].map(x => x.toLowerCase());
        if (flags.includes('\\deleted') || flags.includes('\\draft')) { lastScanned = uid; continue; }
        if (!Number.isSafeInteger(meta.size) || meta.size < 0) throw new Error('IMAP message size missing');
        if (meta.size > 25 * 1024 * 1024) throw new Error('IMAP message exceeds 25 MB processing limit');
        if (batchBytes + meta.size > 50 * 1024 * 1024) { sizeLimited = true; break; }
        batchBytes += meta.size;
        lastScanned = uid;
        const full = await client.fetchOne(String(uid),{ source: true },{ uid: true });
        if (!full) continue;
        if (!full.source) throw new Error('IMAP message source missing');
        const parsed = await this.parse(full.source,{ skipHtmlToText: false, skipTextToHtml: true });
        const sender = parsed.from?.value?.[0]?.address?.toLowerCase() || '';
        if (!sender.includes('@')) throw new Error('IMAP message has no valid sender');
        if (sender === i.email.toLowerCase()) continue;
        const internetMessageId = singleId(parsed.messageId);
        const references = (Array.isArray(parsed.references) ? parsed.references : String(parsed.references || '').split(/\s+/)).filter(singleId);
        const receivedAt = new Date(meta.internalDate || parsed.date || Date.now());
        const auto = String(parsed.headers?.get('auto-submitted') || '').toLowerCase();
        messages.push({ id: `${i.imapMailboxKey}:${uidValidity}:${uid}`, uid, sender, from: parsed.from.text || sender,
          threadId: references[0] || singleId(parsed.inReplyTo) || internetMessageId || `${uidValidity}:${uid}`,
          internetMessageId, references: references.join(' '), subject: parsed.subject || 'Guest inquiry', text: parsed.text || '', receivedAt,
          automated: Boolean((auto && auto !== 'no') || parsed.headers?.get('list-id') || /bulk|list|junk/i.test(String(parsed.headers?.get('precedence') || ''))),
          recovery: uid <= recoveryUntil });
      }
      const hasMore = sizeLimited || candidates.length > selected.length;
      return { messages, uidValidity, lastUid: String(hasMore ? lastScanned : upper), recoveryUntilUid: String(recoveryUntil), hasMore };
    });
  }
  async send({ to, subject, bodyText, bodyHtml, inReplyTo, references, rfcMessageId }) {
    if (typeof to !== 'string' || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(to) || (!bodyText && !bodyHtml)) throw Object.assign(new Error('Recipient and reply body required'),{ definitelyNotSent: true });
    let smtp;
    try { smtp = await this.smtp(); } catch (error) { error.definitelyNotSent = true; throw error; }
    const timer = setTimeout(() => smtp.close(),60000);
    try {
      const info = await smtp.sendMail({ from: { address: this.integration.email, name: 'Hotel Reception' }, to,
        subject: subject || 'Message from Hotel Reception', text: bodyText, html: bodyHtml,
        inReplyTo: singleId(inReplyTo) || undefined,
        references: String(references || inReplyTo || '').split(/\s+/).filter(singleId), messageId: singleId(rfcMessageId) || undefined,
        headers: { 'Auto-Submitted': 'auto-replied' } });
      if (!info.accepted?.some(address => String(address).toLowerCase() === to.toLowerCase())) throw Object.assign(new Error('SMTP did not accept recipient'),{ definitelyNotSent: true });
      return { success: true, messageId: info.messageId, provider: 'credentials' };
    } catch (error) {
      // Explicit SMTP rejection means no accepted send. A lost DATA response is uncertain.
      if (Number(error.responseCode) >= 400 || ['EAUTH','EDNS','ECONNECTION','ETLS'].includes(error.code) || ['CONN','AUTH','STARTTLS','EHLO','HELO','MAIL FROM','RCPT TO'].includes(error.command)) error.definitelyNotSent = true;
      throw error;
    } finally { clearTimeout(timer); smtp.close(); }
  }
}
