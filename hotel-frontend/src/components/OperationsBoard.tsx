import { HousekeepingRepair } from './HousekeepingRepair';
import { useEffect, useRef, useState } from 'react';
import { HousekeepingPlanEditor } from './HousekeepingPlan';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/session';
import { useOperations, type Worker } from '@/lib/useOperations';
import type { Task } from '@/lib/types';
import { Badge, Button, Card, SectionTitle, statusTone } from './ui';

const field = 'rounded border border-line bg-white px-3 py-2 text-sm';
const sourceTitle: Record<string, string> = { housekeeping: 'Housekeeping', vip: 'VIP preparation', departure_bills: 'Departure balances' };
export function OperationsBoard({ operations }: { operations?: ReturnType<typeof useOperations> }) {
  return operations ? <Board operations={operations} /> : <LoadedBoard />;
}
function LoadedBoard() { const operations = useOperations(); return <Board operations={operations} />; }
function Board({ operations: { data, error, loading, load } }: { operations: ReturnType<typeof useOperations> }) {
  const user = useCurrentUser(), canAssign = user?.role === 'manager' || user?.role === 'housekeeping';
  const [selected, setSelected] = useState<string[]>([]), [workerId, setWorkerId] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [actionError, setActionError] = useState('');
  // Retain the request ID after a network failure so retry cannot send another assignment.
  const [editor, setEditor] = useState<Task | 'new' | null>(null);
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const tasks = (data?.tasks.filter(t => t.department === 'Housekeeping') || []).sort((a, b) => ({ Urgent: 0, High: 1, Normal: 2, Low: 3 }[a.priority] - { Urgent: 0, High: 1, Normal: 2, Low: 3 }[b.priority]));
  const source = data?.sources.find(s => s.kind === 'housekeeping');
  const current = source?.status === 'complete' && !source.stale && !source.latestRunFailed;
  const eligible = tasks.filter(t => (current || t.source === 'Operational change') && !t.stale && !t.sourceReviewRequired && !['In Progress', 'Completed'].includes(t.executionStatus || t.status));
  const chosen = eligible.filter(t => selected.includes(t.id));
  const execute = async (fn: () => Promise<void>) => {
    setBusy(true); setActionError(''); setNotice('');
    try { await fn(); await load(); window.dispatchEvent(new Event('hotelogx:operations-updated')); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Update failed'); }
    finally { setBusy(false); }
  };
  const update = (task: Task, status: string) => execute(async () => { await api.updateOperation(task.id, { status, reportContentHash: task.reportContentHash }); });
  return <div className="mb-6 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-xl">Daily operations {data?.today}</h2><p className="text-sm text-ink-3">Tasks and priorities prepared by Hotelogx. Progress updates as your team works.</p></div><Button variant="outline" disabled={loading || busy} onClick={() => void load()}>Refresh</Button></div>
    {error && <p role="alert" className="text-red-700">{error} Existing information may be out of date.</p>}
    {loading && !data && <p>Loading operations...</p>}
    <div className="flex flex-wrap gap-3 text-xs">{data?.sources.map(s => <span key={s.kind} className={s.status !== 'complete' || s.stale || s.latestRunFailed ? 'text-amber-800' : 'text-ink-3'}>{sourceTitle[s.kind]}: {s.status !== 'complete' ? 'awaiting a successful engine run' : `${s.reportDate}${s.stale ? ' (previous day)' : ''}${s.latestRunFailed ? ' (latest run failed)' : ''}`}</span>)}</div>
    {actionError && <p role="alert" className="text-red-700">{actionError}</p>}{notice && <p role="status" className="rounded bg-paper-2 p-3 text-sm">{notice}</p>}
    {data && <>
      {editor && <HousekeepingPlanEditor task={editor === 'new' ? undefined : editor} date={data.today} timezone={data.timezone} onClose={() => setEditor(null)} onSaved={async message => { setNotice(message); await load(); window.dispatchEvent(new Event('hotelogx:operations-updated')); }} />}
      <Card><SectionTitle title="Housekeeping" hint={source?.reportDate ? `Work date ${source.reportDate}` : 'Awaiting tasks from Hotelogx'} />
        <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2 text-sm"><strong>{data.housekeeping.roomCount} rooms with tasks</strong><span>{data.housekeeping.completed} tasks done</span><span>{data.housekeeping.inProgress} in progress</span><span>{data.housekeeping.unassigned} unassigned</span><span>{data.housekeeping.unaccepted} awaiting acceptance</span><span>{data.housekeeping.problems} problems</span>{data.housekeeping.averageMinutes !== null && <span>Average completed task: {data.housekeeping.averageMinutes} min</span>}</div>
        {data.housekeeping.completedRooms.length > 0 && <p className="mb-3 text-sm text-pine-700">Housekeeping tasks completed: rooms {data.housekeeping.completedRooms.join(', ')}. Front Office can check inspection and PMS release status.</p>}
        {data.housekeeping.noCleaningRooms.length > 0 && <p className="mb-3 text-sm text-ink-3">No cleaning requested in this snapshot: {data.housekeeping.noCleaningRooms.join(', ')}.</p>}
        {canAssign && <>
          <Button variant="outline" disabled={busy} onClick={() => setEditor('new')}>Add housekeeping task</Button>
          <div className="mb-4 flex flex-wrap items-center gap-3"><label className="text-sm"><input type="checkbox" checked={eligible.length > 0 && chosen.length === eligible.length} disabled={!eligible.length || busy} onChange={e => setSelected(e.target.checked ? eligible.map(t => t.id) : [])} /> Select all available</label>
            <select aria-label="Assign tasks to worker" className={field} value={workerId} onChange={e => setWorkerId(e.target.value)} disabled={busy}><option value="">Choose housekeeper</option>{data.workers.filter(w => w.active && w.whatsappEnabled).map(w => <option value={w.id} key={w.id}>{w.name} · {w.phone} · {tasks.filter(t => t.assignedWorkerId === w.id && t.status !== 'Completed').length} open tasks</option>)}</select>
            <Button disabled={busy || !chosen.length || !workerId} onClick={() => void execute(async () => {
              const input = { workerId, tasks: chosen.map(t => ({ id: t.id, contentHash: t.reportContentHash })) };
              const signature = JSON.stringify(input); if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
              const result = await api.assignOperations({ ...input, requestKey: pending.current.key });
              if (!result) throw new Error('Assignment could not be confirmed. Retry with the same selection.');
              setNotice(`Assigned ${chosen.length} tasks. WhatsApp: ${result.deliveryStatus.replaceAll('_', ' ')}.${result.lastError ? ' ' + result.lastError : ' The worker can reply TASKS to view current assignments.'}`); setSelected([]); pending.current = null;
            })}>{busy ? 'Saving...' : `Assign ${chosen.length || ''} & Send WhatsApp`}</Button>
          </div>
          {!current && <p className="mb-3 text-sm text-amber-800">Report tasks require a successful run for today. Added operational tasks can still be assigned.</p>}
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Select', 'Room / task', 'Status', 'Assigned to', 'Details', 'Manager action'].map(h => <th className="border-b p-2" key={h}>{h}</th>)}</tr></thead><tbody>{tasks.map(t => <tr key={t.id}>
            <td className="border-b p-2"><input type="checkbox" aria-label={`Select room ${t.room} ${t.title}`} disabled={busy || !eligible.some(e => e.id === t.id)} checked={chosen.some(c => c.id === t.id)} onChange={e => setSelected(old => e.target.checked ? [...old, t.id] : old.filter(id => id !== t.id))} /></td>
            <td className="border-b p-2"><strong>{t.location || t.room}</strong><p>{t.title}</p><p>{t.priority}</p></td><td className="border-b p-2"><Badge tone={statusTone(t.status)}>{t.executionStatus === 'New' ? 'Unassigned' : t.executionStatus || t.status}</Badge></td>
            <td className="border-b p-2">{t.assignee || '—'}{t.acceptedAt && <p className="text-xs">Accepted {new Date(t.acceptedAt).toLocaleTimeString()}</p>}{t.startedAt && <p className="text-xs">Started {new Date(t.startedAt).toLocaleTimeString()}</p>}{t.completedAt && <p className="text-xs">Done {new Date(t.completedAt).toLocaleTimeString()}</p>}</td>
            <td className="max-w-xs whitespace-pre-wrap border-b p-2">{t.detail}<HousekeepingRepair task={t} reload={load} />{t.sourceReviewRequired && <p className="text-amber-800">Morning plan changed ? review instructions before continuing.</p>}{t.planNotification && <p className="text-xs">Notification: {t.planNotification.status.replaceAll('_', ' ')} {t.planNotification.error}</p>}<details className="text-xs"><summary>History</summary>{t.trail.map((event, i) => <p key={i}>{new Date(event.at).toLocaleString()} ? {event.text}</p>)}</details>{t.problemType && <p className="text-red-700">{t.problemType === 'dnd' ? 'Do not disturb' : 'Maintenance'}: {t.problemNote || 'Awaiting details'}</p>}</td>
            <td className="border-b p-2">{t.status !== 'Completed' && <div className="space-y-2"><Button size="sm" variant="outline" disabled={busy || t.stale} onClick={() => setEditor(t)}>Change instructions</Button><Button size="sm" variant="outline" disabled={busy || t.stale || t.sourceReviewRequired || (!current && t.source !== 'Operational change') || Boolean(t.notBefore && +new Date(t.notBefore) > Date.now())} onClick={() => void update(t, 'Completed')}>Mark complete</Button></div>}{t.status === 'Completed' && <span className="text-xs">Completed work retained. Add a new task for follow-up.</span>}</td>
          </tr>)}</tbody></table>{!tasks.length && <p className="p-3 text-sm">{source?.status === 'complete' ? 'No actionable cleaning tasks in this snapshot.' : 'No morning report yet. You can add operational tasks now.'}</p>}</div>
          <WorkerSettings workers={data.workers} tasks={tasks} reload={load} />
        </>}
      </Card>
      {user?.role !== 'housekeeping' && <div className="grid gap-4 lg:grid-cols-2">{(['VIP', 'Billing'] as const).map(department => {
        const relevant = data.tasks.filter(t => t.department === department), s = data.sources.find(r => r.kind === (department === 'VIP' ? 'vip' : 'departure_bills'));
        const fresh = s?.status === 'complete' && !s.stale && !s.latestRunFailed;
        return <Card key={department}><SectionTitle title={department === 'VIP' ? 'VIP preparation' : 'Departure balance follow-up'} hint={`${relevant.filter(t => t.status !== 'Completed').length} awaiting staff review`} />
          {department === 'Billing' && <p className="mb-3 text-xs text-ink-3">Snapshot amounts require staff review. A credit balance is not proof of overcharging. Marking reviewed does not settle or refund a bill.</p>}
          {!relevant.length && <p className="text-sm">{s?.status === 'complete' ? `No ${department === 'VIP' ? 'VIP preparations' : 'balance exceptions'} in this snapshot.` : 'Awaiting a successful engine run.'}</p>}
          <ul className="divide-y divide-line">{relevant.map(t => <li key={t.id} className="space-y-2 py-3"><p className="font-medium">{t.title}{t.room ? ` · Room ${t.room}` : ''}</p><p className="whitespace-pre-wrap text-sm text-ink-3">{t.detail}</p><Badge tone={statusTone(t.status)}>{t.status === 'Completed' ? department === 'VIP' ? 'Prepared' : 'Reviewed' : t.status}</Badge><Button size="sm" variant="outline" disabled={busy || !fresh} onClick={() => void update(t, t.status === 'Completed' ? 'New' : 'Completed')}>{t.status === 'Completed' ? 'Reopen' : department === 'VIP' ? 'Mark prepared' : 'Mark reviewed'}</Button></li>)}</ul>
        </Card>;
      })}</div>}
    </>}
  </div>;
}

function WorkerSettings({ workers, tasks, reload }: { workers: Worker[]; tasks: Task[]; reload: () => Promise<void> }) {
  const empty = { name: '', phone: '', active: true, whatsappEnabled: false, language: 'en' };
  const [id, setId] = useState(''), [form, setForm] = useState(empty), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [config, setConfig] = useState({ templateName: '', changeTemplateName: '', templateLanguage: 'en_US' });
  const [assignments, setAssignments] = useState<any[]>([]);
  useEffect(() => { let active = true; Promise.all([api.getHousekeepingConfig(), api.getOperationalAssignments()]).then(([c, a]) => { if (active) { setConfig({ templateName: c?.templateName || '', changeTemplateName: c?.changeTemplateName || '', templateLanguage: c?.templateLanguage || 'en_US' }); setAssignments(a || []); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [workers]);
  const save = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); setNotice(''); try { await fn(); await reload(); setNotice('Saved'); } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); } finally { setBusy(false); } };
  return <details className="mt-5 border-t border-line pt-4"><summary className="cursor-pointer font-medium">Workers & WhatsApp settings</summary>
    <p className="my-3 text-sm">Register each housekeeper once. Ask them to send TASKS to the hotel’s internal WhatsApp number. Their phone must include the country code.</p>
    <ul className="mb-4 text-sm">{workers.map(w => <li key={w.id} className="flex flex-wrap items-center gap-3 py-1"><span>{w.name} · {w.phone} · {w.active ? 'Active' : 'Inactive'} · {tasks.filter(t => t.assignedWorkerId === w.id && t.status === 'Completed').length} tasks completed</span><Button size="sm" variant="quiet" onClick={() => { setId(w.id); setForm({ name: w.name, phone: w.phone, active: w.active, whatsappEnabled: w.whatsappEnabled, language: w.language }); }}>Edit</Button></li>)}</ul>
    <form className="flex flex-wrap items-center gap-3" onSubmit={e => { e.preventDefault(); void save(async () => { await api.saveHousekeepingWorker(id || undefined, form); setId(''); setForm(empty); }); }}>
      <input className={field} aria-label="Worker name" placeholder="Name" required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
      <input className={field} aria-label="Worker WhatsApp phone" placeholder="+31612345678" type="tel" required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
      <label className="text-sm"><input type="checkbox" checked={form.whatsappEnabled} onChange={e => setForm({ ...form, whatsappEnabled: e.target.checked })} /> Enable WhatsApp tasks</label><label className="text-sm"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Active</label>
      <Button type="submit" disabled={busy}>{id ? 'Save worker' : 'Add worker'}</Button>{id && <Button variant="quiet" onClick={() => { setId(''); setForm(empty); }}>Cancel edit</Button>}
    </form>
    <details className="mt-4"><summary className="cursor-pointer text-sm">Approved assignment notification template</summary><p className="my-2 text-sm">Without an open WhatsApp conversation, Meta requires an approved template. Configure a body with two variables: worker name and task count. Include “Reply TASKS to accept and view your assignments.” For changed instructions, configure a separate approved template with worker name and location, asking the worker to reply TASKS. Approval is managed in Meta.</p><div className="flex flex-wrap gap-2"><input aria-label="Assignment template name" className={field} placeholder="Approved template name" value={config.templateName} onChange={e => setConfig({ ...config, templateName: e.target.value })} /><input aria-label="Plan change template name" className={field} placeholder="Approved plan-change template" value={config.changeTemplateName} onChange={e => setConfig({ ...config, changeTemplateName: e.target.value })} /><input aria-label="Template language code" className={field} value={config.templateLanguage} onChange={e => setConfig({ ...config, templateLanguage: e.target.value })} /><Button disabled={busy} onClick={() => void save(() => api.saveHousekeepingConfig(config))}>Save template</Button></div></details>
    {assignments.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-sm">Recent assignment delivery</summary><ul className="text-sm">{assignments.slice(0, 10).map(a => <li key={a.id} className="py-2">{new Date(a.createdAt).toLocaleString()} · {workers.find(w => w.id === a.workerId)?.name || 'Worker'} · {a.taskIds.length} tasks · {a.deliveryStatus.replaceAll('_', ' ')}{a.lastError && <p>{a.lastError}</p>}</li>)}</ul></details>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}{notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
  </details>;
}
