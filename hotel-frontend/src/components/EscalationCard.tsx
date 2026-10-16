import { useState } from "react";
import { ChevronDown, ChevronUp, Crown, Sparkles, TriangleAlert } from "lucide-react";
import { resolveConversation, sendReply, takeOver } from "@/lib/store";
import type { Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, Button, ChannelMark, Eyebrow, priorityTone } from "./ui";

export function EscalationCard({
  conversation,
  staffName,
  onOpen,
}: {
  conversation: Conversation;
  staffName: string;
  onOpen?: (id: string) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.escalation?.suggested ?? conversation.suggestedReply);
  const escalation = conversation.escalation;
  if (!escalation) return null;

  return (
    <article className="overflow-hidden rounded-card border border-urgent/25 bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft bg-urgent-bg/50 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink">{conversation.guest.name}</h3>
            {conversation.guest?.room && (
              <span className="tnum rounded-[6px] border border-line bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2">
                Room {conversation.guest.room}
              </span>
            )}
            {conversation.guest?.vip && (
              <Badge tone="pine">
                <Crown className="size-3" /> VIP
              </Badge>
            )}
            <Badge tone={priorityTone(escalation.urgency)} dot>
              {escalation.urgency} urgency
            </Badge>
          </div>
          <p className="tnum mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-4">
            <span>{conversation.guest?.reservation?.number ?? "—"}</span>
            <span className="text-line">|</span>
            <ChannelMark channel={conversation.primaryChannel} withLabel />
            <span className="text-line">|</span>
            <span>raised {escalation.raisedAt}</span>
          </p>
        </div>
        {onOpen && (
          <Button size="sm" variant="outline" onClick={() => onOpen(conversation.id)}>
            Open conversation
          </Button>
        )}
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-3.5">
          <div className="rounded-[10px] border border-urgent/20 bg-urgent-bg/40 px-3 py-2.5">
            <Eyebrow className="text-urgent/70">Why it reached you</Eyebrow>
            <p className="mt-1 flex items-start gap-2 text-[13px] leading-snug font-medium text-ink">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-urgent" />
              {escalation.reason}
            </p>
          </div>

          <div>
            <Eyebrow>AI summary</Eyebrow>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{conversation.summary}</p>
          </div>

          <button
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-3 transition-colors hover:text-ink"
          >
            {showHistory ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {showHistory ? "Hide" : "Show"} conversation history ({conversation.messages.length})
          </button>

          {showHistory && (
            <ol className="space-y-2 border-l border-line-soft pl-3">
              {conversation.messages.map((m) => (
                <li key={m.id} className="text-[12.5px] leading-snug">
                  <p className="tnum flex items-center gap-1.5 font-mono text-[10.5px] text-ink-4">
                    <ChannelMark channel={m.author === "guest" ? m.channel : m.author} />
                    <span className="font-sans font-medium">
                      {m.author === "guest" ? conversation.guest.name : m.author === "ai" ? "AI" : m.staffName ?? "System"}
                    </span>
                    {m.at}
                  </p>
                  <p className={cn("mt-0.5 whitespace-pre-line", m.author === "system" ? "text-ink-4 italic" : "text-ink-2")}>{m.body}</p>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-[10px] border border-ai/20 bg-ai-bg/60 p-3">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-ai" />
              <Eyebrow className="text-ai/80">Suggested response</Eyebrow>
            </span>
            {editing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={6}
                className="mt-2 w-full resize-none rounded-[8px] border border-line bg-surface p-2.5 text-[13px] leading-relaxed text-ink outline-none focus:border-pine-400"
              />
            ) : (
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{draft}</p>
            )}
            {conversation.knowledgeUsed.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-1.5">
                {conversation.knowledgeUsed.map((k) => (
                  <span key={k} className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10.5px] text-ink-3">
                    {k}
                  </span>
                ))}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => takeOver(conversation.id, staffName)}>
              Take over
            </Button>
            <Button size="sm" variant="outline" onClick={() => sendReply(conversation.id, draft, "ai")}>
              Approve AI reply
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setEditing((v) => !v)}>
              {editing ? "Keep changes" : "Modify reply"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => resolveConversation(conversation.id)}>
              Resolve
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
