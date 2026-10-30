import type { Issue } from '@/lib/types';
import { MaintenanceWorkCard } from './MaintenanceWorkCard';

export function IssueCard({ issue }: { issue: Issue; compact?: boolean }) {
  return <MaintenanceWorkCard work={{ ...issue, kind: 'issue', version: issue.version ?? 0 }} />;
}
