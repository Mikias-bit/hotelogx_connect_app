import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { roleHome, useCurrentUser, useSession } from "@/lib/session";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/")({
  component: Entry,
});

function Entry() {
  const session = useSession();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const setupDone = useApp((s) => s.onboarding.complete);

  useEffect(() => {
    if (!session.ready) return;
    if (!user) {
      navigate({ to: "/login", replace: true });
      return;
    }
    // A hotel that has not finished setup goes to the wizard first; only a manager can run it.
    if (!setupDone && user.role === "manager") {
      navigate({ to: "/onboarding" });
      return;
    }
    navigate({ to: roleHome[user.role] });
  }, [session.ready, user, setupDone, navigate]);

  return (
    <div className="grain flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper">
      <Logo size={40} />
      <p className="text-[13px] text-ink-3">Opening your workspace…</p>
    </div>
  );
}
