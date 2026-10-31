import { GuestEscalationCount } from '@/components/GuestHandoffs';
import { useReadiness } from '@/lib/useReadiness';
import { useState } from 'react';
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
  TriangleAlert,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ActivityFeed } from "@/components/ActivityFeed";
import { Briefing } from "@/components/Briefing";
import type { BriefLine } from "@/components/Briefing";
import { TaskRow } from "@/components/TaskRow";
import { Badge, Button, Card, Empty, Eyebrow, SectionTitle, StatCard, statusTone } from "@/components/ui";
import { useCurrentUser } from "@/lib/session";
import { selectors, useApp } from "@/lib/store";
import { greeting } from "@/lib/utils";

export const Route = createFileRoute("/front-office/")({
  component: FrontOfficeDashboard,
});

function FrontOfficeDashboard() {
  const user = useCurrentUser();
  const operations = useOperations();
  const readiness = useReadiness();
  const [detail, setDetail] = useState<'vip' | 'departure_bills' | null>(null);
  const navigate = useNavigate();
  const escalations = useApp(selectors.escalations);
  const tasks = useApp((s) => s.tasks);
  const rooms = useApp((s) => s.rooms);
  const conversations = useApp((s) => s.conversations);
  const guestRequests = useApp(selectors.guestRequests);

  const myTasks = tasks
    .filter((t) => t.source !== "Daily report" && t.status !== "Completed" && (t.department === "Front Office" || t.department === "VIP" || t.department === "Billing"))
    .slice(0, 6);
  const readyRooms = readiness.error ? [] : readiness.rooms.filter(r => r.ready);
  const arrivalsWaiting = rooms.filter(r => r.arrivalTime && !readyRooms.some(ready => ready.number === r.number));
  const aiHandling = conversations.filter((c) => c.aiStatus === "ai-handling").length;

  const arrivalsCount = rooms.filter((r) => r.arrivalTime).length;
  const departuresCount = rooms.filter((r) => r.guestStatus === "Departed" || r.guestStatus === "Departing").length;
  const vipSource = operations.data?.sources.find(s => s.kind === 'vip');
  const vipArrivalsCount = vipSource?.status === 'complete' && !vipSource.stale ? operations.data?.vips.length ?? 0 : 0;
  const balanceSource = operations.data?.sources.find(s => s.kind === 'departure_bills');
  const balanceCount = operations.data?.tasks.filter(t => t.department === 'Billing' && t.status !== 'Completed').length ?? 0;
  const vipReady = vipSource?.status === 'complete' && !vipSource.stale && !vipSource.latestRunFailed && !operations.error;
  const balancesReady = balanceSource?.status === 'complete' && !balanceSource.stale && !balanceSource.latestRunFailed && !operations.error;
  const earlyCheckInsCount = rooms.filter((r) => r.earlyCheckIn).length;
  const totalMessages = conversations.reduce((acc, c) => acc + (c.messages?.length || 0), 0);

  const lines: BriefLine[] = [
    {
      text: readiness.error || readiness.loading ? "Room readiness is not yet confirmed. Open Room readiness before allocating a room." : `${arrivalsCount} arrivals scheduled today. ${readyRooms.length} rooms are released and ${arrivalsWaiting.length} arrivals are currently waiting on housekeeping.`,
      tone: arrivalsWaiting.length > 0 ? "attend" : "good",
    },
    {
      text: `${totalMessages} messages recorded so far and is holding ${aiHandling} conversations without requiring manual input.`,
      tone: "ai",
    },
    {
      text: `${escalations.length} conversation${escalations.length === 1 ? "" : "s"} currently escalated to the team.${escalations[0]?.escalation?.reason ? ` — ${escalations[0].escalation.reason}` : ""}`,
      tone: escalations.length > 0 ? "urgent" : "good",
    },
    {
      text: readiness.error || readiness.loading ? "Inspection and release approvals are loading or unavailable." : `${readyRooms.length} out of ${rooms.length} total rooms have current inspection and Front Office release approval.`,
      tone: "good",
    },
  ];

  const briefOpening =
    arrivalsWaiting.length > 0
      ? `${arrivalsWaiting.length} arrival${arrivalsWaiting.length === 1 ? " is" : "s are"} waiting on housekeeping; ${readyRooms.length} rooms are released and ready for check-in.`
      : "No arrivals are currently flagged as waiting in the room feed. Review housekeeping completion and inspection status before releasing rooms.";

  return (
    <AppShell title="Front office — your shift, prepared">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>{greeting()}, {user?.name.split(" ")[0]}</Eyebrow>
            <h1 className="mt-1.5 font-display text-[27px] leading-tight font-medium text-ink sm:text-[30px]">
              You are ahead of the desk today.
            </h1>
            <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
              Review the current guest conversations, VIP preparations and departure follow-ups.
            </p>
          </div>
          <Button variant="outline" icon={Archive} onClick={() => navigate({ to: "/front-office/lost-found" })}>Lost &amp; Found</Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Arrivals" value={arrivalsCount} hint={`${earlyCheckInsCount} early`} icon={LogIn} tone="pine" delay={0} />
          <StatCard label="Departures" value={departuresCount} hint="late checkouts monitored" icon={LogOut} tone="mute" delay={40} />
          <StatCard label="Rooms ready" value={readiness.error || readiness.loading ? "?" : `${readyRooms.length}/${readiness.rooms.length}`} onClick={() => navigate({ to: "/front-office/rooms" })} hint="Inspect restrictions and release approvals" icon={BedDouble} tone="attend" delay={80} />
          <StatCard label="Open requests" value={guestRequests.length} hint="in-house guests" icon={MessageSquare} tone="ai" delay={120} />
          <StatCard label="VIPs" value={vipReady ? vipArrivalsCount : '—'} hint="View VIP guests" icon={Crown} tone="pine" delay={160} onClick={() => setDetail('vip')} />
          <StatCard label="Departure balances" value={balancesReady ? balanceCount : '—'} hint="Problems to review" icon={TriangleAlert} tone="attend" delay={180} emphasis={balancesReady && balanceCount > 0} onClick={() => setDetail('departure_bills')} />
          <GuestEscalationCount count={escalations.length}>{count => <StatCard
            label="Escalated"
            value={count}
            hint="need a person"
            icon={TriangleAlert}
            tone="urgent"
            emphasis={escalations.length > 0}
            delay={200}
            onClick={() => navigate({ to: "/front-office/conversations", search: { filter: "escalated" } })}
          />}</GuestEscalationCount>
        </div>

        <Briefing
          eyebrow="AI front office brief"
          opening={briefOpening}
          lines={lines}
          action={
            <Button icon={ArrowRight} onClick={() => navigate({ to: "/front-office/conversations" })}>
              Open conversations
            </Button>
          }
          footnote="Updated continuously from guest messages, housekeeping and maintenance replies on WhatsApp, and your PMS."
        />

        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr] lg:items-start">
          <section>
            <SectionTitle
              title="Priority tasks"
              hint="Yours first — housekeeping and maintenance have their own lists"
              action={
                <Button size="sm" variant="outline" onClick={() => navigate({ to: "/front-office/tasks" })}>
                  All tasks
                </Button>
              }
            />
            <Card pad={false}>
              {myTasks.length === 0 ? (
                <div className="p-4">
                  <Empty title="Nothing waiting on you" hint="The AI will put anything new here." icon={ClipboardList} />
                </div>
              ) : (
                <ul>
                  {myTasks.map((t) => (
                    <TaskRow key={t.id} task={t} showDepartment={false} />
                  ))}
                </ul>
              )}
            </Card>

            <SectionTitle className="mt-6" title="Arrivals waiting on a room" hint="Live from housekeeping's WhatsApp updates" />
            <Card pad={false}>
              <ul>
                {rooms
                  .filter((r) => r.arrivalTime)
                  .sort((a, b) => (a.arrivalTime ?? "").localeCompare(b.arrivalTime ?? ""))
                  .map((r) => (
                    <li key={r.number} className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
                      <span className="tnum inline-flex h-7 min-w-11 items-center justify-center rounded-[7px] border border-line bg-paper-2 font-mono text-[12px] font-medium text-ink-2">
                        {r.number}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink">
                          Arrival {r.arrivalTime}
                          {r.vip && <span className="ml-1.5 text-[11px] text-pine-600">VIP</span>}
                        </p>
                        <p className="text-[11.5px] text-ink-4">
                          {r.cleaningType} · {r.cleaner ?? "unassigned"} · updated {r.updatedAt}
                        </p>
                      </div>
                      <Badge tone={statusTone(r.status)} dot>
                        {readiness.rooms.find(room => room.number === r.number)?.releaseStatus || "Readiness not confirmed"}
                      </Badge>
                    </li>
                  ))}
              </ul>
            </Card>
          </section>

          <section>
            <SectionTitle title="Recent AI activity" hint="What was handled without you" />
            <Card>
              <ActivityFeed limit={14} compact />
            </Card>

            <Card className="mt-4">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-ai" />
                <Eyebrow>Handover note</Eyebrow>
              </span>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
                Review current escalations, departure balance follow-ups and task notes before taking over this shift.
              </p>
            </Card>
          </section>
        </div>
      </div>
      {detail && <OperationalDetails kind={detail} operations={operations} onClose={() => setDetail(null)} />}
    </AppShell>
  );
}
