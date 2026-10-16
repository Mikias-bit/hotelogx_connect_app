import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlarmClock, ArrowRight, BedDouble, CheckCircle2, Crown, DoorClosed, LogIn, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WhatsAppOps } from "@/components/WhatsAppOps";
import { Badge, Button, Card, Empty, Eyebrow, SectionTitle, StatCard, statusTone } from "@/components/ui";
import { useCurrentUser } from "@/lib/session";
import { selectors, setRoomStatus, useApp } from "@/lib/store";
import { greeting } from "@/lib/utils";

export const Route = createFileRoute("/housekeeping/")({
  component: HousekeepingDashboard,
});

function HousekeepingDashboard() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const rooms = useApp((s) => s.rooms);
  const tasks = useApp((s) => s.tasks);
  const teamCleaners = useApp(selectors.housekeepingTeam);

  const toClean = rooms.filter((r) => r.status === "Dirty");
  const cleaning = rooms.filter((r) => r.status === "Cleaning");
  const cleaned = rooms.filter((r) => r.status === "Clean" || r.status === "Inspected");
  const dnd = rooms.filter((r) => r.status === "DND" || r.status === "Guest Inside");
  const vip = rooms.filter((r) => r.vip);
  const earlyArrivals = rooms.filter((r) => r.arrivalTime && r.arrivalTime < "15:00");
  const late = rooms.filter((r) => r.arrivalTime && r.status !== "Clean" && r.status !== "Inspected" && r.arrivalTime < "15:00");

  const priority = rooms
    .filter((r) => r.status !== "Clean" && r.status !== "Inspected" && r.status !== "Blocked")
    .sort((a, b) => {
      const rank = { Urgent: 0, High: 1, Normal: 2, Low: 3 } as const;
      return rank[a.priority] - rank[b.priority] || (a.arrivalTime ?? "99:99").localeCompare(b.arrivalTime ?? "99:99");
    })
    .slice(0, 6);

  const openTasks = tasks.filter((t) => t.department === "Housekeeping" && t.status !== "Completed");

  return (
    <AppShell title="Housekeeping — the floor at a glance">
      <div className="space-y-6">
        <div>
          <Eyebrow>{greeting()}, {user?.name.split(" ")[0]}</Eyebrow>
          <h1 className="mt-1.5 font-display text-[27px] leading-tight font-medium text-ink sm:text-[30px]">
            {cleaned.length} of {rooms.length} rooms released.
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
            Your team never has to open this. Everything here arrives from the buttons they tap on WhatsApp.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <StatCard label="To clean" value={toClean.length} hint="waiting to start" icon={BedDouble} tone="urgent" delay={0} onClick={() => navigate({ to: "/housekeeping/rooms" })} />
          <StatCard label="In progress" value={cleaning.length} hint="being cleaned now" icon={Sparkles} tone="attend" delay={40} />
          <StatCard label="Cleaned" value={cleaned.length} hint="released to reception" icon={CheckCircle2} tone="good" delay={80} />
          <StatCard label="Late" value={late.length} hint="arrival before the room" icon={AlarmClock} tone="urgent" emphasis={late.length > 0} delay={120} />
          <StatCard label="DND / occupied" value={dnd.length} hint="cannot enter yet" icon={DoorClosed} tone="mute" delay={160} />
          <StatCard label="VIP rooms" value={vip.length} hint="extra preparation" icon={Crown} tone="pine" delay={200} />
          <StatCard label="Early arrivals" value={earlyArrivals.length} hint="before 15:00" icon={LogIn} tone="ai" delay={240} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr] lg:items-start">
          <div className="space-y-4">
            <section>
              <SectionTitle
                title="Priority rooms"
                hint="Sorted by arrival time and priority"
                action={
                  <Button size="sm" variant="outline" icon={ArrowRight} onClick={() => navigate({ to: "/housekeeping/rooms" })}>
                    All rooms
                  </Button>
                }
              />
              <Card pad={false}>
                {priority.length === 0 ? (
                  <div className="p-4">
                    <Empty title="Everything is released" hint="Nothing is waiting on housekeeping right now." />
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
                            {r.guestStatus}
                            {r.arrivalTime && ` · arrival ${r.arrivalTime}`}
                            {r.cleaner && ` · ${r.cleaner}`}
                          </p>
                          {r.note && <p className="mt-0.5 text-[11.5px] text-attend">{r.note}</p>}
                        </div>
                        <Badge tone={statusTone(r.status)} dot>
                          {r.status}
                        </Badge>
                        {r.status !== "Clean" && r.status !== "Inspected" && (
                          <div className="flex gap-1.5">
                            {r.status !== "Cleaning" && (
                              <Button size="sm" variant="quiet" onClick={() => setRoomStatus(r.number, "Cleaning")}>
                                Start
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => setRoomStatus(r.number, "Clean")}>
                              Release
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            <section>
              <SectionTitle title="Team today" hint="Rooms assigned per attendant" />
              <div className="grid gap-3 sm:grid-cols-2">
                {teamCleaners.map((c) => {
                  const assigned = rooms.filter((r) => r.cleaner === c);
                  const done = assigned.filter((r) => r.status === "Clean" || r.status === "Inspected").length;
                  return (
                    <Card key={c} className="p-4">
                      <p className="text-[13.5px] font-medium text-ink">{c}</p>
                      <p className="tnum mt-1 font-mono text-[12px] text-ink-3">
                        {done}/{assigned.length} released
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {assigned.map((r) => (
                          <span
                            key={r.number}
                            className="tnum rounded-[6px] border border-line bg-paper px-1.5 py-0.5 font-mono text-[11px] text-ink-2"
                          >
                            {r.number}
                          </span>
                        ))}
                      </div>
                    </Card>
                  );
                })}
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
