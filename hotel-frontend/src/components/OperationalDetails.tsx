import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { useOperations } from '@/lib/useOperations';
import { Button, Badge, statusTone } from './ui';

export function OperationalDetails({ kind, operations, onClose }: { kind: 'vip' | 'departure_bills'; operations: ReturnType<typeof useOperations>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const source = operations.data?.sources.find(s => s.kind === kind);
  const current = source?.status === 'complete' && !source.stale && !source.latestRunFailed && !operations.error;
  const tasks = operations.data?.tasks.filter(t => t.department === (kind === 'vip' ? 'VIP' : 'Billing') && (kind === 'vip' || t.status !== 'Completed')) || [];
  return <dialog ref={dialog} aria-labelledby="operational-detail-title" onCancel={onClose} onClick={e => { if (e.target === dialog.current) onClose(); }} className="fixed inset-0 m-auto max-h-[85vh] w-[min(95vw,52rem)] overflow-y-auto rounded-card border border-line bg-surface p-6 text-ink shadow-xl backdrop:bg-black/30">
    <div className="mb-4 flex items-start justify-between gap-3"><div><h2 id="operational-detail-title" className="font-display text-xl">{kind === 'vip' ? 'VIP guests' : 'Departure balance problems'}</h2>{source?.reportDate && <p className="mt-1 text-xs text-ink-3">{source.reportDate}{source.stale ? ' · Previous available day' : ''}</p>}</div><Button variant="quiet" onClick={onClose}>Close</Button></div>
    {(error || operations.error) && <p role="alert" className="mb-3 text-red-700">{error || operations.error}</p>}
    {operations.loading && !operations.data ? <p>Loading...</p> : source?.status !== 'complete' ? <p>Today’s information is not available yet.</p> : <>
      {source.latestRunFailed && <p className="mb-3 text-amber-800">The latest update was unsuccessful. These are the last available records.</p>}
      {!tasks.length && <p>{kind === 'vip' ? 'No VIP guests listed for this day.' : 'No departure balance problems awaiting review.'}</p>}
      <ul className="divide-y divide-line">{tasks.map(task => <li key={task.id} className="space-y-2 py-4"><p className="font-medium">{task.title}{task.room ? ` · Room ${task.room}` : ''}</p><p className="whitespace-pre-wrap text-sm text-ink-3">{task.detail}</p>
        <div className="flex items-center gap-3"><Badge tone={statusTone(task.status)}>{task.status === 'Completed' ? 'Prepared' : 'Needs review'}</Badge><Button size="sm" variant="outline" disabled={busy || !current} onClick={async () => {
          setBusy(true); setError(''); try { await api.updateOperation(task.id, { reportContentHash: task.reportContentHash, status: task.status === 'Completed' ? 'New' : 'Completed' }); await operations.load(); window.dispatchEvent(new Event('hotelogx:operations-updated')); }
          catch (e) { setError(e instanceof Error ? e.message : 'Update failed'); } finally { setBusy(false); }
        }}>{task.status === 'Completed' ? 'Reopen preparation' : kind === 'vip' ? 'Mark prepared' : 'Mark reviewed'}</Button></div>
      </li>)}</ul>
    </>}
  </dialog>;
}
