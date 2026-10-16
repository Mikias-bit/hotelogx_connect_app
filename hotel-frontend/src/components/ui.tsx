import type { ReactNode } from "react";
import {
  BellRing,
  CheckCheck,
  Mail,
  MessageCircle,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { dismissToast, useApp } from "@/lib/store";
import type { Priority } from "@/lib/types";

export type Tone = "good" | "attend" | "urgent" | "ai" | "mute" | "pine";

const toneChip: Record<Tone, string> = {
  good: "bg-good-bg text-good border-good/20",
  attend: "bg-attend-bg text-attend border-attend/20",
  urgent: "bg-urgent-bg text-urgent border-urgent/20",
  ai: "bg-ai-bg text-ai border-ai/20",
  mute: "bg-mute-bg text-ink-3 border-line",
  pine: "bg-pine-50 text-pine-700 border-pine-200",
};

const toneText: Record<Tone, string> = {
  good: "text-good",
  attend: "text-attend",
  urgent: "text-urgent",
  ai: "text-ai",
  mute: "text-ink-3",
  pine: "text-pine-600",
};

const toneBg: Record<Tone, string> = {
  good: "bg-good",
  attend: "bg-attend",
  urgent: "bg-urgent",
  ai: "bg-ai",
  mute: "bg-ink-4",
  pine: "bg-pine-500",
};

export function Card({
  children,
  className,
  as: As = "div",
  pad = true,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
  pad?: boolean;
}) {
  return (
    <As
      className={cn(
        "rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(25,29,26,0.03)]",
        pad && "p-5",
        className,
      )}
    >
      {children}
    </As>
  );
}

export function Badge({
  children,
  tone = "mute",
  className,
  dot,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        toneChip[tone],
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", toneBg[tone])} />}
      {children}
    </span>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4", className)}>{children}</p>
  );
}

export function SectionTitle({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-4", className)}>
      <div>
        <h2 className="font-display text-[19px] leading-tight font-medium text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-ink-3">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  className,
  icon: Icon,
  disabled,
  type = "button",
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline" | "quiet" | "danger" | "ghost";
  size?: "sm" | "md";
  className?: string;
  icon?: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const variants: Record<string, string> = {
    primary: "bg-pine-600 text-white hover:bg-pine-700 border border-pine-700/20",
    outline: "bg-surface text-ink border border-line hover:border-ink-4 hover:bg-paper",
    quiet: "bg-paper-2 text-ink-2 border border-transparent hover:bg-line-soft",
    danger: "bg-urgent-bg text-urgent border border-urgent/25 hover:bg-urgent hover:text-white",
    ghost: "bg-transparent text-ink-3 border border-transparent hover:text-ink hover:bg-paper-2",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[9px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-8 px-2.5 text-[12.5px]" : "h-9.5 px-3.5 text-[13.5px]",
        variants[variant],
        className,
      )}
    >
      {Icon && <Icon className={size === "sm" ? "size-3.5" : "size-4"} />}
      {children}
    </button>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "mute",
  icon: Icon,
  emphasis,
  delay = 0,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
  icon?: React.ComponentType<{ className?: string }>;
  emphasis?: boolean;
  delay?: number;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "rise rounded-card border bg-surface p-4",
        emphasis ? "border-urgent/25 bg-urgent-bg/40" : "border-line",
        onClick && "cursor-pointer transition-colors hover:border-ink-4",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium text-ink-3">{label}</p>
        {Icon && <Icon className={cn("size-4 shrink-0", toneText[tone])} />}
      </div>
      <p className={cn("tnum mt-2 font-display text-[30px] leading-none font-medium", emphasis ? "text-urgent" : "text-ink")}>
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11.5px] text-ink-4">{hint}</p>}
    </div>
  );
}

export function Avatar({
  initials,
  size = 34,
  tone = "pine",
  className,
}: {
  initials: string;
  size?: number;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border font-medium",
        toneChip[tone],
        className,
      )}
    >
      {initials}
    </span>
  );
}

export function ChannelMark({
  channel,
  withLabel,
  className,
}: {
  channel: string;
  withLabel?: boolean;
  className?: string;
}) {
  const map: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
    whatsapp: { icon: MessageCircle, color: "text-wa", label: "WhatsApp" },
    gmail: { icon: Mail, color: "text-urgent", label: "Gmail" },
    outlook: { icon: Mail, color: "text-ai", label: "Outlook" },
    email: { icon: Mail, color: "text-ink-3", label: "Email" },
    ai: { icon: Sparkles, color: "text-ai", label: "AI" },
    staff: { icon: UserRound, color: "text-pine-600", label: "Staff" },
    internal: { icon: BellRing, color: "text-ink-4", label: "Internal" },
  };
  const meta = map[channel] ?? map.internal;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Icon className={cn("size-3.5 shrink-0", meta.color)} />
      {withLabel && <span className="text-[11.5px] text-ink-3">{meta.label}</span>}
    </span>
  );
}

export function Sparkline({
  values,
  tone = "pine",
  width = 132,
  height = 34,
}: {
  values: number[];
  tone?: Tone;
  width?: number;
  height?: number;
}) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * (height - 6) - 3).toFixed(1)}`);
  const stroke = {
    good: "#3f7d52",
    attend: "#a8760f",
    urgent: "#b0453a",
    ai: "#3f5c96",
    mute: "#99a09a",
    pine: "#2f6b5b",
  }[tone];
  const last = points[points.length - 1].split(",");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={points.join(" ")} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={stroke} />
    </svg>
  );
}

export function Meter({ value, tone = "pine", className }: { value: number; tone?: Tone; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-paper-2", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", toneBg[tone])} style={{ width: `${Math.min(100, Math.max(2, value))}%` }} />
    </div>
  );
}

export function Empty({ title, hint, icon: Icon }: { title: string; hint?: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line px-6 py-10 text-center">
      {Icon && <Icon className="size-5 text-ink-4" />}
      <p className="text-[14px] font-medium text-ink-2">{title}</p>
      {hint && <p className="max-w-xs text-[12.5px] text-ink-4">{hint}</p>}
    </div>
  );
}

export function KeyValue({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[12px] text-ink-4">{label}</span>
      <span className={cn("text-right text-[12.5px] font-medium text-ink-2", mono && "tnum font-mono text-[12px]")}>{value}</span>
    </div>
  );
}

export function Toaster() {
  const toasts = useApp((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-60 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="slide-in-right pointer-events-auto flex items-start gap-3 rounded-card border border-line bg-surface p-3 shadow-[0_8px_24px_-12px_rgba(25,29,26,0.25)]"
        >
          <span className={cn("mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border", toneChip[t.tone])}>
            {t.tone === "ai" ? <Sparkles className="size-3" /> : <CheckCheck className="size-3" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">{t.text}</p>
            {t.detail && <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{t.detail}</p>}
          </div>
          <button onClick={() => dismissToast(t.id)} className="text-ink-4 transition-colors hover:text-ink">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "Clean":
    case "Inspected":
    case "Completed":
    case "resolved":
    case "Accepted":
    case "Active":
    case "Paid":
      return "good";
    case "Cleaning":
    case "In Progress":
    case "Assigned":
    case "Waiting":
    case "Waiting Parts":
    case "DND":
    case "Guest Inside":
    case "Sent":
      return "attend";
    case "Dirty":
    case "Escalated":
    case "escalated":
    case "Maintenance":
    case "Urgent":
    case "Past Due":
    case "Failed":
      return "urgent";
    case "ai-handling":
    case "New":
    case "Open":
    case "Trialing":
      return "ai";
    case "human-takeover":
      return "pine";
    default:
      return "mute";
  }
}

export function priorityTone(priority: Priority): Tone {
  switch (priority) {
    case "Urgent":
      return "urgent";
    case "High":
      return "attend";
    case "Normal":
      return "mute";
    default:
      return "mute";
  }
}
