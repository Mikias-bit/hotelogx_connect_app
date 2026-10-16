import { useState } from "react";
import { X } from "lucide-react";
import { createTask, selectors, useApp } from "@/lib/store";
import type { Department, Priority, TaskSource } from "@/lib/types";
import { Button, Eyebrow } from "./ui";

const departments: Department[] = ["Front Office", "Housekeeping", "Maintenance", "Guest Request", "VIP", "Billing", "Follow-up"];
const priorities: Priority[] = ["Urgent", "High", "Normal", "Low"];

export function TaskComposer({
  open,
  onClose,
  defaults,
  source = "Manager",
}: {
  open: boolean;
  onClose: () => void;
  defaults?: { title?: string; room?: string; guest?: string; department?: Department; conversationId?: string };
  source?: TaskSource;
}) {
  const [title, setTitle] = useState(defaults?.title ?? "");
  const [detail, setDetail] = useState("");
  const [room, setRoom] = useState(defaults?.room ?? "");
  const [department, setDepartment] = useState<Department>(defaults?.department ?? "Front Office");
  const [priority, setPriority] = useState<Priority>("Normal");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");

  const hkCleaners = useApp(selectors.housekeepingTeam);
  const users = useApp((s) => s.users);

  if (!open) return null;

  function getDynamicAssignees(dept: Department): string[] {
    if (dept === "Housekeeping") return hkCleaners;
    if (dept === "Maintenance") {
      const techUsers = users
        .filter((u) => u.role === "maintenance" || u.title?.toLowerCase().includes("tech") || u.title?.toLowerCase().includes("maint"))
        .map((u) => u.name);
      return techUsers.length > 0 ? techUsers : ["Peter Janssens", "Milan Novák"];
    }
    const deskUsers = users.filter((u) => u.role === "front-office" || u.role === "manager").map((u) => u.name);
    return deskUsers.length > 0 ? deskUsers : ["Jonas Verhaeghe", "Amélie Duprez", "Thibault Moreau"];
  }

  const options = getDynamicAssignees(department);

  const field = "mt-1 w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-pine-400";
  const label = "block text-[11.5px] font-medium text-ink-3";

  return (
    <div className="fixed inset-0 z-60 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button className="absolute inset-0 bg-ink/25" onClick={onClose} aria-label="Close" />
      <div className="rise relative w-full max-w-[520px] rounded-t-card border border-line bg-surface p-5 sm:rounded-card">
        <div className="flex items-start justify-between">
          <div>
            <Eyebrow>New task</Eyebrow>
            <p className="mt-1 font-display text-[19px] font-medium text-ink">Send work to a department</p>
          </div>
          <button onClick={onClose} className="text-ink-4 transition-colors hover:text-ink">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className={label}>What needs doing</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Extra pillows for 208" className={field} />
          </label>
          <label className="block">
            <span className={label}>Detail (optional)</span>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} className={`${field} resize-none`} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>Room</span>
              <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="302" className={`${field} tnum font-mono`} />
            </label>
            <label className="block">
              <span className={label}>Due</span>
              <input value={due} onChange={(e) => setDue(e.target.value)} placeholder="13:00" className={`${field} tnum font-mono`} />
            </label>
            <label className="block">
              <span className={label}>Department</span>
              <select
                value={department}
                onChange={(e) => {
                  setDepartment(e.target.value as Department);
                  setAssignee("");
                }}
                className={field}
              >
                {departments.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>Priority</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={field}>
                {priorities.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className={label}>Send to</span>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
              <option value="">Leave unassigned</option>
              {options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <p className="text-[11px] leading-snug text-ink-4">
            Assigned tasks are delivered as an interactive WhatsApp card. The status the person taps comes straight back into
            these dashboards.
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim()}
            onClick={() => {
              createTask({
                title: title.trim(),
                detail: detail.trim() || undefined,
                room: room.trim() || undefined,
                guest: defaults?.guest,
                department,
                priority,
                due: due.trim() || undefined,
                assignee: assignee || undefined,
                source,
                conversationId: defaults?.conversationId,
              });
              onClose();
            }}
          >
            Create task
          </Button>
        </div>
      </div>
    </div>
  );
}
