import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '@/components/AppShell';
import { DailyReports } from '@/components/DailyReports';
export const Route = createFileRoute('/housekeeping/reports')({ component: () => <AppShell title="Daily reports"><DailyReports /></AppShell> });
