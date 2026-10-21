import { ManualMailboxForm } from './ManualMailboxForm';
import { useEffect, useState } from "react";
import { ArrowRight, Check, Loader2, Lock, Mail, Search, Settings2, ShieldCheck } from "lucide-react";
import { isEmailish } from "@/lib/onboarding";
import { connectEmail, runEmailDetection, toast, useApp } from "@/lib/store";
import { api } from "@/lib/api";
import { Badge, Button, Card, Eyebrow, SectionTitle } from "./ui";
import { ConnectionHealth } from "./ConnectionHealth";

const providerMark: Record<string, string> = {
  google: "Google Workspace",
  microsoft: "Microsoft 365",
  hostinger: "Hostinger Email",
  zoho: "Zoho Mail",
  fastmail: "Fastmail",
  proton: "Proton Mail",
};

/** The three checks the wizard promises to report for a credentials provider. */
function DetectionChecks({ checks }: { checks: { incoming: boolean; outgoing: boolean; security: boolean } }) {
  const rows = [
    { label: "Incoming mail", ok: checks.incoming },
    { label: "Outgoing mail", ok: checks.outgoing },
    { label: "Security", ok: checks.security },
  ];
  return (
    <div className="mt-3 space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[12.5px]">
          <span className="w-28 text-ink-4">{r.label}</span>
          {r.ok ? (
            <span className="inline-flex items-center gap-1 font-medium text-good">
              <Check className="size-3.5" /> detected
            </span>
          ) : (
            <span className="text-ink-4">not found</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function OnboardingEmailStep() {
  const email = useApp((s) => s.onboarding.email);
  const profile = useApp((s) => s.hotelProfile);

  const [address, setAddress] = useState(email.address || `reception@${profile.website}`);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [advanced, setAdvanced] = useState(false);

  const detection = email.detection;
  const connected = email.state === "connected";

  // Handle return from Real Google OAuth
  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlParams = new URLSearchParams(window.location.search);
    const oauthStatus = urlParams.get("oauth_status");

    if (oauthStatus === "success") {
      const emailAccount = urlParams.get("email") || address;
      connectEmail("oauth", null, undefined, emailAccount).then((connected) => {
        if (connected) toast("Mailbox connected", "good", emailAccount);
      });
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    } else if (oauthStatus === "error") {
      const msg = urlParams.get("message") || "Email authorization failed";
      toast("Could not connect mailbox", "urgent", decodeURIComponent(msg));
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }, []);

  const detect = async () => {
    setBusy(true);
    const result = await runEmailDetection(address.trim());
    setBusy(false);
    setAdvanced(result.method === "manual");
  };

  const handleContinueWithOAuth = async (provider: "google" | "microsoft") => {
    setBusy(true);
    try {
      const result = provider === "microsoft"
        ? await api.getMicrosoftOAuthUrl("/onboarding")
        : await api.getGoogleOAuthUrl("/onboarding");
      if (!result?.url) throw new Error('Could not generate authorization URL');
      window.location.href = result.url;
    } catch (err: any) {
      toast("Email authorization failed", "urgent", err?.message || "Please try again");
      setBusy(false);
    }
  };

  if (connected) {
    return (
      <Card>
        <SectionTitle title="Email" hint="Guest email arrives in the same thread as their WhatsApp" />
        <ConnectionHealth
          title="Guest mailbox"
          identifier={email.address}
          state="connected"
          rows={[
            { label: "Receive mail", ok: true },
            { label: "Send and reply in thread", ok: true },
            { label: "Method", value: email.method === "oauth" ? "OAuth" : email.method === "manual" ? "IMAP / SMTP" : "App password" },
            { label: "Last message", value: email.lastMessage ?? "—" },
          ]}
        />
        <p className="mt-3 border-t border-line-soft pt-3 text-[11.5px] leading-snug text-ink-4">
          A guest who writes by email and then by WhatsApp stays one conversation. Nothing is copied between mailboxes.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <SectionTitle
          title="Which mailbox do guests write to?"
          hint="We look up your domain and work out how to connect it — no server settings unless we have to ask"
        />

        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[240px] flex-1">
            <span className="text-[11.5px] font-medium text-ink-3">Email address for guest communication</span>
            <div className="mt-1 flex items-center gap-2 rounded-[9px] border border-line bg-surface px-2.5 focus-within:border-pine-400">
              <Mail className="size-3.5 shrink-0 text-ink-4" />
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && isEmailish(address) && !busy) void detect();
                }}
                placeholder="reception@yourhotel.com"
                className="tnum w-full bg-transparent py-2 font-mono text-[12.5px] outline-none"
              />
            </div>
          </label>
          <Button icon={busy ? Loader2 : Search} disabled={!isEmailish(address) || busy} onClick={() => void detect()}>
            {busy ? "Looking up…" : "Detect settings"}
          </Button>
        </div>

        {busy && (
          <div className="mt-3 rounded-[10px] border border-line bg-paper/50 p-3.5">
            <ol className="space-y-1.5 text-[12.5px] text-ink-3">
              {[
                `Reading the domain — ${address.split("@")[1] ?? ""}`,
                "Looking up MX records",
                "Matching the provider",
                "Trying autodiscovery if needed",
              ].map((line) => (
                <li key={line} className="flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin text-ai" />
                  {line}
                </li>
              ))}
            </ol>
          </div>
        )}

        {detection && !busy && (
          <div className="mt-4">
            {/* known provider, OAuth ------------------------------------------- */}
            {detection.method === "oauth" && (
              <div className="rounded-[10px] border border-pine-200 bg-pine-50/60 p-3.5">
                <Eyebrow>We detected</Eyebrow>
                <p className="mt-1 font-display text-[19px] leading-tight font-medium text-ink">
                  {providerMark[detection.provider] ?? detection.providerName}
                </p>
                <p className="tnum mt-0.5 font-mono text-[12.5px] text-ink-2">{email.address}</p>
                {detection.note && <p className="mt-2 text-[12px] leading-snug text-ink-3">{detection.note}</p>}
                <Button
                  className="mt-3"
                  icon={ArrowRight}
                  disabled={busy}
                  onClick={() => handleContinueWithOAuth(detection.provider === "microsoft" ? "microsoft" : "google")}
                >
                  Continue with {detection.provider === "microsoft" ? "Microsoft" : "Google"}
                </Button>
                <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-ink-4">
                  <ShieldCheck className="mt-px size-3.5 shrink-0 text-pine-600" />
                  You sign in with {detection.provider === "microsoft" ? "Microsoft" : "Google"} and approve the access.
                  Hotelogx never sees your password.
                </p>
              </div>
            )}

            {/* known provider, credentials ------------------------------------- */}
            {detection.method === "credentials" && (
              <div className="rounded-[10px] border border-line bg-surface p-3.5">
                <Eyebrow>We detected</Eyebrow>
                <p className="mt-1 font-display text-[19px] leading-tight font-medium text-ink">
                  {providerMark[detection.provider] ?? detection.providerName}
                </p>
                <DetectionChecks checks={detection.checks} />
                {detection.note && <p className="mt-2.5 text-[12px] leading-snug text-ink-3">{detection.note}</p>}

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-[11.5px] font-medium text-ink-3">Email</span>
                    <input
                      value={email.address}
                      readOnly
                      className="tnum mt-1 w-full rounded-[9px] border border-line bg-paper/60 px-2.5 py-2 font-mono text-[12.5px] text-ink-2 outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11.5px] font-medium text-ink-3">Password / App password</span>
                    <div className="mt-1 flex items-center gap-2 rounded-[9px] border border-line bg-surface px-2.5 focus-within:border-pine-400">
                      <Lock className="size-3.5 shrink-0 text-ink-4" />
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••"
                        className="w-full bg-transparent py-2 font-mono text-[12.5px] outline-none"
                      />
                    </div>
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button disabled={busy || password.length < 4} onClick={async () => { setBusy(true); try { if (await connectEmail("credentials", detection.settings, password, email.address || address)) setPassword(""); } finally { setBusy(false); } }}>
                    Connect
                  </Button>
                  <Button variant="ghost" icon={Settings2} onClick={() => setAdvanced((v) => !v)}>
                    Advanced setup
                  </Button>
                </div>
              </div>
            )}

            {/* nothing recognised --------------------------------------------- */}
            {detection.method === "manual" && (
              <div className="rounded-[10px] border border-attend/30 bg-attend-bg/40 p-3.5">
                <p className="text-[13.5px] font-medium text-ink">We couldn't detect your email settings automatically.</p>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
                  {detection.note ?? "Your provider does not publish the records we look for."}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Badge tone="mute">MX {detection.mx.length ? `· ${detection.mx.length} found` : "· none"}</Badge>
                  <Badge tone="mute">Autodiscover {detection.autodiscover?.https ? "· found" : "· none"}</Badge>
                  <Badge tone="mute">SRV {detection.autodiscover?.srv ? "· found" : "· none"}</Badge>
                </div>
                {!advanced && (
                  <Button className="mt-3" variant="outline" icon={Settings2} onClick={() => setAdvanced(true)}>
                    Advanced Setup
                  </Button>
                )}
              </div>
            )}

            {/* manual IMAP / SMTP -------------------------------------------- */}
            {advanced && <ManualMailboxForm />}

            {/* what the lookup actually found -------------------------------- */}
            <details className="mt-3 rounded-[10px] border border-line-soft bg-surface px-3 py-2">
              <summary className="cursor-pointer text-[11.5px] font-medium text-ink-3">What the lookup found</summary>
              <div className="mt-2 space-y-1 text-[11.5px] text-ink-4">
                <p>
                  Domain <span className="tnum font-mono text-ink-2">{detection.domain}</span>
                </p>
                <p>
                  MX{" "}
                  <span className="tnum font-mono text-ink-2">
                    {detection.mx.length ? detection.mx.join(", ") : "none published"}
                  </span>
                </p>
                <p>
                  Resolved by{" "}
                  <span className="font-medium text-ink-2">
                    {detection.source === "mx"
                      ? "MX record match"
                      : detection.source === "autodiscover"
                        ? "autodiscovery"
                        : detection.source === "offline"
                          ? "local fallback — the lookup service was unreachable"
                          : "nothing matched"}
                  </span>
                </p>
              </div>
            </details>
          </div>
        )}
      </Card>


    </>
  );
}
