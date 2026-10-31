import { GuestHandoffList } from './GuestHandoffs';
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ClipboardList,
  Crown,
  Pencil,
  Send,
  Sparkles,
  StickyNote,
  TrendingUp,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  acceptUpsell,
  addNote,
  channelLabel,
  escalateConversation,
  markRead,
  resolveConversation,
  returnToAi,
  sendReply,
  store,
  takeOver,
  useApp,
} from "@/lib/store";
import type { AiStatus, Conversation, Sentiment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, Button, ChannelMark, Empty, Eyebrow, KeyValue, statusTone } from "./ui";
import type { Tone } from "./ui";
import { PmsUpsells } from "./PmsUpsells";
import { TaskComposer } from "./TaskComposer";

const filters = [
  "All",
  "AI handling",
  "Human takeover",
  "Escalated",
  "Unresolved",
  "WhatsApp",
  "Email",
  "Pre-arrival",
  "In-house",
  "Post-stay",
] as const;
type Filter = (typeof filters)[number];

const aiStatusLabel: Record<AiStatus, string> = {
  "ai-handling": "AI handling",
  "human-takeover": "Human takeover",
  escalated: "Escalated",
  resolved: "Resolved",
};

const sentimentTone: Record<Sentiment, Tone> = {
  positive: "good",
  neutral: "mute",
  frustrated: "attend",
  urgent: "urgent",
};

const stageLabel: Record<Conversation["stage"], string> = {
  "pre-arrival": "Pre-arrival",
  "in-house": "In-house",
  "post-stay": "Post-stay",
};

function matches(conversation: Conversation, filter: Filter) {
  const channels = conversation.channels || (conversation.primaryChannel ? [conversation.primaryChannel] : ["whatsapp"]);
  switch (filter) {
    case "All":
      return true;
    case "AI handling":
      return conversation.aiStatus === "ai-handling";
    case "Human takeover":
      return conversation.aiStatus === "human-takeover";
    case "Escalated":
      return conversation.aiStatus === "escalated" || !!conversation.guestFollowUpPending;
    case "Unresolved":
      return conversation.aiStatus !== "resolved" || !!conversation.guestFollowUpPending;
    case "WhatsApp":
      return channels.includes("whatsapp");
    case "Email":
      return channels.some((c) => c !== "whatsapp");
    case "Pre-arrival":
      return conversation.stage === "pre-arrival";
    case "In-house":
      return conversation.stage === "in-house";
    case "Post-stay":
      return conversation.stage === "post-stay";
  }
}

function lastGuestLine(conversation: Conversation) {
  const msgs = conversation.messages || [];
  const message = [...msgs].reverse().find((m) => m.author !== "system");
  if (!message) return "";
  const prefix = message.author === "ai" ? "AI: " : message.author === "staff" ? `${message.staffName ?? "Staff"}: ` : "";
  return prefix + message.body.replace(/\n+/g, " ");
}

/* ------------------------------------------------------------------ list -- */

function FilterBar({ active, onChange, counts }: { active: Filter; onChange: (f: Filter) => void; counts: Record<string, number> }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      {filters.map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-medium whitespace-nowrap transition-colors",
            f === active ? "border-pine-600 bg-pine-600 text-white" : "border-line bg-surface text-ink-3 hover:border-ink-4 hover:text-ink",
          )}
        >
          {f}
          {counts[f] !== undefined && <span className="tnum ml-1.5 font-mono text-[10.5px] opacity-70">{counts[f]}</span>}
        </button>
      ))}
    </div>
  );
}

function ListItem({
  conversation,
  active,
  onSelect,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "block w-full border-b border-line-soft px-3.5 py-3 text-left transition-colors last:border-b-0",
        active ? "bg-pine-50/70" : "hover:bg-paper",
      )}
    >
      <div className="flex items-center gap-2">
        <ChannelMark channel={conversation.primaryChannel} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{conversation.guest?.name ?? "Guest"}</span>
        {conversation.guest?.vip && <Crown className="size-3 shrink-0 text-pine-600" />}
        <span className="tnum shrink-0 font-mono text-[10.5px] text-ink-4">{conversation.lastAt}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink-3">{lastGuestLine(conversation)}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Badge tone={statusTone(conversation.aiStatus)} dot>
          {aiStatusLabel[conversation.aiStatus]}
        </Badge>
        {conversation.guest?.room && (
          <span className="tnum font-mono text-[10.5px] text-ink-4">{conversation.guest.room}</span>
        )}
        {conversation.unread > 0 && (
          <span className="tnum ml-auto rounded-full bg-pine-600 px-1.5 font-mono text-[10px] text-white">
            {conversation.unread}
          </span>
        )}
      </div>
    </button>
  );
}

/* ---------------------------------------------------------------- thread -- */

function Thread({ conversation }: { conversation: Conversation }) {
  return (
    <ol className="space-y-3.5">
      {conversation.messages.map((m) => {
        if (m.author === "system") {
          return (
            <li key={m.id} className="flex items-start justify-center gap-2 py-0.5">
              <p className="max-w-md rounded-full border border-line bg-paper-2 px-3 py-1 text-center text-[11px] leading-snug text-ink-3">
                <span className="tnum font-mono">{m.at}</span> · {m.body}
              </p>
            </li>
          );
        }
        const isGuest = m.author === "guest";
        return (
          <li key={m.id} className={cn("flex", isGuest ? "justify-start" : "justify-end")}>
            <div className={cn("max-w-[85%] sm:max-w-[78%]", isGuest ? "" : "text-right")}>
              <p className="tnum mb-1 flex items-center gap-1.5 font-mono text-[10.5px] text-ink-4" style={{ justifyContent: isGuest ? "flex-start" : "flex-end" }}>
                <ChannelMark channel={isGuest ? m.channel : m.author === "ai" ? "ai" : "staff"} />
                <span className="font-sans font-medium text-ink-3">
                  {isGuest ? conversation.guest.name : m.author === "ai" ? "AI assistant" : (m.staffName ?? "Staff")}
                </span>
                {m.channel !== "internal" && <span>· {channelLabel(m.channel)}</span>}
                <span>· {m.at}</span>
                {m.confidence !== undefined && <span className="font-sans">· {Math.round(m.confidence * 100)}% confident</span>}
              </p>
              <div
                className={cn(
                  "rounded-[12px] border px-3.5 py-2.5 text-left text-[13.5px] leading-relaxed whitespace-pre-line",
                  isGuest
                    ? "rounded-tl-[4px] border-line bg-surface text-ink"
                    : m.author === "ai"
                      ? "rounded-tr-[4px] border-ai/20 bg-ai-bg text-ink"
                      : m.channel === "internal"
                        ? "rounded-tr-[4px] border-attend/25 bg-attend-bg text-ink-2"
                        : "rounded-tr-[4px] border-pine-200 bg-pine-50 text-ink",
                )}
              >
                {m.body}
                {m.buttons && (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {m.buttons.map((b) => (
                      <span key={b} className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-3">
                        {b}
                      </span>
                    ))}
                  </span>
                )}
                {Array.isArray(m.knowledge) && m.knowledge.length > 0 && (
                  <span className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line-soft pt-2 text-[10.5px] text-ink-4">
                    <BookOpen className="size-3" />
                    {m.knowledge.join(" · ")}
                  </span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------------------------------------- context -- */

function GuestContext({
  conversation,
  staffName,
  onCreateTask,
}: {
  conversation: Conversation;
  staffName: string;
  onCreateTask: () => void;
}) {
  const taskIds = conversation.taskIds || [];
  const tasks = useApp((s) => s.tasks.filter((t) => (taskIds.includes(t.id) || t.conversationId === conversation.id)));
  const guest = conversation.guest || ({} as any);
  const reservation = guest.reservation || { number: "—" };
  const tags = guest.tags || [];

  return (
    <div className="space-y-5">
      <GuestHandoffList conversationId={conversation.id} />
      {(conversation.aiStatus === 'escalated' || conversation.aiStatus === 'human-takeover') && (
        <details className="rounded-[10px] border border-line bg-paper/70 p-3" open={conversation.escalation?.kind === 'reservation_verification' || conversation.escalation?.kind === 'pms_approval' || conversation.escalation?.kind === 'pms_review'}>
          <summary className="cursor-pointer text-[13px] font-medium">Reservation check &amp; approvals</summary>
          <div className="mt-3"><PmsUpsells key={conversation.id} conversationId={conversation.id} /></div>
        </details>
      )}
      <div>
        <div className="flex items-center gap-2">
          <UserRound className="size-3.5 text-ink-4" />
          <p className="text-[14px] font-semibold text-ink">{guest.name}</p>
          {guest.vip && (
            <Badge tone="pine">
              <Crown className="size-3" /> VIP
            </Badge>
          )}
        </div>
        <p className="mt-1 text-[12px] text-ink-3">
          {guest.country} · speaks {guest.language} · {guest.previousStays ?? 0} previous {guest.previousStays === 1 ? "stay" : "stays"}
        </p>
        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((t: string) => (
              <span key={t} className="rounded-full border border-line bg-paper px-2 py-0.5 text-[10.5px] text-ink-3">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-[10px] border border-line bg-paper/70 px-3 py-2">
        <Eyebrow>Reservation · from your PMS</Eyebrow>
        <div className="mt-1 divide-y divide-line-soft">
          <KeyValue label="Number" value={reservation?.number ?? "—"} mono />
          <KeyValue label="Room" value={guest.room ?? "Not assigned"} mono />
          <KeyValue label="Stay" value={reservation?.arrival && reservation?.departure ? `${reservation.arrival} → ${reservation.departure}` : "—"} />
          <KeyValue label="Nights" value={reservation?.nights ? `${reservation.nights} · ${reservation.adults ?? 1}A ${reservation.children ?? 0}C` : "—"} />
          <KeyValue label="Category" value={reservation?.roomType ?? "—"} />
          <KeyValue label="Rate" value={reservation?.rate ?? "—"} />
          <KeyValue label="Status" value={reservation?.status ?? "—"} />
        </div>
      </div>

      <div>
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-ai" />
          <Eyebrow>AI summary</Eyebrow>
        </span>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{conversation.summary}</p>
      </div>

      {conversation.knowledgeUsed.length > 0 && (
        <div>
          <Eyebrow>Knowledge used</Eyebrow>
          <ul className="mt-1.5 space-y-1">
            {conversation.knowledgeUsed.map((k) => (
              <li key={k} className="flex items-start gap-1.5 text-[12px] text-ink-2">
                <BookOpen className="mt-0.5 size-3 shrink-0 text-ink-4" />
                {k}
              </li>
            ))}
          </ul>
        </div>
      )}

      {conversation.upsellIdeas.length > 0 && (
        <div>
          <span className="inline-flex items-center gap-1.5">
            <TrendingUp className="size-3.5 text-good" />
            <Eyebrow>Upsell opportunities</Eyebrow>
          </span>
          <ul className="mt-1.5 space-y-2">
            {conversation.upsellIdeas.map((u) => (
              <li key={u.label} className="rounded-[9px] border border-line bg-surface px-2.5 py-2">
                <p className="flex items-baseline justify-between gap-2 text-[12.5px] font-medium text-ink">
                  {u.label}
                  <span className="tnum font-mono text-[12px] text-good">{u.value}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-ink-4">{u.reason}</p>
                <Button size="sm" variant="quiet" className="mt-1.5 w-full" onClick={() => acceptUpsell(conversation.id, u.label, u.value)}>
                  Offer to guest
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <Eyebrow>Tasks created</Eyebrow>
          <button onClick={onCreateTask} className="text-[11.5px] font-medium text-pine-600 hover:text-pine-700">
            + New
          </button>
        </div>
        {tasks.length === 0 ? (
          <p className="mt-1.5 text-[12px] text-ink-4">No tasks from this conversation yet.</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-2 rounded-[9px] border border-line bg-surface px-2.5 py-2">
                <ClipboardList className="mt-0.5 size-3 shrink-0 text-ink-4" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] leading-snug text-ink-2">{t.title}</span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                    <span className="text-[10.5px] text-ink-4">{t.assignee ?? "Unassigned"}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="border-t border-line-soft pt-3 text-[10.5px] leading-snug text-ink-4">
        Handled by {conversation.aiStatus === "human-takeover" ? staffName : "the AI"} · {conversation.aiHandledCount} automatic
        replies so far in this thread.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- actions -- */

function Composer({
  conversation,
  staffName,
  onCreateTask,
  compact,
}: {
  conversation: Conversation;
  staffName: string;
  onCreateTask: () => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(conversation.suggestedReply);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const suggested = conversation.suggestedReply;

  return (
    <div className="border-t border-line bg-surface p-3.5">
      {mode === "reply" && suggested && draft === suggested && (
        <p className="mb-2 flex items-start gap-1.5 text-[11px] leading-snug text-ink-4">
          <Sparkles className="mt-px size-3 shrink-0 text-ai" />
          Suggested by the AI from {conversation.knowledgeUsed[0] ?? "your knowledge base"} — send it, edit it, or write your own.
        </p>
      )}
      <div className="flex gap-1.5">
        {(["reply", "note"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setDraft(m === "reply" ? suggested : "");
            }}
            className={cn(
              "rounded-full px-2 py-0.5 text-[11.5px] font-medium transition-colors",
              mode === m ? "bg-pine-50 text-pine-700" : "text-ink-4 hover:text-ink",
            )}
          >
            {m === "reply" ? `Reply on ${channelLabel(conversation.primaryChannel)}` : "Internal note"}
          </button>
        ))}
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={compact ? 2 : 3}
        placeholder={mode === "reply" ? "Write to the guest…" : "Note for your colleagues…"}
        className="mt-2 w-full resize-none rounded-[10px] border border-line bg-paper/60 px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none focus:border-pine-400 focus:bg-surface"
      />

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {mode === "reply" ? (
          <>
            <Button
              size="sm"
              icon={Send}
              disabled={!draft.trim()}
              onClick={() => {
                sendReply(conversation.id, draft.trim(), draft === suggested ? "ai" : "staff", staffName);
                setDraft("");
              }}
            >
              {draft === suggested && suggested ? "Send AI reply" : "Send reply"}
            </Button>
            <Button size="sm" variant="outline" icon={Pencil} onClick={() => setDraft(suggested)}>
              Reset to AI draft
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            icon={StickyNote}
            onClick={() => {
              addNote(conversation.id, draft.trim() || "Noted internally.", staffName);
              setDraft(suggested);
              setMode("reply");
            }}
          >
            Add internal note
          </Button>
        )}

        <span className="mx-1 hidden h-4 w-px bg-line sm:block" />

        {conversation.aiStatus === "human-takeover" ? (
          <Button size="sm" variant="quiet" icon={Sparkles} onClick={() => returnToAi(conversation.id)}>
            Return to AI
          </Button>
        ) : (
          <Button size="sm" variant="quiet" icon={UserRound} onClick={() => takeOver(conversation.id, staffName)}>
            Take over
          </Button>
        )}
        <Button size="sm" variant="quiet" icon={ClipboardList} onClick={onCreateTask}>
          Create task
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={TriangleAlert}
          onClick={() => escalateConversation(conversation.id, "Escalated manually by " + staffName)}
        >
          Escalate
        </Button>
        <Button size="sm" variant="ghost" icon={Check} onClick={() => resolveConversation(conversation.id)}>
          Resolve
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- inbox -- */

export function Inbox({ variant, staffName, initialFilter = "All" }: { variant: "manager" | "front-office"; staffName: string; initialFilter?: Filter }) {
  const conversations = useApp((s) => s.conversations);
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  useEffect(() => { setFilter(initialFilter); setSelectedId(null); }, [initialFilter]);

  useEffect(() => {
    api.getConversations().then((remoteConvs: any) => {
      const data = remoteConvs?.data || remoteConvs;
      if (Array.isArray(data) && data.length > 0) {
        store.setState((s) => ({
          ...s,
          conversations: data.map((c: any) => ({
            ...c,
            channels: c.primaryChannel ? [c.primaryChannel] : ["email"],
            knowledgeUsed: Array.isArray(c.knowledgeUsed) ? c.knowledgeUsed : [],
            upsellIdeas: Array.isArray(c.upsellIdeas) ? c.upsellIdeas : [],
            escalation: c.escalation || undefined,
            messages: c.messages || [],
            guest: {
              ...c.guest,
              tags: Array.isArray(c.guest?.tags) ? c.guest.tags : [],
            },
          })),
        }));
      }
    }).catch(() => {});
  }, []);

  const list = useMemo(() => conversations.filter((c) => matches(c, filter)), [conversations, filter]);
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    filters.forEach((f) => (result[f] = conversations.filter((c) => matches(c, f)).length));
    return result;
  }, [conversations]);

  const selected = list.find((c) => c.id === selectedId) ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    markRead(id);
  };

  const taskComposer = selected && (
    <TaskComposer
      open={composerOpen}
      onClose={() => setComposerOpen(false)}
      source="Manager"
      defaults={{
        title: `Follow up for ${selected.guest?.name ?? "Guest"}`,
        room: selected.guest?.room,
        guest: selected.guest?.name ?? "Guest",
        conversationId: selected.id,
      }}
    />
  );

  /* ---------------------------------------------------- manager: table -- */
  if (variant === "manager") {
    if (!selected) {
      return (
        <div className="space-y-4">
          <FilterBar active={filter} onChange={setFilter} counts={counts} />
          {filter === 'Escalated' && <GuestHandoffList unlinkedOnly />}
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="hidden grid-cols-[1.4fr_0.8fr_0.6fr_2fr_0.9fr_0.7fr_0.5fr] gap-3 border-b border-line bg-paper/60 px-4 py-2.5 text-[10.5px] font-semibold tracking-[0.1em] text-ink-4 uppercase lg:grid">
              <span>Guest</span>
              <span>Room / reservation</span>
              <span>Channel</span>
              <span>Last message</span>
              <span>AI status</span>
              <span>Sentiment</span>
              <span className="text-right">Time</span>
            </div>
            {list.length === 0 && <Empty title="Nothing in this view" hint="Try another filter — the AI may have closed these already." />}
            {list.map((c) => (
              <button
                key={c.id}
                onClick={() => select(c.id)}
                className="grid w-full grid-cols-1 gap-2 border-b border-line-soft px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-paper lg:grid-cols-[1.4fr_0.8fr_0.6fr_2fr_0.9fr_0.7fr_0.5fr] lg:items-center lg:gap-3"
              >
                <span className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-ink">{c.guest?.name ?? "Guest"}</span>
                  {c.guest?.vip && <Crown className="size-3 shrink-0 text-pine-600" />}
                  {c.escalation && <TriangleAlert className="size-3.5 shrink-0 text-urgent" />}
                </span>
                <span className="tnum font-mono text-[11.5px] text-ink-3">
                  {c.guest?.room ? `${c.guest.room} · ` : ""}
                  {c.guest?.reservation?.number ?? "—"}
                </span>
                <span className="flex items-center gap-1.5">
                  {(c.channels || (c.primaryChannel ? [c.primaryChannel] : ["whatsapp"])).map((ch) => (
                    <ChannelMark key={ch} channel={ch} />
                  ))}
                  <span className="text-[11px] text-ink-4 lg:hidden">{stageLabel[c.stage]}</span>
                </span>
                <span className="truncate text-[12.5px] text-ink-3">{lastGuestLine(c)}</span>
                <span>
                  <Badge tone={statusTone(c.aiStatus)} dot>
                    {aiStatusLabel[c.aiStatus]}
                  </Badge>
                </span>
                <span>
                  <Badge tone={sentimentTone[c.sentiment]}>{c.sentiment}</Badge>
                </span>
                <span className="tnum font-mono text-[11px] text-ink-4 lg:text-right">{c.lastAt}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" icon={ArrowLeft} onClick={() => setSelectedId(null)}>
            All conversations
          </Button>
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(selected.aiStatus)} dot>
              {aiStatusLabel[selected.aiStatus]}
            </Badge>
            <Badge tone="mute">{stageLabel[selected.stage]}</Badge>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] lg:items-start">
          <div className="flex max-h-[calc(100dvh-13rem)] min-h-0 flex-col overflow-hidden rounded-card border border-line bg-paper/40">
            <div className="border-b border-line bg-surface px-4 py-3">
              <p className="text-[14px] font-semibold text-ink">{selected.subject}</p>
              <p className="tnum mt-0.5 flex items-center gap-2 font-mono text-[11px] text-ink-4">
                <ChannelMark channel={selected.primaryChannel} withLabel />
                <span className="font-sans">· {selected.guest?.name ?? "Guest"}</span>
                {selected.guest?.room && <span>· room {selected.guest.room}</span>}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <Thread conversation={selected} />
            </div>
            <Composer key={selected.id} conversation={selected} staffName={staffName} onCreateTask={() => setComposerOpen(true)} />
          </div>

          <aside className="rounded-card border border-line bg-surface p-4 lg:max-h-[calc(100dvh-13rem)] lg:overflow-y-auto">
            <GuestContext conversation={selected} staffName={staffName} onCreateTask={() => setComposerOpen(true)} />
          </aside>
        </div>
        {taskComposer}
      </div>
    );
  }

  /* --------------------------------------------- front office: 3 columns -- */
  return (
    <div className="grid min-h-0 gap-4 lg:h-[calc(100dvh-9.5rem)] lg:grid-cols-[290px_1fr_300px]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
        <div className="border-b border-line px-3 py-2.5">
          <FilterBar active={filter} onChange={setFilter} counts={counts} />
          {filter === 'Escalated' && <GuestHandoffList unlinkedOnly />}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 && <Empty title="Nothing here" hint="Try another filter." />}
          {list.map((c) => (
            <ListItem key={c.id} conversation={c} active={c.id === selectedId} onSelect={() => select(c.id)} />
          ))}
        </div>
      </div>

      {selected ? (
        <div className="flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-paper/40">
          <div className="flex items-start justify-between gap-3 border-b border-line bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-ink">{selected.subject}</p>
              <p className="tnum mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-4">
                <ChannelMark channel={selected.primaryChannel} withLabel />
                <span className="font-sans">· {selected.guest?.name ?? "Guest"}</span>
                {selected.guest?.room && <span>· room {selected.guest.room}</span>}
                {selected.guest?.reservation?.number && <span>· {selected.guest.reservation.number}</span>}
              </p>
            </div>
            <Badge tone={statusTone(selected.aiStatus)} dot>
              {aiStatusLabel[selected.aiStatus]}
            </Badge>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <Thread conversation={selected} />
          </div>
          <Composer key={selected.id} conversation={selected} staffName={staffName} onCreateTask={() => setComposerOpen(true)} compact />
        </div>
      ) : (
        <Empty title="Select a conversation" hint="The AI keeps answering while you read." />
      )}

      <aside className="min-h-0 overflow-y-auto rounded-card border border-line bg-surface p-4">
        {selected ? (
          <GuestContext conversation={selected} staffName={staffName} onCreateTask={() => setComposerOpen(true)} />
        ) : (
          <p className="text-[12.5px] text-ink-4">Guest details, reservation and AI suggestions appear here.</p>
        )}
      </aside>
      {taskComposer}
    </div>
  );
}
