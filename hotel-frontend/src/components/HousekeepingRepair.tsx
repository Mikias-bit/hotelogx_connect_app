import { useState } from 'react';
import { api } from '@/lib/api';
import type { Task } from '@/lib/types';
import { Button } from './ui';
export function HousekeepingRepair({ task, reload }: { task: Task; reload: () => Promise<void> }) {
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div className="mt-2 text-xs">
    {task.sourceIssueId && <p>Follow-up for repair {task.sourceIssueId}. Completing this task still requires a separate room inspection.</p>}
    {task.linkedRepairs?.map(issue => <p className="py-1" key={issue.id}>Repair {issue.id}: {issue.title} · {issue.status}{issue.followUpTaskId && ` · Follow-up: ${issue.followUpTaskId}`}</p>)}
    {task.status !== 'Completed' && !task.stale && <details><summary className="cursor-pointer">Report a maintenance fault</summary><form className="mt-2 space-y-2" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { const result = await api.reportHousekeepingRepair(task.id, { note, reportContentHash: task.reportContentHash }); if (!result) throw new Error('Report could not be confirmed. Refresh before retrying.'); setNote(''); await reload(); window.dispatchEvent(new Event('hotelogx:maintenance-updated')); window.dispatchEvent(new Event('hotelogx:operations-updated')); }
      catch (err) { setError(err instanceof Error ? err.message : 'Report failed'); } finally { setBusy(false); }
    }}><textarea aria-label="Maintenance fault description" className="w-full rounded border p-2" required maxLength={2000} value={note} disabled={busy} onChange={e => setNote(e.target.value)} placeholder="Describe the fault and its exact location" /><Button size="sm" type="submit" disabled={busy}>Create / link repair ticket</Button>{error && <p role="alert" className="text-red-700">{error}</p>}</form></details>}
  </div>;
}
