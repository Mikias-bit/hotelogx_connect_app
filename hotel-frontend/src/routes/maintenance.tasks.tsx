import { createFileRoute } from '@tanstack/react-router';
import { MaintenanceWorkPage } from '@/components/MaintenanceWorkPage';
export const Route = createFileRoute('/maintenance/tasks')({ component: () => <MaintenanceWorkPage kind="task" /> });
