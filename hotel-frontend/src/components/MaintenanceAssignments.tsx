import { GuestHandoffWork } from './GuestHandoffs';
import { BlockerControls } from './OperationalBlockers';
import { useEffect, useRef, useState } from 'react';
import { AppShell } from './AppShell';
import { Badge, Button, Card, SectionTitle, statusTone } from './ui';
import { useMaintenance } from '@/lib/useMaintenance';
import { useCurrentUser } from '@/lib/session';
import { api } from '@/lib/api';
import type { MaintenanceWorker } from '@/lib/types';

const field = 'rounded-[9px] border border-line bg-surface px-3 py-2 text-sm';
const workerDefaults = { name: '', phone: '', active: true, whatsappEnabled: true, language: 'en' };
export function MaintenanceAssignments() {
  const user = useCurrentUser();
  return <MaintenanceAssignmentBoard key={user?.id || 'signed-out'} />;
}
function MaintenanceAssignmentBoard() {
  const { data, loading, error, load } = useMaintenance();
  const [selected, setSelected] = useState<string[]>([]), [workerId, setWorkerId] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [actionError, setActionError] = useState('');
  const [editId, setEditId] = useState(''), [worker, setWorker] = useState<Omit<MaintenanceWorker, 'id'>>(workerDefaults);
  const [config, setConfig] = useState({ templateName: '', templateLanguage: 'en_US' });
  const configLoaded = useRef(false);
  const pending = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => { if (data && !configLoaded.current) { setConfig({ templateName: data.config.templateName || '', templateLanguage: data.config.templateLanguage }); configLoaded.current = true; } }, [data]);
  const key = (row: { kind: string; id: string; version: number }) => `${row.kind}:${row.id}:${row.version}`;
  const eligible = data?.work.filter(row => !row.blockers?.length && !['Completed', 'In Progress'].includes(row.status)) || [];
  const chosen = eligible.filter(row => selected.includes(key(row)));
  const execute = async (fn: () => Promise<string>) => {
    if (busy) return;
    setBusy(true); setNotice(''); setActionError('');
    try { setNotice(await fn()); await load(); window.dispatchEvent(new Event('hotelogx:maintenance-updated')); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Unable to update maintenance'); }
    finally { setBusy(false); }
  };
  return <AppShell title="Maintenance assignments" wide><div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-display text-[26px] text-ink">Maintenance assignments</h1><p className="mt-2 text-sm text-ink-3">Select issues and follow-up tasks, assign a technician and track their WhatsApp responses.</p></div><Button variant="outline" disabled={busy || loading} onClick={() => void load()}>Refresh</Button></div>
    {error && <p role="alert" className="text-sm text-urgent">{error} Refresh before assigning work.</p>}
    {actionError && <p role="alert" className="text-sm text-urgent">{actionError}</p>}{notice && <p role="status" className="rounded bg-paper-2 p-3 text-sm">{notice}</p>}
    {loading && !data && <p role="status">Loading maintenance assignments…</p>}
    {data && <>
      <Card>
        <div className="mb-4 flex flex-wrap gap-4 text-sm"><span>{data.work.filter(row => row.status !== 'Completed').length} open</span><span>{data.work.filter(row => row.status === 'Assigned').length} awaiting acceptance</span><span>{data.work.filter(row => row.status === 'Accepted').length} accepted</span><span>{data.work.filter(row => row.status === 'In Progress').length} in progress</span><span>{data.work.filter(row => row.status === 'Completed').length} completed</span></div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="text-sm"><input type="checkbox" disabled={busy || !!error || !eligible.length} checked={eligible.length > 0 && chosen.length === eligible.length} onChange={e => setSelected(e.target.checked ? eligible.map(key) : [])} /> Select all available</label>
          <select aria-label="Assign technician" className={field} disabled={busy} value={workerId} onChange={e => setWorkerId(e.target.value)}><option value="">Choose technician</option>{data.workers.filter(worker => worker.active && worker.whatsappEnabled).map(worker => <option key={worker.id} value={worker.id}>{worker.name} · {data.work.filter(row => row.assignedWorkerId === worker.id && row.status !== 'Completed').length} open</option>)}</select>
          <Button disabled={busy || !!error || !workerId || !chosen.length} onClick={() => void execute(async () => {
            const input = { workerId, work: chosen.map(({ kind, id, version }) => ({ kind, id, version })) };
            const signature = JSON.stringify(input);
            if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
            const result = await api.assignMaintenance({ ...input, requestKey: pending.current.key });
            if (!result) throw new Error('Assignment could not be confirmed. Retry with the same selection.');
            pending.current = null; setSelected([]);
            return `Assigned ${chosen.length} tasks. WhatsApp: ${result.deliveryStatus.replaceAll('_', ' ')}.${result.lastError ? ' ' + result.lastError : ' The technician can reply MAINTENANCE to view their work.'}`;
          })}>{busy ? 'Saving…' : 'Assign & Send WhatsApp'}</Button>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Select', 'Room / task', 'Status', 'Assigned to', 'Details', 'Staff action'].map(label => <th scope="col" className="border-b border-line p-2" key={label}>{label}</th>)}</tr></thead><tbody>
          {data.work.map(row => <tr key={`${row.kind}:${row.id}`}>
            <td className="border-b border-line-soft p-2"><input type="checkbox" aria-label={`Select ${row.title} ${row.room || ''}`} checked={chosen.some(item => key(item) === key(row))} disabled={busy || !!error || !eligible.some(item => key(item) === key(row))} onChange={e => setSelected(old => e.target.checked ? [...old, key(row)] : old.filter(value => value !== key(row)))} /></td>
            <td className="min-w-44 border-b border-line-soft p-2"><strong>{row.room || 'General'}</strong><p>{row.title}</p><GuestHandoffWork kind={row.kind} id={row.id} /><p className="text-xs text-ink-4">{row.kind === 'issue' ? 'Issue' : 'Follow-up task'} · {row.priority}</p></td>
            <td className="border-b border-line-soft p-2"><Badge tone={statusTone(row.status)}>{row.status}</Badge></td>
            <td className="min-w-40 border-b border-line-soft p-2">{row.assignee || 'Unassigned'}{([['assignedAt', 'Assigned'], ['acceptedAt', 'Accepted'], ['startedAt', 'Started'], ['completedAt', 'Completed']] as const).map(([field, label]) => row[field] && <p key={field} className="text-xs text-ink-3">{label} {new Date(row[field]!).toLocaleString()}</p>)}</td>
            <td className="min-w-44 max-w-sm whitespace-pre-wrap border-b border-line-soft p-2">{row.detail}{row.status !== "Completed" && <BlockerControls work={{ workKind: row.kind, workId: row.id, workVersion: row.version }} blockers={row.blockers} timezone={data.timezone} reload={load} />}{row.linkedHousekeepingTaskIds?.length ? <p className="mt-2 text-xs">Linked housekeeping: {row.linkedHousekeepingTaskIds.join(", ")}</p> : null}{row.followUpTaskId && <p className="mt-2 text-xs">Housekeeping follow-up: {row.followUpTaskId}. Room inspection and release are still required.</p>}{row.problemNote && <p className="mt-1 text-attend">{row.problemNote}</p>}</td>
            <td className="border-b border-line-soft p-2"><Button size="sm" variant="outline" disabled={busy || !!error || !!row.blockers?.length} onClick={() => void execute(async () => {
              const status = row.status === 'Completed' ? 'Open' : 'Completed';
              await api.updateMaintenance(row.kind, row.id, { version: row.version, status });
              return status === 'Completed' ? 'Work marked complete by staff. Check room readiness separately.' : 'Work reopened and unassigned. Select a technician to assign it again.';
            })}>{row.status === 'Completed' ? 'Reopen' : 'Mark complete'}</Button></td>
          </tr>)}
        </tbody></table>{!data.work.length && <p className="p-4 text-sm text-ink-3">No maintenance work yet. Add an issue or follow-up task to start assigning.</p>}</div>
      </Card>
      <Card><details><summary className="cursor-pointer font-medium">Technicians &amp; WhatsApp settings</summary><p className="my-3 text-sm text-ink-3">Register each technician with their international WhatsApp number. Ask them to message MAINTENANCE to the hotel's internal number.</p>
        <ul className="mb-4 space-y-2">{data.workers.map(item => <li key={item.id} className="flex flex-wrap items-center gap-3 text-sm"><span>{item.name} · {item.phone} · {item.active ? 'Active' : 'Inactive'}</span><Button size="sm" variant="quiet" disabled={busy} onClick={() => { setEditId(item.id); setWorker({ name: item.name, phone: item.phone, active: item.active, whatsappEnabled: item.whatsappEnabled, language: item.language }); }}>Edit</Button></li>)}</ul>
        <form className="flex flex-wrap items-center gap-3" onSubmit={event => { event.preventDefault(); void execute(async () => { await api.saveMaintenanceWorker(editId || undefined, worker); setEditId(''); setWorker({ ...workerDefaults }); return 'Technician saved.'; }); }}>
          <input aria-label="Technician name" className={field} required maxLength={120} placeholder="Name" value={worker.name} disabled={busy} onChange={e => setWorker({ ...worker, name: e.target.value })} />
          <input aria-label="Technician WhatsApp number" className={field} required type="tel" placeholder="+31612345678" value={worker.phone} disabled={busy} onChange={e => setWorker({ ...worker, phone: e.target.value })} />
          <label className="text-sm"><input type="checkbox" checked={worker.active} disabled={busy} onChange={e => setWorker({ ...worker, active: e.target.checked })} /> Active</label><label className="text-sm"><input type="checkbox" checked={worker.whatsappEnabled} disabled={busy} onChange={e => setWorker({ ...worker, whatsappEnabled: e.target.checked })} /> Enable WhatsApp tasks</label>
          <Button type="submit" disabled={busy}>{editId ? 'Save technician' : 'Add technician'}</Button>{editId && <Button variant="quiet" disabled={busy} onClick={() => { setEditId(''); setWorker({ ...workerDefaults }); }}>Cancel</Button>}
        </form>
        <details className="mt-5"><summary className="cursor-pointer text-sm">Approved assignment notification template</summary><p className="my-3 text-sm text-ink-3">To notify a technician outside an open WhatsApp conversation, configure an approved text-only template with two body variables: technician name and task count. Include “Reply MAINTENANCE to view and accept your assignments.”</p><div className="flex flex-wrap gap-2"><input aria-label="Maintenance template name" className={field} value={config.templateName} placeholder="maintenance_assignment" disabled={busy} onChange={e => setConfig({ ...config, templateName: e.target.value })} /><input aria-label="Maintenance template language" className={field} value={config.templateLanguage} disabled={busy} onChange={e => setConfig({ ...config, templateLanguage: e.target.value })} /><Button disabled={busy} onClick={() => void execute(async () => { await api.saveMaintenanceConfig(config); return 'Template settings saved.'; })}>Save template</Button></div></details>
      </details></Card>
      {!!data.assignments.length && <Card><SectionTitle title="Recent assignment delivery" hint="Submission to WhatsApp is separate from technician acceptance" /><ul className="space-y-2 text-sm">{data.assignments.map(assignment => <li key={assignment.id}>{data.workers.find(worker => worker.id === assignment.workerId)?.name || 'Technician'} · {assignment.work.length} tasks · {assignment.deliveryStatus.replaceAll('_', ' ')} · {new Date(assignment.createdAt).toLocaleString()}{assignment.lastError && <p className="text-attend">{assignment.lastError}</p>}</li>)}</ul></Card>}
    </>}
  </div></AppShell>;
}
