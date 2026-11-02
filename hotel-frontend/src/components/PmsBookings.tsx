import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const input = 'w-full rounded border border-line bg-surface px-3 py-2 text-sm';
const button = 'rounded bg-ink px-3 py-2 text-sm text-white disabled:opacity-40';
export function BookingSettings() {
  const [config, setConfig] = useState<any>({ enabled: false, autoBook: false, serviceId: '', categoryIds: [], rateTerms: {}, arrivalTime: '15:00', departureTime: '11:00', paymentInstructions: '' });
  const [services, setServices] = useState<{ id: string; name: string }[]>([]), [catalog, setCatalog] = useState<any>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [reviewed, setReviewed] = useState(false);
  useEffect(() => { let active = true; api.getBookingConfig().then(data => { if (active && data) setConfig(data); }).catch(() => { if (active) setNotice('Booking settings could not be loaded.'); }); return () => { active = false; }; }, []);
  async function act(fn: () => Promise<void>) { setBusy(true); setNotice(''); try { await fn(); } catch (e) { setNotice(e instanceof Error ? e.message : 'Unable to update bookings'); } finally { setBusy(false); } }
  return <details className="mt-4 border-t border-line pt-4"><summary className="cursor-pointer font-medium">Chat reservations and staff payment procedure</summary>
    <div className="mt-3 space-y-3 text-sm">
      <p>Enable one-room bookings using selected Mews rates. Staff collect payment or arrange preauthorization through the hotel’s normal procedure. No card details are requested in chat.</p>
      <button className={button} disabled={busy} onClick={() => void act(async () => { const result = await api.getBookingServices(); if (!result?.services) throw new Error('Could not load Mews services'); setServices(result.services); })}>Load Mews services</button>
      <label className="block">Accommodation service<select className={input} value={config.serviceId} disabled={busy} onChange={e => { setConfig({ ...config, serviceId: e.target.value, categoryIds: [], rateTerms: {} }); setCatalog(null); setReviewed(false); }}><option value="">Choose service</option>{config.serviceId && !services.some(s => s.id === config.serviceId) && <option value={config.serviceId}>Saved accommodation service — load to view name</option>}{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
      <button className={button} disabled={busy || !config.serviceId} onClick={() => void act(async () => { const data = await api.getBookingCatalog(config.serviceId); if (!data) throw new Error('Could not load rooms and rates'); setCatalog(data); })}>Load rooms and rates</button>
      {catalog && <>
        <p>Choose up to 3 room categories and 2 public rates.</p>
        {catalog.categories.map((c: any) => <label key={c.id} className="block"><input type="checkbox" disabled={busy} checked={config.categoryIds.includes(c.id)} onChange={e => setConfig({ ...config, categoryIds: e.target.checked ? [...config.categoryIds, c.id] : config.categoryIds.filter((id: string) => id !== c.id) })} /> {c.name} · capacity {c.capacity}</label>)}
        {catalog.rates.map((r: any) => <div key={r.id}><label><input type="checkbox" disabled={busy} checked={Object.hasOwn(config.rateTerms, r.id)} onChange={e => { const terms = { ...config.rateTerms }; if (e.target.checked) terms[r.id] = ''; else delete terms[r.id]; setConfig({ ...config, rateTerms: terms }); }} /> {r.name}</label>{Object.hasOwn(config.rateTerms, r.id) && <textarea className={input} aria-label={`Terms for ${r.name}`} placeholder="Cancellation terms, inclusions, city tax and any additional charges" value={config.rateTerms[r.id]} maxLength={1200} disabled={busy} onChange={e => setConfig({ ...config, rateTerms: { ...config.rateTerms, [r.id]: e.target.value } })} />}</div>)}
      </>}
      <div className="grid grid-cols-2 gap-2"><label>Check-in time<input className={input} type="time" value={config.arrivalTime} disabled={busy} onChange={e => setConfig({ ...config, arrivalTime: e.target.value })} /></label><label>Check-out time<input className={input} type="time" value={config.departureTime} disabled={busy} onChange={e => setConfig({ ...config, departureTime: e.target.value })} /></label></div>
      <label className="block">Payment instructions shown to guests<textarea className={input} value={config.paymentInstructions} disabled={busy} maxLength={1000} placeholder="For example: Front Office will contact you to arrange payment securely before arrival." onChange={e => setConfig({ ...config, paymentInstructions: e.target.value })} /></label>
      <label className="block"><input type="checkbox" disabled={busy} checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} /> Enable chat availability and reservation quotes</label>
      <button className="underline" disabled={busy} onClick={() => void act(async () => { const result = await api.disableBookings(); if (!result?.disabled) throw new Error('Could not confirm bookings are disabled'); setConfig({ ...config, enabled: false, autoBook: false }); setNotice('Chat bookings disabled. Existing reservations are unchanged.'); })}>Disable bookings now</button>
      <label className="block"><input type="checkbox" disabled={busy} checked={config.autoBook} onChange={e => setConfig({ ...config, autoBook: e.target.checked })} /> Automatically book after guest acceptance when hotel AI rules permit it</label>
      <p>Otherwise, Front Office approval is required. Potential rate restrictions always require a staff check. Mews inventory is checked again when creating the reservation.</p>
      <label className="block"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)} /> I reviewed these rates, terms and Mews payment automations. These bookings may be created before staff arrange payment.</label>
      <button className={button} disabled={busy || !reviewed} onClick={() => void act(async () => { const saved = await api.saveBookingConfig({ ...config, paymentProcedureReviewed: reviewed }); if (!saved) throw new Error('Save could not be confirmed'); setConfig(saved); setReviewed(false); setNotice('Booking settings saved.'); })}>Save booking settings</button>
      {notice && <p role="status">{notice}</p>}
    </div>
  </details>;
}

export function BookingRequests({ conversationId }: { conversationId: string }) {
  const [offers, setOffers] = useState<any[]>([]), [note, setNote] = useState(''), [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  async function refresh() { const rows = await api.getBookingOffers(conversationId); if (!rows) throw new Error('Booking requests unavailable'); setOffers(rows); }
  useEffect(() => { let active = true; api.getBookingOffers(conversationId).then(rows => { if (active) setOffers(rows || []); }).catch(() => { if (active) setNotice('Booking requests could not be loaded.'); }); return () => { active = false; }; }, [conversationId]);
  async function action(id: string, type: 'approve' | 'reject' | 'payment-follow-up') {
    setBusy(true); setNotice('');
    try { const result = await api.bookingAction(id, type, { note, restrictionsChecked: checked }); if (!result) throw new Error('The result is not confirmed; check Mews before retrying.'); await refresh(); setNotice(result.reply_text || 'Saved.'); setChecked(false); }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Request failed'); } finally { setBusy(false); }
  }
  return <section className="space-y-3 text-sm"><div className="flex justify-between"><strong>Booking requests &amp; payment follow-up</strong><button disabled={busy} onClick={() => void refresh().catch(() => setNotice('Refresh failed'))}>Refresh</button></div>
    {offers.map(row => <div className="space-y-2 rounded border border-line p-3" key={row.id}>
      <p>{row.snapshot.room_name} · {row.request.check_in} → {row.request.check_out}</p><p>{row.snapshot.total} {row.snapshot.currency} · {row.status.replaceAll('_', ' ')}</p>
      <details><summary>Accepted details and terms</summary><p className="whitespace-pre-wrap">{row.replyText}</p></details>
      {row.result?.confirmation_number && <p>Confirmation: {row.result.confirmation_number}</p>}
      {row.lastError && <p role="alert">{row.lastError}</p>}
      {['posting', 'uncertain'].includes(row.status) && <p>Check Mews using this reference: {row.id}. Do not create a replacement booking until reconciled.</p>}
      {['offered', 'pending_approval'].includes(row.status) && <button className={button} disabled={busy || !checked || note.trim().length < 10 || new Date(row.expiresAt) <= new Date()} onClick={() => void action(row.id, 'approve')}>Approve accepted booking</button>}
      {['offered', 'pending_approval'].includes(row.status) && <button className="ml-2 underline" disabled={busy} onClick={() => void action(row.id, 'reject')}>Reject request</button>}
      {row.status === 'booked' && <><p>Payment follow-up: {row.paymentStatus.replaceAll('_', ' ')}</p>{row.paymentStatus !== 'handled_by_staff' && <button className={button} disabled={busy || note.trim().length < 10} onClick={() => void action(row.id, 'payment-follow-up')}>Record staff follow-up</button>}</>}
    </div>)}
    {!offers.length && <p>No booking requests in this conversation.</p>}
    {!!offers.length && <><textarea className={input} aria-label="Booking approval or payment follow-up note" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="Approval checks or how staff handled payment. Never enter card details." /><label className="block"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> I checked guest details, occupancy, rate restrictions and the hotel payment procedure.</label><p>Approval results are shown here and saved as a suggested reply. Send the guest confirmation through the conversation. Recording follow-up does not charge a card or mark a Mews bill paid.</p></>}
    {notice && <p role="status" className="whitespace-pre-wrap">{notice}</p>}
  </section>;
}
