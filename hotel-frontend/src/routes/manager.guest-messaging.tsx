import { createFileRoute } from '@tanstack/react-router';
import { GuestMessagingPage } from '@/components/GuestMessaging';
export const Route = createFileRoute('/manager/guest-messaging')({ component: GuestMessagingPage });
