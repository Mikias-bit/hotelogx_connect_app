import type { ReactNode } from "react";
import { Check, CircleAlert, Loader2, Minus } from "lucide-react";
import type { ConnectionState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, Eyebrow } from "./ui";

const label: Record<ConnectionState, string> = {
  "not-started": "Not connected",
  "in-progress": "Connecting",
  connected: "Connected",
  error: "Needs attention",
};

function tone(state: ConnectionState) {
  switch (state) {
    case "connected":
      return "good" as const;
    case "in-progress":
      return "ai" as const;
    case "error":
      return "urgent" as const;
    default:
      return "mute" as const;
  }
}

/**
 * The manager-facing view of a connection: a plain status and a few facts they can act
 * on. Hosts, ports and tokens stay out of it — those live behind Advanced setup.
 */
export function ConnectionHealth({
  title,
  identifier,
  state,
  rows,
  actions,
  error,
  className,
}: {
  title: string;
  identifier?: string | null;
  state: ConnectionState;
  rows?: { label: string; ok?: boolean; value?: string }[];
  actions?: ReactNode;
  error?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[10px] border p-3.5", state === "connected" ? "border-pine-200 bg-pine-50/60" : "border-line bg-surface", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{title}</Eyebrow>
          {identifier && <p className="tnum mt-1 font-mono text-[13px] text-ink">{identifier}</p>}
        </div>
        <Badge tone={tone(state)} dot>
          {label[state]}
        </Badge>
      </div>

      {rows && rows.length > 0 && (
        <div className="mt-2.5 divide-y divide-line-soft border-t border-line-soft pt-1">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-[12px] text-ink-4">{row.label}</span>
              {row.value !== undefined ? (
                <span className="tnum text-right font-mono text-[12px] font-medium text-ink-2">{row.value}</span>
              ) : row.ok === undefined ? (
                <Minus className="size-3.5 text-ink-4" />
              ) : row.ok ? (
                <Check className="size-3.5 text-good" />
              ) : (
                <CircleAlert className="size-3.5 text-attend" />
              )}
            </div>
          ))}
        </div>
      )}

      {state === "in-progress" && (
        <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-ink-4">
          <Loader2 className="size-3.5 animate-spin text-ai" />
          Waiting for the provider…
        </p>
      )}

      {error && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-urgent">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}

      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
