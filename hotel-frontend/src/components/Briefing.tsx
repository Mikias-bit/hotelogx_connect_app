import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./ui";
import type { Tone } from "./ui";

export interface BriefLine {
  text: string;
  tone?: Tone;
  meta?: string;
}

const dotTone: Record<Tone, string> = {
  good: "bg-good",
  attend: "bg-attend",
  urgent: "bg-urgent",
  ai: "bg-ai",
  mute: "bg-ink-4",
  pine: "bg-pine-500",
};

export function Briefing({
  eyebrow = "AI daily briefing",
  opening,
  lines,
  action,
  footnote,
}: {
  eyebrow?: string;
  opening: string;
  lines: BriefLine[];
  action?: ReactNode;
  footnote?: string;
}) {
  return (
    <section className="rule-grid relative overflow-hidden rounded-card border border-line bg-surface">
      <span className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-pine-500 via-ai to-pine-200" aria-hidden />
      <div className="p-5 pl-6 sm:p-6 sm:pl-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-ai" />
              <Eyebrow>{eyebrow}</Eyebrow>
            </span>
            <p className="mt-2 max-w-2xl font-display text-[21px] leading-snug font-medium text-ink sm:text-[23px]">
              {opening}
            </p>
          </div>
          {action && <div className="hidden shrink-0 sm:block">{action}</div>}
        </div>

        <ul className="mt-5 grid gap-x-8 gap-y-1 sm:grid-cols-2">
          {lines.map((line, i) => (
            <li
              key={line.text}
              style={{ animationDelay: `${90 + i * 55}ms` }}
              className="rise flex items-start gap-2.5 border-t border-line-soft py-2.5 first:border-t-0 sm:first:border-t sm:[&:nth-child(-n+2)]:border-t-0"
            >
              <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", dotTone[line.tone ?? "mute"])} />
              <p className="text-[13.5px] leading-snug text-ink-2">
                {line.text}
                {line.meta && <span className="tnum ml-1.5 font-mono text-[11px] text-ink-4">{line.meta}</span>}
              </p>
            </li>
          ))}
        </ul>

        {footnote && <p className="mt-4 text-[11.5px] text-ink-4">{footnote}</p>}
        {action && <div className="mt-4 sm:hidden">{action}</div>}
      </div>
    </section>
  );
}
