import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Inbox } from "@/components/Inbox";
import { Eyebrow } from "@/components/ui";
import { useCurrentUser } from "@/lib/session";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/manager/conversations")({
  validateSearch: (search: Record<string, unknown>): { filter?: 'escalated' } => ({ filter: search.filter === 'escalated' ? 'escalated' : undefined }),
  component: ManagerConversations,
});

function ManagerConversations() {
  const user = useCurrentUser();
  const { filter } = Route.useSearch();
  const conversations = useApp((s) => s.conversations);
  const handled = conversations.filter((c) => c.aiStatus === "ai-handling" || c.aiStatus === "resolved").length;

  return (
    <AppShell title="Every guest conversation, every channel" wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Conversations</Eyebrow>
            <h1 className="mt-1.5 font-display text-[26px] leading-tight font-medium text-ink">One thread per guest</h1>
            <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
              WhatsApp, Gmail, Outlook and your own mailbox merged into a single history. {handled} of {conversations.length} are
              running without a person.
            </p>
          </div>
        </div>
        <Inbox initialFilter={filter === "escalated" ? "Escalated" : "All"} variant="manager" staffName={user?.name ?? "Manager"} />
      </div>
    </AppShell>
  );
}
