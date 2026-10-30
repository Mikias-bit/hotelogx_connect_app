import { createFileRoute } from '@tanstack/react-router';
import { RoomReadinessPage } from '@/components/RoomReadinessPage';
export const Route = createFileRoute('/manager/rooms')({ component: RoomReadinessPage });
