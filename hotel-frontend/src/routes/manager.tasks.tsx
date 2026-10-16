import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TaskComposer } from "@/components/TaskComposer";
import { TaskRow } from "@/components/TaskRow";
import { Badge, Button, Card, Empty, Eyebrow, SectionTitle, StatCard } from "@/components/ui";
import { useApp } from "@/lib/store";
import type { Department, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/manager/tasks")({
  component: ManagerTasks,
});

const departments: (Department | "All")[] = [
  "All",
  "Front Office",
  "Housekeeping",
  "Maintenance",
  "Guest Request",
  "VIP",
  "Billing",
  "Follow-up",
];

const statuses: (TaskStatus | "Open")[] = ["Open", "New", "Assigned", "In Progress", "Waiting", "Escalated", "Completed"];

function ManagerTasks() {
  const tasks = useApp((s) => s.tasks);
  const [department, setDepartment] = useState<Department | "All">("All");
  const [status, setStatus] = useState<TaskStatus | "Open">("Open");
  const [composer, setComposer] = useState(false);

  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        const byDepartment = department === "All" || t.department === department;
        const byStatus = status === "Open" ? t.status !== "Completed" : t.status === status;
        return byDepartment && byStatus;
      }),
    [tasks, department, status],
  );

  const open = tasks.filter((t) => t.status !== "Completed");
  const escalated = tasks.filter((t) => t.status === "Escalated");
  const fromGuests = tasks.filter((t) => t.source === "Guest WhatsApp" || t.source === "Guest Email");
  const fromAi = tasks.filter((t) => t.source === "AI Detection" || t.source === "PMS event");

  return (
    <AppShell title="Everything the hotel owes a guest today" wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Tasks</Eyebrow>
            <h1 className="mt-1.5 font-display text-[26px] leading-tight font-medium text-ink">One list across every department</h1>
            <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
              Most of these were created by the AI from a guest message. Department updates arrive back from WhatsApp.
            </p>
          </div>
          <Button icon={Plus} onClick={() => setComposer(true)}>
            New task
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Open" value={open.length} hint="not yet completed" tone="attend" delay={0} />
          <StatCard label="Escalated" value={escalated.length} hint="waiting on a decision" tone="urgent" emphasis={escalated.length > 0} delay={40} />
          <StatCard label="From guests" value={fromGuests.length} hint="WhatsApp and email" tone="pine" delay={80} />
          <StatCard label="Created by AI" value={fromAi.length} hint="intent detection and PMS events" tone="ai" delay={120} />
        </div>

        <div className="space-y-2">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {departments.map((d) => (
              <button
                key={d}
                onClick={() => setDepartment(d)}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                  d === department ? "border-pine-600 bg-pine-600 text-white" : "border-line bg-surface text-ink-3 hover:border-ink-4 hover:text-ink",
                )}
              >
                {d}
                <span className="tnum ml-1.5 font-mono text-[10.5px] opacity-70">
                  {d === "All" ? tasks.length : tasks.filter((t) => t.department === d).length}
                </span>
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {statuses.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
                  s === status ? "bg-paper-2 text-ink" : "text-ink-4 hover:text-ink",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <Card pad={false}>
          {filtered.length === 0 ? (
            <div className="p-4">
              <Empty title="No tasks in this view" hint="Change the filters, or create one and send it straight to a phone." icon={ClipboardList} />
            </div>
          ) : (
            <ul>
              {filtered.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </ul>
          )}
        </Card>

        <section>
          <SectionTitle title="Where work comes from" hint="Sources the AI turns into tasks automatically" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { source: "Guest WhatsApp", note: "Requests detected in the guest's own words" },
              { source: "Guest Email", note: "Gmail, Outlook and your own mailbox" },
              { source: "AI Detection", note: "Follow-ups the AI decides are needed" },
              { source: "PMS event", note: "Arrivals, VIP flags, failed authorisations" },
            ].map((s) => (
              <Card key={s.source} className="p-4">
                <Badge tone="ai">{s.source}</Badge>
                <p className="tnum mt-2 font-display text-[22px] leading-none font-medium text-ink">
                  {tasks.filter((t) => t.source === s.source).length}
                </p>
                <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{s.note}</p>
              </Card>
            ))}
          </div>
        </section>
      </div>

      <TaskComposer open={composer} onClose={() => setComposer(false)} source="Manager" />
    </AppShell>
  );
}
