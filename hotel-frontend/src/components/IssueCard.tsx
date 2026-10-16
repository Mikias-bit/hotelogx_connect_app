import { useState } from "react";
import { AlertTriangle, ArrowUpRight, DoorClosed, MessageCircle, Wrench } from "lucide-react";
import { assignIssue, setIssueStatus, useApp } from "@/lib/store";
import { technicians } from "@/lib/data";
import type { Issue } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, priorityTone, statusTone } from "./ui";

export function IssueCard({ issue, compact }: { issue: Issue; compact?: boolean }) {
  const users = useApp((s) => s.users);
  const [note, setNote] = useState("");
  const [noting, setNoting] = useState(false);
  const done = issue.status === "Completed";
  const mtUsers = users.filter((u) => u.role === "maintenance").map((u) => u.name);
  const techOptions = mtUsers.length > 0 ? mtUsers : technicians;

  return (
    <Card pad={false} className={cn("overflow-hidden", issue.priority === "Urgent" && !done && "border-urgent/25")}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tnum font-mono text-[11.5px] font-medium text-ink-4">{issue.id}</span>
            <span className="tnum rounded-md bg-paper-2 px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-ink-2">
              Room {issue.room}
            </span>
            <Badge tone={priorityTone(issue.priority)} dot>
              {issue.priority}
            </Badge>
            <Badge tone={statusTone(issue.status)}>{issue.status}</Badge>
            {issue.outOfService && (
              <span className="inline-flex items-center gap-1 rounded-full bg-urgent-bg px-2 py-0.5 text-[11px] font-medium text-urgent">
                <DoorClosed className="size-3" /> Out of service
              </span>
            )}
          </div>
          <p className="mt-2 text-[14.5px] leading-snug font-medium text-ink">{issue.title}</p>
          {issue.detail && !compact && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-3">{issue.detail}</p>}
          <p className="tnum mt-2 font-mono text-[11px] text-ink-4">
            {issue.createdAt} · {issue.reportedBy} · {issue.via}
            {issue.assignee ? ` · ${issue.assignee}` : " · unassigned"}
          </p>
        </div>
        <Wrench className={cn("size-4 shrink-0", done ? "text-good" : issue.priority === "Urgent" ? "text-urgent" : "text-ink-4")} />
      </div>

      {issue.updates.length > 0 && !compact && (
        <ul className="border-t border-line-soft bg-paper/50 px-4 py-3">
          {issue.updates.map((u, i) => (
            <li key={`${u.at}-${i}`} className="flex items-start gap-2.5 py-1">
              <span className="tnum mt-px w-9 shrink-0 font-mono text-[10.5px] text-ink-4">{u.at}</span>
              {u.via === "whatsapp" ? (
                <MessageCircle className="mt-0.5 size-3 shrink-0 text-wa" />
              ) : (
                <span className="mt-[6px] size-1.5 shrink-0 rounded-full bg-ink-4/50" />
              )}
              <span className="text-[12.5px] leading-snug text-ink-2">{u.text}</span>
            </li>
          ))}
        </ul>
      )}

      {!done && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-3">
          {issue.status === "Open" && (
            <Button size="sm" onClick={() => setIssueStatus(issue.id, "Accepted")}>
              Accept
            </Button>
          )}
          {(issue.status === "Accepted" || issue.status === "Waiting Parts") && (
            <Button size="sm" onClick={() => setIssueStatus(issue.id, "In Progress")}>
              Start work
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setNoting((v) => !v)}>
            Update
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIssueStatus(issue.id, "Waiting Parts")}>
            Parts required
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setIssueStatus(issue.id, "Completed")}>
            Complete
          </Button>
          <Button size="sm" variant="ghost" icon={ArrowUpRight} onClick={() => setIssueStatus(issue.id, "Escalated")}>
            Escalate
          </Button>
          {!issue.assignee && (
            <span className="ml-auto flex items-center gap-1.5">
              <AlertTriangle className="size-3 text-attend" />
              {techOptions.map((t) => (
                <Button key={t} size="sm" variant="outline" onClick={() => assignIssue(issue.id, t)}>
                  {t.split(" ")[0]}
                </Button>
              ))}
            </span>
          )}
        </div>
      )}

      {noting && !done && (
        <div className="border-t border-line-soft p-4">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Capacitor replaced, testing for 20 minutes before releasing the room…"
            className="w-full resize-none rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine-400"
          />
          <div className="mt-2 flex gap-1.5">
            <Button
              size="sm"
              onClick={() => {
                if (!note.trim()) return;
                setIssueStatus(issue.id, issue.status === "Open" ? "In Progress" : issue.status, note.trim());
                setNote("");
                setNoting(false);
              }}
            >
              Post update
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNoting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
