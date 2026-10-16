import { createFileRoute } from "@tanstack/react-router";
import { AlertOctagon, CheckCircle2, ClipboardList, DoorClosed, Timer, Wrench } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Briefing } from "@/components/Briefing";
import { IssueCard } from "@/components/IssueCard";
import { WhatsAppOps } from "@/components/WhatsAppOps";
import { Badge, Button, Card, Empty, Eyebrow, SectionTitle, StatCard } from "@/components/ui";
import { technicians } from "@/lib/data";
import { useApp } from "@/lib/store";
import { useCurrentUser } from "@/lib/session";
import { greeting } from "@/lib/utils";

export const Route = createFileRoute("/maintenance/")({
  component: MaintenanceDashboard,
});

function MaintenanceDashboard() {
  const user = useCurrentUser();
  const issues = useApp((s) => s.issues);
  const tasks = useApp((s) => s.tasks.filter((t) => t.department === "Maintenance"));

  const open = issues.filter((i) => i.status !== "Completed");
  const urgent = open.filter((i) => i.priority === "Urgent");
  const inProgress = issues.filter((i) => i.status === "In Progress" || i.status === "Accepted");
  const completed = issues.filter((i) => i.status === "Completed");
  const oos = issues.filter((i) => i.outOfService && i.status !== "Completed");
  const waitingParts = open.filter((i) => i.status === "Waiting Parts");

  const mine = open.filter((i) => i.assignee === user?.name);
  const active = [...open].sort((a, b) => {
    const rank = { Urgent: 0, High: 1, Normal: 2, Low: 3 } as const;
    return rank[a.priority] - rank[b.priority] || a.createdAt.localeCompare(b.createdAt);
  });

  return (
    <AppShell title="Maintenance" wide>
      <div className="space-y-5">
        <div>
          <Eyebrow>Technical department</Eyebrow>
          <h1 className="mt-1.5 font-display text-[26px] leading-tight font-medium text-ink">
            {greeting()}, {user?.name.split(" ")[0] ?? "team"}
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
            {mine.length > 0
              ? `${mine.length} ${mine.length === 1 ? "ticket" : "tickets"} assigned to you. `
              : "Nothing assigned to you right now. "}
            Everything below can also be worked from WhatsApp.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Open issues" value={open.length} icon={Wrench} tone="attend" delay={0} />
          <StatCard
            label="Urgent"
            value={urgent.length}
            hint={urgent.length > 0 ? urgent.map((i) => i.room).join(", ") : "none right now"}
            icon={AlertOctagon}
            tone="urgent"
            emphasis={urgent.length > 0}
            delay={40}
          />
          <StatCard label="In progress" value={inProgress.length} icon={Timer} tone="ai" delay={80} />
          <StatCard label="Completed today" value={completed.length} icon={CheckCircle2} tone="good" delay={120} />
          <StatCard
            label="Rooms out of service"
            value={oos.length}
            hint={oos.length > 0 ? oos.map((i) => i.room).join(", ") : "all sellable"}
            icon={DoorClosed}
            tone={oos.length > 0 ? "urgent" : "good"}
            delay={160}
          />
        </div>

        <Briefing
          eyebrow="AI maintenance brief"
          opening={
            urgent.length > 0
              ? `${urgent[0].room} is the one that decides today — ${urgent[0].title.toLowerCase()}.`
              : "Nothing urgent open. Good morning to clear the small ones."
          }
          lines={[
            ...urgent.map((i) => ({
              text: `${i.id} · Room ${i.room} — ${i.title}. ${i.outOfService ? "Room is blocked until you release it." : "Guest is in-house."}`,
              tone: "urgent" as const,
              meta: i.assignee ?? "unassigned",
            })),
            ...waitingParts.map((i) => ({
              text: `${i.id} · Room ${i.room} waiting on parts. Front office has been told the room stays out.`,
              tone: "attend" as const,
              meta: "waiting parts",
            })),
            {
              text: `${issues.filter((i) => i.via.startsWith("Housekeeping")).length} of today's tickets came straight from housekeeping's WhatsApp buttons — no phone calls needed.`,
              tone: "ai",
              meta: "auto-routed",
            },
            {
              text: "Completing a ticket sends the room back to housekeeping for a recheck and tells the guest their issue is fixed.",
              tone: "pine",
              meta: "automatic",
            },
          ]}
          footnote="Written from live tickets, room status and guest conversations."
          action={
            <Button variant="outline" onClick={() => document.getElementById("active-issues")?.scrollIntoView({ behavior: "smooth" })}>
              View details
            </Button>
          }
        />

        <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
          <div className="space-y-5">
            <section id="active-issues">
              <SectionTitle title="Active issues" hint={`${open.length} open · sorted by urgency`} />
              {active.length === 0 ? (
                <Empty title="No open issues" hint="Enjoy it while it lasts." icon={CheckCircle2} />
              ) : (
                <div className="space-y-3">
                  {active.map((i) => (
                    <IssueCard key={i.id} issue={i} />
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionTitle title="Technicians" hint="who is carrying what" />
              <div className="grid gap-3 sm:grid-cols-2">
                {technicians.map((t) => {
                  const load = open.filter((i) => i.assignee === t);
                  return (
                    <Card key={t}>
                      <div className="flex items-center justify-between">
                        <p className="text-[13.5px] font-medium text-ink">{t}</p>
                        <Badge tone={load.length > 1 ? "attend" : "good"}>{load.length} open</Badge>
                      </div>
                      <ul className="mt-2.5 space-y-1.5">
                        {load.length === 0 && <li className="text-[12.5px] text-ink-4">Free — send the next ticket here.</li>}
                        {load.map((i) => (
                          <li key={i.id} className="flex items-center gap-2 text-[12.5px] text-ink-2">
                            <span className="tnum font-mono text-[11px] text-ink-4">{i.room}</span>
                            <span className="truncate">{i.title}</span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  );
                })}
              </div>
            </section>

            {tasks.filter((t) => t.status !== "Completed").length > 0 && (
              <section>
                <SectionTitle
                  title="Related tasks"
                  hint="parts, follow-ups and checks"
                  action={
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-4">
                      <ClipboardList className="size-3.5" /> {tasks.filter((t) => t.status !== "Completed").length} open
                    </span>
                  }
                />
                <Card pad={false}>
                  <ul>
                    {tasks
                      .filter((t) => t.status !== "Completed")
                      .map((t) => (
                        <li key={t.id} className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
                          <span className="tnum w-10 shrink-0 font-mono text-[12px] text-ink-4">{t.room ?? "—"}</span>
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{t.title}</span>
                          <Badge tone="mute">{t.status}</Badge>
                        </li>
                      ))}
                  </ul>
                </Card>
              </section>
            )}
          </div>

          <Card className="lg:sticky lg:top-20 lg:h-[calc(100dvh-8rem)]">
            <WhatsAppOps department="Maintenance" />
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
