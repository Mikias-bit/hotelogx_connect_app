import { createFileRoute } from '@tanstack/react-router';
import { MaintenanceWorkPage } from '@/components/MaintenanceWorkPage';
export const Route = createFileRoute('/maintenance/issues')({ component: () => <MaintenanceWorkPage kind="issue" /> });
