import { createFileRoute } from '@tanstack/react-router';
import { LostFoundPage } from '@/components/LostFoundPage';

export const Route = createFileRoute('/manager/lost-found')({ component: LostFoundPage });
