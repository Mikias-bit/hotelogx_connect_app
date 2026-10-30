import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AlertOctagon, ArrowRight, CheckCircle2, DoorClosed, Timer, Wrench } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Briefing } from '@/components/Briefing';
import { WhatsAppOps } from '@/components/WhatsAppOps';
import { MaintenanceWorkCard } from '@/components/MaintenanceWorkCard';
import { Badge, Button, Card, Empty, Eyebrow, SectionTitle, StatCard } from '@/components/ui';
import { useMaintenance } from '@/lib/useMaintenance';
import { useCurrentUser } from '@/lib/session';
import { greeting } from '@/lib/utils';

export const Route = createFileRoute('/maintenance/')({ component: MaintenanceDashboard });
function MaintenanceDashboard() {
  const user = useCurrentUser(), navigate = useNavigate();
  const { data, error, loading, load } = useMaintenance();
  const work = data?.work || [], open = work.filter(row => row.status !== 'Completed');
  const urgent = open.filter(row => row.priority === 'Urgent');
  const active = work.filter(row => row.status === 'In Progress');
  const completed = work.filter(row => row.status === 'Completed');
  const flagged = new Set(work.filter(row => row.kind === 'issue' && row.outOfService && row.status !== 'Completed').map(row => row.room));
  const unaccepted = work.filter(row => row.status === 'Assigned');
  const count = (value: number) => data && !error ? value : '\u2014';
  return <AppShell title="Maintenance" wide>
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><Eyebrow>Technical department</Eyebrow><h1 className="mt-1.5 font-display text-[26px] font-medium text-ink">{greeting()}, {user?.name.split(' ')[0] || 'team'}</h1><p className="mt-1.5 text-[13.5px] text-ink-3">Your hotel's issues, tasks and technician progress, updated from the backend.</p></div><div className="flex gap-2"><Button variant="quiet" disabled={loading} onClick={() => void load()}>Refresh</Button><Button icon={ArrowRight} onClick={() => navigate({ to: '/maintenance/assignments' })}>Assignments</Button></div></div>
      {error && <p role="alert" className="text-sm text-urgent">{error} Existing records may be out of date.</p>}
      {loading && !data && <p role="status">Loading maintenance records?</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Open work" value={count(open.length)} icon={Wrench} tone="attend" hint="issues and follow-ups" onClick={() => navigate({ to: '/maintenance/assignments' })} />
        <StatCard label="Urgent" value={count(urgent.length)} icon={AlertOctagon} tone="urgent" emphasis={urgent.length > 0} delay={40} />
        <StatCard label="In progress" value={count(active.length)} icon={Timer} tone="ai" delay={80} />
        <StatCard label="Completed" value={count(completed.length)} icon={CheckCircle2} tone="good" delay={120} />
        <StatCard label="Rooms flagged" value={count(flagged.size)} icon={DoorClosed} tone="attend" hint="out-of-service issue flags" delay={160} />
      </div>
      {data && !error && <Briefing eyebrow="Maintenance overview" opening={`${open.length} open items. ${unaccepted.length} assignments awaiting technician acceptance.`} lines={[
        ...urgent.slice(0, 3).map(row => ({ text: `${row.room ? 'Room / location ' + row.room + ': ' : ''}${row.title}`, tone: 'urgent' as const, meta: row.assignee || 'Unassigned' })),
        { text: `${work.filter(row => row.status === 'Waiting Parts').length} items waiting for parts; ${work.filter(row => row.status === 'Escalated').length} need help.`, tone: 'attend' as const },
        { text: 'Technicians accept, start and complete assigned work on WhatsApp. Review room readiness separately after a repair.', tone: 'pine' as const },
      ]} footnote="Based on saved maintenance issues, tasks and worker responses." />}
      <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start"><div className="space-y-5">
        <section><SectionTitle title="Active work" hint="Sorted by priority" />{open.map(row => <MaintenanceWorkCard key={`${row.kind}:${row.id}`} work={row} />)}{data && !error && !open.length && <Empty title="No open maintenance work" hint="Create an issue or follow-up task to get started." icon={CheckCircle2} />}</section>
        <section><SectionTitle title="Technicians" hint="Registered workers and current workload" /><div className="grid gap-3 sm:grid-cols-2">{data?.workers.filter(worker => worker.active || open.some(row => row.assignedWorkerId === worker.id)).map(worker => {
          const assigned = open.filter(row => row.assignedWorkerId === worker.id);
          return <Card key={worker.id}><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{worker.name}</p><Badge tone={assigned.length ? 'attend' : 'mute'}>{assigned.length} open</Badge></div><ul className="mt-3 space-y-2 text-[12.5px] text-ink-3">{assigned.map(row => <li key={`${row.kind}:${row.id}`}>{row.room || 'General'} ? {row.title} ? {row.status}</li>)}</ul>{!assigned.length && <p className="mt-3 text-sm text-ink-3">No open assignments.</p>}</Card>;
        })}</div>{data && !data.workers.length && <Empty title="No technicians registered" hint="Add technicians on the Assignments page." />}</section>
      </div><Card className="lg:sticky lg:top-20 lg:h-[calc(100dvh-8rem)]"><WhatsAppOps department="Maintenance" /></Card></div>
    </div>
  </AppShell>;
}
