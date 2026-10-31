import { GuestEscalationCount } from '@/components/GuestHandoffs';
import { useReadiness } from '@/lib/useReadiness';
import { OperationalDetails } from '@/components/OperationalDetails';
import { useOperations } from '@/lib/useOperations';
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArrowRight,
  BedDouble,
  ClipboardList,
  Crown,
  LogIn,
  LogOut,
  MessageSquare,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Users,
  Wrench,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ActivityFeed } from "@/components/ActivityFeed";
import { Briefing } from "@/components/Briefing";
import type { BriefLine } from "@/components/Briefing";
import { EscalationCard } from "@/components/EscalationCard";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Empty, Eyebrow, Meter, SectionTitle, Sparkline, StatCard, statusTone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/session";
import { selectors, useApp } from "@/lib/store";
import { greeting, money } from "@/lib/utils";

export const Route = createFileRoute("/manager/")({
  component: ManagerDashboard,
});

function ManagerDashboard() {
  const user = useCurrentUser();
  const operations = useOperations();
  const readiness = useReadiness();
  const [detail, setDetail] = useState<'vip' | 'departure_bills' | null>(null);
  const navigate = useNavigate();
  const escalations = useApp(selectors.escalations).filter(c => c.escalation?.kind !== 'reservation_verification');
  const openTasks = useApp(selectors.openTasks);
  const openIssues = useApp(selectors.openIssues);
  const guestRequests = useApp(selectors.guestRequests);
  const rooms = useApp((s) => s.rooms);
  const tasks = useApp((s) => s.tasks);
  const upsells = useApp((s) => s.upsells);
  const upsellTotal = useApp(selectors.acceptedUpsellTotal);
  const conversations = useApp((s) => s.conversations);

  const [trends, setTrends] = useState<{
    weekdays: string[];
    conversationTrend: number[];
    aiTrend: number[];
    upsellTrend: number[];
    hasData: boolean;
  }>({
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    conversationTrend: [0, 0, 0, 0, 0, 0, 0],
    aiTrend: [0, 0, 0, 0, 0, 0, 0],
    upsellTrend: [0, 0, 0, 0, 0, 0, 0],
    hasData: false,
  });

  useEffect(() => {
    api.getDashboardTrends().then((res) => {
      const data = (res as any)?.data || res;
      if (data && Array.isArray(data.weekdays)) {
        setTrends(data);
      }
    }).catch(() => {});
  }, []);

  const roomsToClean = rooms.filter((r) => r.status === "Dirty").length;
  const roomsReady = readiness.error || readiness.loading ? "?" : readiness.rooms.filter(r => r.ready).length;
  const outOfService = rooms.filter((r) => r.status === "Blocked" || r.status === "Maintenance").length;
  const aiHandled = conversations.filter((c) => c.aiStatus === "ai-handling" || c.aiStatus === "resolved").length;

  const arrivalsCount = rooms.filter((r) => r.arrivalTime).length;
  const departuresCount = rooms.filter((r) => r.guestStatus === "Departed" || r.guestStatus === "Departing").length;
  const inHouseCount = rooms.filter((r) => r.guestStatus !== "Vacant").length;
  const occupancyRate = rooms.length ? Math.round((inHouseCount / rooms.length) * 100) : 0;
  const vipSource = operations.data?.sources.find(s => s.kind === 'vip');
  const vipArrivalsCount = vipSource?.status === 'complete' && !vipSource.stale ? operations.data?.vips.length ?? 0 : 0;
  const balanceSource = operations.data?.sources.find(s => s.kind === 'departure_bills');
  const balanceCount = operations.data?.tasks.filter(t => t.department === 'Billing' && t.status !== 'Completed').length ?? 0;
  const vipReady = vipSource?.status === 'complete' && !vipSource.stale && !vipSource.latestRunFailed && !operations.error;
  const balancesReady = balanceSource?.status === 'complete' && !balanceSource.stale && !balanceSource.latestRunFailed && !operations.error;
  const earlyCheckInsCount = rooms.filter((r) => r.earlyCheckIn).length;
  const totalMessages = conversations.reduce((acc, c) => acc + (c.messages?.length || 0), 0);

  const briefLines: BriefLine[] = [
    {
      text: `${arrivalsCount} arrivals and ${departuresCount} departures. ${vipArrivalsCount} VIP preparations, ${earlyCheckInsCount} early check-ins already agreed.`,
      tone: "ai",
      meta: `${occupancyRate}% occupancy`,
    },
    {
      text: `${totalMessages} messages recorded across channels, handling ${aiHandled} conversations autonomously.`,
      tone: "good",

    },
    {
      text: `${escalations.length} conversation${escalations.length === 1 ? "" : "s"} need you personally.${escalations[0]?.escalation?.reason ? ` — ${escalations[0].escalation.reason}` : ""}`,
      tone: escalations.length > 0 ? "urgent" : "good",
    },
    {
      text: `${roomsToClean} rooms still to clean, ${roomsReady} released out of ${rooms.length} total rooms.`,
      tone: roomsToClean > 0 ? "attend" : "good",
    },
    {
      text: `${money(upsellTotal)} of upsells accepted today from ${upsells.length} offers made by AI.`,
      tone: "good",
      meta: `${upsells.filter((u) => u.status === "Accepted").length} accepted`,
    },
  ];

  const priorities = [
    ...escalations.slice(0, 2).map((e) => ({
      text: `Review escalation: ${e.escalation?.reason || "Guest query in " + (e.room || "thread")}`,
      tone: "urgent" as const,
      who: "You",
    })),
    ...tasks
      .filter((t) => t.source !== "Daily report" && t.status !== "Completed" && (t.priority === "Urgent" || t.priority === "High"))
      .slice(0, 3)
      .map((t) => ({
        text: `${t.title}${t.room ? " (" + t.room + ")" : ""}`,
        tone: t.priority === "Urgent" ? ("urgent" as const) : ("attend" as const),
        who: t.department,
      })),
  ];

  const departments = [
    {
      name: "Front Office",
      icon: MessageSquare,
      lead: "Front Office team",
      stat: `${tasks.filter((t) => t.department === "Front Office" && t.status !== "Completed").length} open tasks`,
      note: `${guestRequests.length} live guest requests · ${aiHandled} threads on autopilot`,
      progress: tasks.filter(t => t.department === "Front Office").length ? Math.round(tasks.filter(t => t.department === "Front Office" && t.status === "Completed").length / tasks.filter(t => t.department === "Front Office").length * 100) : 0,
      tone: "pine" as const,
    },
    {
      name: "Housekeeping",
      icon: BedDouble,
      lead: "Housekeeping team",
      stat: `${operations.data?.housekeeping.completed ?? 0} housekeeping tasks completed`,
      note: `${roomsToClean} to clean · updates arriving on WhatsApp`,
      progress: operations.data?.tasks.filter(t => t.department === "Housekeeping").length ? Math.round(operations.data.housekeeping.completed / operations.data.tasks.filter(t => t.department === "Housekeeping").length * 100) : 0,
      tone: "attend" as const,
    },
    {
      name: "Maintenance",
      icon: Wrench,
      lead: "Maintenance team",
      stat: `${openIssues.length} open issues`,
      note: `${outOfService} rooms affected · ${openIssues.filter((i) => i.status === "Waiting Parts").length} waiting for parts`,
      progress: openIssues.length ? Math.round((1 - openIssues.length / Math.max(openIssues.length + 2, 1)) * 100) : 100,
      tone: "urgent" as const,
    },
  ];

  const briefingOpening =
    escalations.length === 0
      ? "Review current conversations, operational tasks and staff follow-ups below."
      : `${escalations.length} conversation${escalations.length === 1 ? "" : "s"} need your attention: ${escalations
          .map((e) => e.escalation?.reason || "room " + (e.room || ""))
          .slice(0, 2)
          .join(", ")}. Review the operational tasks for other outstanding work.`;

  return (
    <AppShell title="Morning operational briefing">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>{greeting()}, {user?.name.split(" ")[0]}</Eyebrow>
            <h1 className="mt-1.5 font-display text-[27px] leading-tight font-medium text-ink sm:text-[31px]">
              Here is your hotel this morning.
            </h1>
            <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
              Review current conversations, operational tasks and staff follow-ups below.
            </p>
          </div>
          <Button variant="outline" icon={Archive} onClick={() => navigate({ to: "/manager/lost-found" })}>Lost &amp; Found</Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <StatCard label="Arrivals" value={arrivalsCount} hint={`${vipArrivalsCount} VIP`} icon={LogIn} tone="pine" delay={0} />
          <StatCard label="Departures" value={departuresCount} hint={`${earlyCheckInsCount} early checkouts`} icon={LogOut} tone="mute" delay={40} />
          <StatCard label="In-house" value={inHouseCount} hint={`${occupancyRate}% occupancy`} icon={Users} tone="pine" delay={80} />
          <StatCard label="VIPs" value={vipReady ? vipArrivalsCount : '—'} hint="View VIP guests" icon={Crown} tone="pine" delay={100} onClick={() => setDetail('vip')} />
          <StatCard label="Departure balances" value={balancesReady ? balanceCount : '—'} hint="Problems to review" icon={TriangleAlert} tone="attend" delay={110} emphasis={balancesReady && balanceCount > 0} onClick={() => setDetail('departure_bills')} />
          <StatCard label="Guest requests" value={guestRequests.length} hint="open right now" icon={MessageSquare} tone="ai" delay={120} />
          <GuestEscalationCount count={escalations.length}>{count => <StatCard
            label="Escalations"
            value={count}
            hint="need a person"
            icon={TriangleAlert}
            tone="urgent"
            emphasis={escalations.length > 0}
            delay={160}
            onClick={() => navigate({ to: "/manager/conversations", search: { filter: "escalated" } })}
          />}</GuestEscalationCount>
          <StatCard label="Open tasks" value={openTasks.length} hint="across 3 departments" icon={ClipboardList} tone="attend" delay={200} onClick={() => navigate({ to: "/manager/tasks" })} />
          <StatCard label="Maintenance" value={openIssues.length} hint={`${outOfService} rooms affected`} icon={Wrench} tone="attend" delay={240} />
        </div>

        <Briefing
          opening={briefingOpening}
          lines={briefLines}
          action={
            <Button icon={ArrowRight} onClick={() => navigate({ to: "/manager/conversations" })}>
              View details
            </Button>
          }
          footnote="Compiled at 09:55 from WhatsApp, Gmail, your PMS and every department update received on WhatsApp since midnight."
        />

        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr] lg:items-start">
          <div className="space-y-4">
            <section>
              <SectionTitle
                title="Needs you now"
                hint="Escalation cards — the AI has already prepared a reply for each"
                action={
                  escalations.length > 0 ? (
                    <Badge tone="urgent" dot>
                      {escalations.length} waiting
                    </Badge>
                  ) : undefined
                }
              />
              <div className="space-y-3">
                {escalations.length === 0 ? (
                  <Empty title="Nothing escalated" hint="The AI is handling every conversation on its own right now." icon={Sparkles} />
                ) : (
                  escalations.map((c) => (
                    <EscalationCard
                      key={c.id}
                      conversation={c}
                      staffName={user?.name ?? "Manager"}
                      onOpen={() => navigate({ to: "/manager/conversations" })}
                    />
                  ))
                )}
              </div>
            </section>

            <section>
              <SectionTitle title="Today's priorities" hint="Ordered by what will cost you a guest if it slips" />
              <Card pad={false}>
                <ol>
                  {priorities.map((p, i) => (
                    <li key={`${p.text}-${i}`} className="flex items-start gap-3 border-t border-line-soft px-4 py-3 first:border-t-0">
                      <span className="tnum mt-px font-mono text-[11px] text-ink-4">{String(i + 1).padStart(2, "0")}</span>
                      <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-ink-2">{p.text}</p>
                      <Badge tone={p.tone}>{p.who}</Badge>
                    </li>
                  ))}
                </ol>
              </Card>
            </section>
          </div>

          <div className="space-y-4">
            <section>
              <SectionTitle title="Department status" />
              <div className="space-y-3">
                {departments.map((d) => {
                  const Icon = d.icon;
                  return (
                    <Card key={d.name} className="p-4">
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex size-8 items-center justify-center rounded-[9px] border border-line bg-paper">
                          <Icon className="size-4 text-ink-3" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] font-medium text-ink">{d.name}</p>
                          <p className="text-[11.5px] text-ink-4">{d.lead}</p>
                        </div>
                        <Badge tone={d.tone}>{d.stat}</Badge>
                      </div>
                      <Meter value={d.progress} tone={d.tone} className="mt-3" />
                      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">{d.note}</p>
                    </Card>
                  );
                })}
              </div>
            </section>

            <section>
              <SectionTitle title="This week" hint="Real rolling 7-day activity scoped to this hotel" />
              <Card className="space-y-4">
                {[
                  {
                    label: "Conversations",
                    values: trends.conversationTrend,
                    tone: "pine" as const,
                    value: conversations.length,
                    suffix: conversations.length === 0 ? "No threads yet" : "active threads",
                  },
                  {
                    label: "AI resolution rate",
                    values: trends.aiTrend,
                    tone: "good" as const,
                    value: `${conversations.length ? Math.round((aiHandled / conversations.length) * 100) : 0}%`,
                    suffix: conversations.length === 0 ? "Awaiting inquiries" : "of all threads",
                  },
                  {
                    label: "Upsell revenue",
                    values: trends.upsellTrend,
                    tone: "ai" as const,
                    value: money(upsellTotal),
                    suffix: upsells.length === 0 ? "No offers accepted yet" : "accepted total",
                  },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3 border-t border-line-soft pt-4 first:border-t-0 first:pt-0">
                    <div>
                      <p className="text-[12px] text-ink-3">{row.label}</p>
                      <p className="tnum font-display text-[21px] leading-tight font-medium text-ink">{row.value}</p>
                      <p className="text-[11px] text-ink-4">{row.suffix}</p>
                    </div>
                    <div className="text-right">
                      <Sparkline values={row.values || [0, 0, 0, 0, 0, 0, 0]} tone={row.tone} />
                      <p className="tnum mt-1 font-mono text-[10px] text-ink-4">{(trends?.weekdays || ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]).join(" ")}</p>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-line-soft pt-3">
                  <p className="text-[12px] text-ink-3">Accepted upsells, all time in view</p>
                  <p className="tnum inline-flex items-center gap-1 font-mono text-[13px] font-medium text-good">
                    <TrendingUp className="size-3.5" />
                    {money(upsellTotal)}
                  </p>
                </div>
              </Card>
            </section>

            <section>
              <SectionTitle title="What the AI has been doing" hint="Live, across every channel" />
              <Card>
                <ActivityFeed limit={10} compact />
              </Card>
            </section>
          </div>
        </div>

        <section>
          <SectionTitle title="Rooms at a glance" hint="Housekeeping and maintenance keep this current from WhatsApp" />
          <Card pad={false} className="overflow-x-auto">
            <div className="flex min-w-max gap-2 p-4">
              {rooms.map((r) => (
                <div key={r.number} className="w-[104px] shrink-0 rounded-[10px] border border-line bg-paper/60 p-2.5">
                  <p className="tnum font-mono text-[13px] font-medium text-ink">{r.number}</p>
                  <Badge tone={statusTone(r.status)} className="mt-1.5">
                    {r.status}
                  </Badge>
                  <p className="tnum mt-1.5 font-mono text-[10px] text-ink-4">{r.updatedAt}</p>
                </div>
              ))}
            </div>
          </Card>
        </section>
      </div>
      {detail && <OperationalDetails kind={detail} operations={operations} onClose={() => setDetail(null)} />}
    </AppShell>
  );
}
