import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from './AppShell';
import { Badge, Button, Card, Empty } from './ui';
import { api } from '@/lib/api';
import { useApp } from '@/lib/store';
import { dateLabel } from '@/lib/timeline';
import type { Shift, ShiftHandover } from '@/lib/shiftHandover';

const shifts: Shift[] = ['Morning', 'Evening', 'Night'];
const field = 'w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink';

function HandoverCard({ item, timezone, refresh }: { item: ShiftHandover; timezone: string; refresh: () => Promise<void> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function update(action: string) {
    setBusy(true); setError('');
    try {
      const result = await api.updateShiftHandover(item.id, { version: item.version, action, note });
      if (!result) throw new Error('Update could not be saved. Refresh and try again.');
      setNote(''); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Update failed'); }
    finally { setBusy(false); }
  }
  return <Card className="p-4 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="font-semibold text-ink">{item.title}</h3>
      <Badge tone={item.priority === 'Urgent' ? 'urgent' : item.priority === 'High' ? 'attend' : 'mute'}>{item.priority}</Badge>
      <Badge tone={item.status === 'Completed' ? 'good' : 'attend'}>{item.status}</Badge>
      {item.room && <Badge tone="mute">Room {item.room}</Badge>}
    </div>
    <p className="text-xs text-ink-3">{item.shiftDate} {item.shift} to {item.targetDate} {item.targetShift}</p>
    <p className="whitespace-pre-wrap text-sm text-ink">{item.body}</p>
    <p className="text-xs text-ink-3">Added by {item.authorName} | {dateLabel(item.createdAt, timezone)}</p>
    <details className="text-sm text-ink-3"><summary className="cursor-pointer">Updates and history ({item.events.length})</summary>
      <ol className="mt-2 space-y-2">{item.events.map((event, index) => <li key={index} className="border-l-2 border-line pl-3">
        <p>{event.action} | {event.actorName} | {dateLabel(event.at, timezone)}</p>
        {event.note && <p className="whitespace-pre-wrap text-ink">{event.note}</p>}
      </li>)}</ol>
    </details>
    <label className="block text-xs text-ink-3">Update or completion note
      <textarea className={`${field} mt-1`} rows={2} disabled={busy} maxLength={4000} value={note} onChange={e => setNote(e.target.value)} placeholder="Add an update, outcome or correction" />
    </label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {item.status === 'Open' && <Button size="sm" disabled={busy} onClick={() => update('Acknowledge')}>Acknowledge receipt</Button>}
      <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => update('Comment')}>Add update</Button>
      <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => update(item.status === 'Completed' ? 'Reopen' : 'Complete')}>
        {item.status === 'Completed' ? 'Reopen' : 'Mark completed'}
      </Button>
    </div>
  </Card>;
}

export function ShiftHandoverPage() {
  const timezone = useApp(s => s.hotelProfile.timezone);
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()));
  const [shift, setShift] = useState<Shift>('Morning');
  const [view, setView] = useState<'Outstanding' | 'Shift history'>('Outstanding');
  const [items, setItems] = useState<ShiftHandover[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const [room, setRoom] = useState(''); const [priority, setPriority] = useState('Normal');
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const result = await api.getShiftHandovers(date);
      if (current !== request.current) return;
      if (!result) throw new Error('Handovers could not be loaded. Please retry.');
      setItems(result); setError('');
    } catch (error) { if (current === request.current) setError(error instanceof Error ? error.message : 'Loading failed'); }
    finally { if (current === request.current) setLoading(false); }
  }, [date]);
  useEffect(() => {
    setLoading(true); setItems([]); void refresh();
    const timer = setInterval(() => { void refresh(); }, 30000);
    return () => { clearInterval(timer); request.current++; };
  }, [refresh]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const result = await api.createShiftHandover({ shiftDate: date, shift, title, body, room, priority });
      if (!result) throw new Error('Handover was not saved. Your text has been kept.');
      setTitle(''); setBody(''); setRoom(''); setPriority('Normal'); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Save failed'); }
    finally { setSaving(false); }
  }
  const next = shifts[(shifts.indexOf(shift) + 1) % shifts.length];
  const visible = items.filter(item => view === 'Outstanding' ? item.status !== 'Completed' :
    (item.shiftDate === date && item.shift === shift) || (item.targetDate === date && item.targetShift === shift))
    .sort((a, b) => ({ Urgent: 0, High: 1, Normal: 2 }[a.priority] - { Urgent: 0, High: 1, Normal: 2 }[b.priority]) || b.createdAt.localeCompare(a.createdAt));
  return <AppShell title="Front Office shift handover" wide>
    <div className="space-y-5">
      <div><h1 className="font-display text-2xl text-ink">Shift handover</h1>
        <p className="mt-2 text-sm text-ink-3">One shared reception log. Acknowledge what you have read, add updates and close items when the work is done.</p></div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-3">Shift start date<input type="date" className={`${field} mt-1`} value={date} disabled={saving} onChange={e => { if (e.target.value) setDate(e.target.value); }} /></label>
        <label className="text-xs text-ink-3">Outgoing shift<select className={`${field} mt-1`} value={shift} disabled={saving} onChange={e => setShift(e.target.value as Shift)}>{shifts.map(value => <option key={value}>{value}</option>)}</select></label>
        <Button variant="outline" onClick={() => { void refresh(); }}>Refresh</Button>
      </div>
      <p className="text-xs text-ink-3">Dates use {timezone}. Night shift belongs to the date it starts; its handover goes to the following morning.</p>
      {error && <p role="alert" className="rounded-lg border border-red-200 p-3 text-sm text-red-700">{error}</p>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
        <section className="space-y-3">
          <div className="flex gap-2">{(['Outstanding', 'Shift history'] as const).map(value => <Button key={value} variant={view === value ? 'primary' : 'outline'} onClick={() => setView(value)}>{value}</Button>)}</div>
          <p className="text-xs text-ink-3">{view === 'Outstanding' ? 'All unfinished handovers through this date, including previous shifts. Acknowledging does not complete an item.' : 'Items written by or handed to the selected shift, including completed items.'}</p>
          {loading ? <p className="p-4 text-sm">Loading handovers...</p> : visible.length === 0 ? <Empty title="No handovers in this view" hint="Add a note for the next shift or select another date." /> : visible.map(item => <HandoverCard key={item.id} item={item} timezone={timezone} refresh={refresh} />)}
        </section>
        <Card className="h-fit p-4">
          <form onSubmit={save}><fieldset disabled={saving} className="space-y-3">
            <h2 className="font-semibold text-ink">Add handover for {next}{shift === 'Night' ? ' (next day)' : ''}</h2>
            <label className="block text-xs text-ink-3">Subject<input required maxLength={160} className={`${field} mt-1`} value={title} onChange={e => setTitle(e.target.value)} /></label>
            <label className="block text-xs text-ink-3">Information for the next shift<textarea required rows={7} maxLength={10000} className={`${field} mt-1`} value={body} onChange={e => setBody(e.target.value)} placeholder="What happened, what is outstanding and what the next shift needs to do" /></label>
            <label className="block text-xs text-ink-3">Room reference (optional)<input maxLength={40} className={`${field} mt-1`} value={room} onChange={e => setRoom(e.target.value)} /></label>
            <label className="block text-xs text-ink-3">Priority<select className={`${field} mt-1`} value={priority} onChange={e => setPriority(e.target.value)}>{['Normal', 'High', 'Urgent'].map(value => <option key={value}>{value}</option>)}</select></label>
            <Button type="submit" disabled={saving || !title.trim() || !body.trim()}>{saving ? 'Saving...' : 'Save handover'}</Button>
          </fieldset></form>
        </Card>
      </div>
    </div>
  </AppShell>;
}
