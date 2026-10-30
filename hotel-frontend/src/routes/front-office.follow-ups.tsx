import { createFileRoute } from '@tanstack/react-router';
import { OperationalBlockersPage } from '@/components/OperationalBlockers';
export const Route = createFileRoute('/front-office/follow-ups')({ component: OperationalBlockersPage });
