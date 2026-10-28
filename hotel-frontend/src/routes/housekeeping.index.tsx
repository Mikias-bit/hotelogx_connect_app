import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '@/components/AppShell';
import { OperationsBoard } from '@/components/OperationsBoard';
import { TaskRow } from '@/components/TaskRow';
import { Card, SectionTitle } from '@/components/ui';
import { useApp } from '@/lib/store';
export const Route = createFileRoute('/housekeeping/')({ component: HousekeepingDashboard });
function HousekeepingDashboard() {
  const requests = useApp(s => s.tasks).filter(t => t.department === 'Housekeeping' && t.source !== 'Daily report' && t.status !== 'Completed');
  return <AppShell title="Housekeeping assignments"><OperationsBoard /><Card><SectionTitle title="Additional guest requests" hint="Requests received outside the daily cleaning plan" /><ul>{requests.map(task => <TaskRow key={task.id} task={task} />)}</ul>{!requests.length && <p className="text-sm">No additional open requests.</p>}</Card></AppShell>;
}
