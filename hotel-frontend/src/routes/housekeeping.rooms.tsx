import { createFileRoute } from '@tanstack/react-router';
import { RoomReadinessPage } from '@/components/RoomReadinessPage';
export const Route = createFileRoute('/housekeeping/rooms')({ component: RoomReadinessPage });
