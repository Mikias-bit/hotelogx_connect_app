import { createFileRoute } from '@tanstack/react-router';
import { OperationalBlockersPage } from '@/components/OperationalBlockers';
export const Route = createFileRoute('/housekeeping/follow-ups')({ component: OperationalBlockersPage });
