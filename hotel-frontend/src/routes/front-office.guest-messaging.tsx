import { createFileRoute } from '@tanstack/react-router';
import { GuestMessagingPage } from '@/components/GuestMessaging';
export const Route = createFileRoute('/front-office/guest-messaging')({ component: GuestMessagingPage });
