import {
  Bot,
  CalendarClock,
  ClipboardList,
  Mail,
  MessageCircle,
  Server,
  UserRound,
} from "lucide-react";
import { setTaskStatus } from "@/lib/store";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, Button, priorityTone, statusTone } from "./ui";

const DefaultSourceIcon = ClipboardList;

const sourceIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  "Guest WhatsApp": MessageCircle,
  "Guest Email": Mail,
  "AI Detection": Bot,
  ai: Bot,
  whatsapp: MessageCircle,
  email: Mail,
  Manager: UserRound,
  manager: UserRound,
  "Front Office": ClipboardList,
  "front-office": ClipboardList,
  Housekeeping: ClipboardList,
  housekeeping: ClipboardList,
  "PMS event": Server,
  pms: Server,
};

export function TaskRow({ task, onOpen, showDepartment = true }: { task: Task; onOpen?: (task: Task) => void; showDepartment?: boolean }) {
  const SourceIcon = (task?.source ? sourceIcon[task.source] : undefined) ?? DefaultSourceIcon;
  const done = task?.status === "Completed";
  return (
    <li
      className={cn(
        "group flex flex-col gap-3 border-t border-line-soft px-4 py-3.5 transition-colors first:border-t-0 hover:bg-paper sm:flex-row sm:items-center",
        done && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {task.room ? (
          <span className="tnum mt-0.5 inline-flex h-7 min-w-11 shrink-0 items-center justify-center rounded-[7px] border border-line bg-paper-2 px-1.5 font-mono text-[12px] font-medium text-ink-2">
            {task.room}
          </span>
        ) : (
          <span className="mt-0.5 inline-flex h-7 min-w-11 shrink-0 items-center justify-center rounded-[7px] border border-dashed border-line font-mono text-[11px] text-ink-4">
            —
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onOpen?.(task)}
              className={cn("text-left text-[14px] font-medium text-ink", onOpen && "hover:text-pine-600", done && "line-through decoration-ink-4")}
            >
              {task.title}
            </button>
            <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge>
            {showDepartment && <Badge tone="mute">{task.department}</Badge>}
          </div>
          {task.detail && <p className="mt-1 line-clamp-1 text-[12.5px] text-ink-3">{task.detail}</p>}
          <p className="tnum mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[10.5px] text-ink-4">
            <span className="inline-flex items-center gap-1">
              <SourceIcon className="size-3" />
              <span className="font-sans">{task.source}</span>
            </span>
            <span>· {task.createdAt}</span>
            {task.due && (
              <span className="inline-flex items-center gap-1">
                · <CalendarClock className="size-3" /> due {task.due}
              </span>
            )}
            {task.guest && <span className="font-sans">· {task.guest}</span>}
            <span className="font-sans">· {task.assignee ?? "Unassigned"}</span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:justify-end">
        <Badge tone={statusTone(task.status)} dot>
          {task.status}
        </Badge>
        {!done && (
          <div className="flex gap-1.5 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
            {task.status !== "In Progress" && (
              <Button size="sm" variant="quiet" onClick={() => setTaskStatus(task.id, "In Progress")}>
                Start
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setTaskStatus(task.id, "Completed")}>
              Complete
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
