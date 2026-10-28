import { createFileRoute } from '@tanstack/react-router';
import { LostFoundPage } from '@/components/LostFoundPage';

export const Route = createFileRoute('/front-office/lost-found')({ component: LostFoundPage });
