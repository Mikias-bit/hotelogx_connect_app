import { createFileRoute } from '@tanstack/react-router';
import { MaintenanceAssignments } from '@/components/MaintenanceAssignments';
export const Route = createFileRoute('/maintenance/assignments')({ component: MaintenanceAssignments });
