import { GuestHandoffWork } from './GuestHandoffs';
import { useNavigate } from '@tanstack/react-router';
import { Badge, Button, Card, priorityTone, statusTone } from './ui';
import type { MaintenanceWork } from '@/lib/types';
import { useCurrentUser } from '@/lib/session';

export function MaintenanceWorkCard({ work }: { work: MaintenanceWork }) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  return <Card>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap gap-2"><Badge tone="mute">{work.room ? `Room / location ${work.room}` : 'General task'}</Badge><Badge tone={priorityTone(work.priority)}>{work.priority}</Badge><Badge tone={statusTone(work.status)}>{work.status}</Badge>{work.outOfService && <Badge tone="urgent">Flagged out of service</Badge>}</div>
        <h3 className="text-[14px] font-medium text-ink">{work.title}</h3>
        {work.detail && <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-3">{work.detail}</p>}
        <p className="mt-2 text-[12px] text-ink-3">{work.assignee || 'Unassigned'}{work.acceptedAt && ` · Accepted ${new Date(work.acceptedAt).toLocaleString()}`}{work.completedAt && ` · Completed ${new Date(work.completedAt).toLocaleString()}`}</p>
        {work.problemNote && <p className="mt-2 whitespace-pre-wrap text-sm text-attend">{work.problemNote}</p>}
      </div>
      {user && ['manager', 'maintenance'].includes(user.role) && <Button size="sm" variant="outline" onClick={() => navigate({ to: '/maintenance/assignments' })}>Manage</Button>}
    </div>
    <GuestHandoffWork kind={work.kind} id={work.id} />
    {(work.updates?.length || work.trail?.length || 0) > 0 && <details className="mt-3 border-t border-line pt-2 text-[12px] text-ink-3"><summary className="cursor-pointer">Activity</summary><ul className="mt-2 space-y-1">{(work.updates || work.trail || []).map((event, i) => <li key={i}>{event.at} · {event.text}</li>)}</ul></details>}
  </Card>;
}
