import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Wrench, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { IssueCard } from "@/components/IssueCard";
import { Button, Card, Empty, Eyebrow, SectionTitle } from "@/components/ui";
import { createIssue, useApp } from "@/lib/store";
import { useCurrentUser } from "@/lib/session";
import type { Issue, Priority } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/maintenance/issues")({
  component: MaintenanceIssues,
});

type View = "Open" | "Mine" | "Urgent" | "Waiting Parts" | "Completed" | "All";
const views: View[] = ["Open", "Mine", "Urgent", "Waiting Parts", "Completed", "All"];

function MaintenanceIssues() {
  const user = useCurrentUser();
  const issues = useApp((s) => s.issues);
  const rooms = useApp((s) => s.rooms);
  const [view, setView] = useState<View>("Open");
  const [composer, setComposer] = useState(false);

  const list = useMemo(() => {
    const match = (i: Issue) => {
      if (view === "All") return true;
      if (view === "Mine") return i.assignee === user?.name && i.status !== "Completed";
      if (view === "Urgent") return i.priority === "Urgent" && i.status !== "Completed";
      if (view === "Waiting Parts") return i.status === "Waiting Parts";
      if (view === "Completed") return i.status === "Completed";
      return i.status !== "Completed";
    };
    return issues.filter(match);
  }, [issues, view, user]);

  const count = (v: View) =>
    issues.filter((i) => {
      if (v === "All") return true;
      if (v === "Mine") return i.assignee === user?.name && i.status !== "Completed";
      if (v === "Urgent") return i.priority === "Urgent" && i.status !== "Completed";
      if (v === "Waiting Parts") return i.status === "Waiting Parts";
      if (v === "Completed") return i.status === "Completed";
      return i.status !== "Completed";
    }).length;

  return (
    <AppShell title="Issues">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Issue log</Eyebrow>
            <h1 className="mt-1.5 font-display text-[26px] leading-tight font-medium text-ink">Every ticket, and where it came from</h1>
            <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
              Guests report through WhatsApp or email, housekeeping reports with a button, the AI opens the ticket and picks the department.
            </p>
          </div>
          <Button icon={Plus} onClick={() => setComposer(true)}>
            Report issue
          </Button>
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
              <span className="tnum ml-1.5 font-mono text-[10.5px] opacity-70">{count(v)}</span>
            </button>
          ))}
        </div>

        {list.length === 0 ? (
          <Empty title="Nothing here" hint="Try another view." icon={Wrench} />
        ) : (
          <div className="space-y-3">
            {list.map((i) => (
              <IssueCard key={i.id} issue={i} />
            ))}
          </div>
        )}

        <section>
          <SectionTitle title="How a ticket travels" hint="the same flow whether it starts with a guest or a cleaner" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { step: "01", title: "Reported", body: "Guest message, or a housekeeper tapping “Maintenance Required” on the room card." },
              { step: "02", title: "Ticket opened", body: "The AI writes the ticket, sets urgency and sends it to the technical WhatsApp group." },
              { step: "03", title: "Worked", body: "Accept · Unable to handle · Parts required · External technician — all buttons, no typing." },
              { step: "04", title: "Closed", body: "The room goes back to housekeeping for a recheck and the guest is told it is fixed." },
            ].map((s) => (
              <Card key={s.step}>
                <span className="tnum font-mono text-[11px] font-medium text-pine-600">{s.step}</span>
                <p className="mt-1.5 text-[13.5px] font-medium text-ink">{s.title}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{s.body}</p>
              </Card>
            ))}
          </div>
        </section>
      </div>

      {composer && (
        <IssueComposer
          rooms={rooms.map((r) => r.number)}
          reporter={user?.name ?? "Maintenance"}
          onClose={() => setComposer(false)}
        />
      )}
    </AppShell>
  );
}

function IssueComposer({ rooms, reporter, onClose }: { rooms: string[]; reporter: string; onClose: () => void }) {
  const [room, setRoom] = useState(rooms[0] ?? "");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [priority, setPriority] = useState<Priority>("Normal");

  const field = "mt-1 w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-pine-400";
  const label = "block text-[11.5px] font-medium text-ink-3";

  return (
    <div className="fixed inset-0 z-60 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button className="absolute inset-0 bg-ink/25" onClick={onClose} aria-label="Close" />
      <div className="rise relative w-full max-w-[500px] rounded-t-card border border-line bg-surface p-5 sm:rounded-card">
        <div className="flex items-start justify-between">
          <div>
            <Eyebrow>New issue</Eyebrow>
            <p className="mt-1 font-display text-[19px] font-medium text-ink">Open a maintenance ticket</p>
          </div>
          <button onClick={onClose} className="text-ink-4 transition-colors hover:text-ink">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className={label}>What is wrong</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Radiator not heating" className={field} />
          </label>
          <label className="block">
            <span className={label}>Detail</span>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} className={cn(field, "resize-none")} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>Room</span>
              <select value={room} onChange={(e) => setRoom(e.target.value)} className={field}>
                {rooms.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>Urgency</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={field}>
                {(["Urgent", "High", "Normal", "Low"] as Priority[]).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink-4">
            Urgent tickets mark the room out of service and warn front office straight away.
          </p>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim()}
            onClick={() => {
              createIssue({
                room,
                title: title.trim(),
                detail: detail.trim() || undefined,
                priority,
                reportedBy: reporter,
                via: "Dashboard",
              });
              onClose();
            }}
          >
            Open ticket
          </Button>
        </div>
      </div>
    </div>
  );
}
