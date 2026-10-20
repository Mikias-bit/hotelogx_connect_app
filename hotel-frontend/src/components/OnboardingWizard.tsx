import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, LayoutDashboard, Sparkles, X } from "lucide-react";
import { Logo } from "./Logo";
import { Badge, Button, Card, Eyebrow } from "./ui";
import { OnboardingAiStep } from "./OnboardingAiStep";
import { OnboardingEmailStep } from "./OnboardingEmailStep";
import { OnboardingKnowledgeStep } from "./OnboardingKnowledgeStep";
import { OnboardingPmsStep } from "./OnboardingPmsStep";
import { OnboardingProfileStep } from "./OnboardingProfileStep";
import { OnboardingUsersStep } from "./OnboardingUsersStep";
import { OnboardingWhatsAppStep } from "./OnboardingWhatsAppStep";
import { onboardingSteps, stepsForTopology, waTopologyOptions } from "@/lib/onboarding";
import { completeOnboarding, markOnboardingStep, setWaTopology, store, toast, updateHotelProfile, useApp } from "@/lib/store";
import { roleHome, useCurrentUser } from "@/lib/session";
import type { HotelProfile, OnboardingStepKey, Role, StaffUser, WaTopology } from "@/lib/types";
import { cn } from "@/lib/utils";

function StepBody({
  step,
  onProfileChange,
}: {
  step: OnboardingStepKey;
  onProfileChange?: (draft: HotelProfile) => void;
}) {
  switch (step) {
    case "profile":
      return <OnboardingProfileStep onDraftChange={onProfileChange} />;
    case "pms":
      return <OnboardingPmsStep />;
    case "email":
      return <OnboardingEmailStep />;
    case "wa-guest":
      return <OnboardingWhatsAppStep connectionType="guest" />;
    case "wa-internal":
      return <OnboardingWhatsAppStep connectionType="internal" />;
    case "knowledge":
      return <OnboardingKnowledgeStep />;
    case "users":
      return <OnboardingUsersStep />;
    case "ai":
      return <OnboardingAiStep />;
  }
}

export function OnboardingWizard() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const onboarding = useApp((s) => s.onboarding);
  const profile = useApp((s) => s.hotelProfile);
  const aiMode = useApp((s) => s.aiMode);

  const hasOauthReturn = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("oauth_status");

  const [stage, setStage] = useState<"welcome" | "checklist" | "finish">(
    hasOauthReturn || onboarding.waTopology ? "checklist" : "welcome"
  );
  const [topology, setTopology] = useState<WaTopology>(onboarding.waTopology ?? "separate");
  const [open, setOpen] = useState<OnboardingStepKey | null>(hasOauthReturn ? "email" : null);
  const [profileDraft, setProfileDraft] = useState<HotelProfile | null>(null);

  const steps = stepsForTopology(onboarding.waTopology);
  const doneCount = steps.filter((s) => onboarding.done[s.key]).length;
  const required = steps.filter((s) => !s.optional);
  const ready = required.every((s) => onboarding.done[s.key]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const index = open ? steps.findIndex((s) => s.key === open) : -1;
  const current = index >= 0 ? steps[index] : null;

  const advance = async (mark: boolean) => {
    if (!current) return;
    if (current.key === "profile") {
      if (!user || !window.localStorage.getItem("token") || !onboarding.done.profile) {
        toast("Save your manager account and profile first", "urgent", "Use the profile save button above, or sign in to your existing hotel account.");
        return;
      }
      if (mark && profileDraft && !await updateHotelProfile(profileDraft)) return;
    }
    if (mark) markOnboardingStep(current.key);
    const next = steps[index + 1];
    setOpen(next ? next.key : null);
  };

  /* --- welcome --- */
  if (stage === "welcome") {
    return (
      <div className="grain min-h-dvh bg-paper px-5 py-10 sm:px-8 sm:py-14">
        <div className="mx-auto max-w-[720px]">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span>
              <span className="block font-display text-[15px] leading-tight font-semibold text-ink">Hotelogx</span>
              <span className="block text-[10px] tracking-[0.14em] text-ink-4 uppercase">Connect</span>
            </span>
          </div>

          <h1 className="rise mt-9 font-display text-[32px] leading-[1.1] font-medium text-ink sm:text-[38px]">
            Welcome to Hotelogx Connect
          </h1>
          <p className="rise mt-3 max-w-[54ch] text-[14px] leading-relaxed text-ink-3" style={{ animationDelay: "60ms" }}>
            Eight steps and {profile.name} is live. Most of them take a minute — you pick the provider, sign in once, and we
            configure the rest on our side. You can skip anything and come back to it under Settings.
          </p>

          <ol className="mt-8 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {onboardingSteps.map((step, i) => (
              <li key={step.key} className="rise flex gap-3" style={{ animationDelay: `${100 + i * 35}ms` }}>
                <span className="tnum mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[11px] text-ink-4">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink">{step.label}</p>
                  <p className="text-[11.5px] leading-snug text-ink-4">{step.blurb}</p>
                </div>
              </li>
            ))}
          </ol>

          <Card className="mt-8">
            <Eyebrow>One question before we start</Eyebrow>
            <p className="mt-1 text-[14px] font-medium text-ink">How does your hotel use WhatsApp?</p>
            <p className="mt-0.5 text-[12px] text-ink-4">
              Guests and staff can share a number, but most hotels keep them apart so operations chatter never reaches a guest.
            </p>
            <div className="mt-3.5 space-y-1.5">
              {waTopologyOptions.map((option) => (
                <button
                  key={option.key}
                  onClick={() => setTopology(option.key)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
                    topology === option.key ? "border-pine-400 bg-pine-50" : "border-line bg-surface hover:border-ink-4",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
                      topology === option.key ? "border-pine-600" : "border-line",
                    )}
                  >
                    {topology === option.key && <span className="size-2 rounded-full bg-pine-600" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{option.label}</span>
                    <span className="block text-[11.5px] leading-snug text-ink-3">{option.note}</span>
                  </span>
                </button>
              ))}
            </div>
          </Card>

          <Button
            className="mt-6"
            icon={ArrowRight}
            onClick={() => {
              setWaTopology(topology);
              setStage("checklist");
            }}
          >
            Start setup
          </Button>
          <p className="mt-3 text-[11.5px] text-ink-4">Nothing is charged during setup, and no reservation is ever touched.</p>
        </div>
      </div>
    );
  }

  /* --- finish --- */
  if (stage === "finish") {
    return (
      <div className="grain flex min-h-dvh items-center justify-center bg-paper px-5 py-12">
        <div className="w-full max-w-[520px] text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-good-bg text-good">
            <Check className="size-6" />
          </span>
          <h1 className="rise mt-5 font-display text-[30px] leading-tight font-medium text-ink">
            {profile.name} is set up
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-3">
            {doneCount} of {steps.length} steps done. The AI starts in{" "}
            <span className="font-medium text-ink-2">{aiModeLabel(aiMode)}</span> — you can change that, add documents and invite
            more colleagues at any time under Settings.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button
              icon={LayoutDashboard}
              onClick={async () => {
                completeOnboarding();
                const invitedUsers = store.state.users as StaffUser[];
                const activeUser = user;
                if (!activeUser || (typeof window !== "undefined" && !window.localStorage.getItem("token"))) {
                  navigate({ to: "/login" });
                  return;
                }
                if (typeof window !== "undefined" && activeUser) {
                  const displayUsers = (invitedUsers && invitedUsers.length > 0 ? invitedUsers : [activeUser]).map((u) => ({
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    role: u.role,
                    title: u.title || "Staff",
                    initials: u.initials || "ST",
                  }));
                  window.localStorage.setItem(
                    "hotelogx.recent_hotel_meta.v1",
                    JSON.stringify({
                      name: profile.name || "Hotel Workspace",
                      users: displayUsers,
                    })
                  );
                }
                navigate({ to: roleHome[activeUser.role as Role] || "/manager" });
              }}
            >
              Open the dashboard
            </Button>
            <Button variant="quiet" onClick={() => setStage("checklist")}>
              Back to the checklist
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* --- checklist --- */
  return (
    <div className="grain min-h-dvh bg-paper">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-3 px-5 py-3 sm:px-8">
          <Logo size={26} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[14.5px] font-medium text-ink">Setting up {profile.name}</p>
            <p className="text-[11.5px] text-ink-4">
              {doneCount} of {steps.length} steps done
            </p>
          </div>
          <div className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-line-soft sm:block">
            <div
              className="h-full rounded-full bg-pine-600 transition-[width] duration-500"
              style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }}
            />
          </div>
          <Button size="sm" variant={ready ? "primary" : "outline"} icon={ArrowRight} onClick={() => setStage("finish")}>
            Finish
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] px-5 py-8 sm:px-8">
        <h2 className="font-display text-[22px] font-medium text-ink">Your setup checklist</h2>
        <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-ink-3">
          Open a step to set it up. Connections sign you in with the provider and we configure the technical side — you only
          ever see whether it is healthy.
        </p>

        <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
          {steps.map((step, i) => {
            const isDone = onboarding.done[step.key];
            return (
              <li key={step.key} className="rise" style={{ animationDelay: `${i * 40}ms` }}>
                <button
                  onClick={() => setOpen(step.key)}
                  className="flex w-full items-start gap-3 rounded-card border border-line bg-surface px-4 py-3.5 text-left transition-colors hover:border-pine-400"
                >
                  <span
                    className={cn(
                      "tnum mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px]",
                      isDone ? "bg-good-bg text-good" : "border border-line text-ink-4",
                    )}
                  >
                    {isDone ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium text-ink">{step.label}</span>
                      {isDone ? <Badge tone="good">Done</Badge> : step.optional ? <Badge tone="mute">Optional</Badge> : null}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">{step.blurb}</span>
                  </span>
                  <ArrowRight className="mt-1 size-3.5 shrink-0 text-ink-4" />
                </button>
              </li>
            );
          })}
        </ul>

        <p className="mt-6 flex max-w-[64ch] items-start gap-2 border-t border-line-soft pt-5 text-[11.5px] leading-snug text-ink-4">
          <Sparkles className="mt-px size-3.5 shrink-0 text-ai" />
          Hotelogx Connect reads reservations, availability and rates from your PMS. It never creates, changes or cancels a
          booking and never takes payment — availability questions always finish on your own booking engine.
        </p>
      </main>

      {current && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/25 px-3 py-6 backdrop-blur-sm sm:px-6 sm:py-10">
          <div className="rise w-full max-w-[860px] overflow-hidden rounded-card border border-line bg-paper shadow-lg">
            <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 sm:px-5">
              <span className="tnum inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-pine-50 font-mono text-[11px] text-pine-700">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-medium text-ink">{current.label}</p>
                <p className="truncate text-[11.5px] text-ink-4">{current.blurb}</p>
              </div>
              {onboarding.done[current.key] && <Badge tone="good">Done</Badge>}
              <Button size="sm" variant="ghost" icon={X} onClick={() => setOpen(null)} />
            </div>

            <div className="max-h-[70dvh] overflow-y-auto bg-paper p-4 sm:p-5">
              <StepBody step={current.key} onProfileChange={setProfileDraft} />
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3 sm:px-5">
              <Button
                size="sm"
                variant="quiet"
                icon={ArrowLeft}
                disabled={index === 0}
                onClick={() => {
                  const prev = steps[index - 1];
                  if (prev) setOpen(prev.key);
                }}
              >
                Previous
              </Button>
              <span className="tnum ml-auto font-mono text-[11px] text-ink-4">
                {index + 1} / {steps.length}
              </span>
              <Button size="sm" variant="outline" onClick={() => advance(false)}>
                Skip for now
              </Button>
              <Button size="sm" icon={ArrowRight} onClick={() => advance(true)}>
                {index === steps.length - 1 ? "Mark done" : "Save and continue"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function aiModeLabel(mode: "Autonomous" | "Approval Required" | "Suggestions Only") {
  return mode === "Approval Required" ? "approval required" : mode === "Suggestions Only" ? "suggestions only" : "autonomous";
}
