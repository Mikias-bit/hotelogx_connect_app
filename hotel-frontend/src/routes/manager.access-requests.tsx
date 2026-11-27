import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '@/components/AppShell';
import { Button, Card } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export const Route = createFileRoute('/manager/access-requests')({ component: AccessManagement });
const blank = { email: '', name: '', hotelName: '', hotelId: '', linkExistingUser: false };
function AccessManagement() {
  const session = useSession();
  const [data, setData] = useState<any>(null), [draft, setDraft] = useState(blank);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function refresh() { setData(await api.getAccessManagement()); }
  useEffect(() => { if (session.ready && session.userId) refresh().catch(() => setError('This page is restricted to configured Hotelogx operators.')); }, [session.ready, session.userId]);
  async function act(fn: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await fn(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed. Refresh to check status before retrying.'); } finally { setBusy(false); } }
  const field = 'mt-1 w-full rounded-lg border border-line bg-surface p-2 text-sm';
  return <AppShell title="Hotelogx access management" wide>
    <h1 className="mb-2 text-xl font-semibold">Hotel access & invitations</h1>
    <p className="mb-5 text-sm text-ink-3">Review requests or invite a hotel directly. Access is granted only to the selected email and hotel.</p>
    {error && <p role="alert" className="mb-4 text-urgent">{error}</p>}{notice && <p role="status" className="mb-4">{notice}</p>}
    {data && <div className="grid items-start gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">Pending requests</h2>
          {!data.notificationReady && <p className="text-sm text-attend">Approval emails are not configured yet. Requests are still saved here.</p>}
          <Button disabled={busy} variant="outline" onClick={() => void act(refresh)}>Refresh</Button>
          {!data.requests.length && <p className="text-sm text-ink-3">No pending requests.</p>}
          {data.requests.map((r: any) => <div key={r.id} className="space-y-2 border-t border-line pt-3 text-sm">
            <p className="font-medium">{r.hotelName}</p><p>{r.name} · {r.email}</p>
            <p className="text-xs text-ink-3">Notification: {r.notificationStatus} · {new Date(r.createdAt).toLocaleString()}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => { setDraft({ ...blank, email: r.email, name: r.name, hotelName: r.hotelName }); setConfirmed(false); setNotice('Review the hotel and email in the invitation form, then confirm approval.'); }}>Review request</Button>
              {r.notificationStatus === 'pending' && <Button disabled={busy || !data.notificationReady} variant="outline" onClick={() => void act(async () => { const result = await api.notifyAccessRequest(r.id); setNotice(`Notification: ${result.status}`); })}>Send approval notification</Button>}
              <Button disabled={busy} variant="quiet" onClick={() => void act(async () => { await api.rejectAccessRequest(r.id); setNotice('Request declined. No invitation sent.'); })}>Decline</Button>
            </div>
          </div>)}
        </Card>
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">Recent invitations</h2>
          {data.invitations.map((i: any) => <div key={i.id} className="space-y-1 border-t border-line pt-3 text-sm">
            <p>{i.name} · {i.email}</p><p className="break-all text-xs text-ink-3">Hotel: {i.hotelId}</p>
            <p>{i.revokedAt ? 'Revoked' : i.acceptedAt ? 'Accepted' : i.deliveryStatus} · expires {new Date(i.expiresAt).toLocaleDateString()}</p>
            {i.deliveryStatus === 'pending' && !i.acceptedAt && !i.revokedAt && new Date(i.expiresAt) > new Date() && <Button disabled={busy || !data.invitationReady} variant="outline" onClick={() => void act(async () => { const r = await api.sendHotelInvitation(i.id); setNotice(`Invitation: ${r.status}`); })}>Send approved invitation</Button>}
            {['failed', 'uncertain', 'sending', 'manual-review'].includes(i.deliveryStatus) && <p className="text-xs text-attend">Check delivery in Netlify before sending or resending manually.</p>}
          </div>)}
        </Card>
      </div>
      <Card className="p-4">
        <h2 className="font-semibold">Approve & invite a hotel</h2>
        <p className="mt-2 text-sm text-ink-3">A prior access request is not required. The invitation link is emailed directly to the approved recipient.</p>
        {!data.invitationReady && <p className="mt-2 text-sm text-attend">Automatic invitations need configuration. Approval can still be recorded; then invite the same email through Netlify.</p>}
        <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); void act(async () => {
          const r = await api.approveHotelAccess(draft);
          setNotice(`Hotel approved. Invitation: ${r.delivery.status}${r.delivery.reason ? ' — ' + r.delivery.reason : ''}.`);
          setDraft(blank); setConfirmed(false);
        }); }}>
          {(['name', 'email', 'hotelName', 'hotelId'] as const).map(key => <label key={key} className="block text-sm">
            {{ name: 'Administrator name', email: 'Invited email', hotelName: 'New hotel name', hotelId: 'Existing hotel ID (optional; uses that hotel instead)' }[key]}
            <input className={field} type={key === 'email' ? 'email' : 'text'} required={key === 'name' || key === 'email' || (key === 'hotelName' && !draft.hotelId)} maxLength={key === 'email' ? 254 : 200} value={draft[key]} onChange={e => { setDraft({ ...draft, [key]: e.target.value }); setConfirmed(false); }} />
          </label>)}
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.linkExistingUser} onChange={e => { setDraft({ ...draft, linkExistingUser: e.target.checked }); setConfirmed(false); }} />Explicitly link an existing manager account belonging to this hotel.</label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I approve this person as administrator of the selected hotel and want to send their invitation.</label>
          <Button type="submit" disabled={busy || !confirmed}>{busy ? 'Processing…' : data.invitationReady ? 'Approve & send invitation' : 'Record approval'}</Button>
          <Button type="button" variant="quiet" disabled={busy} onClick={() => { setDraft(blank); setConfirmed(false); }}>Clear / invite another hotel</Button>
        </form>
      </Card>
    </div>}
  </AppShell>;
}
