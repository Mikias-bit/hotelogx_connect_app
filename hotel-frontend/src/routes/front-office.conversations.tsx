import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Inbox } from "@/components/Inbox";
import { useCurrentUser } from "@/lib/session";

export const Route = createFileRoute("/front-office/conversations")({
  validateSearch: (search: Record<string, unknown>): { filter?: 'escalated' } => ({
    filter: search.filter === 'escalated' ? 'escalated' : undefined,
  }),
  component: FrontOfficeConversations,
});

function FrontOfficeConversations() {
  const user = useCurrentUser();
  const { filter } = Route.useSearch();
  return (
    <AppShell title="Guest conversations — the AI drafts, you decide" flush>
      <div className="px-4 py-4 sm:px-6">
        <Inbox initialFilter={filter === "escalated" ? "Escalated" : "All"} variant="front-office" staffName={user?.name ?? "Front Office"} />
      </div>
    </AppShell>
  );
}
