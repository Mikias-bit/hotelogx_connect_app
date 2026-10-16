import { Shield, Sparkles } from "lucide-react";
import { setAiMode, setAiRule, useApp } from "@/lib/store";
import type { AiRule } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, Eyebrow, SectionTitle } from "./ui";

const modes: AiRule["mode"][] = ["Autonomous", "Human Approval", "Always Escalate"];

const globalModes = [
  { key: "Autonomous" as const, label: "Autonomous", note: "The AI replies on its own and escalates by rule." },
  { key: "Approval Required" as const, label: "Approval required", note: "Every reply waits for a person to approve it." },
  { key: "Suggestions Only" as const, label: "Suggestions only", note: "The AI drafts, nothing is sent automatically." },
];

export function OnboardingAiStep() {
  const aiMode = useApp((s) => s.aiMode);
  const rules = useApp((s) => s.aiRules);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px] lg:items-start">
      <div className="space-y-4">
        <Card>
          <SectionTitle
            title="How much freedom should the AI have?"
            hint="Most hotels start on Approval required and move to Autonomous within a fortnight"
          />
          <div className="grid gap-3 sm:grid-cols-3">
            {globalModes.map((m) => (
              <button
                key={m.key}
                onClick={() => setAiMode(m.key)}
                className={cn(
                  "rounded-[10px] border p-3.5 text-left transition-colors",
                  aiMode === m.key ? "border-pine-400 bg-pine-50/60" : "border-line bg-surface hover:border-ink-4",
                )}
              >
                <span className="flex items-center gap-2">
                  <Sparkles className={cn("size-3.5", aiMode === m.key ? "text-pine-600" : "text-ink-4")} />
                  <span className="text-[13px] font-medium text-ink">{m.label}</span>
                </span>
                <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{m.note}</p>
              </button>
            ))}
          </div>
        </Card>

        <Card pad={false}>
          <div className="border-b border-line px-4 py-3">
            <p className="text-[13.5px] font-medium text-ink">Rules by topic</p>
            <p className="text-[11.5px] text-ink-4">Anything not listed follows the setting above.</p>
          </div>
          <ul>
            {rules.map((rule) => (
              <li key={rule.topic} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{rule.topic}</p>
                  <p className="text-[11.5px] text-ink-4">{rule.note}</p>
                </div>
                <div className="flex gap-1">
                  {modes.map((m) => (
                    <button
                      key={m}
                      onClick={() => setAiRule(rule.topic, m)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                        rule.mode === m
                          ? m === "Autonomous"
                            ? "border-good/25 bg-good-bg text-good"
                            : m === "Human Approval"
                              ? "border-attend/25 bg-attend-bg text-attend"
                              : "border-urgent/25 bg-urgent-bg text-urgent"
                          : "border-line bg-surface text-ink-4 hover:text-ink",
                      )}
                    >
                      {m === "Autonomous" ? "Auto" : m === "Human Approval" ? "Approve" : "Escalate"}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <Eyebrow>Never automatic</Eyebrow>
          <ul className="mt-2 space-y-1.5">
            {rules
              .filter((r) => r.mode === "Always Escalate")
              .map((r) => (
                <li key={r.topic} className="flex items-start gap-1.5 text-[12.5px] text-ink-2">
                  <Shield className="mt-0.5 size-3.5 shrink-0 text-urgent" />
                  {r.topic}
                </li>
              ))}
          </ul>
          <p className="mt-3 border-t border-line-soft pt-3 text-[11.5px] leading-snug text-ink-4">
            Whatever you choose above, these always reach a person. The guest is told someone is looking at it.
          </p>
        </Card>
        <Card>
          <Eyebrow>And never at all</Eyebrow>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
            The AI cannot create, change or cancel a reservation, and cannot take payment. Availability questions always end
            at your booking engine. That is not a setting.
          </p>
        </Card>
      </div>
    </div>
  );
}
