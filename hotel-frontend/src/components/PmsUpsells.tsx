import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/session';

export function PmsUpsells() {
  const user = useCurrentUser();
  const [data, setData] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [conversation, setConversation] = useState('');
  const [reservation, setReservation] = useState('');
  const [verified, setVerified] = useState(false);
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [product, setProduct] = useState<any>(null);
  const [source, setSource] = useState('pms');
  const [amount, setAmount] = useState('');
  const [doc, setDoc] = useState('');
  const [category, setCategory] = useState('other');
  const [autoPost, setAutoPost] = useState(false);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() { setData(await api.getPmsUpsells()); }
  async function act(fn: () => Promise<any>) {
    setBusy(true); setNotice('');
    try { const result = await fn(); await refresh(); setNotice(result?.reply_text || 'Saved.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Request failed'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    refresh().catch(() => setNotice('PMS upsell controls are unavailable. Check the backend connection.'));
    api.getConversations().then(rows => setConversations(rows || []));
    api.getKnowledgeDocs().then(rows => setDocs(rows || []));
  }, []);
  const input = 'rounded border border-slate-300 bg-white px-3 py-2 text-sm';
  const button = 'rounded bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-40';
  return <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-semibold">Reservation extras and folio approvals</h2>
    <p className="text-sm text-slate-600">Prices come from Mews or a manager-approved knowledge document. The guest must accept an exact offer before posting. No payment is collected.</p>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <details><summary className="cursor-pointer font-medium">Verify a conversation’s reservation</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        <select aria-label="Guest conversation" className={input} value={conversation} onChange={e => { setConversation(e.target.value); setVerified(false); }}><option value="">Choose conversation</option>{conversations.map(c => <option key={c.id} value={c.id}>{c.guest?.name || c.guestName || c.subject || c.id}</option>)}</select>
        <input aria-label="Mews reservation ID" className={input} value={reservation} onChange={e => { setReservation(e.target.value); setVerified(false); }} placeholder="Mews reservation UUID" />
        <label className="text-sm"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} /> I verified this guest’s identity and reservation</label>
        <button className={button} disabled={busy || !verified || !conversation || !reservation} onClick={() => act(() => api.bindPmsConversation(conversation, reservation))}>Link verified reservation</button>
      </div>
    </details>
    {user?.role === 'manager' && <details><summary className="cursor-pointer font-medium">Configure product prices and autonomy</summary>
      <div className="mt-3 space-y-3">
        <div className="flex gap-2"><input className={input} aria-label="Product search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Breakfast, parking…" /><button className={button} disabled={busy || !query} onClick={() => act(async () => { const result = await api.searchPmsProducts(query); setProducts(result?.products || []); })}>Search Mews products</button></div>
        <select className={input} aria-label="Product" value={product?.product_id || ''} onChange={e => { const selected = products.find(p => p.product_id === e.target.value); setProduct(selected); setCategory(selected?.category || 'other'); setSource('pms'); setAutoPost(false); }}><option value="">Choose product</option>{products.map(p => <option key={p.product_id} value={p.product_id}>{p.name} — {p.unit_amount} {p.currency}</option>)}</select>
        {product && <div className="flex flex-wrap items-center gap-3">
          <select className={input} aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}><option value="other">Other extra</option><option value="breakfast">Breakfast</option><option value="early_checkin">Early check-in</option><option value="late_checkout">Late checkout</option></select>
          <select className={input} aria-label="Price source" value={source} onChange={e => setSource(e.target.value)}><option value="pms">PMS price</option><option value="knowledge">Approved knowledge-base price</option></select>
          {source === 'knowledge' && <><input className={input} aria-label="Approved unit price" type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Unit price (${product.currency})`} /><select className={input} aria-label="Knowledge document" value={doc} onChange={e => setDoc(e.target.value)}><option value="">Source document</option>{docs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></>}
          <label className="text-sm"><input type="checkbox" checked={autoPost} onChange={e => setAutoPost(e.target.checked)} /> Allow automatic posting after guest acceptance, subject to hotel policy</label>
          <button className={button} disabled={busy || (source === 'knowledge' && (!amount || !doc))} onClick={() => act(() => api.savePmsProduct(product.product_id, { serviceId: product.service_id, label: product.name, category, priceSource: source, unitAmount: amount, currency: product.currency, knowledgeDocId: doc, autoPost }))}>Approve product configuration</button>
          <p className="text-xs text-slate-600">Early check-in and late checkout always require staff approval.</p>
        </div>}
      </div>
    </details>}
    <button className={button} disabled={busy} onClick={() => act(refresh)}>Refresh offers</button>
    <input className={`${input} ml-2`} aria-label="Approval note" value={note} onChange={e => setNote(e.target.value)} placeholder="Approval reason / availability checked" />
    <div className="space-y-2">{data?.offers?.length === 0 && <p className="text-sm">No PMS offers yet.</p>}{data?.offers?.map((offer: any) => <article key={offer.id} className="rounded border p-3 text-sm">
      <p className="font-medium">{offer.name} · {offer.quantity} unit(s) · {offer.totalAmount} {offer.currency}</p>
      <p>Offer {offer.id.toUpperCase()} · {offer.status} · {offer.priceSource} price</p>
      <p className="break-all text-xs text-slate-600">Reservation {offer.reservationId} · Consumption {new Date(offer.consumptionUtc).toLocaleString()}</p>
      {['offered', 'pending_approval'].includes(offer.status) && <div className="mt-2 flex gap-2"><button className={button} disabled={busy || note.trim().length < 5} onClick={() => act(() => api.approvePmsOffer(offer.id, note))}>Approve and post accepted offer</button><button className={button} disabled={busy} onClick={() => act(() => api.rejectPmsOffer(offer.id))}>Reject</button></div>}
      {['posting', 'uncertain'].includes(offer.status) && <p className="text-amber-800">Check the Mews folio manually before taking further action. Do not create a replacement charge.</p>}
    </article>)}</div>
  </section>;
}
