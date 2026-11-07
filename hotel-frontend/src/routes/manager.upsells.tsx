import { UpsellAutomation } from '@/components/UpsellAutomation';
import { useEffect, useState } from 'react';
import { PmsUpsells } from '@/components/PmsUpsells';
import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle2, Percent, Send, TrendingUp } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Badge, Card, ChannelMark, Empty, Eyebrow, SectionTitle, Sparkline, StatCard, statusTone } from '@/components/ui';
import { channelLabel, useApp } from '@/lib/store';
import { api } from '@/lib/api';
import type { Upsell, UpsellSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/manager/upsells')({ component: ManagerUpsells });
const tabs = ['All', 'Guest accepted', 'Posted', 'Sent', 'Rejected', 'Expired', 'Pending', 'Failed', 'Uncertain'] as const;
const amountLabel = (totals: Record<string, number>) => Object.entries(totals).map(([currency, value]) => `${value.toFixed(2)} ${currency}`).join(' / ') || '0.00';

function ManagerUpsells() {
  const preparationTasks = useApp(s => s.tasks.filter(t => Boolean(t.upsellOfferId)));
  const [report, setReport] = useState<{ rows: Upsell[]; summary: UpsellSummary } | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<typeof tabs[number]>('All');
  useEffect(() => {
    let active = true, loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const data = await api.getUpsellReport();
        if (!data) throw new Error('Upsell reporting is unavailable.');
        if (active) { setReport(data); setError(''); }
      } catch (err) { if (active) setError(err instanceof Error ? err.message : 'Unable to refresh upsell reporting.'); }
      finally { loading = false; }
    };
    void load();
    const timer = window.setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', load); };
  }, []);
  const upsells = report?.rows || [];
  const summary = report?.summary;
  const matches = (u: Upsell, selected: typeof tabs[number]) => selected === 'All' || (selected === 'Guest accepted' ? u.guestAccepted : u.status === selected);
  const list = upsells.filter(u => matches(u, tab));
  const posted = upsells.filter(u => u.postingStatus === 'posted');
  const byOffer = Object.entries(posted.reduce<Record<string, number>>((acc, u) => {
    const key = `${u.offer} (${u.currency || 'Unknown currency'})`;
    acc[key] = (acc[key] || 0) + Math.round(u.value * 100);
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const weekCurrencies = Object.keys(summary?.week.totals || {});
  const timestamp = (date: string) => new Date(date).toLocaleString(undefined, { timeZone: summary?.timezone || 'UTC' });

  return <AppShell title="Catalogue offers and reservation extras">
    <div className="space-y-5">
      <UpsellAutomation />
      <PmsUpsells />
      <div>
        <Eyebrow>Upsells</Eyebrow>
        <h1 className="mt-1.5 font-display text-[26px] leading-tight font-medium text-ink">Offers sent to guests</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">Guest acceptance and PMS posting are tracked separately. Posted value is added to the reservation bill; payment collection is not tracked here.</p>
      </div>
      {error && <p role="alert" className="text-sm text-attend">{error} {report && 'The last loaded figures are shown.'}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total PMS posted value" value={summary ? amountLabel(summary.postedTotals) : '...'} hint="all time, not payments collected" icon={TrendingUp} tone="good" delay={0} />
        <StatCard label="Offers sent" value={summary?.sent ?? '...'} hint="confirmed delivery or recorded staff offer" icon={Send} tone="pine" delay={40} />
        <StatCard label="Guest accepted" value={summary?.accepted ?? '...'} hint="includes offers awaiting staff approval" icon={CheckCircle2} tone="good" delay={80} />
        <StatCard label="Conversion rate" value={summary ? `${summary.conversion}%` : '...'} hint="guest accepted / sent, all time" icon={Percent} tone="ai" delay={120} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {tabs.map(t => <button key={t} onClick={() => setTab(t)} className={cn('rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors', t === tab ? 'border-pine-600 bg-pine-600 text-white' : 'border-line bg-surface text-ink-3 hover:border-ink-4')}>
              {t}<span className="tnum ml-1.5 font-mono text-[10.5px] opacity-70">{upsells.filter(u => matches(u, t)).length}</span>
            </button>)}
          </div>
          <Card pad={false}>
            <div className="hidden grid-cols-[1.1fr_1.7fr_0.6fr_0.7fr_0.9fr_1fr] gap-3 border-b border-line bg-paper/60 px-4 py-2.5 text-[10.5px] font-semibold uppercase sm:grid">
              <span>Guest</span><span>Offer</span><span className="text-right">Value</span><span>Channel</span><span>Status</span><span className="text-right">Event date</span>
            </div>
            {!list.length ? <div className="p-4"><Empty title={report ? 'Nothing here yet' : 'Loading offers'} hint="Offers show guest acceptance, delivery and PMS posting separately." /></div> : <ul>
              {list.map(u => <li key={u.id} className="grid grid-cols-1 gap-1.5 border-b border-line-soft px-4 py-3 last:border-b-0 sm:grid-cols-[1.1fr_1.7fr_0.6fr_0.7fr_0.9fr_1fr] sm:items-center sm:gap-3">
                <span className="text-[13px] font-medium text-ink">{u.guest}{u.room && <span className="ml-1.5 font-mono text-[11px] text-ink-4">{u.room}</span>}</span>
                <span className="text-[12.5px] text-ink-2">{u.offer}</span>
                <span className="font-mono text-[12.5px] sm:text-right">{u.value.toFixed(2)} {u.currency || 'Unknown currency'}</span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3"><ChannelMark channel={u.channel} />{channelLabel(u.channel)}</span>
                <span><Badge tone={statusTone(u.status)} dot>{u.status === 'Accepted' ? 'Guest accepted' : u.status}</Badge>
                  {u.guestAccepted && u.status !== 'Accepted' && <span className="mt-1 block text-[10px] text-ink-3">Guest accepted</span>}
                  {u.postingStatus === 'pending_approval' && <span className="mt-1 block text-[10px] text-ink-3">Awaiting staff approval</span>}
                  {preparationTasks.filter(t => t.upsellOfferId === u.id).map(t => <span key={t.id} className="mt-1 block text-[10px] text-ink-3">Preparation: {t.status} | {t.department} | Room {t.room || 'awaiting assignment'}</span>)}
                  {u.status === 'Posted' && <span className="mt-1 block text-[10px] text-ink-3">Payment not tracked</span>}
                </span>
                <span className="font-mono text-[11px] text-ink-4 sm:text-right">
                  {u.status === 'Posted' ? u.postedAt ? `Posted ${timestamp(u.postedAt)}` : 'Posting date unavailable' : u.acceptedAt ? `Accepted ${timestamp(u.acceptedAt)}` : `Created ${timestamp(u.date)}`}
                </span>
              </li>)}
            </ul>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <SectionTitle title="This week" hint="PMS posted value" />
            {summary && <>
              <p className="mb-3 text-xs text-ink-3">{summary.week.start} to {summary.week.end} ({summary.timezone})</p>
              {weekCurrencies.length ? weekCurrencies.map(currency => <div key={currency} className="mt-2">
                <p className="text-xs text-ink-3">{currency}</p>
                <Sparkline values={summary.week.days.map(day => day.totals[currency] || 0)} tone="good" width={260} height={54} />
              </div>) : <p className="text-sm text-ink-3">No dated PMS postings this week.</p>}
              <p className="mt-1 flex justify-between font-mono text-[10.5px] text-ink-4">{summary.week.days.map(day => <span key={day.date}>{day.label}</span>)}</p>
              <p className="mt-3 border-t border-line-soft pt-3 text-[12.5px] text-ink-3">{amountLabel(summary.week.totals)} posted this week ({summary.week.postedCount} offers).</p>
              {summary.undatedPostingCount > 0 && <p className="mt-2 text-xs text-attend">{summary.undatedPostingCount} older postings have no reliable posting date. Included in the all-time total, excluded from weekly figures.</p>}
            </>}
          </Card>
          <Card>
            <SectionTitle title="Best performing offers" hint="All-time PMS posted value" />
            {!byOffer.length ? <p className="py-2 text-[12.5px] text-ink-4">No posted offers yet.</p> : <ul className="space-y-2.5">{byOffer.map(([offer, cents]) => <li key={offer} className="flex justify-between gap-2 text-[12.5px] text-ink-2"><span>{offer}</span><span className="font-mono text-good">{(cents / 100).toFixed(2)}</span></li>)}</ul>}
          </Card>
          <Card>
            <Eyebrow>How it works</Eyebrow>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">Acceptance counts when the guest accepts the exact offer, including while staff approval is pending. Posted value counts only after the PMS confirms the extra was added. Weekly figures use that posting date in the hotel timezone. Neither figure confirms payment.</p>
          </Card>
        </div>
      </div>
    </div>
  </AppShell>;
}
