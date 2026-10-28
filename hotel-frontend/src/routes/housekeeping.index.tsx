import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlarmClock, ArrowRight, BedDouble, CheckCircle2, Crown, DoorClosed, LogIn, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WhatsAppOps } from "@/components/WhatsAppOps";
import { Badge, Button, Card, Empty, Eyebrow, SectionTitle, StatCard, statusTone } from "@/components/ui";
import { useCurrentUser } from "@/lib/session";
import { useApp } from "@/lib/store";
import { useOperations } from "@/lib/useOperations";
import type { Task } from "@/lib/types";
import { greeting } from "@/lib/utils";

export const Route = createFileRoute("/housekeeping/")({
  component: HousekeepingDashboard,
});

function hotelTime(timezone: string) {
  if (!timezone) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  } catch {
    return null;
  }
}

function HousekeepingDashboard() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const pmsRooms = useApp((s) => s.rooms);
  const tasks = useApp((s) => s.tasks);
  const hotel = useApp((s) => s.hotelProfile);
  const { data, error } = useOperations();
  const source = data?.sources.find(s => s.kind === 'housekeeping');
  const current = source?.status === 'complete' && !source.stale && !source.latestRunFailed && !error;
  const dailyTasks = current ? data?.tasks.filter(t => t.department === 'Housekeeping') || [] : [];
  const byRoom = new Map<string, Task[]>();
  for (const task of dailyTasks) {
    if (task.room) byRoom.set(task.room, [...(byRoom.get(task.room) || []), task]);
  }
  const rank = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
  // The plan and completion state come from Neon; PMS data adds room context only.
  const rooms = [...byRoom].map(([number, roomTasks]) => {
    const pmsRoom = pmsRooms.find(r => r.number === number);
    const completed = roomTasks.every(t => t.status === 'Completed');
    const inProgress = roomTasks.some(t => t.status === 'In Progress');
    const problem = roomTasks.some(t => t.executionStatus === 'Problem');
    return {
      number, completed, inProgress, tasks: roomTasks,
      status: completed ? 'Completed' : problem ? 'Needs attention' : inProgress ? 'In Progress' : roomTasks.some(t => t.assignedWorkerId) ? 'Assigned' : 'Unassigned',
      priority: Math.min(...roomTasks.map(t => rank[t.priority])),
      cleaningType: roomTasks.map(t => t.title).join(' \u00b7 '),
      guestStatus: pmsRoom?.guestStatus,
      arrivalTime: pmsRoom?.arrivalTime,
      earlyCheckIn: pmsRoom?.earlyCheckIn,
      vip: pmsRoom?.vip,
      dnd: !completed && (roomTasks.some(t => t.problemType === 'dnd' && t.status !== 'Completed') || pmsRoom?.status === 'DND' || pmsRoom?.status === 'Guest Inside'),
      cleaner: Array.from(new Set(roomTasks.map(t => t.assignee || 'Unassigned'))).join(', '),
      note: roomTasks.filter(t => t.problemType && t.status !== 'Completed').map(t => `${t.problemType === 'dnd' ? 'Do not disturb' : 'Maintenance'}${t.problemNote ? ': ' + t.problemNote : ''}`).join(' \u00b7 '),
    };
  });
  const toClean = rooms.filter(r => !r.completed && !r.inProgress);
  const cleaning = rooms.filter(r => !r.completed && r.inProgress);
  const cleaned = rooms.filter(r => r.completed);
  const dnd = rooms.filter(r => r.dnd);
  const vip = rooms.filter(r => r.vip);
  const checkIn = hotel.checkIn || '15:00';
  const earlyArrivals = rooms.filter(r => r.earlyCheckIn || (r.arrivalTime && r.arrivalTime < checkIn));
  // A room is late only after its known arrival time in the hotel's timezone.
  const now = hotelTime(hotel.timezone);
  const late = rooms.filter(r => !r.completed && now && r.arrivalTime && r.arrivalTime < now);
  const priority = rooms.filter(r => !r.completed)
    .sort((a, b) => a.priority - b.priority || (a.arrivalTime ?? '99:99').localeCompare(b.arrivalTime ?? '99:99')).slice(0, 6);
  const openTasks = tasks.filter(t => t.department === 'Housekeeping' && t.source !== 'Daily report' && t.status !== 'Completed');
  const teamCleaners = data?.workers.filter(w => w.active || dailyTasks.some(t => t.assignedWorkerId === w.id)) || [];
  const count = (value: number) => current ? value : '\u2014';
  const hasRoomDetails = current && rooms.some(r => pmsRooms.some(p => p.number === r.number));
  const assignments = () => navigate({ to: '/housekeeping/assignments' });

  return (
    <AppShell title="Housekeeping — the floor at a glance">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>{greeting()}, {user?.name.split(" ")[0]}</Eyebrow>
            <h1 className="mt-1.5 font-display text-[27px] leading-tight font-medium text-ink sm:text-[30px]">
              {current ? `${cleaned.length} of ${rooms.length} rooms completed.` : 'Your floor at a glance.'}
            </h1>
            <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
              Today's cleaning plan and your team's progress. Housekeepers accept and update their tasks on WhatsApp.
            </p>
          </div>
          <Button variant="outline" icon={ArrowRight} onClick={assignments}>Assignments</Button>
        </div>
        {error && <p role="alert" className="text-sm text-attend">Unable to refresh today's housekeeping progress.</p>}
        {!error && source && !current && <p className="text-sm text-ink-3">{source.stale || source.latestRunFailed ? "Today's cleaning plan is not up to date." : "Today's cleaning plan is not available yet."}</p>}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <StatCard label="To clean" value={count(toClean.length)} hint="waiting to start" icon={BedDouble} tone="urgent" delay={0} onClick={assignments} />
          <StatCard label="In progress" value={count(cleaning.length)} hint="being cleaned now" icon={Sparkles} tone="attend" delay={40} onClick={assignments} />
          <StatCard label="Completed" value={count(cleaned.length)} hint="all planned tasks done" icon={CheckCircle2} tone="good" delay={80} onClick={assignments} />
          <StatCard label="Late" value={hasRoomDetails && now ? late.length : '\u2014'} hint="past known arrival time" icon={AlarmClock} tone="urgent" emphasis={late.length > 0} delay={120} onClick={assignments} />
          <StatCard label="DND / occupied" value={count(dnd.length)} hint="cannot enter yet" icon={DoorClosed} tone="mute" delay={160} onClick={assignments} />
          <StatCard label="VIP rooms" value={hasRoomDetails ? vip.length : '\u2014'} hint="extra preparation" icon={Crown} tone="pine" delay={200} onClick={() => navigate({ to: "/housekeeping/rooms" })} />
          <StatCard label="Early arrivals" value={hasRoomDetails ? earlyArrivals.length : '\u2014'} hint={`before ${checkIn}`} icon={LogIn} tone="ai" delay={240} onClick={() => navigate({ to: "/housekeeping/rooms" })} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr] lg:items-start">
          <div className="space-y-4">
            <section>
              <SectionTitle
                title="Priority rooms"
                hint="Sorted by priority and known arrival time"
                action={
                  <Button size="sm" variant="outline" icon={ArrowRight} onClick={() => navigate({ to: "/housekeeping/rooms" })}>
                    All rooms
                  </Button>
                }
              />
              <Card pad={false}>
                {priority.length === 0 ? (
                  <div className="p-4">
                    <Empty title={current ? 'No rooms waiting' : 'No current cleaning plan'} hint={current ? "There are no outstanding rooms in today's plan." : "Rooms appear here when today's plan is available."} />
                  </div>
                ) : (
                  <ul>
                    {priority.map((r) => (
                      <li key={r.number} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
                        <span className="tnum inline-flex h-8 min-w-12 items-center justify-center rounded-[8px] border border-line bg-paper-2 font-mono text-[13px] font-medium text-ink">
                          {r.number}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-ink">
                            {r.cleaningType}
                            {r.vip && <Crown className="size-3 text-pine-600" />}
                          </p>
                          <p className="text-[11.5px] text-ink-4">
                            {[r.guestStatus, r.arrivalTime && `arrival ${r.arrivalTime}`, r.cleaner].filter(Boolean).join(' · ')}
                          </p>
                          {r.note && <p className="mt-0.5 text-[11.5px] text-attend">{r.note}</p>}
                        </div>
                        <Badge tone={r.status === 'Needs attention' ? 'urgent' : statusTone(r.status)} dot>
                          {r.status}
                        </Badge>
                        <Button size="sm" variant="outline" onClick={assignments}>Manage</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            <section>
              <SectionTitle title="Team today" hint="Today's assignments per attendant" />
              <div className="grid gap-3 sm:grid-cols-2">
                {teamCleaners.map((c) => {
                  const assigned = dailyTasks.filter(t => t.assignedWorkerId === c.id);
                  const roomNumbers = Array.from(new Set(assigned.map(t => t.room).filter(Boolean)));
                  const done = assigned.filter(t => t.status === 'Completed').length;
                  return (
                    <Card key={c.id} className="p-4">
                      <p className="text-[13.5px] font-medium text-ink">{c.name}</p>
                      <p className="tnum mt-1 font-mono text-[12px] text-ink-3">
                        {current ? `${done}/${assigned.length} tasks completed` : 'Progress unavailable'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {roomNumbers.map((number) => (
                          <span
                            key={number}
                            className="tnum rounded-[6px] border border-line bg-paper px-1.5 py-0.5 font-mono text-[11px] text-ink-2"
                          >
                            {number}
                          </span>
                        ))}
                      </div>
                    </Card>
                  );
                })}
                {!teamCleaners.length && <Card className="sm:col-span-2"><Empty title="No housekeepers to show" hint="Manage your team on the Assignments page." /></Card>}
              </div>
            </section>

            <section>
              <SectionTitle title="Open housekeeping tasks" hint="Guest requests routed automatically" />
              <Card pad={false}>
                <ul>
                  {openTasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
                      <span className="tnum inline-flex h-7 min-w-11 items-center justify-center rounded-[7px] border border-line bg-paper-2 font-mono text-[12px] text-ink-2">
                        {t.room ?? "—"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink">{t.title}</p>
                        <p className="text-[11.5px] text-ink-4">
                          {t.assignee ?? "Unassigned"}
                          {t.due && ` · due ${t.due}`}
                        </p>
                      </div>
                      <Badge tone={statusTone(t.status)} dot>
                        {t.status}
                      </Badge>
                    </li>
                  ))}
                  {openTasks.length === 0 && (
                    <li className="p-4">
                      <Empty title="No open tasks" hint="Guest requests appear here the moment the AI receives one." />
                    </li>
                  )}
                </ul>
              </Card>
            </section>
          </div>

          <Card className="lg:sticky lg:top-20 lg:h-[calc(100dvh-8rem)]">
            <WhatsAppOps department="Housekeeping" />
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
