import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/session';
import type { CheckinAutomationData } from '@/lib/guestMessaging';
import { Button, Card } from './ui';
const field = 'w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink';
export function CheckinAutomation() {
  const user = useCurrentUser();
  const [data, setData] = useState<CheckinAutomationData | null>(null);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function refresh() { const result = await api.getCheckinAutomation(); if (!result) throw new Error('Could not load automatic invitations'); setData(result); }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  async function act(fn: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); } }
  return <Card className="space-y-3 p-4">
    <h2 className="font-semibold">Automatic invitations after check-in</h2>
    <p className="text-sm text-ink-3">Works with reception, online and kiosk check-ins once Mews marks the stay as checked in. Online registration alone does not qualify. Enabling applies to new check-ins; existing stays can use the manual invitation below.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {data && <>
      <p className="text-sm">Automation: {data.enabled ? 'Enabled' : 'Disabled'} · Last recovery check: {data.lastScannedAt ? new Date(data.lastScannedAt).toLocaleString() : 'Not run yet'}</p>
      {data.error && <p role="alert">{data.error}</p>}
      {user?.role === 'manager' && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void act(async () => {
        if (!await api.saveCheckinAutomation({ ...data, guestContactsConfirmed: confirmed })) throw new Error('Settings were not saved');
        await refresh(); setConfirmed(false); setNotice('Automatic invitation settings saved.');
      }); }}>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={data.enabled} onChange={e => setData({ ...data, enabled: e.target.checked })} />Send automatically after confirmed PMS check-in</label>
        <label className="block text-sm">Delivery preference<select className={field} value={data.channel} onChange={e => setData({ ...data, channel: e.target.value })}>
          <option value="email_first">Email first; WhatsApp if no email is available</option><option value="email">Email only</option><option value="whatsapp">WhatsApp only</option>
        </select></label>
        <details><summary className="text-sm">Mews integration setup</summary><div className="space-y-2 pt-2">
          <label className="block text-sm">Mews enterprise ID<input className={field} value={data.enterpriseId} onChange={e => setData({ ...data, enterpriseId: e.target.value.trim() })} /></label>
          <label className="block text-sm">Mews integration ID<input className={field} value={data.integrationId} onChange={e => setData({ ...data, integrationId: e.target.value.trim() })} /></label>
          <label className="block text-sm">Accommodation service ID<input className={field} value={data.serviceId} onChange={e => setData({ ...data, serviceId: e.target.value.trim() })} /></label>
          <p className="text-xs text-ink-3">Use the integration receiving Mews General Webhooks and the service for room stays. Your integration administrator can supply these IDs.</p>
        </div></details>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Our PMS staying-guest profiles contain the guest’s own contact details, including online and kiosk check-ins.</label>
        <p className="text-xs text-ink-3">Uncertain contacts go to Front Office review. WhatsApp needs the approved template configured below. Invitations are not automatically resent when a code expires or delivery is uncertain.</p>
        <Button type="submit" disabled={busy || (data.enabled && !confirmed)}>Save automation</Button>
      </form>}
      <div className="flex items-center justify-between"><h3 className="font-semibold">Front Office review and queued work</h3><Button disabled={busy} onClick={() => void act(refresh)}>Refresh</Button></div>
      {!data.jobs.length ? <p className="text-sm">No outstanding invitation checks.</p> : data.jobs.map(job => <div key={job.reservationId} className="border-t border-line py-2 text-sm">
        <p>{job.reservationId} · {job.status}</p><p>{job.reason || 'Waiting for PMS check'}</p>
        <div className="mt-2 flex gap-2"><Button disabled={busy} onClick={() => void act(async () => { await api.reviewCheckinInvitation(job.reservationId, 'retry'); await refresh(); })}>Recheck PMS</Button>
          <Button disabled={busy} onClick={() => void act(async () => { await api.reviewCheckinInvitation(job.reservationId, 'dismiss'); await refresh(); })}>Dismiss review</Button></div>
      </div>)}
      <p className="text-xs text-ink-3">After correcting a contact or expired code, use the manual invitation below. Rechecking PMS never overrides an invitation already recorded for the reservation.</p>
    </>}
  </Card>;
}
