import { useCallback, useEffect, useState } from 'react';
import { AppShell } from './AppShell';
import { CheckinAutomation } from './CheckinAutomation';
import { Button, Card } from './ui';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/session';
import { useApp } from '@/lib/store';
import type { MessagingData, MessagingReservation } from '@/lib/guestMessaging';

const field = 'w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink';
export function GuestMessagingPage() {
  const user = useCurrentUser();
  const timezone = useApp(s => s.hotelProfile.timezone);
  const [data, setData] = useState<MessagingData | null>(null);
  const [reservations, setReservations] = useState<MessagingReservation[]>([]);
  const [query, setQuery] = useState(''); const [reservationId, setReservationId] = useState('');
  const [channel, setChannel] = useState('email'); const [contact, setContact] = useState('');
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [template, setTemplate] = useState(''); const [language, setLanguage] = useState('en');
  const refresh = useCallback(async () => {
    const result = await api.getGuestMessaging();
    if (!result) throw new Error('Could not load guest messaging');
    setData(result); return result;
  }, []);
  useEffect(() => { refresh().then(result => { setTemplate(result.config.whatsappTemplate); setLanguage(result.config.whatsappLanguage); }).catch(e => setError(e.message)); }, [refresh]);
  async function perform(fn: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); }
  }
  const date = (value: string) => new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <AppShell title="Connect guest messaging" wide>
    <div className="space-y-5 p-5">
      <h1 className="font-display text-2xl">Connect guest messaging</h1>
      <p className="text-sm text-ink-3">After check-in, confirm the guest’s own email or WhatsApp number and send a single-use connection code. Mews must show a checked-in reservation with an assigned room. Each companion can receive a separate invitation.</p>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <CheckinAutomation />
      <Card className="space-y-4 p-4">
        <h2 className="font-semibold">Find the reservation</h2>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void perform(async () => {
          const result = await api.findMessagingReservations(query); if (!result) throw new Error('Could not search reservations');
          setReservations(result); setReservationId(''); setConfirmed(false);
          if (!result.length) setNotice('No matching synced reservations. Check in and sync the reservation in Mews, then search again.');
        }); }}>
          <input className={field} aria-label="Reservation search" placeholder="Guest name, reservation number or room" value={query} onChange={e => setQuery(e.target.value)} />
          <Button type="submit" disabled={busy}>Search</Button>
        </form>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); void perform(async () => {
          const result = await api.inviteGuestMessaging({ reservationId, channel, contact, contactConfirmed: confirmed });
          if (!result) throw new Error('Could not confirm invitation delivery. Refresh the list before trying again.');
          setNotice(result.status === 'sent' ? 'Invitation accepted by the provider. Ask the guest to reply with the code within 10 minutes. This does not yet verify the guest.'
            : result.status === 'redeemed' ? 'The guest has connected messaging.' : `Invitation status: ${result.status}. Check delivery before sending another invitation.`);
          setConfirmed(false); await refresh();
        }); }}>
          <label className="block text-sm">Reservation<select className={field} required value={reservationId} onChange={e => { setReservationId(e.target.value); setConfirmed(false); }}>
            <option value="">Select a reservation</option>{reservations.map(r => <option key={r.reservationId} value={r.reservationId}>{r.number} · {r.name} · Room {r.room || 'unassigned'} · {r.arrival} – {r.departure} · {r.status}</option>)}
          </select></label>
          <p className="text-xs text-ink-3">Search results are synced records. Check-in status is checked live before sending and when the guest replies.</p>
          <label className="block text-sm">Send by<select className={field} value={channel} onChange={e => { setChannel(e.target.value); setContact(''); setConfirmed(false); }}><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select></label>
          <label className="block text-sm">Guest contact<input className={field} required type={channel === 'email' ? 'email' : 'tel'} maxLength={254} placeholder={channel === 'email' ? 'guest@example.com' : '+31612345678'} value={contact} onChange={e => { setContact(e.target.value); setConfirmed(false); }} /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I checked the guest’s identity at reception and confirmed this contact belongs to this guest or an authorised companion on this reservation, rather than the booking agent.</label>
          {channel === 'whatsapp' && !data?.config.whatsappTemplate && <p className="text-sm">A manager must configure an approved WhatsApp invitation template. Email is available when the hotel mailbox is connected.</p>}
          <Button type="submit" disabled={busy || !data || !reservationId || !confirmed || (channel === 'whatsapp' && !data.config.whatsappTemplate)}>Send connection invitation</Button>
        </form>
      </Card>
      <Card className="space-y-3 p-4">
        <div className="flex justify-between"><h2 className="font-semibold">Recent invitations</h2><Button disabled={busy} onClick={() => void perform(async () => { await refresh(); })}>Refresh</Button></div>
        <p className="text-xs text-ink-3">Latest 100 invitations. Redeemed means the code was used; access still requires a current checked-in stay and ends at the recorded checkout time. Times use {timezone}.</p>
        {!data ? <p>Loading…</p> : !data.invitations.length ? <p>No invitations yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Contact</th><th>Reservation</th><th>Status</th><th>Sent / code expiry</th><th>Access</th></tr></thead><tbody>{data.invitations.map(item => <tr key={item.id} className="border-t border-line">
          <td className="py-3">{item.contact}<br />{item.channel}</td><td>{reservations.find(r => r.reservationId === item.reservationId)?.number || item.reservationId}</td>
          <td>{!item.redeemedAt && !item.revokedAt && new Date(item.expiresAt) < new Date() ? 'Code expired' : item.status}</td><td>{date(item.createdAt)}<br />{date(item.expiresAt)}</td>
          <td>{item.revokedAt ? 'Revoked' : <Button disabled={busy} onClick={() => void perform(async () => { if (!await api.revokeGuestMessaging(item.id)) throw new Error('Could not revoke invitation'); await refresh(); setNotice('Invitation and its matching messaging connection revoked.'); })}>Revoke</Button>}</td>
        </tr>)}</tbody></table></div>}
      </Card>
      {user?.role === 'manager' && <Card className="space-y-3 p-4"><h2 className="font-semibold">WhatsApp invitation template</h2>
        <p className="text-sm text-ink-3">Use an approved template with one body parameter for the full CONNECT code. Its text should tell the guest to reply with only that code within 10 minutes and keep it private.</p>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); void perform(async () => { if (!await api.saveGuestMessagingConfig({ whatsappTemplate: template, whatsappLanguage: language })) throw new Error('Could not save template'); await refresh(); setNotice('Invitation template saved.'); }); }}>
          <label className="block text-sm">Approved template name<input className={field} value={template} maxLength={100} onChange={e => setTemplate(e.target.value)} placeholder="guest_messaging_connection" /></label>
          <label className="block text-sm">Template language<input className={field} required value={language} onChange={e => setLanguage(e.target.value)} placeholder="en" /></label>
          <Button type="submit" disabled={busy}>Save template</Button>
        </form></Card>}
    </div>
  </AppShell>;
}
