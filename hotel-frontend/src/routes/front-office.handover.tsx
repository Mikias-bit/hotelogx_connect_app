import { createFileRoute } from '@tanstack/react-router';
import { ShiftHandoverPage } from '@/components/ShiftHandover';
export const Route = createFileRoute('/front-office/handover')({ component: ShiftHandoverPage });
