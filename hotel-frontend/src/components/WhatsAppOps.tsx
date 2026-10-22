import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/session';
import { useEffect, useRef, useState } from "react";
import { Phone, Smartphone } from "lucide-react";
import { useApp, waChoose, toast, store } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./ui";

export function WhatsAppOps({ department }: { department?: "Housekeeping" | "Maintenance" }) {
  const user = useCurrentUser();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const threads = useApp((s) => s.waThreads);
  const visible = department ? threads.filter((t) => t.department === department) : threads;
  const [activeId, setActiveId] = useState(visible[0]?.id ?? "");
  const thread = visible.find((t) => t.id === activeId) ?? visible[0];
  const scrollRef = useRef<HTMLDivElement>(null);
  const count = thread?.messages.length ?? 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, thread?.id]);

  if (!thread) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center p-6 text-center">
        <div className="inline-flex size-12 items-center justify-center rounded-full bg-wa/10 text-wa">
          <Smartphone className="size-6" />
        </div>
        <p className="mt-3 font-display text-[15px] font-medium text-ink">WhatsApp Operations Layer</p>
        <p className="mt-1 max-w-xs text-[12px] text-ink-3">
          Staff WhatsApp messages and action buttons are loading from your active operational database.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3">
        <Eyebrow>WhatsApp operations layer</Eyebrow>
        <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
          This is what your team sees on their phones. Tap a button as they would — the dashboards update immediately.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {visible.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveId(t.id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              t.id === thread.id
                ? "border-pine-600 bg-pine-600 text-white"
                : "border-line bg-surface text-ink-3 hover:border-ink-4 hover:text-ink",
            )}
          >
            {t.contact.split(" ")[0]}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line">
        <header className="flex items-center gap-2.5 border-b border-line bg-[#f0f2f0] px-3 py-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-wa/12 text-wa">
            <Smartphone className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-ink">{thread.contact}</p>
            <p className="tnum truncate font-mono text-[10.5px] text-ink-4">
              {thread.phone} · {thread.role}
            </p>
          </div>
          <Phone className="size-3.5 text-ink-4" />
        </header>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-[#efeae2] px-3 py-3.5"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 10%, rgba(255,255,255,0.7), transparent 45%), radial-gradient(circle at 85% 70%, rgba(255,255,255,0.55), transparent 40%)",
          }}
        >
          {thread.messages.map((m) => (
            <div key={m.id}>
              <div className="max-w-[86%] rounded-[10px] rounded-tl-[3px] bg-white px-2.5 py-2 shadow-[0_1px_1px_rgba(11,20,26,0.13)]">
                <p className="text-[10px] font-semibold text-wa">{m.from === 'staff' ? thread.contact : 'Hotelogx Connect'}</p>
                <p className="mt-1 text-[12.5px] leading-snug whitespace-pre-line text-[#111b21]">{m.body}</p>
                <p className="tnum mt-1 text-right font-mono text-[9.5px] text-[#667781]">{m.at}</p>
                {m.buttons && m.buttons.length > 0 && (
                  <div className="mt-1.5 flex flex-col gap-px overflow-hidden rounded-[7px] border-t border-[#e9edef]">
                    {m.buttons.map((b) => {
                      const btnLabel = typeof b === "string" ? b : (b as any).label;
                      return (
                        <button
                          key={btnLabel}
                          disabled={Boolean(m.chosen)}
                          onClick={() => waChoose(thread.id, m.id, btnLabel)}
                          className={cn(
                            "bg-white py-1.5 text-[12.5px] font-medium text-[#027eb5] transition-colors",
                            m.chosen === btnLabel && "text-[#027eb5]/50",
                            m.chosen ? "cursor-default opacity-55" : "hover:bg-[#f5f6f6]",
                          )}
                        >
                          {btnLabel}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {m.chosen && (
                <div className="mt-1.5 flex justify-end">
                  <div className="max-w-[70%] rounded-[10px] rounded-tr-[3px] bg-[#d9fdd3] px-2.5 py-1.5 shadow-[0_1px_1px_rgba(11,20,26,0.13)]">
                    <p className="text-[12.5px] leading-snug text-[#111b21]">{m.chosen}</p>
                    <p className="tnum mt-0.5 flex items-center justify-end gap-1 font-mono text-[9.5px] text-[#667781]">
                      {m.at}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <footer className="border-t border-line bg-[#f0f2f0] px-3 py-2">
          {user?.role === 'manager' && <form className="flex gap-2" onSubmit={async e => {
            e.preventDefault(); if (!reply.trim() || sending) return; setSending(true);
            try {
              await api.replyToWhatsAppThread(thread.id, reply);
              setReply(''); const rows = await api.getWaThreads();
              if (rows) store.setState(s => ({ ...s, waThreads: rows }));
              toast('Meta accepted the reply', 'good', thread.contact);
            } catch (error) { toast('Reply failed', 'urgent', error instanceof Error ? error.message : 'Please retry'); }
            finally { setSending(false); }
          }}>
            <input aria-label="WhatsApp reply" className="min-w-0 flex-1 rounded border p-2 text-sm" value={reply} onChange={e => setReply(e.target.value)} />
            <button type="submit" disabled={sending || !reply.trim()}>{sending ? 'Sending?' : 'Send'}</button>
          </form>}
          <p className="mt-2 text-[10.5px] text-ink-4">Free-text replies require a recent inbound message from this recipient.</p>
        </footer>
      </div>
    </div>
  );
}
