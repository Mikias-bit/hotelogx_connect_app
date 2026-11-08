import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function ReservationRequests({ conversationId }: { conversationId: string }) {
  const [data, setData] = useState<any>(null), [error, setError] = useState('');
  async function refresh() { try { setData(await api.getReservationRequests(conversationId)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load requests'); } }
  useEffect(() => { void refresh(); const timer = setInterval(refresh, 15000); return () => clearInterval(timer); }, [conversationId]);
  return <section className="space-y-3 rounded border p-3 text-sm">
    <h3 className="font-semibold">Reservation requests — Front Office and management</h3>
    {error && <p role="alert">{error}</p>}
    {data?.requests?.length === 0 && <p>No reservation change or extra-bed requests.</p>}
    {data?.requests?.map((request: any) => <RequestReview key={request.id} request={request} data={data} refresh={refresh} />)}
  </section>;
}

function RequestReview({ request, data, refresh }: { request: any; data: any; refresh: () => Promise<void> }) {
  const [note, setNote] = useState(''), [workDate, setDate] = useState(data.today || '');
  const [bedType, setBedType] = useState('extra_bed_requested'), [quantity, setQuantity] = useState(1);
  const [suitability, setSuitability] = useState(false), [agreement, setAgreement] = useState(false);
  const [existingTaskId, setExisting] = useState(''), [covers, setCovers] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const extra = request.kind === 'extra_bed';
  const task = data.tasks?.find((t: any) => t.id === request.taskId);
  async function review(action: string) {
    setBusy(true); setNotice('');
    try { await api.reviewReservationRequest(request.id, { action, note, workDate, bedType, quantity, suitabilityConfirmed: suitability, guestAgreementConfirmed: agreement, existingTaskId: existingTaskId || undefined, existingTaskCoversRequest: covers }); await refresh(); }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Review failed'); }
    finally { setBusy(false); }
  }
  async function checkOrigin() { setBusy(true); setNotice(''); try { await api.checkReservationOrigin(request.id); await refresh(); } catch (e) { setNotice(e instanceof Error ? e.message : 'Source check failed'); } finally { setBusy(false); } }
  const input = 'w-full rounded border p-2';
  return <article className="space-y-2 border-t pt-3">
    <p className="font-medium">{extra ? 'Extra-bed request' : request.kind === 'cancellation' ? 'Cancellation request' : 'Amendment request'} · {request.status}</p>
    <p className="whitespace-pre-wrap">{request.requestText}</p>
    {task && <p>Housekeeping: {task.status}{task.completedAt ? ` · Completed ${new Date(task.completedAt).toLocaleString()}` : ''}</p>}
    {request.note && <p>Staff outcome: {request.note}</p>}
    {!extra && <>
      <p>Booking source: {request.bookingSource?.type || 'not checked'}{request.bookingSource?.provider ? ` (${request.bookingSource.provider})` : ''}</p>
      <p>{request.guidance}</p>
      {['awaiting_origin', 'pending', 'referred'].includes(request.status) && <button className="underline" disabled={busy} onClick={() => void checkOrigin()}>Check verified reservation source</button>}
      {request.status === 'awaiting_origin' && <p>Verify and link the guest reservation below, then check its source. An unknown source is not treated as a direct booking.</p>}
      {request.status === 'referred' && <p>Use the suggested reply to direct the guest to their booking provider. This is not a hotel cancellation or amendment approval.</p>}
    </>}
    {request.status === 'pending' && (extra || request.bookingSource?.type === 'direct') && <>
      <p>{extra ? 'Verify the guest reservation below. Check hotel policy, room capacity, bed stock and any charges before approving. Existing report work can be linked instead of creating another task.' : 'Check identity and handle the cancellation or amendment in the PMS. Record the outcome here and contact the guest. This control does not change the reservation.'}</p>
      {extra && <>
        <label className="block">Preparation date (hotel time)<input className={input} type="date" min={data.today} value={workDate} onChange={e => setDate(e.target.value)} /></label>
        <label className="block">Arrangement<select className={input} value={bedType} onChange={e => setBedType(e.target.value)}><option value="extra_bed_requested">Extra / rollaway bed</option><option value="make_sofa_bed">Prepare sofa bed</option></select></label>
        <label className="block">Number of beds<input className={input} type="number" min={1} max={5} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label>
        <label className="block">Existing housekeeping work<select className={input} value={existingTaskId} onChange={e => { setExisting(e.target.value); setCovers(false); }}><option value="">Create task if no matching work exists</option>{data.candidates?.filter((t: any) => t.reportDate === workDate).map((t: any) => <option key={t.id} value={t.id}>Room {t.room}: {t.title} ({t.status})</option>)}</select></label>
        {existingTaskId && <p className="whitespace-pre-wrap">{data.candidates?.find((t: any) => t.id === existingTaskId)?.detail || "Open the housekeeping plan to review the setup instructions."}</p>}
        {existingTaskId && <label className="block"><input type="checkbox" checked={covers} onChange={e => setCovers(e.target.checked)} /> I checked the report instructions and this task covers the full request and quantity.</label>}
        <label className="block"><input type="checkbox" checked={suitability} onChange={e => setSuitability(e.target.checked)} /> This hotel and assigned room allow the arrangement; capacity and bed availability are checked.</label>
        <label className="block"><input type="checkbox" checked={agreement} onChange={e => setAgreement(e.target.checked)} /> The guest agreed to the arrangement and any charges. Record details below.</label>
      </>}
      <label className="block">Decision / preparation instructions<textarea className={input} value={note} maxLength={2000} onChange={e => setNote(e.target.value)} /></label>
      <div className="flex flex-wrap gap-3">
        {extra ? <button className="underline" disabled={busy || note.trim().length < 5 || !suitability || !agreement || (!!existingTaskId && !covers)} onClick={() => void review('approve')}>Approve Housekeeping preparation</button> : <button className="underline" disabled={busy || note.trim().length < 5} onClick={() => void review('resolve')}>Record staff outcome</button>}
        <button className="underline" disabled={busy || note.trim().length < 5} onClick={() => void review('reject')}>Decline request</button>
      </div>
    </>}
    {notice && <p role="alert">{notice}</p>}
  </article>;
}
