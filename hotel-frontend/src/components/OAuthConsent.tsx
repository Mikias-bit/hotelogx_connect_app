import { Check, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

const providerCopy = {
  google: { name: "Google", account: "Google Workspace account", host: "accounts.google.com" },
  microsoft: { name: "Microsoft", account: "Microsoft 365 account", host: "login.microsoftonline.com" },
  meta: { name: "Meta", account: "Facebook account", host: "business.facebook.com" },
  generic: { name: "your provider", account: "account", host: "provider.example.com" },
} as const;

export type OAuthProvider = keyof typeof providerCopy;

/**
 * Stands in for the provider's hosted sign-in page. In production the manager leaves
 * Hotelogx entirely and returns through a redirect; the point of showing it here is
 * that the credential is entered on the provider's domain, never on ours.
 */
export function OAuthConsent({
  provider,
  account,
  scopes,
  title,
  host,
  providerName,
  onAllow,
  onCancel,
}: {
  provider: OAuthProvider;
  account?: string;
  scopes: string[];
  title?: string;
  /** override the address bar and button copy for providers without a fixed brand */
  host?: string;
  providerName?: string;
  onAllow: () => void;
  onCancel: () => void;
}) {
  const base = providerCopy[provider];
  const copy = { ...base, name: providerName ?? base.name, host: host ?? base.host };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4">
      <div className="rise w-full max-w-md overflow-hidden rounded-card border border-line bg-surface shadow-lg">
        <div className="flex items-center gap-2 border-b border-line bg-paper/60 px-4 py-2.5">
          <span className="flex gap-1">
            <span className="size-2 rounded-full bg-line" />
            <span className="size-2 rounded-full bg-line" />
            <span className="size-2 rounded-full bg-line" />
          </span>
          <span className="tnum flex-1 truncate rounded-[6px] border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink-4">
            {copy.host}
          </span>
          <button onClick={onCancel} className="text-ink-4 hover:text-ink" aria-label="Cancel">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">Sign in with {copy.name}</p>
          <h2 className="mt-1.5 font-display text-[21px] leading-tight font-medium text-ink">
            {title ?? `Hotelogx Connect wants access to your ${copy.account}`}
          </h2>
          {account && <p className="tnum mt-1.5 font-mono text-[12.5px] text-ink-3">{account}</p>}

          <ul className="mt-4 space-y-2 border-t border-line-soft pt-3.5">
            {scopes.map((scope) => (
              <li key={scope} className="flex items-start gap-2 text-[13px] text-ink-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-good" />
                {scope}
              </li>
            ))}
          </ul>

          <p className="mt-3.5 flex items-start gap-1.5 border-t border-line-soft pt-3 text-[11.5px] leading-snug text-ink-4">
            <ShieldCheck className="mt-px size-3.5 shrink-0 text-pine-600" />
            You can revoke this at any time from your {copy.name} account. Hotelogx receives a token, never your password.
          </p>

          <div className={cn("mt-4 flex gap-2")}>
            <Button className="flex-1" onClick={onAllow}>
              Allow access
            </Button>
            <Button variant="quiet" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
