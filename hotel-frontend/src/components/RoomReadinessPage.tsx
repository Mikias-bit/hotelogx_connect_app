import { useState } from 'react';
import { AppShell } from './AppShell';
import { Badge, Button, Card } from './ui';
import { useReadiness, type ReadyRoom } from '@/lib/useReadiness';
import { useCurrentUser } from '@/lib/session';
import { api } from '@/lib/api';

export function RoomReadinessPage() {
  const user = useCurrentUser();
  return <ReadinessBoard key={user?.id} />;
}
function ReadinessBoard() {
  const { rooms, error, loading, load } = useReadiness(), user = useCurrentUser();
  const [filter, setFilter] = useState('All'), [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ room: ReadyRoom; action: string } | null>(null), [note, setNote] = useState('');
  const [restrictions, setRestrictions] = useState({ occupied: false, dnd: false, maintenanceBlocked: false, otherRestriction: '' });
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [notice, setNotice] = useState('');
  const canInspect = ['manager', 'housekeeping'].includes(user?.role || ''), canRelease = ['manager', 'front-office'].includes(user?.role || '');
  const labels: Record<string, string> = { cleaned: 'Confirm cleaning finished', needs_cleaning: 'Needs cleaning', inspect: 'Approve inspection', release: 'Approve ready for Front Office', revoke: 'Withdraw release approval', restrictions: 'Update restrictions' };
  const open = (room: ReadyRoom, action: string) => { setSelected({ room, action }); setNote(''); setFailure(''); setRestrictions({ occupied: room.occupied, dnd: room.dnd, maintenanceBlocked: room.maintenanceBlocked, otherRestriction: room.otherRestriction }); };
  const list = rooms.filter(r => (!search || r.number.toLowerCase().includes(search.toLowerCase())) && (filter === 'All' || filter === 'Ready' ? filter === 'All' || r.ready : filter === 'Restricted' ? r.restrictions.length > 0 : r.cleanliness === filter));
  return <AppShell title="Room readiness" wide><div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-display text-[26px]">Room readiness</h1><p className="mt-2 text-sm text-ink-3">{error ? 'Readiness unavailable' : `${rooms.filter(r => r.ready).length} ready for Front Office · ${rooms.filter(r => r.cleanliness === 'Awaiting inspection').length} awaiting inspection`}</p><p className="mt-1 text-sm text-ink-3">Cleaning, inspection and release are separate. Approval here records internal readiness; it does not change PMS availability or message guests.</p></div><Button variant="outline" disabled={loading || busy} onClick={() => void load()}>Refresh</Button></div>
    {error && <p role="alert" className="text-red-700">{error} Refresh before taking action.</p>}{notice && <p role="status">{notice}</p>}
    <div className="flex flex-wrap gap-2"><input aria-label="Find room" className="rounded border p-2 text-sm" placeholder="Find room" value={search} onChange={e => setSearch(e.target.value)} />{['All', 'Needs cleaning', 'Cleaning', 'Awaiting inspection', 'Inspected', 'Restricted', 'Ready'].map(value => <Button size="sm" variant={filter === value ? 'primary' : 'outline'} key={value} onClick={() => setFilter(value)}>{value}</Button>)}</div>
    <Card pad={false}><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Room', 'Cleaning / inspection', 'Restrictions', 'Front Office readiness', 'Actions'].map(h => <th className="border-b p-3" key={h}>{h}</th>)}</tr></thead><tbody>{list.map(room => <tr key={room.number}>
      <td className="border-b p-3"><strong>{room.number}</strong>{room.arrivalTime && <p>Arrival {room.arrivalTime}</p>}<p>{room.guestStatus}</p></td>
      <td className="border-b p-3"><Badge tone={room.cleanliness === 'Inspected' ? 'good' : 'attend'}>{room.cleanliness}</Badge>{room.inspectedAt && <p className="text-xs">Inspected {new Date(room.inspectedAt).toLocaleString()} · {room.inspectedBy}</p>}<details className="mt-2"><summary>{room.openTasks.length} open housekeeping tasks</summary>{room.openTasks.map(t => <p key={t.id}>{t.title} · {t.status}</p>)}</details></td>
      <td className="max-w-xs border-b p-3">{room.restrictions.length ? room.restrictions.map(r => <p key={r} className="text-amber-800">{r}</p>) : 'None recorded'}{room.issues.map(i => <p key={i.id} className="mt-1 text-xs">{i.title} · {i.status} · {i.id}</p>)}</td>
      <td className="border-b p-3"><Badge tone={room.ready ? 'good' : 'mute'}>{room.releaseStatus}</Badge>{room.releasedAt && <p className="text-xs">Approved {new Date(room.releasedAt).toLocaleString()} · {room.releasedBy}</p>}<details className="mt-2 text-xs"><summary>History</summary>{room.history.map(e => <p className="py-1" key={e.id}>{new Date(e.at).toLocaleString()} · {e.action} · {e.actor}: {e.note}</p>)}</details></td>
      <td className="space-y-2 border-b p-3">{canInspect && <><Button size="sm" variant="outline" disabled={busy || !!error || room.openTasks.length > 0} onClick={() => open(room, 'cleaned')}>Cleaning finished</Button><Button size="sm" variant="outline" disabled={busy || !!error || !room.canInspect} onClick={() => open(room, 'inspect')}>Approve inspection</Button><Button size="sm" variant="quiet" disabled={busy || !!error} onClick={() => open(room, 'needs_cleaning')}>Needs cleaning</Button></>}{canRelease && <Button size="sm" variant="outline" disabled={busy || !!error || (!room.ready && (room.cleanliness !== 'Inspected' || room.restrictions.length > 0))} onClick={() => open(room, room.ready ? 'revoke' : 'release')}>{room.ready ? 'Withdraw approval' : 'Approve ready'}</Button>}{(canInspect || canRelease) && <Button size="sm" variant="quiet" disabled={busy || !!error} onClick={() => open(room, 'restrictions')}>Restrictions</Button>}</td>
    </tr>)}</tbody></table>{!list.length && <p className="p-4">{loading ? 'Loading rooms…' : 'No rooms match this view.'}</p>}</div></Card>
    {selected && <div role="dialog" aria-modal="true" aria-label={labels[selected.action]} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><form className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setFailure('');
      try { const result = await api.updateRoomReadiness(selected.room.number, { action: selected.action, token: selected.room.token, note, ...(selected.action === 'restrictions' ? { restrictions } : {}) }); if (!result) throw new Error('Update could not be confirmed. Refresh the room.'); setNotice(`Room ${selected.room.number}: ${labels[selected.action]} saved.`); setSelected(null); await load(); window.dispatchEvent(new Event('hotelogx:readiness-updated')); }
      catch (err) { setFailure(err instanceof Error ? err.message : 'Update failed'); } finally { setBusy(false); }
    }}><h2 className="font-display text-xl">Room {selected.room.number}: {labels[selected.action]}</h2>
      {selected.action === 'restrictions' && <fieldset disabled={busy} className="space-y-2">{(['occupied', 'dnd', 'maintenanceBlocked'] as const).map(key => <label className="block text-sm" key={key}><input type="checkbox" checked={restrictions[key]} onChange={e => setRestrictions({ ...restrictions, [key]: e.target.checked })} /> {key === 'occupied' ? 'Guest inside' : key === 'dnd' ? 'Do not disturb' : 'Manual maintenance block'}</label>)}<label className="block text-sm">Other restriction<input className="w-full rounded border p-2" maxLength={500} value={restrictions.otherRestriction} onChange={e => setRestrictions({ ...restrictions, otherRestriction: e.target.value })} /></label><p className="text-xs">Open repairs and PMS restrictions remain until resolved at their source.</p></fieldset>}
      <label className="block text-sm">{selected.action === 'inspect' ? 'Inspection findings' : 'Reason / confirmation'}<textarea autoFocus required maxLength={2000} className="mt-1 w-full rounded border p-2" disabled={busy} value={note} onChange={e => setNote(e.target.value)} /></label>
      {failure && <p role="alert" className="text-red-700">{failure}</p>}<div className="flex gap-2"><Button type="submit" disabled={busy}>Confirm</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setSelected(null)}>Cancel</Button></div>
    </form></div>}
  </div></AppShell>;
}
