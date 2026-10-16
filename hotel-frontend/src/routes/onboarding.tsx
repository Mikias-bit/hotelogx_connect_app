import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { Toaster } from "@/components/ui";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/onboarding")({
  component: Onboarding,
});

function Onboarding() {
  const [mounted, setMounted] = useState(false);
  const session = useSession();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !session.ready) {
    return (
      <div className="grain flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper">
        <Logo size={40} />
        <p className="text-[13px] text-ink-3">Opening setup…</p>
      </div>
    );
  }

  return (
    <>
      <OnboardingWizard />
      <Toaster />
    </>
  );
}
