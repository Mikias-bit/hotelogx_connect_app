import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/session';
import { Button, Card, SectionTitle } from './ui';
const titles: Record<string, string> = { housekeeping: 'Housekeeping list', vip: 'VIP list', departure_bills: 'Departure bills checklist' };
const tasks: Record<string, string> = { departure_clean_required: 'Departure cleaning', linen_change: 'Stayover - linen change', stayover_no_cleaning: 'Stayover - no cleaning', baby_bed_requested: 'Prepare baby bed', make_sofa_bed: 'Prepare sofa bed', late_checkout: 'Late checkout', extension: 'Extension', extension_with_room_change: 'Extension with room move', room_move: 'Room move' };
function useReports(date?: string) {
  const user = useCurrentUser();
  const [data, setData] = useState<any>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    if (!user?.id) { setLoading(false); return; }
    setLoading(true); setError('');
    try { const value = await api.getDailyReports(date); if (requestId === sequence.current) setData(value); }
    catch (err) { if (requestId === sequence.current) setError(err instanceof Error ? err.message : 'Unable to load reports'); }
    finally { if (requestId === sequence.current) setLoading(false); }
  }, [user?.id, date]);
  useEffect(() => {
    setData(null); void load();
    const timer = window.setInterval(() => void load(), 60000);
    return () => { sequence.current++; window.clearInterval(timer); };
  }, [load]);
  return { data, error, loading, load };
}
export function DailyReportSummary() {
  const user = useCurrentUser(); const { data, error, loading } = useReports();
  if (!user || !['manager', 'front-office', 'housekeeping'].includes(user.role)) return null;
  return <Card><SectionTitle title="Daily engine reports" hint="Morning lists from your hotel reporting engine" />
    {error ? <p role="alert">{error}</p> : loading ? <p>Loading reports...</p> : <div className="flex flex-wrap gap-4">{data?.reports.map((report: any) => <div key={report.kind}><p className="font-medium">{titles[report.kind]}</p><p className="text-sm">{report.status === 'complete' ? `${report.rows.length} items | ${report.reportDate}${report.stale ? ' | Previous report' : ''}${report.latestRunFailed ? ' | Latest run failed' : ''}` : report.status === 'failed' ? 'Report failed - needs attention' : 'Awaiting first report'}</p></div>)}</div>}
    <Link to={`/${user.role}/reports` as any} className="mt-3 inline-block text-sm font-semibold underline">Open daily reports</Link>
  </Card>;
}
function Review({ report, row, reload }: { report: any; row: any; reload: () => Promise<void> }) {
  const [status, setStatus] = useState(row.review.status), [note, setNote] = useState(row.review.note || ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { setStatus(row.review.status); setNote(row.review.note || ''); }, [row.review.status, row.review.note, row.contentHash]);
  return <div className="min-w-48 space-y-2">
    {row.review.sourceChanged && <p className="text-xs text-amber-800">Source changed. Review this item again.</p>}
    <select aria-label="Checklist status" value={status} onChange={e => setStatus(e.target.value)} className="w-full rounded border p-1"><option value="pending">Pending</option><option value="in-progress">In progress</option><option value="done">{report.kind === 'departure_bills' ? 'Reviewed' : 'Done'}</option></select>
    <input aria-label="Checklist note" placeholder="Staff note" maxLength={2000} value={note} onChange={e => setNote(e.target.value)} className="w-full rounded border p-1" />
    <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await api.reviewDailyReport({ kind: report.kind, reportDate: report.reportDate, itemKey: row.itemKey, contentHash: row.contentHash, status, note }); await reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Update failed'); } finally { setBusy(false); } }}>{busy ? 'Saving...' : 'Save'}</Button>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>;
}
export function DailyReports() {
  const [date, setDate] = useState(''); const { data, error, loading, load } = useReports(date || undefined);
  const [filter, setFilter] = useState('all'); const user = useCurrentUser();
  return <div className="space-y-5">
    <Card><SectionTitle title="Daily reports" hint="Engine results and your team checklist progress" />
      <div className="flex flex-wrap items-center gap-3"><label>Report date <input aria-label="Report date" type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded border p-2" /></label><Button variant="outline" onClick={() => setDate('')}>Latest available</Button><Button variant="outline" disabled={loading} onClick={() => void load()}>Refresh</Button></div>
      <p className="mt-2 text-sm">Reports are snapshots, not live PMS balances. Checklist updates do not charge, refund, or change a room PMS status.</p>
      {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}{loading && <p>Loading...</p>}
    </Card>
    {data?.reports.map((report: any) => <Card key={report.kind}>
      <SectionTitle title={titles[report.kind]} hint={report.reportDate ? `Report date: ${report.reportDate} | ${report.generatedAt ? 'Generated ' + new Date(report.generatedAt).toLocaleString() : ''}` : 'Awaiting the first report from the engine'} />
      {report.stale && <p className="mb-3 text-amber-800">This is a previous report, not data for today.</p>}
      {report.latestRunFailed && <p role="alert" className="mb-3 text-red-700">The latest run failed. Showing the last successful report.</p>}
      {report.status !== 'complete' ? <p>{report.status === 'failed' ? 'The engine could not complete this report. No all-clear result is available.' : 'No report has been received for this selection.'}</p> : <>
        {report.kind === 'departure_bills' && <div className="mb-3"><label>Show <select value={filter} onChange={e => setFilter(e.target.value)} className="rounded border p-1"><option value="all">All exceptions</option><option value="unpaid balance">Open balances</option><option value="overpayment">Overpayments</option><option value="overcharge">Reported overcharges</option></select></label><p className="mt-2 text-sm">Overpayments are credit balances, not proof of an incorrect charge. Reviewed records a staff check, not payment settlement.</p></div>}
        {!report.rows.length ? <p>{report.kind === 'departure_bills' ? 'No balance exceptions reported in this completed snapshot.' : 'No items reported in this completed snapshot.'}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{(report.kind === 'housekeeping' ? ['Room', 'Task', 'Details', 'Checklist'] : report.kind === 'vip' ? ['Guest / reservation', 'VIP reason', 'Benefits', 'Checklist'] : ['Guest / reservation', 'Balance', 'Bill details', 'Checklist']).map(label => <th className="border-b p-3" key={label}>{label}</th>)}</tr></thead><tbody>
          {report.rows.filter((row: any) => report.kind !== 'departure_bills' || filter === 'all' || row.reason === filter).map((row: any) => <tr key={row.itemKey}>
            <td className="border-b p-3 align-top">{report.kind === 'housekeeping' ? row.room : <><p>{row.guest || 'Unnamed guest'}</p><p>{row.confirmation}</p>{row.room && <p>Room {row.room}</p>}{row.additionalGuests && <p>Also: {row.additionalGuests}</p>}</>}</td>
            <td className="border-b p-3 align-top">{report.kind === 'housekeeping' ? tasks[row.task] || row.task : report.kind === 'vip' ? <>{row.type.replaceAll('_', ' ')}{row.nights && <p>{row.nights} nights</p>}</> : <><p className="font-semibold">{row.amount} {row.currency}</p><p>{row.reason}</p></>}</td>
            <td className="max-w-md whitespace-pre-wrap border-b p-3 align-top">{report.kind === 'vip' ? row.benefits : report.kind === 'housekeeping' ? <>{row.comment}{row.oldRoom && <p>Move: {row.oldRoom} to {row.newRoom}</p>}{row.checkoutTime && <p>Checkout: {row.checkoutTime}</p>}</> : <><p>{row.channel} | {row.billOwner}</p><p>{row.amountFor}</p></>}</td>
            <td className="border-b p-3 align-top"><Review report={report} row={row} reload={load} /></td>
          </tr>)}
        </tbody></table></div>}
      </>}
    </Card>)}
    {user?.role === 'manager' && <ReportSource />}
  </div>;
}
function ReportSource() {
  const [engineHotelId, setEngineHotelId] = useState(''), [configured, setConfigured] = useState(false), [token, setToken] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; api.getReportSource().then(source => { if (active) { setEngineHotelId(source?.engineHotelId || ''); setConfigured(Boolean(source?.enabled)); } }).catch(err => { if (active) setError(err.message); }); return () => { active = false; }; }, []);
  return <Card><details><summary className="cursor-pointer font-semibold">Connect reporting engine</summary><p className="my-2 text-sm">Use the hotel ID configured in the Python engine. Creating a new key revokes the previous key for this hotel.</p><input aria-label="Engine hotel ID" placeholder="Engine hotel ID" value={engineHotelId} onChange={e => setEngineHotelId(e.target.value)} className="rounded border p-2" /><Button disabled={busy || !engineHotelId} onClick={async () => { setBusy(true); setError(''); try { const result = await api.createReportSource(engineHotelId); setToken(result.token); setConfigured(true); } catch (err) { setError(err instanceof Error ? err.message : 'Connection failed'); } finally { setBusy(false); } }}>{configured ? 'Replace engine key' : 'Create engine key'}</Button>{token && <div className="mt-3"><p>Save this key in the engine Secret Manager configuration. It is shown only once.</p><input aria-label="Engine access key" type="password" readOnly value={token} className="w-full rounded border p-2" /><Button onClick={() => void navigator.clipboard.writeText(token)}>Copy key</Button></div>}{error && <p role="alert" className="text-red-700">{error}</p>}</details></Card>;
}
