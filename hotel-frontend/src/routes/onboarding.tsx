import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { Toaster } from "@/components/ui";
import { useSession } from "@/lib/session";
import { initBackendSync } from '@/lib/store';

export const Route = createFileRoute("/onboarding")({
  component: Onboarding,
});

function Onboarding() {
  const [mounted, setMounted] = useState(false);
  const session = useSession();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    if (session.ready && session.user?.role !== 'manager') navigate({ to: '/login', replace: true });
    if (session.ready && session.user?.role === 'manager') {
      let cancelled = false;
      initBackendSync({ force: true }).then(ok => { if (!cancelled) { setLoaded(Boolean(ok)); setLoadError(!ok); } });
      return () => { cancelled = true; };
    }
  }, [session.ready, session.user, navigate]);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (loadError) return <div className="p-8 text-center"><p>Could not load your approved hotel profile.</p><a href="/onboarding" className="underline">Retry setup</a></div>;
  if (!mounted || !session.ready || session.user?.role !== 'manager' || !loaded) {
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
