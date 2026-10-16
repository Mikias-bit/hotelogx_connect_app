import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Inbox } from "@/components/Inbox";
import { useCurrentUser } from "@/lib/session";

export const Route = createFileRoute("/front-office/conversations")({
  component: FrontOfficeConversations,
});

function FrontOfficeConversations() {
  const user = useCurrentUser();
  return (
    <AppShell title="Guest conversations — the AI drafts, you decide" flush>
      <div className="px-4 py-4 sm:px-6">
        <Inbox variant="front-office" staffName={user?.name ?? "Front Office"} />
      </div>
    </AppShell>
  );
}
