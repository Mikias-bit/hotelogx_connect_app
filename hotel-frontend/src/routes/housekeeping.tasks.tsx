import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList, MessageCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TaskComposer } from "@/components/TaskComposer";
import { TaskRow } from "@/components/TaskRow";
import { Button, Card, Empty, Eyebrow, SectionTitle, StatCard } from "@/components/ui";
import { assignTask, selectors, useApp } from "@/lib/store";

export const Route = createFileRoute("/housekeeping/tasks")({
  component: HousekeepingTasks,
});

function HousekeepingTasks() {
  const tasks = useApp((s) => s.tasks.filter((t) => t.department === "Housekeeping"));
  const teamCleaners = useApp(selectors.housekeepingTeam);
  const [composer, setComposer] = useState(false);
  const open = tasks.filter((t) => t.status !== "Completed");
  const unassigned = open.filter((t) => !t.assignee);

  return (
    <AppShell title="Housekeeping tasks">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Tasks</Eyebrow>
            <h1 className="mt-1.5 font-display text-[26px] leading-tight font-medium text-ink">Guest requests, routed to a floor</h1>
            <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
              Towels, cots, extra pillows and turndowns arrive here the moment a guest asks — in any language, on any channel.
            </p>
          </div>
          <Button icon={ClipboardList} onClick={() => setComposer(true)}>
            New task
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Open" value={open.length} tone="attend" delay={0} />
          <StatCard label="Unassigned" value={unassigned.length} hint="nobody has it yet" tone="urgent" emphasis={unassigned.length > 0} delay={40} />
          <StatCard label="Completed" value={tasks.filter((t) => t.status === "Completed").length} tone="good" delay={80} />
          <StatCard label="From guests" value={tasks.filter((t) => t.source.startsWith("Guest")).length} tone="pine" delay={120} />
        </div>

        <Card pad={false}>
          {tasks.length === 0 ? (
            <div className="p-4">
              <Empty title="Nothing for housekeeping" hint="New requests appear here automatically." />
            </div>
          ) : (
            <ul>
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} showDepartment={false} />
              ))}
            </ul>
          )}
        </Card>

        {unassigned.length > 0 && (
          <section>
            <SectionTitle title="Send to a phone" hint="Assigning delivers an interactive WhatsApp card" />
            <div className="space-y-3">
              {unassigned.map((t) => (
                <Card key={t.id} className="p-4">
                  <p className="text-[13.5px] font-medium text-ink">
                    {t.title}
                    {t.room && <span className="tnum ml-2 font-mono text-[12px] text-ink-4">{t.room}</span>}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {teamCleaners.map((c) => (
                      <Button key={c} size="sm" variant="outline" icon={MessageCircle} onClick={() => assignTask(t.id, c)}>
                        {c.split(" ")[0]}
                      </Button>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>

      <TaskComposer open={composer} onClose={() => setComposer(false)} source="Housekeeping" defaults={{ department: "Housekeeping" }} />
    </AppShell>
  );
}
