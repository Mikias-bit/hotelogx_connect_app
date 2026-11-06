import { useState } from 'react';
import { api } from '@/lib/api';

export function UpsellRecommendations({ conversationId, channel }: { conversationId: string; channel: string }) {
  const [ideas, setIdeas] = useState<any[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(channel === 'whatsapp' ? 'whatsapp' : 'email');
  const [note, setNote] = useState('');
  async function load() {
    setBusy(true); setNotice('');
    try { const rows = await api.getUpsellRecommendations(conversationId) || []; setIdeas(rows); if (!rows.length) setNotice('No new catalogue extras match this conversation, or they have already been offered.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to check catalogue extras.'); }
    finally { setBusy(false); }
  }
  async function send(productId: string) {
    setBusy(true); setNotice('');
    try {
      const result = await api.sendUpsellRecommendation(conversationId, productId, target);
      setNotice(result.status === 'sent' ? 'Offer sent.' : result.status === 'skipped' ? result.reason : 'Delivery was not confirmed. Review the conversation before contacting the guest again.');
      setIdeas(ideas.filter(i => i.productId !== productId));
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to send offer.'); }
    finally { setBusy(false); }
  }
  async function record(productId: string) {
    setBusy(true);
    try { await api.recordStaffUpsell(conversationId, productId, note); setIdeas(ideas.filter(i => i.productId !== productId)); setNotice('Prior staff offer recorded. This extra will not be offered again automatically.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to record previous offer.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-2">
    <h3 className="text-sm font-medium">Catalogue upsell opportunities</h3>
    <p className="text-xs text-ink-3">Check current prices and previous staff or AI offers before sending.</p>
    <button className="rounded border px-3 py-2 text-sm disabled:opacity-40" disabled={busy} onClick={load}>Check relevant extras</button>
    <select aria-label="Upsell delivery channel" className="ml-2 rounded border p-2 text-sm" value={target} onChange={e => setTarget(e.target.value)}><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select>
    {!!ideas.length && <label className="block text-xs">Already offered outside this app? Record where and when.<input className="mt-1 w-full rounded border p-2" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="Offered by phone today by reception" /></label>}
    {ideas.map(i => <article key={i.productId} className="rounded border p-3 text-sm"><p>{i.label} · {i.value}</p><button disabled={busy} className="mt-2 rounded bg-slate-800 px-3 py-2 text-white disabled:opacity-40" onClick={() => send(i.productId)}>Offer to guest</button><button className="mt-2 rounded border px-3 py-2 disabled:opacity-40" disabled={busy || note.trim().length < 5} onClick={() => record(i.productId)}>Already offered by staff</button></article>)}
    {notice && <p role="status" className="text-xs">{notice}</p>}
  </section>;
}
