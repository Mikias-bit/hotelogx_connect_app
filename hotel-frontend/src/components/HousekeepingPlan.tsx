import { BlockerControls } from './OperationalBlockers';
import { HousekeepingRepair } from './HousekeepingRepair';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/session';
import { useOperations } from '@/lib/useOperations';
import type { Task } from '@/lib/types';
import { Badge, Button } from './ui';

const field = 'w-full rounded border border-line bg-white px-3 py-2 text-sm';
const types: Record<string, string> = { departure_clean_required: 'Departure clean', stayover_clean: 'Stayover clean', linen_change: 'Linen change', towels: 'Towels', late_checkout: 'Late checkout preparation', room_move: 'Room move', urgent_clean: 'Urgent cleaning', delivery: 'Delivery / guest preparation', public_area: 'Public-area cleaning', baby_bed_requested: 'Baby bed', make_sofa_bed: 'Sofa bed', other: 'Other' };

export function HousekeepingPlanEditor({ task, date, timezone, onClose, onSaved }: { task?: Task; date: string; timezone: string; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [values, setValues] = useState({ room: task?.room || '', location: task?.location || '', task: task?.planData?.task || 'urgent_clean', priority: task?.priority || 'Normal', comment: task?.planData?.comment || '', notBeforeTime: task?.planData?.notBeforeTime || '', dueTime: task?.planData?.dueTime || '' });
  const [place, setPlace] = useState(task?.location ? 'public' : 'room'), [reason, setReason] = useState(''), [decision, setDecision] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [cancel, setCancel] = useState(false);
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const update = (key: keyof typeof values, value: string) => setValues(old => ({ ...old, [key]: value }));
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={task ? 'Change housekeeping instructions' : 'Add housekeeping task'}>
    <form className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-auto rounded-xl bg-white p-6" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try {
        const payload = { values: cancel ? {} : { ...values, room: place === 'room' ? values.room : '', location: place === 'public' ? values.location : '' }, reason, cancel, reportContentHash: task?.reportContentHash, ...(task?.sourceReviewRequired ? { sourceDecision: decision } : {}) };
        const signature = JSON.stringify(payload); if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
        const result = await api.changeHousekeepingPlan(task?.id, { ...payload, requestKey: pending.current.key });
        if (!result) throw new Error('The save could not be confirmed. Retry without changing the form.');
        await onSaved(`Plan saved. ${result.deliveryStatus === 'not_assigned' ? 'Ready for housekeeping to assign.' : `Worker notification: ${result.deliveryStatus.replaceAll('_', ' ')}.`}${result.lastError ? ' ' + result.lastError : ''}`); onClose();
      } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save the plan'); } finally { setBusy(false); }
    }}>
      <h2 className="font-display text-xl">{task ? 'Change housekeeping instructions' : 'Add housekeeping task'}</h2>
      <p className="text-sm text-ink-3">Work date {date}. All times are in {timezone}. Existing progress and assignment history are retained.</p>
      {task && <label className="block text-sm"><input type="checkbox" checked={cancel} disabled={busy} onChange={e => setCancel(e.target.checked)} /> Cancel this task and retain its history</label>}
      {task?.sourceReviewRequired && !cancel && <div className="space-y-2 rounded bg-amber-50 p-3 text-sm"><p>The morning plan {task.sourcePresent === false ? 'removed this task' : 'changed'}. Review it before work continues.</p>
        {task.pendingSourceData && task.sourcePresent !== false && <p>Latest report: {task.pendingSourceData.room} · {types[task.pendingSourceData.task] || task.pendingSourceData.task} · {task.pendingSourceData.comment || 'No additional instructions'}{task.pendingSourceData.checkoutTime && ` · Checkout ${task.pendingSourceData.checkoutTime}`}</p>}
        <select className={field} aria-label="Review source change" required value={decision} onChange={e => { setDecision(e.target.value); if (e.target.value === 'adopt' && task.pendingSourceData) { const d = task.pendingSourceData; setValues(old => ({ ...old, room: d.room || '', location: '', task: d.task, comment: d.comment || '' })); setPlace('room'); } }}>
          <option value="">Choose how to proceed</option><option value="keep">Keep / edit the operational instructions</option>{task.pendingSourceData && task.sourcePresent !== false && <option value="adopt">Use the latest report instructions</option>}
        </select></div>}
      <fieldset disabled={busy} className="space-y-3">
        <label className="block text-sm">Location type<select className={field} value={place} onChange={e => setPlace(e.target.value)}><option value="room">Guest room</option><option value="public">Public area / other location</option></select></label>
        <label className="block text-sm">{place === 'room' ? 'Room' : 'Location'}<input autoFocus required maxLength={120} className={field} value={place === 'room' ? values.room : values.location} onChange={e => update(place === 'room' ? 'room' : 'location', e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">Task<select className={field} value={values.task} onChange={e => update('task', e.target.value)}>{!types[values.task] && <option value={values.task}>{values.task.replaceAll('_', ' ')}</option>}{Object.entries(types).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
          <label className="text-sm">Priority<select className={field} value={values.priority} onChange={e => update('priority', e.target.value)}>{['Normal', 'High', 'Urgent'].map(p => <option key={p}>{p}</option>)}</select></label></div>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">Do not enter before<input type="time" className={field} value={values.notBeforeTime} onChange={e => update('notBeforeTime', e.target.value)} /></label><label className="text-sm">Needed by<input type="time" className={field} value={values.dueTime} onChange={e => update('dueTime', e.target.value)} /></label></div>
        <label className="block text-sm">Instructions<textarea className={field} maxLength={2000} rows={3} value={values.comment} onChange={e => update('comment', e.target.value)} placeholder="For example: guest extended; stayover clean only. Deliver two towels." /></label>
        <label className="block text-sm">Reason for this change<input required maxLength={1000} className={field} value={reason} onChange={e => setReason(e.target.value)} placeholder="Extension, late checkout, waiting arrival, additional request…" /></label>
      </fieldset>
      {task?.assignee && <p className="text-sm">Assigned to {task.assignee}. Saving will request a WhatsApp notification with the updated instructions.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-3"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save plan change'}</Button><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button></div>
    </form>
  </div>;
}

// Opened from the existing Tasks pages; no operational panel is added to a dashboard.
export function HousekeepingPlanButton() {
  const [open, setOpen] = useState(false), user = useCurrentUser();
  return <><Button variant="outline" onClick={() => setOpen(v => !v)}>{open ? 'Close housekeeping plan' : 'Housekeeping plan'}</Button>{open && <PlanList key={user?.id} />}</>;
}
function PlanList() {
  const { data, load, error, loading } = useOperations();
  const [editor, setEditor] = useState<Task | 'new' | null>(null), [notice, setNotice] = useState('');
  return <section className="basis-full space-y-3 rounded-lg border border-line bg-white p-4">
    <div className="flex flex-wrap justify-between gap-3"><p className="font-medium">Today's housekeeping plan</p><Button disabled={!data || loading} onClick={() => setEditor('new')}>Add housekeeping task</Button></div>
    {error && <p role="alert" className="text-red-700">{error}</p>}{notice && <p role="status">{notice}</p>}
    <ul className="divide-y">{data?.tasks.filter(t => t.department === 'Housekeeping').map(t => <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 py-3"><div><strong>{t.location || `Room ${t.room}`} · {t.title}</strong><p className="whitespace-pre-wrap text-sm">{t.detail}</p><HousekeepingRepair task={t} reload={load} />{t.status !== "Completed" && <BlockerControls work={{ workKind: "report", workId: t.id, reportContentHash: t.reportContentHash }} blockers={t.blockers} carriedFrom={t.carriedFrom} carryReviewRequired={t.carryReviewRequired} timezone={data.timezone} reload={load} />}<p className="text-sm">{t.assignee || 'Unassigned'} · {t.executionStatus} · {t.priority}</p>{t.sourceReviewRequired && <Badge tone="attend">Plan review needed</Badge>}{t.planNotification && <p className="text-xs">Notification: {t.planNotification.status.replaceAll('_', ' ')} {t.planNotification.error}</p>}<details className="text-xs"><summary>History</summary>{t.trail.map((event, i) => <p className="whitespace-pre-wrap py-1" key={i}>{new Date(event.at).toLocaleString()} · {event.text}</p>)}</details></div><Button variant="outline" size="sm" disabled={t.status === 'Completed' || t.stale} onClick={() => setEditor(t)}>Change instructions</Button></li>)}</ul>
    {data && !data.tasks.some(t => t.department === 'Housekeeping') && <p>No housekeeping tasks yet. You can add a task without waiting for the morning report.</p>}
    {editor && data && <HousekeepingPlanEditor task={editor === 'new' ? undefined : editor} date={data.today} timezone={data.timezone} onClose={() => setEditor(null)} onSaved={async message => { setNotice(message); await load(); window.dispatchEvent(new Event('hotelogx:operations-updated')); }} />}
  </section>;
}
