import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Plus, Wrench } from 'lucide-react';
import { AppShell } from './AppShell';
import { Button, Card, Empty, Eyebrow } from './ui';
import { MaintenanceWorkCard } from './MaintenanceWorkCard';
import { useMaintenance } from '@/lib/useMaintenance';
import { api } from '@/lib/api';
import type { Priority } from '@/lib/types';

export function MaintenanceWorkPage({ kind }: { kind: 'issue' | 'task' }) {
  const { data, error, loading, load } = useMaintenance();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('Open'), [composer, setComposer] = useState(false);
  const [title, setTitle] = useState(''), [room, setRoom] = useState(''), [detail, setDetail] = useState('');
  const [priority, setPriority] = useState<Priority>('Normal');
  const [busy, setBusy] = useState(false), [saveError, setSaveError] = useState('');
  const rows = data?.work.filter(row => row.kind === kind && (filter === 'All' || (filter === 'Completed' ? row.status === 'Completed' : row.status !== 'Completed'))) || [];
  const field = 'mt-1 w-full rounded-[9px] border border-line bg-surface px-3 py-2 text-sm';
  return <AppShell title={kind === 'issue' ? 'Maintenance issues' : 'Maintenance tasks'}>
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><Eyebrow>Technical department</Eyebrow><h1 className="mt-1 font-display text-[26px]">{kind === 'issue' ? 'Every issue, and its progress' : 'Parts, checks and follow-ups'}</h1><p className="mt-2 text-sm text-ink-3">Saved records for your hotel. Assign work to registered technicians from Assignments.</p></div><div className="flex gap-2"><Button variant="outline" icon={ArrowRight} onClick={() => navigate({ to: '/maintenance/assignments' })}>Assignments</Button><Button icon={Plus} onClick={() => setComposer(true)} disabled={composer}>New {kind}</Button></div></div>
      {composer && <Card><form onSubmit={async event => {
        event.preventDefault(); if (busy) return; setBusy(true); setSaveError('');
        try {
          const result = kind === 'issue' ? await api.createIssue({ title: title.trim(), room: room.trim(), detail: detail.trim(), priority, via: 'Dashboard' })
            : await api.createTask({ title: title.trim(), room: room.trim() || undefined, detail: detail.trim(), priority, department: 'Maintenance', source: 'Manager' });
          if (!result) throw new Error('The save could not be confirmed. Refresh before trying again.');
          setComposer(false); setTitle(''); setRoom(''); setDetail(''); setPriority('Normal'); await load();
        } catch (err) { setSaveError(err instanceof Error ? err.message : 'Unable to save'); } finally { setBusy(false); }
      }}><fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Title<input required maxLength={300} className={field} value={title} onChange={e => setTitle(e.target.value)} /></label><label className="text-sm">Room / location<input required={kind === 'issue'} maxLength={200} className={field} value={room} onChange={e => setRoom(e.target.value)} placeholder="Room 203, lobby or plant room" /></label><label className="text-sm sm:col-span-2">Details<textarea maxLength={4000} rows={3} className={field} value={detail} onChange={e => setDetail(e.target.value)} /></label><label className="text-sm">Priority<select className={field} value={priority} onChange={e => setPriority(e.target.value as Priority)}>{['Urgent', 'High', 'Normal', 'Low'].map(value => <option key={value}>{value}</option>)}</select></label></fieldset>{saveError && <p role="alert" className="my-3 text-sm text-urgent">{saveError}</p>}<div className="mt-4 flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button><Button variant="outline" disabled={busy} onClick={() => setComposer(false)}>Cancel</Button></div></form></Card>}
      <div className="flex flex-wrap gap-2">{['Open', 'Completed', 'All'].map(value => <Button key={value} size="sm" variant={filter === value ? 'primary' : 'outline'} onClick={() => setFilter(value)}>{value}</Button>)}<Button size="sm" variant="quiet" disabled={loading} onClick={() => void load()}>Refresh</Button></div>
      {error && <p role="alert" className="text-sm text-urgent">{error} Displayed records may be out of date.</p>}
      {loading && !data ? <p role="status">Loading maintenance records…</p> : rows.map(row => <MaintenanceWorkCard key={`${row.kind}:${row.id}`} work={row} />)}
      {data && !error && !rows.length && <Empty title="No work in this view" hint="New backend records will appear here." icon={Wrench} />}
    </div>
  </AppShell>;
}
