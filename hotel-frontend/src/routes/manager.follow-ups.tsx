import { createFileRoute } from '@tanstack/react-router';
import { OperationalBlockersPage } from '@/components/OperationalBlockers';
export const Route = createFileRoute('/manager/follow-ups')({ component: OperationalBlockersPage });
