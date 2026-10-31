import { useState } from 'react';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/session';
import { useGuestHandoffs, type GuestHandoff } from '@/lib/useGuestHandoffs';
import { Badge, Button } from './ui';

const actions: Record<string, string> = { inform: 'Acknowledge Front Office handoff', contact: 'Record guest contacted', unreachable: 'Record contact attempt', not_required: 'Contact not required', resolve: 'Confirm issue resolved', reopen: 'Guest says problem continues / reopen' };
const when = (value?: string) => value ? new Date(value).toLocaleString() : '';
export function GuestEscalationCount({ count, children }: { count: number; children: (count: number | string) => React.ReactNode }) {
  const { rows, loading, error } = useGuestHandoffs();
  return children(loading || error ? '—' : count + rows.filter(r => !r.conversationId && r.awaitingFrontOffice).length);
}
export function GuestHandoffCard({ row }: { row: GuestHandoff }) {
  const user = useCurrentUser(), { reload, error: loadError } = useGuestHandoffs();
  const [action, setAction] = useState(''), [note, setNote] = useState(''), [channel, setChannel] = useState('phone'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const canManage = ['manager', 'front-office'].includes(user?.role || ''), done = row.workStatus === 'Completed';
  const available = row.state === 'resolved' ? ['reopen'] : !done ? [] : !row.foInformedAt ? ['inform', 'reopen'] : ['contact', 'unreachable', 'not_required', ...(['contacted', 'not_required'].includes(row.contactStatus) ? ['resolve'] : []), 'reopen'];
  return <div className="space-y-2 rounded-lg border border-line bg-paper p-3 text-sm">
    <div className="flex flex-wrap items-center gap-2"><strong>{row.room ? `${row.room} - ` : ''}{row.title}</strong><Badge tone={row.state === 'resolved' ? 'good' : 'attend'}>{row.state === 'resolved' ? 'Guest issue resolved' : row.state === 'reopened' ? 'Reopened with department' : done ? 'Front Office follow-up' : 'Department work pending'}</Badge></div>
    <p>{row.department}: {done ? `Work completed${row.workCompletedAt ? ` ${when(row.workCompletedAt)}` : ' (time not recorded)'}` : row.workStatus}</p>
    <p>Front Office informed: {row.foInformedAt ? `${when(row.foInformedAt)} (${row.foInformedBy})` : 'Awaiting acknowledgment'}</p>
    <p>Guest contact: {row.contactStatus.replaceAll('_', ' ')} {when(row.contactedAt)} {row.contactChannel?.replace('_', ' ')}</p>
    {row.contactNote && <p>{row.contactNote}</p>}{row.resolutionNote && <p>Resolution: {row.resolutionNote}</p>}
    {canManage && <div className="flex flex-wrap gap-2">{available.map(key => <Button key={key} size="sm" variant="outline" disabled={busy || !!loadError} onClick={() => { setAction(key); setNote(''); setError(''); }}>{actions[key]}</Button>)}</div>}
    {action && <form className="space-y-2 rounded border border-line bg-white p-3" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { const result = await api.actGuestHandoff(row.id, { action, note, channel, version: row.version }); if (!result) throw new Error('Update could not be confirmed'); await reload(); window.dispatchEvent(new Event('hotelogx:handoffs-updated')); setAction(''); }
      catch (err) { setError(err instanceof Error ? err.message : 'Update failed'); } finally { setBusy(false); }
    }}><p className="font-medium">{actions[action]}</p>
      {['contact', 'unreachable'].includes(action) && <><p className="text-xs text-ink-3">Record contact already made. Send messages using the existing conversation composer.</p><select aria-label="Contact channel" className="rounded border p-2" disabled={busy} value={channel} onChange={e => setChannel(e.target.value)}>{['phone', 'in_person', 'whatsapp', 'email'].map(v => <option value={v} key={v}>{v.replace('_', ' ')}</option>)}</select></>}
      {action === 'reopen' && <p className="text-xs">The original work returns to its department for reassignment. Previous completion and contact history remain available.</p>}
      <textarea required maxLength={2000} aria-label="Follow-up outcome and next action" className="w-full rounded border p-2" disabled={busy} value={note} onChange={e => setNote(e.target.value)} placeholder={action === 'not_required' ? 'Why is guest contact not appropriate?' : action === 'resolve' ? 'What confirms the issue is resolved?' : 'What happened and what should happen next?'} />
      {error && <p role="alert" className="text-red-700">{error}</p>}<Button size="sm" type="submit" disabled={busy}>Save</Button> <Button size="sm" variant="quiet" disabled={busy} onClick={() => setAction('')}>Cancel</Button>
    </form>}
    <details><summary className="cursor-pointer text-xs">Handoff history</summary>{row.history.map(e => <p className="mt-1 text-xs" key={e.id}>{when(e.at)} - {e.action} ({e.actor}, cycle {e.cycle + 1}): {e.note}</p>)}</details>
  </div>;
}
export function GuestHandoffWork({ kind, id, conversationId }: { kind: string; id: string; conversationId?: string }) {
  const { rows, error, loading, reload } = useGuestHandoffs(), user = useCurrentUser();
  const row = rows.find(r => r.workKind === kind && r.workId === id);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
  if (!row && !['manager', 'front-office'].includes(user?.role || '')) return null;
  return <div className="mt-2"><Button size="sm" variant="quiet" onClick={() => setOpen(!open)}>{row ? row.state === 'resolved' ? 'Guest issue resolved - history' : 'Guest follow-up' : 'Guest-reported problem'}</Button>
    {open && <div className="mt-2">{error && <p role="alert">{error}</p>}{row ? <GuestHandoffCard row={row} /> : <><p className="text-xs">Track this guest-reported problem through department completion and Front Office follow-up.</p><Button size="sm" variant="outline" disabled={loading || busy || !!error} onClick={async () => { setBusy(true); setActionError(''); try { const result = await api.enableGuestHandoff({ workKind: kind, workId: id, conversationId }); if (!result) throw new Error('Follow-up could not be confirmed'); await reload(); window.dispatchEvent(new Event('hotelogx:handoffs-updated')); } catch (err) { setActionError(err instanceof Error ? err.message : 'Unable to open follow-up'); } finally { setBusy(false); } }}>Track guest follow-up</Button>{actionError && <p role="alert">{actionError}</p>}</>}</div>}
  </div>;
}
export function GuestHandoffList({ conversationId, unlinkedOnly = false }: { conversationId?: string; unlinkedOnly?: boolean }) {
  const { rows, error, loading } = useGuestHandoffs();
  const [showResolved, setShowResolved] = useState(!!conversationId);
  const scoped = rows.filter(r => (!conversationId || r.conversationId === conversationId) && (!unlinkedOnly || (!r.conversationId && (r.awaitingFrontOffice || r.state === 'resolved'))));
  const open = scoped.filter(r => r.state !== 'resolved');
  if (unlinkedOnly && !scoped.length && !error) return null;
  return <details className="rounded-lg border border-line p-3" open={!!conversationId || undefined}><summary className="cursor-pointer text-sm font-medium">Guest follow-ups ({loading ? '...' : open.length} open)</summary>
    <div className="mt-3 space-y-3">{error && <p role="alert" className="text-red-700">{error}</p>}<label className="text-xs"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> Include resolved issues</label>
      {(showResolved ? scoped : open).map(r => <GuestHandoffCard key={r.id} row={r} />)}{!loading && !error && !scoped.length && <p className="text-sm">No guest follow-ups recorded.</p>}
    </div></details>;
}
