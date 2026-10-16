import {
  ArrowUpRight,
  BedDouble,
  ClipboardList,
  MessageCircle,
  Sparkles,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./ui";

const defaultMeta = { icon: Sparkles, color: "text-ai" };

const kindMeta: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  "ai-reply": { icon: Sparkles, color: "text-ai" },
  ai: { icon: Sparkles, color: "text-ai" },
  task: { icon: ClipboardList, color: "text-pine-600" },
  escalation: { icon: TriangleAlert, color: "text-urgent" },
  upsell: { icon: ArrowUpRight, color: "text-good" },
  room: { icon: BedDouble, color: "text-attend" },
  maintenance: { icon: Wrench, color: "text-attend" },
  guest: { icon: MessageCircle, color: "text-wa" },
  issue: { icon: Wrench, color: "text-attend" },
  status: { icon: BedDouble, color: "text-attend" },
};

export function ActivityFeed({ limit = 10, compact }: { limit?: number; compact?: boolean }) {
  const activity = useApp((s) => s.activity) ?? [];
  return (
    <ol className="relative">
      <span className="absolute top-2 bottom-2 left-[9px] w-px bg-line-soft" aria-hidden />
      {activity.slice(0, limit).map((item) => {
        const meta = (item && item.kind ? kindMeta[item.kind] : undefined) ?? defaultMeta;
        const Icon = meta.icon;
        return (
          <li key={item.id} className={cn("relative flex gap-3 pl-0", compact ? "py-2" : "py-2.5")}>
            <span className="relative z-10 mt-0.5 inline-flex size-[19px] shrink-0 items-center justify-center rounded-full border border-line bg-surface">
              <Icon className={cn("size-[11px]", meta.color)} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-ink-2", compact ? "text-[12.5px] leading-snug" : "text-[13px] leading-snug")}>{item.text}</p>
              <p className="tnum mt-0.5 font-mono text-[10.5px] tracking-tight text-ink-4">
                {item.at}
                {item.meta && <span className="font-sans"> · {item.meta}</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ActivityPanel() {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <Eyebrow>Live</Eyebrow>
          <p className="mt-1 text-[13.5px] font-medium text-ink">What the AI has been doing</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-4">
          <span className="pulse-dot size-1.5 rounded-full bg-good" />
          streaming
        </span>
      </div>
      <ActivityFeed limit={16} compact />
    </div>
  );
}
