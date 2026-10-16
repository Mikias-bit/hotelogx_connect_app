import type {
  EmailDetection,
  EmailServerSettings,
  OnboardingStepKey,
  WaConnectionType,
  WaTopology,
} from "./types";

/* ------------------------------------------------------------ step order -- */

export interface StepMeta {
  key: OnboardingStepKey;
  label: string;
  blurb: string;
  /** steps a hotel can legitimately finish setup without */
  optional?: boolean;
}

export const onboardingSteps: StepMeta[] = [
  { key: "profile", label: "Hotel Profile", blurb: "The facts the AI treats as certain" },
  { key: "pms", label: "Connect PMS", blurb: "Read availability, rates and arrivals" },
  { key: "email", label: "Connect Email", blurb: "Where guest email arrives" },
  { key: "wa-guest", label: "Connect Guest WhatsApp", blurb: "The number guests already write to" },
  { key: "wa-internal", label: "Connect Internal WhatsApp", blurb: "How departments work from a phone" },
  { key: "knowledge", label: "Upload Knowledge Base", blurb: "What the AI answers from", optional: true },
  { key: "users", label: "Invite Users", blurb: "Your team and what they see", optional: true },
  { key: "ai", label: "Configure AI Behaviour", blurb: "How much freedom the AI has" },
];

/** Internal WhatsApp is skipped when the hotel runs a single number, or none for staff. */
export function stepsForTopology(topology: WaTopology | null): StepMeta[] {
  if (topology === "single" || topology === "guest-only") {
    return onboardingSteps.filter((s) => s.key !== "wa-internal");
  }
  return onboardingSteps;
}

/* -------------------------------------------------------------- pms list -- */

export interface PmsOption {
  key: string;
  name: string;
  available: boolean;
  note: string;
}

export const pmsOptions: PmsOption[] = [
  { key: "mews", name: "Mews", available: true, note: "Read-only connection, enabled per property" },
  { key: "apaleo", name: "Apaleo", available: true, note: "OAuth app, scoped to one property" },
  { key: "cloudbeds", name: "Cloudbeds", available: false, note: "In development" },
  { key: "opera", name: "Opera Cloud", available: false, note: "In development" },
  { key: "protel", name: "Protel", available: false, note: "In development" },
  { key: "stayntouch", name: "Stayntouch", available: false, note: "In development" },
  { key: "other", name: "Another PMS", available: false, note: "Tell us which — it shapes what we build next" },
];

/* ------------------------------------------------------ email detection -- */

const offlineProviders: { match: string[]; provider: string; name: string; method: "oauth" | "credentials" }[] = [
  { match: ["gmail.com", "googlemail.com"], provider: "google", name: "Google Workspace", method: "oauth" },
  { match: ["outlook.com", "hotmail.com", "live.com", "office365.com"], provider: "microsoft", name: "Microsoft 365", method: "oauth" },
  { match: ["zoho.com", "zoho.eu"], provider: "zoho", name: "Zoho Mail", method: "credentials" },
  { match: ["fastmail.com", "fastmail.fm"], provider: "fastmail", name: "Fastmail", method: "credentials" },
  { match: ["titan.email", "hostinger.com"], provider: "hostinger", name: "Hostinger Email", method: "credentials" },
];

export function domainFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

export function isEmailish(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/**
 * Asks the backend to run the MX and autodiscovery chain. If the endpoint is not
 * reachable — a static preview, an offline demo — we fall back to a small table of
 * well-known domains so the wizard still behaves, and say so in `source`.
 */
export async function detectEmail(email: string): Promise<EmailDetection> {
  const domain = domainFromEmail(email);

  try {
    const rawBase = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api").replace(/\/$/, "");
    const baseUrl = rawBase.startsWith("http") ? rawBase : `https://${rawBase}`;
    const response = await fetch(`${baseUrl}/email-detect?email=${encodeURIComponent(email)}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as EmailDetection;
    if (!data || typeof data.provider !== "string") throw new Error("bad payload");
    return data;
  } catch {
    return offlineDetection(domain);
  }
}

function offlineDetection(domain: string): EmailDetection {
  const hit = offlineProviders.find((p) => p.match.some((m) => domain === m || domain.endsWith(`.${m}`)));

  if (!hit) {
    return {
      domain,
      provider: "unknown",
      providerName: "Unknown provider",
      method: "manual",
      mx: [],
      checks: { incoming: false, outgoing: false, security: false },
      settings: null,
      autodiscover: null,
      note: "We could not reach the lookup service, so nothing was detected.",
      source: "offline",
    };
  }

  return {
    domain,
    provider: hit.provider,
    providerName: hit.name,
    method: hit.method,
    mx: [],
    checks: { incoming: true, outgoing: true, security: true },
    settings: hit.method === "credentials" ? presetFor(hit.provider) : null,
    autodiscover: null,
    note: "Recognised from the domain name — the DNS lookup did not run.",
    source: "offline",
  };
}

function presetFor(provider: string): EmailServerSettings | null {
  switch (provider) {
    case "zoho":
      return { imapHost: "imap.zoho.com", imapPort: 993, imapSecurity: "SSL/TLS", smtpHost: "smtp.zoho.com", smtpPort: 465, smtpSecurity: "SSL/TLS" };
    case "fastmail":
      return { imapHost: "imap.fastmail.com", imapPort: 993, imapSecurity: "SSL/TLS", smtpHost: "smtp.fastmail.com", smtpPort: 465, smtpSecurity: "SSL/TLS" };
    case "hostinger":
      return { imapHost: "imap.titan.email", imapPort: 993, imapSecurity: "SSL/TLS", smtpHost: "smtp.titan.email", smtpPort: 465, smtpSecurity: "SSL/TLS" };
    default:
      return null;
  }
}

export const blankSettings: EmailServerSettings = {
  imapHost: "",
  imapPort: 993,
  imapSecurity: "SSL/TLS",
  smtpHost: "",
  smtpPort: 587,
  smtpSecurity: "STARTTLS",
};

/* --------------------------------------------------------- whatsapp copy -- */

export const waTopologyOptions: { key: WaTopology; label: string; note: string }[] = [
  { key: "separate", label: "Separate guest and staff numbers", note: "Guests write to one number, departments work from another" },
  { key: "single", label: "One number for both", note: "Guests and staff share a single business number" },
  { key: "guest-only", label: "Guest WhatsApp only", note: "Departments will work from the dashboard instead" },
];

export function waLabel(type: WaConnectionType): string {
  return type === "guest" ? "Guest WhatsApp" : "Internal WhatsApp";
}

/** Stand-in for the identifiers Meta returns once Embedded Signup completes. */
export function mockMetaIdentifiers(type: WaConnectionType, phone: string) {
  const stamp = Date.now().toString().slice(-6);
  return {
    hotelId: "htl_mercier_01",
    wabaId: `waba_${type === "guest" ? "1029" : "1044"}${stamp.slice(0, 2)}`,
    phoneNumberId: `pn_${stamp}`,
    displayPhoneNumber: phone,
  };
}
