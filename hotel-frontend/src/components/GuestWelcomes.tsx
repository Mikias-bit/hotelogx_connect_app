import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/session';
import { useApp } from '@/lib/store';
import type { WelcomeData } from '@/lib/guestMessaging';
import { Button, Card } from './ui';
const field = 'w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink';
export function GuestWelcomes({ reservationId, channel, contact }: { reservationId: string; channel: string; contact: string }) {
  const user = useCurrentUser(), timezone = useApp(s => s.hotelProfile.timezone);
  const [data, setData] = useState<WelcomeData | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [responsibility, setResponsibility] = useState(false), [ownership, setOwnership] = useState(false), [sent, setSent] = useState(false);
  const [stage, setStage] = useState('confirmation');
  async function refresh() { const result = await api.getGuestWelcomes(); if (!result) throw new Error('Could not load welcome messages'); setData(result); }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  useEffect(() => { setOwnership(false); setSent(false); }, [reservationId, channel, contact, stage]);
  async function act(fn: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); } }
  const date = (value: string) => new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <Card className="space-y-4 p-4">
    <h2 className="font-semibold">Welcome messages and remembered guests</h2>
    <p className="text-sm text-ink-3">Send a booking welcome after confirmation and an arrival welcome after actual check-in. Verified contacts are remembered for the reservation; current room assignments are checked when handling requests. Automatic messaging above must also be enabled.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {data && <>
      {user?.role === 'manager' && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void act(async () => {
        if (!await api.saveWelcomeConfig({ ...data.config, senderResponsibilityConfirmed: responsibility })) throw new Error('Could not save welcome settings');
        await refresh(); setResponsibility(false); setNotice('Welcome settings saved.');
      }); }}>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={data.config.enabled} onChange={e => setData({ ...data, config: { ...data.config, enabled: e.target.checked } })} />Use personalised welcomes and remembered guest contacts</label>
        {(['confirmationSender', 'checkinSender'] as const).map(key => <label key={key} className="block text-sm">{key === 'confirmationSender' ? 'Booking confirmation welcome' : 'Actual check-in welcome'}<select className={field} value={data.config[key]} onChange={e => setData({ ...data, config: { ...data.config, [key]: e.target.value } })}><option value="pms">Handled by PMS / staff — do not send from Hotelogx</option><option value="hotelogx">Send from Hotelogx</option></select></label>)}
        <label className="block text-sm">Arrival instructions<textarea className={field} maxLength={500} value={data.config.arrivalInstructions} onChange={e => setData({ ...data, config: { ...data.config, arrivalInstructions: e.target.value } })} /></label>
        <label className="block text-sm">Public online check-in page (optional)<input className={field} type="url" placeholder="https://…" value={data.config.onlineCheckinUrl} onChange={e => setData({ ...data, config: { ...data.config, onlineCheckinUrl: e.target.value } })} /></label>
        <p className="text-xs text-ink-3">Use the hotel's public check-in portal, where guests authenticate. Do not paste a private link for one reservation. No link is sent if this is blank.</p>
        <label className="block text-sm">Public extras catalogue (optional)<input className={field} type="url" placeholder="https://…" value={data.config.catalogueUrl} onChange={e => setData({ ...data, config: { ...data.config, catalogueUrl: e.target.value } })} /></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={data.config.welcomeUpsells} onChange={e => setData({ ...data, config: { ...data.config, welcomeUpsells: e.target.checked } })} />Combine eligible offers with the confirmation welcome for bookings inside the pre-arrival upsell window</label>
        <p className="text-xs text-ink-3">Uses the hotel’s configured upsell timing (default three days) and live catalogue. Earlier bookings keep their later offer schedule. Previously offered products are excluded.</p>
        <details><summary>Approved WhatsApp welcome templates</summary><div className="space-y-2 pt-2">
          <p className="text-xs text-ink-3">Each template needs one body text parameter for the welcome message. Use the same language as your invitation template. These are separate from the CONNECT-code template.</p>
          <label className="block text-sm">Booking welcome template<input className={field} value={data.config.bookingWelcomeTemplate} onChange={e => setData({ ...data, config: { ...data.config, bookingWelcomeTemplate: e.target.value } })} /></label>
          <label className="block text-sm">Check-in welcome template<input className={field} value={data.config.checkinWelcomeTemplate} onChange={e => setData({ ...data, config: { ...data.config, checkinWelcomeTemplate: e.target.value } })} /></label>
        </div></details>
        <details><summary>Message wording</summary><div className="space-y-3 whitespace-pre-line text-sm pt-2">
          <p>{'Dear {first name},\nThank you for booking {hotel name}. We look forward to welcoming you on {arrival date}.\nCheck-in is available from {hotel check-in time}.\n{Arrival instructions and optional online check-in link}\n{Eligible extras or catalogue link}\nReply here if you have any questions.'}</p>
          <p>{'Dear {first name},\nWelcome to {hotel name}!\nYour checkout is on {checkout date} by {checkout time}.\nDuring your stay, simply reply here for hotel information or assistance.'}</p>
          <p className="text-xs text-ink-3">Unverified contacts receive a general check-in welcome without personal stay details. Email guests can verify by replying to the welcome in the same thread. Unverified WhatsApp guests can reply VERIFY. No Accept step is required for contacts already verified for this stay.</p>
        </div></details>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={responsibility} onChange={e => setResponsibility(e.target.checked)} />I have coordinated with the PMS and staff so they will not duplicate welcomes assigned to Hotelogx.</label>
        <Button type="submit" disabled={busy || (data.config.enabled && !responsibility)}>Save welcome settings</Button>
      </form>}
      <div className="space-y-2 border-t border-line pt-3">
        <h3 className="font-semibold">Reception actions for the selected reservation</h3>
        <p className="text-xs text-ink-3">Select the reservation and contact in the invitation form above. {reservationId ? `Selected: ${reservationId}` : 'No reservation selected.'}</p>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={ownership} onChange={e => setOwnership(e.target.checked)} />I verified the staying reservation owner’s identity and ownership of this contact at reception. It matches their own contact in Mews.</label>
        <Button disabled={busy || !reservationId || !contact || !ownership} onClick={() => void act(async () => { if (!await api.confirmGuestContact(reservationId, channel, contact)) throw new Error('Contact not confirmed'); await refresh(); setOwnership(false); setNotice('Contact verified for this stay. No invitation has been sent.'); })}>Remember verified contact</Button>
        <label className="block text-sm">Welcome already sent<select className={field} value={stage} onChange={e => setStage(e.target.value)}><option value="confirmation">Booking confirmation welcome</option><option value="checkin">Check-in welcome</option></select></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={sent} onChange={e => setSent(e.target.checked)} />I confirm this welcome has already been sent by staff or the PMS.</label>
        <Button disabled={busy || !reservationId || !sent} onClick={() => void act(async () => { if (!await api.recordWelcomeSent(reservationId, stage)) throw new Error('Could not record welcome'); await refresh(); setSent(false); setNotice('Welcome record checked/saved. Review its status below; existing delivery records are preserved.'); })}>Record existing welcome</Button>
      </div>
      <div className="flex justify-between"><h3 className="font-semibold">Welcome history</h3><Button disabled={busy} onClick={() => void act(refresh)}>Refresh</Button></div>
      {!data.welcomes.length ? <p className="text-sm">No welcome records yet.</p> : data.welcomes.map(w => <div key={w.id} className="border-t border-line py-2 text-sm"><p>{w.stage} · {w.status} · {w.channel} · {w.source}</p><p>{w.contact || 'Recorded externally'} · {w.reservationId} · {date(w.createdAt)}</p></div>)}
      <h3 className="font-semibold">Verified contacts for current reservations</h3>
      {!data.contacts.length ? <p className="text-sm">No remembered contacts yet.</p> : data.contacts.map(c => <div key={c.id} className="flex items-center justify-between gap-2 border-t border-line py-2 text-sm"><div>{c.contact} · {c.channel}<br />{c.reservationId} · {c.method}<br />Expires: {date(c.expiresAt)}</div><Button disabled={busy} onClick={() => void act(async () => { if (!await api.revokeGuestContact(c.id)) throw new Error('Could not revoke contact'); await refresh(); })}>Revoke</Button></div>)}
    </>}
  </Card>;
}
