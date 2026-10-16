import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, ClipboardList, MessageCircle, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TaskComposer } from "@/components/TaskComposer";
import { TaskRow } from "@/components/TaskRow";
import { Badge, Button, Card, Empty, Eyebrow, SectionTitle, StatCard } from "@/components/ui";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/front-office/tasks")({
  component: FrontOfficeTasks,
});

const views = ["Mine", "All open", "From guests", "Completed today"] as const;
type View = (typeof views)[number];

function FrontOfficeTasks() {
  const tasks = useApp((s) => s.tasks);
  const [view, setView] = useState<View>("Mine");
  const [composer, setComposer] = useState(false);

  const list = useMemo(() => {
    switch (view) {
      case "Mine":
        return tasks.filter(
          (t) => t.status !== "Completed" && ["Front Office", "VIP", "Billing", "Follow-up", "Guest Request"].includes(t.department),
        );
      case "All open":
        return tasks.filter((t) => t.status !== "Completed");
      case "From guests":
        return tasks.filter((t) => t.source === "Guest WhatsApp" || t.source === "Guest Email");
      case "Completed today":
        return tasks.filter((t) => t.status === "Completed");
    }
  }, [tasks, view]);

  const updatesBack = tasks
    .filter((t) => t.trail.some((entry) => entry.via === "whatsapp") && (t.department === "Housekeeping" || t.department === "Maintenance"))
    .slice(0, 6);

  return (
    <AppShell title="Tasks — yours, and what other departments finished">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Tasks</Eyebrow>
            <h1 className="mt-1.5 font-display text-[26px] leading-tight font-medium text-ink">What the desk owes guests today</h1>
            <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
              Created mostly by the AI from guest messages. When housekeeping or maintenance finish something on WhatsApp, it
              lands here and the guest is told automatically.
            </p>
          </div>
          <Button icon={Plus} onClick={() => setComposer(true)}>
            New task
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Open for the desk" value={tasks.filter((t) => t.status !== "Completed" && t.department === "Front Office").length} tone="attend" delay={0} />
          <StatCard label="VIP preparation" value={tasks.filter((t) => t.department === "VIP" && t.status !== "Completed").length} tone="pine" delay={40} />
          <StatCard label="Waiting on someone else" value={tasks.filter((t) => t.status === "Waiting").length} tone="mute" delay={80} />
          <StatCard label="Completed today" value={tasks.filter((t) => t.status === "Completed").length} icon={CheckCircle2} tone="good" delay={120} />
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
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
              <Empty title="Nothing in this view" hint="Try another filter." icon={ClipboardList} />
            </div>
          ) : (
            <ul>
              {list.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </ul>
          )}
        </Card>

        <section>
          <SectionTitle title="Status updates coming back to you" hint="Straight from housekeeping and maintenance phones" />
          <Card pad={false}>
            <ul>
              {updatesBack.map((t) => {
                const last = t.trail[t.trail.length - 1];
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
                    <span className="tnum inline-flex h-7 min-w-11 items-center justify-center rounded-[7px] border border-line bg-paper-2 font-mono text-[12px] font-medium text-ink-2">
                      {t.room ?? "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">
                        {t.title}
                        {t.guest && <span className="ml-1.5 text-[11.5px] font-normal text-ink-4">{t.guest}</span>}
                      </p>
                      <p className="tnum mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
                        <MessageCircle className="size-3 text-wa" />
                        {last.at} — <span className="font-sans">{last.text}</span>
                      </p>
                    </div>
                    <Badge tone={t.status === "Completed" ? "good" : "attend"} dot>
                      {t.status}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
          <p className="mt-2 text-[11.5px] leading-snug text-ink-4">
            Example: "Room 401 early arrival 13:00" was closed by Maria at 12:26 from her phone. The guest was told the room was
            ready without anyone at the desk typing a word.
          </p>
        </section>
      </div>

      <TaskComposer open={composer} onClose={() => setComposer(false)} source="Front Office" />
    </AppShell>
  );
}
