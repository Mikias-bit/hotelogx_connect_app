import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList, MessageCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TaskComposer } from "@/components/TaskComposer";
import { TaskRow } from "@/components/TaskRow";
import { Button, Card, Empty, Eyebrow, SectionTitle, StatCard } from "@/components/ui";
import { useApp } from "@/lib/store";
import { useCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/maintenance/tasks")({
  component: MaintenanceTasks,
});

type View = "Mine" | "Open" | "Completed" | "All";
const views: View[] = ["Mine", "Open", "Completed", "All"];

function MaintenanceTasks() {
  const user = useCurrentUser();
  const tasks = useApp((s) => s.tasks.filter((t) => t.department === "Maintenance"));
  const issues = useApp((s) => s.issues);
  const [view, setView] = useState<View>("Open");
  const [composer, setComposer] = useState(false);

  const list = tasks.filter((t) => {
    if (view === "All") return true;
    if (view === "Mine") return t.assignee === user?.name && t.status !== "Completed";
    if (view === "Completed") return t.status === "Completed";
    return t.status !== "Completed";
  });

  const trail = issues
    .flatMap((i) => i.updates.filter((u) => u.via === "whatsapp").map((u) => ({ ...u, id: i.id, room: i.room })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  return (
    <AppShell title="Maintenance tasks">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Tasks</Eyebrow>
            <h1 className="mt-1.5 font-display text-[26px] leading-tight font-medium text-ink">Parts, checks and follow-ups</h1>
            <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
              Anything that is not a room fault but still needs doing — ordering parts, booking an external technician, rechecking a repair.
            </p>
          </div>
          <Button icon={ClipboardList} onClick={() => setComposer(true)}>
            New task
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Assigned to me" value={tasks.filter((t) => t.assignee === user?.name && t.status !== "Completed").length} tone="pine" delay={0} />
          <StatCard label="Open" value={tasks.filter((t) => t.status !== "Completed").length} tone="attend" delay={40} />
          <StatCard label="Waiting" value={tasks.filter((t) => t.status === "Waiting").length} hint="parts or third parties" tone="ai" delay={80} />
          <StatCard label="Completed" value={tasks.filter((t) => t.status === "Completed").length} tone="good" delay={120} />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                v === view ? "border-pine-600 bg-pine-600 text-white" : "border-line bg-surface text-ink-3 hover:border-ink-4 hover:text-ink",
              )}
            >
              {v}
            </button>
          ))}
        </div>

        <Card pad={false}>
          {list.length === 0 ? (
            <div className="p-4">
              <Empty title="Nothing in this view" hint="Try another filter." />
            </div>
          ) : (
            <ul>
              {list.map((t) => (
                <TaskRow key={t.id} task={t} showDepartment={false} />
              ))}
            </ul>
          )}
        </Card>

        {trail.length > 0 && (
          <section>
            <SectionTitle title="Reported from WhatsApp" hint="what you and the team sent in today" />
            <Card pad={false}>
              <ul>
                {trail.map((u, i) => (
                  <li key={`${u.id}-${i}`} className="flex items-start gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
                    <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-wa" />
                    <div className="min-w-0">
                      <p className="text-[13px] leading-snug text-ink-2">{u.text}</p>
                      <p className="tnum mt-1 font-mono text-[11px] text-ink-4">
                        {u.at} · {u.id} · Room {u.room}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}
      </div>

      <TaskComposer open={composer} onClose={() => setComposer(false)} source="AI Detection" defaults={{ department: "Maintenance" }} />
    </AppShell>
  );
}
