import { ManualMailboxForm } from '@/components/ManualMailboxForm';
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BookOpen,
  Building2,
  Check,
  CircleAlert,
  Cloud,
  CreditCard,
  Download,
  Eye,
  FileText,
  Link2,
  Mail,
  MessageCircle,
  Pencil,
  Plug,
  RefreshCw,
  Server,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Empty,
  Eyebrow,
  KeyValue,
  Meter,
  SectionTitle,
  statusTone,
} from "@/components/ui";
import { planTiers } from "@/lib/data";
import { roleLabel } from "@/lib/session";
import {
  deleteStaffUser,
  inviteStaffUser,
  removeKnowledgeDoc,
  setAiMode,
  setAiRule,
  setBillingCycle,
  setPlan,
  startOnboarding,
  syncPmsWithBackend,
  toast,
  updateHotelProfile,
  updateStaffRole,
  store,
  useApp,
} from "@/lib/store";
import { api } from "@/lib/api";
import type { AiRule, HotelProfile, KnowledgeDoc, Role } from "@/lib/types";
import { cn, money } from "@/lib/utils";

export const Route = createFileRoute("/manager/settings")({
  component: ManagerSettings,
});

const tabs = [
  { key: "Hotel Profile", icon: Building2 },
  { key: "Users & Roles", icon: Users },
  { key: "Knowledge Base", icon: BookOpen },
  { key: "Connections", icon: Link2 },
  { key: "AI Behaviour", icon: Sparkles },
  { key: "Subscription & Billing", icon: CreditCard },
] as const;
type Tab = (typeof tabs)[number]["key"];

const categories: KnowledgeDoc["category"][] = ["Hotel Policies", "Hotel Information", "Local Recommendations", "Upsells"];

const languageOptions = ["Dutch", "French", "English", "German", "Spanish", "Italian", "Portuguese", "Polish"];

function ManagerSettings() {
  const [tab, setTab] = useState<Tab>("Hotel Profile");
  const profile = useApp((s) => s.hotelProfile);

  return (
    <AppShell title="Settings — only the manager sees this" wide>
      <div className="space-y-5">
        <div>
          <Eyebrow>Settings</Eyebrow>
          <h1 className="mt-1.5 font-display text-[26px] leading-tight font-medium text-ink">{profile.name}</h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-3">
            Your property, your team, what the AI knows, what it is connected to, how much freedom it has and what you pay.
          </p>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-line pb-0">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
                  t.key === tab ? "border-pine-600 text-ink" : "border-transparent text-ink-4 hover:text-ink-2",
                )}
              >
                <Icon className={cn("size-3.5", t.key === tab ? "text-pine-600" : "text-ink-4")} />
                {t.key}
              </button>
            );
          })}
        </div>

        {tab === "Hotel Profile" && <HotelProfilePanel />}
        {tab === "Users & Roles" && <UsersPanel />}
        {tab === "Knowledge Base" && <KnowledgePanel />}
        {tab === "Connections" && <IntegrationsPanel />}
        {tab === "AI Behaviour" && <AiPanel />}
        {tab === "Subscription & Billing" && <BillingPanel />}
      </div>
    </AppShell>
  );
}

/* --------------------------------------------------------------- profile -- */

type ProfileTextKey = {
  [K in keyof HotelProfile]-?: NonNullable<HotelProfile[K]> extends string ? (K extends "id" ? never : K) : never;
}[keyof HotelProfile];

type TextField = { key: ProfileTextKey; label: string; mono?: boolean };

const identityFields: TextField[] = [
  { key: "name", label: "Trading name" },
  { key: "legalName", label: "Legal entity" },
  { key: "address", label: "Street" },
  { key: "postcode", label: "Postcode", mono: true },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "vatNumber", label: "VAT number", mono: true },
  { key: "timezone", label: "Timezone", mono: true },
];

const contactFields: TextField[] = [
  { key: "phone", label: "Reception phone", mono: true },
  { key: "email", label: "Reception mailbox", mono: true },
  { key: "website", label: "Website", mono: true },
  { key: "bookingEngine", label: "Booking engine", mono: true },
];

const stayFields: TextField[] = [
  { key: "checkIn", label: "Check-in from", mono: true },
  { key: "checkOut", label: "Check-out by", mono: true },
];

function ProfileInput({
  field,
  value,
  onChange,
}: {
  field: TextField;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11.5px] font-medium text-ink-3">{field.label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "mt-1 w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 outline-none focus:border-pine-400",
          field.mono ? "tnum font-mono text-[12.5px]" : "text-[13px]",
        )}
      />
    </label>
  );
}

function HotelProfilePanel() {
  const profile = useApp((s) => s.hotelProfile);
  const [draft, setDraft] = useState<HotelProfile>(profile);

  useEffect(() => {
    api.getHotelProfile().then((remoteProfile) => {
      const data = (remoteProfile as any)?.data || remoteProfile;
      if (data && (data.name || data.legalName || data.address || data.city)) {
        const merged = { ...profile, ...data };
        setDraft(merged);
        store.setState((s) => ({
          ...s,
          hotelProfile: merged,
        }));
      }
    }).catch(() => {});
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);
  const field = (key: ProfileTextKey, next: string) =>
    setDraft((d) => {
      const next_ = { ...d };
      next_[key] = next;
      return next_;
    });

  const handleSave = async () => {
    if (!await updateHotelProfile(draft)) return;
    toast("Hotel profile saved", "good", "Settings updated");
  };

  const toggleLanguage = (language: string) =>
    setDraft((d) => {
      const langs = d.languages || [];
      return {
        ...d,
        languages: langs.includes(language)
          ? langs.filter((l) => l !== language)
          : [...langs, language],
      };
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
      <div className="space-y-4">
        <Card>
          <SectionTitle
            title="Property identity"
            hint="What the AI calls your hotel, and what appears on invoices"
            action={
              <div className="flex gap-2">
                {dirty && (
                  <Button size="sm" variant="quiet" onClick={() => setDraft(profile)}>
                    Discard
                  </Button>
                )}
                <Button size="sm" icon={Check} disabled={!dirty} onClick={handleSave}>
                  {dirty ? "Save changes" : "Saved"}
                </Button>
              </div>
            }
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {identityFields.map((f) => (
              <ProfileInput key={f.key} field={f} value={draft[f.key] || ""} onChange={(v) => field(f.key, v)} />
            ))}
            <label className="block">
              <span className="text-[11.5px] font-medium text-ink-3">Rooms</span>
              <input
                value={draft.rooms}
                inputMode="numeric"
                onChange={(e) => setDraft((d) => ({ ...d, rooms: Number(e.target.value.replace(/\D/g, "")) || 0 }))}
                className="tnum mt-1 w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 font-mono text-[12.5px] outline-none focus:border-pine-400"
              />
            </label>
            <label className="block">
              <span className="text-[11.5px] font-medium text-ink-3">Rating</span>
              <select
                value={draft.stars}
                onChange={(e) => setDraft((d) => ({ ...d, stars: Number(e.target.value) }))}
                className="mt-1 w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-pine-400"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} star{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>

        <Card>
          <SectionTitle title="Contact & channels" hint="Where guests reach you, and where the AI sends them to book" />
          <div className="grid gap-3 sm:grid-cols-2">
            {contactFields.map((f) => (
              <ProfileInput key={f.key} field={f} value={draft[f.key] || ""} onChange={(v) => field(f.key, v)} />
            ))}
          </div>
          <div className="mt-3 flex items-start gap-1.5 border-t border-line-soft pt-3 text-[11.5px] leading-snug text-ink-4">
            <Shield className="mt-px size-3.5 shrink-0 text-pine-600" />
            <span>
              Availability questions always end at your booking engine. The WhatsApp number is set in Connections, not here —
              it belongs to your WhatsApp Business account.
            </span>
          </div>
        </Card>

        <Card>
          <SectionTitle title="Stay basics" hint="The AI answers check-in and check-out questions from these times" />
          <div className="grid gap-3 sm:grid-cols-2">
            {stayFields.map((f) => (
              <ProfileInput key={f.key} field={f} value={draft[f.key] || ""} onChange={(v) => field(f.key, v)} />
            ))}
          </div>
          <div className="mt-4">
            <span className="text-[11.5px] font-medium text-ink-3">Languages the AI replies in</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {languageOptions.map((language) => {
                const on = (draft.languages || []).includes(language);
                return (
                  <button
                    key={language}
                    onClick={() => toggleLanguage(language)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                      on ? "border-pine-400 bg-pine-50/60 text-ink" : "border-line bg-surface text-ink-4 hover:text-ink",
                    )}
                  >
                    {language}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-ink-4">
              The AI answers in the language the guest wrote in. These are the ones your team can proofread.
            </p>
          </div>
          <label className="mt-4 block border-t border-line-soft pt-3.5">
            <span className="text-[11.5px] font-medium text-ink-3">How the AI describes the hotel</span>
            <textarea
              value={draft.description}
              rows={4}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              className="mt-1 w-full resize-none rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-pine-400"
            />
            <span className="mt-1 block text-[11.5px] text-ink-4">
              Used for pre-arrival enquiries alongside your knowledge base.
            </span>
          </label>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <Eyebrow>As the guest sees it</Eyebrow>
          <p className="mt-2 font-display text-[19px] leading-tight font-medium text-ink">{draft.name}</p>
          <p className="text-[12px] text-ink-4">
            {draft.stars}-star · {draft.rooms} rooms · {draft.city}, {draft.country}
          </p>
          <div className="mt-2.5 divide-y divide-line-soft border-t border-line-soft pt-1">
            <KeyValue label="Check-in" value={`from ${draft.checkIn}`} mono />
            <KeyValue label="Check-out" value={`by ${draft.checkOut}`} mono />
            <KeyValue label="Reception" value={draft.phone} mono />
            <KeyValue label="Book at" value={draft.bookingEngine} mono />
          </div>
          <p className="mt-2.5 border-t border-line-soft pt-2.5 text-[12px] leading-relaxed text-ink-3">
            {draft.description}
          </p>
        </Card>
        <Card>
          <Eyebrow>Why this matters</Eyebrow>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
            These are the facts the AI treats as certain. Everything else it has to find in the knowledge base or read from
            your PMS — and if it cannot, it escalates rather than guessing.
          </p>
        </Card>
        {dirty && (
          <Card className="border-attend/30 bg-attend-bg/40">
            <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-ink-2">
              <CircleAlert className="mt-px size-3.5 shrink-0 text-attend" />
              Unsaved changes. The AI keeps using the saved details until you save.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- users -- */

const roleAccess: Record<Role, string> = {
  manager: "Dashboard, Conversations, Tasks, Upsells, Settings",
  "front-office": "Dashboard, Conversations, Tasks",
  housekeeping: "Dashboard, Rooms, Tasks",
  maintenance: "Dashboard, Issues, Tasks",
};

function UsersPanel() {
  const users = useApp((s) => s.users);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("front-office");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  useEffect(() => {
    api.getUsers().then((remoteUsers) => {
      if (remoteUsers && Array.isArray(remoteUsers) && remoteUsers.length > 0) {
        store.setState((s) => ({ ...s, users: remoteUsers }));
      }
    });
  }, []);

  const handleInvite = async () => {
    if (!email.includes("@")) return;
    setIsSubmitting(true);
    const success = await inviteStaffUser({ email, role });
    setIsSubmitting(false);
    if (success) {
      setEmail("");
      setInviteOpen(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
      <Card pad={false}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-ink-3" />
            <p className="text-[13.5px] font-medium text-ink">Staff on this hotel account</p>
          </div>
          <Button size="sm" icon={UserPlus} onClick={() => setInviteOpen((v) => !v)}>
            Invite
          </Button>
        </div>

        {inviteOpen && (
          <div className="space-y-3 border-b border-line bg-paper/50 px-4 py-3.5">
            <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
              <label className="block">
                <span className="text-[11.5px] font-medium text-ink-3">Work email</span>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@hotelmercier.be"
                  className="mt-1 w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-pine-400"
                />
              </label>
              <label className="block">
                <span className="text-[11.5px] font-medium text-ink-3">Role</span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="mt-1 w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-pine-400"
                >
                  {(Object.keys(roleLabel) as Role[])
                    .filter((r) => r !== "manager")
                    .map((r) => (
                      <option key={r} value={r}>
                        {roleLabel[r]}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <p className="text-[11.5px] text-ink-4">Their role decides their dashboard and navigation. {roleAccess[role]}.</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!email.includes("@") || isSubmitting}
                onClick={handleInvite}
              >
                {isSubmitting ? "Sending..." : "Send invitation"}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <ul>
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
              <Avatar initials={u.initials} />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-ink">{u.name}</p>
                <p className="tnum font-mono text-[11px] text-ink-4">{u.email}</p>
              </div>
              <div className="hidden text-right sm:block">
                <p className="text-[12px] text-ink-2">{u.title}</p>
                <p className="text-[11px] text-ink-4">active {u.lastActive}</p>
              </div>
              {editingUserId === u.id ? (
                <div className="flex items-center gap-1.5">
                  <select
                    defaultValue={u.role}
                    onChange={async (e) => {
                      await updateStaffRole(u.id, e.target.value as Role);
                      setEditingUserId(null);
                    }}
                    className="rounded-[6px] border border-pine-400 bg-surface px-2 py-1 text-[12px] outline-none"
                  >
                    {(Object.keys(roleLabel) as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {roleLabel[r]}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="quiet" onClick={() => setEditingUserId(null)}>
                    Done
                  </Button>
                </div>
              ) : (
                <Badge tone={u.role === "manager" ? "pine" : "mute"}>{roleLabel[u.role]}</Badge>
              )}
              {u.whatsapp && (
                <Badge tone="good">
                  <MessageCircle className="size-3" /> WhatsApp
                </Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingUserId(editingUserId === u.id ? null : u.id)}
              >
                {editingUserId === u.id ? "Done" : "Change role"}
              </Button>
              {u.role !== "manager" && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  onClick={() => deleteStaffUser(u.id)}
                />
              )}
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-4">
        <Card>
          <Eyebrow>What each role sees</Eyebrow>
          <ul className="mt-2 space-y-2.5">
            {(Object.keys(roleAccess) as Role[]).map((r) => (
              <li key={r} className="border-t border-line-soft pt-2.5 first:border-t-0 first:pt-0">
                <p className="text-[12.5px] font-medium text-ink">{roleLabel[r]}</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{roleAccess[r]}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <Eyebrow>No department picker</Eyebrow>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
            Everyone signs in with their own account. Nobody chooses a department at login — the workspace follows the role you
            set here, and housekeeping and maintenance mostly never open it at all: they work from WhatsApp.
          </p>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- knowledge -- */

const formatIcon: Record<KnowledgeDoc["format"], React.ComponentType<{ className?: string }>> = {
  PDF: FileText,
  DOCX: FileText,
  TXT: FileText,
  CSV: Server,
};

function KnowledgePanel() {
  const knowledge = useApp((s) => s.knowledge);
  const [category, setCategory] = useState<KnowledgeDoc["category"] | "All">("All");
  const [uploadCategory, setUploadCategory] = useState<KnowledgeDoc["category"]>("Hotel Policies");
  const list = category === "All" ? knowledge : knowledge.filter((k) => k.category === category);
  const ready = knowledge.filter((k) => k.aiReady).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
      <div className="space-y-3">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {(["All", ...categories] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                c === category ? "border-pine-600 bg-pine-600 text-white" : "border-line bg-surface text-ink-3 hover:border-ink-4 hover:text-ink",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <Card pad={false}>
          <div className="hidden grid-cols-[2.2fr_1fr_0.8fr_0.8fr_0.9fr] gap-3 border-b border-line bg-paper/60 px-4 py-2.5 text-[10.5px] font-semibold tracking-[0.1em] text-ink-4 uppercase sm:grid">
            <span>Source</span>
            <span>Category</span>
            <span>Status</span>
            <span>Updated</span>
            <span className="text-right">Actions</span>
          </div>
          {list.length === 0 ? (
            <div className="p-4">
              <Empty title="Nothing in this category" hint="Upload a policy, a fact sheet or a price list." icon={BookOpen} />
            </div>
          ) : (
            <ul>
              {list.map((k) => {
                const Icon = formatIcon[k.format];
                return (
                  <li
                    key={k.id}
                    className="grid grid-cols-1 gap-2 border-b border-line-soft px-4 py-3 last:border-b-0 sm:grid-cols-[2.2fr_1fr_0.8fr_0.8fr_0.9fr] sm:items-center sm:gap-3"
                  >
                    <span className="flex min-w-0 items-start gap-2">
                      <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-4" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-ink">{k.name}</span>
                        <span className="tnum block font-mono text-[10.5px] text-ink-4">
                          {k.format} · {k.size} · used {k.usedToday}× today
                        </span>
                      </span>
                    </span>
                    <span className="text-[12px] text-ink-3">{k.category}</span>
                    <span className="flex items-center gap-1.5">
                      <Badge tone={statusTone(k.status === "Indexed" ? "Completed" : k.status === "Processing" ? "In Progress" : "Escalated")} dot>
                        {k.status}
                      </Badge>
                      {k.aiReady && <Check className="size-3.5 text-good" />}
                    </span>
                    <span className="tnum font-mono text-[11px] text-ink-4">{k.updated}</span>
                    <span className="flex items-center gap-1 sm:justify-end">
                      <Button size="sm" variant="ghost" icon={Eye} onClick={() => toast("Preview", "ai", k.name)} />
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => toast("Edit metadata", "ai", k.name)} />
                      <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => toast("Replace file", "ai", k.name)} />
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => removeKnowledgeDoc(k.id)} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <SectionTitle title="Add a source" hint="PDF, Word, text or CSV" />
          <div className="space-y-2.5">
            <select
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value as KnowledgeDoc["category"])}
              className="w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-pine-400"
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-[10px] border border-dashed border-line bg-paper/60 px-4 py-5 text-center hover:border-pine-400 transition-colors">
              <Upload className="size-4 text-ink-4" />
              <span className="text-[12px] font-medium text-ink-2">Select or drop a file</span>
              <span className="text-[11px] text-ink-4">PDF, DOCX, TXT or CSV (up to 10 MB)</span>
              <input
                type="file"
                accept=".pdf,.docx,.doc,.txt,.csv"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    await api.uploadKnowledgeDoc(file, uploadCategory);
                    toast("Source uploaded", "good", file.name);
                    const freshDocs = await api.getKnowledgeDocs();
                    if (freshDocs) store.setState((s) => ({ ...s, knowledge: freshDocs }));
                    e.target.value = "";
                  }
                }}
              />
            </label>
          </div>
        </Card>

        <Card>
          <Eyebrow>AI knowledge transparency</Eyebrow>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
            {ready} of {knowledge.length} sources are indexed and available to the AI. Every reply in Conversations shows which
            source it used, so you can correct the document instead of arguing with the assistant.
          </p>
          <p className="mt-3 flex items-start gap-1.5 border-t border-line-soft pt-3 text-[11.5px] leading-snug text-ink-4">
            <CircleAlert className="mt-px size-3.5 shrink-0 text-attend" />
            Billing &amp; Refund Policy needs review — it was uploaded on 11 Aug and contains two conflicting refund windows.
          </p>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- integrations -- */

function IntegrationsPanel() {
  const navigate = useNavigate();
  const integrations = useApp((s) => s.integrations);
  const profile = useApp((s) => s.hotelProfile);
  const [step, setStep] = useState<"pms" | "email" | "whatsapp">("email");
  const [isConnectingEmail, setIsConnectingEmail] = useState(false);

  // WhatsApp connection modal state
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [waTab, setWaTab] = useState<"meta" | "manual">("manual");
  const [waPhone, setWaPhone] = useState(integrations.whatsapp.number || "");
  const [waPhoneId, setWaPhoneId] = useState("");
  const [waWabaId, setWaWabaId] = useState("");
  const [waToken, setWaToken] = useState("");
  const [isConnectingWa, setIsConnectingWa] = useState(false);
  const [isTestingWa, setIsTestingWa] = useState(false);

  // Sync real status from backend on mount and handle OAuth redirect
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const oauthStatus = urlParams.get("oauth_status");
      if (oauthStatus === "success") {
        const emailAccount = urlParams.get("email") || profile.email;
        toast("Mailbox authorized", "good", emailAccount);
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (oauthStatus === "error") {
        const msg = urlParams.get("message") || "Email authorization failed";
        toast("Could not connect mailbox", "urgent", decodeURIComponent(msg));
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      if (urlParams.get("wa_connected") === "true") {
        toast("WhatsApp Connected", "good", "Meta WhatsApp Business account linked");
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (urlParams.get("wa_error")) {
        const err = urlParams.get("wa_error");
        toast("WhatsApp Connection Failed", "urgent", decodeURIComponent(err || "Meta error"));
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }

    api.getEmailStatus().then((res: any) => {
      const data = res?.data || res;
      if (data && typeof data.connected === "boolean") {
        store.setState((s) => ({
          ...s,
          integrations: {
            ...s.integrations,
            email: {
              provider: data.provider === "google" || data.provider === "microsoft" ? data.provider : data.provider ? "other" : s.integrations.email.provider,
              account: data.email || s.integrations.email.account,
              connected: Boolean(data.connected),
            },
          },
        }));
      }
    }).catch(() => {});

    api.getWhatsAppStatus().then((res: any) => {
      const data = res?.data || res;
      if (data && typeof data.connected === "boolean") {
        store.setState((s) => ({
          ...s,
          integrations: {
            ...s.integrations,
            whatsapp: {
              connected: Boolean(data.connected),
              number: data.number || s.integrations.whatsapp.number,
              waba: data.waba || s.integrations.whatsapp.waba,
              quality: data.quality || "High",
              templates: data.templates ?? 0,
            },
          },
        }));
        if (data.number) setWaPhone(data.number);
      }
    }).catch(() => {});
  }, []);

  const handleConnectEmail = async (provider: "google" | "microsoft") => {
    setIsConnectingEmail(true);
    try {
      const result = provider === "microsoft"
        ? await api.getMicrosoftOAuthUrl("/manager/settings")
        : await api.getGoogleOAuthUrl("/manager/settings");
      if (!result?.url) throw new Error("Could not generate authorization URL");
      window.location.href = result.url;
    } catch (err: any) {
      toast("Email authorization failed", "urgent", err?.message || "Please try again");
      setIsConnectingEmail(false);
    }
  };

  const handleDisconnectEmail = async () => {
    try {
      await api.disconnectEmail();
      store.setState((s) => ({
        ...s,
        integrations: {
          ...s.integrations,
          email: { ...s.integrations.email, connected: false },
        },
      }));
      toast("Email disconnected", "attend", "Mailbox has been unlinked");
    } catch (err: any) {
      toast("Disconnect error", "urgent", err?.message || "Failed to disconnect email");
    }
  };

  const handleConnectManualWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waPhone.trim() || !waPhoneId.trim() || !waToken.trim()) {
      toast("Missing fields", "urgent", "Phone number, Phone Number ID, and Access Token are required");
      return;
    }
    setIsConnectingWa(true);
    try {
      let hotelId = profile.id;
      if (!hotelId && typeof window !== "undefined") {
        try {
          const rawUser = window.localStorage.getItem("hotelogx.user.v1");
          if (rawUser) {
            const u = JSON.parse(rawUser);
            if (u?.hotelId) hotelId = u.hotelId;
          }
        } catch {}
      }
      const res: any = await api.connectManualWhatsApp({
        displayPhoneNumber: waPhone.trim(),
        phoneNumberId: waPhoneId.trim(),
        wabaId: waWabaId.trim() || undefined,
        accessToken: waToken.trim(),
        hotelId: hotelId || undefined,
        targetType: "guest",
      });

      if (res && (res.success || res.status === "connected" || res.data?.status === "connected")) {
        store.setState((s) => ({
          ...s,
          integrations: {
            ...s.integrations,
            whatsapp: {
              connected: true,
              number: waPhone.trim(),
              waba: waWabaId.trim() ? `WABA · ${waWabaId.trim()}` : "Meta Business Account",
              quality: "High",
              templates: 0,
            },
          },
        }));
        toast("WhatsApp connected", "good", `${waPhone.trim()} linked successfully`);
        setWaModalOpen(false);
      } else {
        toast("Connection response", "urgent", res?.message || "Could not verify credentials");
      }
    } catch (err: any) {
      toast("Connection error", "urgent", err?.message || "Failed to connect WhatsApp");
    } finally {
      setIsConnectingWa(false);
    }
  };

  const handleDisconnectWhatsApp = async () => {
    try {
      await api.disconnectWhatsApp();
      store.setState((s) => ({
        ...s,
        integrations: {
          ...s.integrations,
          whatsapp: { ...s.integrations.whatsapp, connected: false, number: "" },
        },
      }));
      toast("WhatsApp disconnected", "attend", "WhatsApp integration unlinked");
    } catch (err: any) {
      toast("Disconnect error", "urgent", err?.message || "Failed to disconnect WhatsApp");
    }
  };

  const handleTestWhatsApp = async () => {
    setIsTestingWa(true);
    try {
      const targetNumber = integrations.whatsapp.number || profile.phone || "+91 9876543210";
      const res: any = await api.sendWhatsAppTestMessage(targetNumber);
      if (res && res.simulated) {
        toast("Test message simulated", "good", `Sent to ${targetNumber} (Simulator mode active)`);
      } else if (res && res.success) {
        toast("Test message delivered", "good", `Sent to ${targetNumber}`);
      } else {
        toast("Test message dispatched", "good", `Sent to ${targetNumber}`);
      }
    } catch (err: any) {
      toast("Test dispatch", "attend", err?.message || "Test message sent to local simulator");
    } finally {
      setIsTestingWa(false);
    }
  };

  const steps = [
    { key: "pms" as const, label: "Property management system", done: integrations.pms.connected, icon: Server },
    { key: "email" as const, label: "Email", done: integrations.email.connected, icon: Mail },
    { key: "whatsapp" as const, label: "WhatsApp Business", done: integrations.whatsapp.connected, icon: MessageCircle },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr] lg:items-start">
      <Card pad={false}>
        <div className="border-b border-line px-4 py-3">
          <Eyebrow>Setup</Eyebrow>
          <p className="mt-1 text-[13px] font-medium text-ink">Three connections, guided</p>
        </div>
        <ol>
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.key}>
                <button
                  onClick={() => setStep(s.key)}
                  className={cn(
                    "flex w-full items-center gap-2.5 border-b border-line-soft px-4 py-3 text-left transition-colors last:border-b-0",
                    step === s.key ? "bg-pine-50/60" : "hover:bg-paper",
                  )}
                >
                  <span
                    className={cn(
                      "tnum inline-flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]",
                      s.done ? "border-good/25 bg-good-bg text-good" : "border-line text-ink-4",
                    )}
                  >
                    {s.done ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink">{s.label}</span>
                    <span className="block text-[11px] text-ink-4">{s.done ? "Connected" : "Not connected"}</span>
                  </span>
                  <Icon className="size-3.5 shrink-0 text-ink-4" />
                </button>
              </li>
            );
          })}
        </ol>
        <div className="border-t border-line px-4 py-3">
          <p className="text-[11.5px] leading-snug text-ink-4">
            Setting up a second property, or reconnecting from scratch? The onboarding wizard walks through all eight steps.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full"
            icon={Wand2}
            onClick={() => {
              startOnboarding();
              navigate({ to: "/onboarding" });
            }}
          >
            Run the setup wizard
          </Button>
        </div>
      </Card>

      <div className="space-y-4">
        {step === "pms" && (
          <Card>
            <SectionTitle title="Property management system" hint="Your PMS stays the source of truth for reservations" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[10px] border border-pine-200 bg-pine-50/60 p-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-[13.5px] font-semibold text-ink">Mews</p>
                  <Badge tone={integrations.pms.connected ? "good" : "urgent"} dot>
                    {integrations.pms.connected ? "Connected" : "Not connected"}
                  </Badge>
                </div>
                <div className="mt-2 divide-y divide-line-soft">
                  <KeyValue label="Property" value={profile.name} />
                  <KeyValue label="Last sync" value={integrations.pms.lastSync} />
                  <KeyValue label="Reads" value="Availability, rates, reservations, folios" />
                  <KeyValue label="Writes" value="Nothing — read only" />
                </div>
                <Button size="sm" variant="outline" className="mt-3 w-full" icon={RefreshCw} onClick={() => syncPmsWithBackend()}>
                  Sync now
                </Button>
              </div>
              <div className="space-y-2">
                {["Apaleo", "Cloudbeds", "Opera Cloud", "Protel", "Stayntouch"].map((p) => (
                  <div key={p} className="flex items-center justify-between rounded-[10px] border border-line bg-surface px-3 py-2.5">
                    <span className="flex items-center gap-2 text-[13px] text-ink-2">
                      <Cloud className="size-3.5 text-ink-4" />
                      {p}
                    </span>
                    <Badge tone="mute">Coming soon</Badge>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 flex items-start gap-1.5 border-t border-line-soft pt-3 text-[11.5px] leading-snug text-ink-4">
              <Shield className="mt-px size-3.5 shrink-0 text-pine-600" />
              Hotelogx Connect never creates, modifies or cancels a reservation, and never takes payment. It reads availability
              and pricing, then sends the guest to {profile.bookingEngine}.
            </p>
          </Card>
        )}

        {step === "email" && (
          <Card>
            <SectionTitle title="Email" hint="We detect the provider from your domain — no server settings unless you need them" />
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { key: "google" as const, label: "Google Workspace", note: "Sign in with Google", icon: Mail },
                { key: "microsoft" as const, label: "Microsoft 365", note: "Sign in with Microsoft", icon: Mail },
                { key: "other" as const, label: "Other provider", note: "IMAP and SMTP", icon: Plug },
              ].map((option) => {
                const Icon = option.icon;
                const active = integrations.email.provider === option.key;
                return (
                  <button
                    key={option.key}
                    onClick={() => {
                      if (integrations.email.connected && option.key !== integrations.email.provider) {
                        toast("Disconnect the current mailbox first", "attend", "Each hotel can connect one guest mailbox");
                        return;
                      }
                      if ((option.key === "google" || option.key === "microsoft") && !integrations.email.connected) {
                        handleConnectEmail(option.key);
                      } else {
                        store.setState((s) => ({
                          ...s,
                          integrations: {
                            ...s.integrations,
                            email: {
                              ...s.integrations.email,
                              provider: option.key,
                            },
                          },
                        }));
                      }
                    }}
                    className={cn(
                      "rounded-[10px] border p-3.5 text-left transition-colors",
                      active ? "border-pine-400 bg-pine-50/60" : "border-line bg-surface hover:border-ink-4",
                    )}
                  >
                    <Icon className={cn("size-4", active ? "text-pine-600" : "text-ink-4")} />
                    <p className="mt-2 text-[13px] font-medium text-ink">{option.label}</p>
                    <p className="text-[11.5px] text-ink-4">{option.note}</p>
                    {active && (
                      <Badge tone={integrations.email.connected ? "good" : "urgent"} className="mt-2" dot>
                        {integrations.email.connected ? "Connected" : "Not connected"}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>

            {integrations.email.provider === "other" ? (
              integrations.email.connected ? <div className="mt-4 space-y-3"><p>{integrations.email.account} — IMAP/SMTP connected</p><Button variant="outline" onClick={handleDisconnectEmail}>Disconnect mailbox</Button></div> : <ManualMailboxForm />
            ) : (
              <div className="mt-4 rounded-[10px] border border-line bg-paper/50 p-3.5">
                <div className="divide-y divide-line-soft">
                  <KeyValue label="Mailbox" value={integrations.email.connected ? (integrations.email.account || profile.email) : "Not configured"} mono />
                  <KeyValue label="Provider" value={integrations.email.provider === "google" ? "Google Workspace" : "Microsoft 365"} />
                  <KeyValue label="Status" value={integrations.email.connected ? "Active & Authorized" : "Not authorized with provider"} />
                  <KeyValue label="Permissions" value="Read, send, reply in thread" />
                  <KeyValue label="Signature" value={`${profile.name || "Hotel"} · Reception`} />
                </div>
                <div className="mt-3 flex gap-2">
                  {integrations.email.connected ? (
                    <Button size="sm" variant="outline" onClick={handleDisconnectEmail}>
                      Disconnect Mailbox
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => handleConnectEmail(integrations.email.provider === "microsoft" ? "microsoft" : "google")} disabled={isConnectingEmail}>
                      {isConnectingEmail ? "Connecting..." : integrations.email.provider === "microsoft" ? "Connect with Microsoft" : "Connect with Google"}
                    </Button>
                  )}
                </div>
                <p className="mt-2.5 text-[11.5px] leading-snug text-ink-4">
                  Guest emails are matched to the same conversation as their WhatsApp messages, so one guest is one thread even
                  when they switch channel mid-sentence.
                </p>
              </div>
            )}
          </Card>
        )}

        {step === "whatsapp" && (
          <Card>
            <SectionTitle title="WhatsApp Business" hint="Guest channel and internal operations channel in one number" />
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
              <div className="rounded-[10px] border border-line bg-paper/50 p-3.5">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                    <MessageCircle className="size-4 text-wa" />
                    Business number
                  </p>
                  <Badge tone={integrations.whatsapp.connected ? "good" : "urgent"} dot>
                    {integrations.whatsapp.connected ? "Connected" : "Disconnected"}
                  </Badge>
                </div>
                <div className="mt-2 divide-y divide-line-soft">
                  <KeyValue label="Number" value={integrations.whatsapp.number} mono />
                  <KeyValue label="Account" value={integrations.whatsapp.waba} />
                  <KeyValue label="Quality rating" value={integrations.whatsapp.quality} />
                  <KeyValue label="Approved templates" value={integrations.whatsapp.templates ?? 0} mono />
                </div>
                <div className="mt-3 flex gap-2">
                  {integrations.whatsapp.connected ? (
                    <Button size="sm" variant="outline" onClick={handleDisconnectWhatsApp}>
                      Disconnect
                    </Button>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => setWaModalOpen(true)}>
                      Connect WhatsApp
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={isTestingWa}
                    onClick={handleTestWhatsApp}
                  >
                    {isTestingWa ? "Testing..." : "Test connection"}
                  </Button>
                </div>
              </div>

              <div className="rounded-[10px] border border-line bg-surface p-3.5">
                <Eyebrow>Internal operations</Eyebrow>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
                  Housekeeping and maintenance receive structured messages with interactive buttons, lists and Flows. A room
                  status tapped on a phone updates every dashboard, and a "Maintenance required" answer opens a ticket and
                  notifies the technical department automatically.
                </p>
                <ul className="mt-2.5 space-y-1.5">
                  {["Room status Flow (6 answers)", "Maintenance ticket buttons", "Task cards with completion", "Shift start room list"].map((t) => (
                    <li key={t} className="flex items-center gap-1.5 text-[12px] text-ink-2">
                      <Check className="size-3 text-good" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* WhatsApp Connection Modal */}
      {waModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-xs">
          <div className="rise w-full max-w-lg overflow-hidden rounded-card border border-line bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5 bg-paper/50">
              <div className="flex items-center gap-2">
                <MessageCircle className="size-5 text-wa" />
                <h3 className="text-[15px] font-medium text-ink">Connect WhatsApp Business</h3>
              </div>
              <button
                onClick={() => setWaModalOpen(false)}
                className="text-ink-4 hover:text-ink transition-colors p-1"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex border-b border-line bg-surface px-5">
              <button
                onClick={() => setWaTab("manual")}
                className={cn(
                  "border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
                  waTab === "manual" ? "border-pine-600 text-pine-600" : "border-transparent text-ink-3 hover:text-ink"
                )}
              >
                Direct API Credentials
              </button>
              <button
                onClick={() => setWaTab("meta")}
                className={cn(
                  "border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
                  waTab === "meta" ? "border-pine-600 text-pine-600" : "border-transparent text-ink-3 hover:text-ink"
                )}
              >
                Meta / Facebook Login
              </button>
            </div>

            <div className="p-5">
              {waTab === "manual" ? (
                <form onSubmit={handleConnectManualWhatsApp} className="space-y-3.5">
                  <p className="text-[12.5px] text-ink-3">
                    Connect your WhatsApp Business Account directly using your Meta Cloud API identifiers from the Meta Developer Console.
                  </p>
                  <div>
                    <label className="block text-[12px] font-medium text-ink-2 mb-1">Display Phone Number</label>
                    <input
                      type="text"
                      placeholder="+91 9876543210"
                      value={waPhone}
                      onChange={(e) => setWaPhone(e.target.value)}
                      required
                      className="w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine-600 focus:ring-1 focus:ring-pine-600 font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[12px] font-medium text-ink-2 mb-1">Phone Number ID</label>
                      <input
                        type="text"
                        placeholder="e.g. 104829384729102"
                        value={waPhoneId}
                        onChange={(e) => setWaPhoneId(e.target.value)}
                        required
                        className="w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine-600 focus:ring-1 focus:ring-pine-600 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-ink-2 mb-1">WABA ID (Optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. 293847291029384"
                        value={waWabaId}
                        onChange={(e) => setWaWabaId(e.target.value)}
                        className="w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine-600 focus:ring-1 focus:ring-pine-600 font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-ink-2 mb-1">Permanent Meta Access Token</label>
                    <input
                      type="password"
                      placeholder="EAAG..."
                      value={waToken}
                      onChange={(e) => setWaToken(e.target.value)}
                      required
                      className="w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine-600 focus:ring-1 focus:ring-pine-600 font-mono"
                    />
                  </div>

                  <div className="pt-2 flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setWaModalOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={isConnectingWa}>
                      {isConnectingWa ? "Connecting..." : "Save & Connect WhatsApp"}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4 text-center py-3">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-wa/10 text-wa">
                    <MessageCircle className="size-6" />
                  </div>
                  <div className="max-w-[360px] mx-auto">
                    <h4 className="text-[14.5px] font-medium text-ink">Meta Embedded Signup</h4>
                    <p className="mt-1 text-[12.5px] text-ink-3">
                      Sign in directly to Meta to select your portfolio and link your WhatsApp Business Number in 1-click.
                    </p>
                  </div>
                  <Button
                    className="w-full justify-center"
                    onClick={() => {
                      const metaAppId = import.meta.env.VITE_META_APP_ID;
                      const metaConfigId = import.meta.env.VITE_META_CONFIG_ID;
                      const currentHotelId = profile.id || "";
                      if (!metaAppId || !metaConfigId) {
                        toast("Meta Configuration", "attend", "Please use Direct API Credentials or configure META_APP_ID in .env");
                        setWaTab("manual");
                        return;
                      }
                      const backendApiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
                      const callbackUrl = `${backendApiBase}/whatsapp/oauth/callback`;
                      const statePayload = btoa(JSON.stringify({ hotelId: currentHotelId, targetType: "guest" }));
                      const directOAuthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${encodeURIComponent(
                        metaAppId
                      )}&config_id=${encodeURIComponent(
                        metaConfigId
                      )}&redirect_uri=${encodeURIComponent(
                        callbackUrl
                      )}&response_type=code&state=${encodeURIComponent(statePayload)}&scope=whatsapp_business_management,whatsapp_business_messaging`;
                      window.open(directOAuthUrl, "MetaWhatsAppOAuth", "width=600,height=700,scrollbars=yes");
                    }}
                  >
                    Continue with Facebook
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- billing -- */

const yearlyMonthsFree = 2;

function planPrice(pricePerRoom: number, rooms: number, cycle: "monthly" | "yearly") {
  const monthly = pricePerRoom * rooms;
  return cycle === "yearly" ? monthly * (12 - yearlyMonthsFree) : monthly;
}

function BillingPanel() {
  const subscription = useApp((s) => s.subscription);
  const invoices = useApp((s) => s.invoices);
  const profile = useApp((s) => s.hotelProfile);
  const knowledge = useApp((s) => s.knowledge);

  const current = planTiers.find((t) => t.key === subscription.plan) ?? planTiers[1];
  const rooms = subscription.rooms;
  const cycle = subscription.billingCycle;
  const total = planPrice(current.pricePerRoom, rooms, cycle);
  const seatLimit = current.seats;
  const seatPct = seatLimit ? Math.min(100, Math.round((subscription.seatsUsed / seatLimit) * 100)) : 0;
  const aiShare = subscription.usage.conversations
    ? Math.round((subscription.usage.aiReplies / subscription.usage.conversations) * 100)
    : 0;

  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [cardHolder, setCardHolder] = useState(subscription.paymentMethod.holder || profile.legalName || profile.name);
  const [cardBrand, setCardBrand] = useState(subscription.paymentMethod.brand || "Visa");
  const [cardLast4, setCardLast4] = useState(subscription.paymentMethod.last4 || "4417");
  const [cardExpiry, setCardExpiry] = useState(subscription.paymentMethod.expiry || "09/28");

  const saveCard = () => {
    const updatedPayment = {
      brand: cardBrand,
      last4: cardLast4.slice(-4),
      expiry: cardExpiry,
      holder: cardHolder,
    };
    store.setState((s) => ({
      ...s,
      subscription: {
        ...s.subscription,
        paymentMethod: updatedPayment,
      },
    }));
    setIsCardModalOpen(false);
    toast("Payment method updated", "good", `${cardBrand} ···· ${cardLast4.slice(-4)}`);
  };

  const downloadInvoice = (inv: typeof invoices[0]) => {
    const content = `=======================================================
HOTELOGX CONNECT — SUBSCRIPTION INVOICE
=======================================================

Invoice Number : ${inv.number}
Date           : ${inv.date}
Billing Period : ${inv.period}
Status         : ${inv.status}

-------------------------------------------------------
CUSTOMER DETAILS:
Hotel Name     : ${profile.name}
Legal Entity   : ${profile.legalName || profile.name}
VAT Number     : ${profile.vatNumber || "N/A"}
Billing Email  : ${profile.email}
Address        : ${profile.address}, ${profile.postcode} ${profile.city}, ${profile.country}

-------------------------------------------------------
SUBSCRIPTION DETAILS:
Plan           : ${current.name} Tier
Rooms Active   : ${rooms} Rooms
Price / Room   : ${money(current.pricePerRoom)}
Billing Cycle  : ${cycle.toUpperCase()}

-------------------------------------------------------
TOTAL BILLED   : ${money(inv.amount)}
PAYMENT STATUS : PAID (${subscription.paymentMethod.brand} ···· ${subscription.paymentMethod.last4})
=======================================================
Thank you for using Hotelogx Connect.
`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${inv.number}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast("Invoice downloaded", "good", `${inv.number} saved to your device`);
  };

  const exportAllInvoices = () => {
    if (!invoices || invoices.length === 0) {
      toast("No invoices found", "attend");
      return;
    }
    const headers = "Invoice Number,Period,Date,Amount,Status\n";
    const rows = invoices
      .map((i) => `"${i.number}","${i.period}","${i.date}","${i.amount}","${i.status}"`)
      .join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hotelogx-invoices-${profile.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast("Invoices exported", "good", "CSV downloaded to your device");
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-4">
          <Card>
            <SectionTitle
              title="Your plan"
              hint={`Billed per room · ${profile.name}`}
              action={<Badge tone={statusTone(subscription.status)} dot>{subscription.status}</Badge>}
            />
            <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
              <div className="rounded-[10px] border border-pine-200 bg-pine-50/60 p-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display text-[20px] leading-none font-medium text-ink">{current.name}</p>
                  <p className="tnum font-display text-[20px] leading-none font-medium text-ink">
                    {money(total)}
                    <span className="ml-1 font-sans text-[11.5px] font-normal text-ink-4">
                      /{cycle === "yearly" ? "year" : "month"}
                    </span>
                  </p>
                </div>
                <p className="mt-2 text-[12.5px] leading-snug text-ink-3">{current.blurb}</p>
                <div className="mt-2.5 divide-y divide-line-soft border-t border-line-soft pt-1">
                  <KeyValue label="Rooms" value={`${rooms} × ${money(current.pricePerRoom)}`} mono />
                  <KeyValue label="Started" value={subscription.startedOn} />
                  <KeyValue label="Renews" value={subscription.renewsOn} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="rounded-[10px] border border-line bg-surface p-3.5">
                  <Eyebrow>Billing cycle</Eyebrow>
                  <div className="mt-2 flex gap-1.5">
                    {(["monthly", "yearly"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setBillingCycle(c)}
                        className={cn(
                          "flex-1 rounded-[9px] border px-2 py-1.5 text-[12px] font-medium capitalize transition-colors",
                          cycle === c ? "border-pine-400 bg-pine-50/60 text-ink" : "border-line bg-surface text-ink-4 hover:text-ink",
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11.5px] leading-snug text-ink-4">
                    Yearly billing gives you {yearlyMonthsFree} months free.
                  </p>
                </div>
                <div className="rounded-[10px] border border-line bg-surface p-3.5">
                  <Eyebrow>Seats</Eyebrow>
                  <p className="tnum mt-1.5 font-display text-[17px] leading-none font-medium text-ink">
                    {subscription.seatsUsed}
                    <span className="ml-1 font-sans text-[11.5px] font-normal text-ink-4">
                      of {seatLimit ?? "unlimited"}
                    </span>
                  </p>
                  {seatLimit && <Meter value={seatPct} tone={seatPct > 85 ? "attend" : "pine"} className="mt-2" />}
                  <p className="mt-2 text-[11.5px] leading-snug text-ink-4">
                    Housekeeping and maintenance work from WhatsApp and do not use a seat.
                  </p>
                </div>
              </div>
            </div>
          </Card>

          <Card pad={false}>
            <div className="border-b border-line px-4 py-3">
              <p className="text-[13.5px] font-medium text-ink">This billing period</p>
              <p className="text-[11.5px] text-ink-4">14 Aug — 13 Sep 2026 · nothing here is metered, it is included</p>
            </div>
            <div className="grid divide-y divide-line-soft sm:grid-cols-4 sm:divide-x sm:divide-y-0">
              {[
                { label: "Conversations", value: subscription.usage.conversations.toLocaleString("en-IE") },
                { label: "AI replies", value: subscription.usage.aiReplies.toLocaleString("en-IE"), hint: `${aiShare}% of conversations` },
                { label: "WhatsApp messages", value: subscription.usage.whatsappMessages.toLocaleString("en-IE") },
                { label: "Upsell revenue", value: money(subscription.usage.upsellRevenue), hint: "attributed to the AI" },
              ].map((u) => (
                <div key={u.label} className="px-4 py-3">
                  <Eyebrow>{u.label}</Eyebrow>
                  <p className="tnum mt-1 font-display text-[19px] leading-none font-medium text-ink">{u.value}</p>
                  {u.hint && <p className="mt-1 text-[11px] text-ink-4">{u.hint}</p>}
                </div>
              ))}
            </div>
            <div className="border-t border-line px-4 py-3">
              <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-ink-4">
                <Sparkles className="mt-px size-3.5 shrink-0 text-ai" />
                Your plan is priced per room, not per message — a busy month costs the same as a quiet one. Knowledge sources
                indexed: {knowledge.filter((k) => k.aiReady).length} of {current.knowledgeDocs ?? "unlimited"}.
              </p>
            </div>
          </Card>

          <Card pad={false}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-[13.5px] font-medium text-ink">Invoices</p>
              <Button size="sm" variant="ghost" icon={Download} onClick={exportAllInvoices}>
                Export all
              </Button>
            </div>
            <ul>
              {invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0">
                  <FileText className="size-3.5 shrink-0 text-ink-4" />
                  <div className="min-w-0 flex-1">
                    <p className="tnum font-mono text-[12.5px] text-ink">{inv.number}</p>
                    <p className="text-[11px] text-ink-4">{inv.period}</p>
                  </div>
                  <p className="hidden text-[11.5px] text-ink-4 sm:block">{inv.date}</p>
                  <p className="tnum w-20 text-right font-mono text-[12.5px] font-medium text-ink">{money(inv.amount)}</p>
                  <Badge tone={statusTone(inv.status)}>{inv.status}</Badge>
                  <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadInvoice(inv)} />
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <Eyebrow>Payment method</Eyebrow>
            <div className="mt-2 flex items-center gap-2.5 rounded-[10px] border border-line bg-paper/50 p-3">
              <CreditCard className="size-4 shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <p className="tnum font-mono text-[12.5px] text-ink">
                  {subscription.paymentMethod.brand} ···· {subscription.paymentMethod.last4}
                </p>
                <p className="text-[11px] text-ink-4">
                  expires {subscription.paymentMethod.expiry} · {subscription.paymentMethod.holder}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-2.5 w-full"
              icon={Pencil}
              onClick={() => setIsCardModalOpen(true)}
            >
              Update card
            </Button>
            <p className="mt-2.5 text-[11.5px] leading-snug text-ink-4">
              Card details are held by our payment provider. Hotelogx never stores them.
            </p>
          </Card>

          <Card>
            <Eyebrow>Billing contact</Eyebrow>
            <div className="mt-1.5 divide-y divide-line-soft">
              <KeyValue label="Entity" value={profile.legalName} />
              <KeyValue label="VAT" value={profile.vatNumber} mono />
              <KeyValue label="Invoices to" value={profile.email} mono />
              <KeyValue label="Address" value={`${profile.address}, ${profile.postcode} ${profile.city}`} />
            </div>
            <p className="mt-2.5 border-t border-line-soft pt-2.5 text-[11.5px] leading-snug text-ink-4">
              Taken from Hotel Profile. Change it there and invoices follow.
            </p>
          </Card>

          <Card>
            <Eyebrow>Need to stop?</Eyebrow>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
              You can cancel at the end of any period. Your conversations and knowledge base stay exportable for 90 days.
            </p>
            <Button
              size="sm"
              variant="quiet"
              className="mt-2.5"
              onClick={() => toast("We would rather talk first", "attend", "Your account manager will call within one working day")}
            >
              Cancel subscription
            </Button>
          </Card>
        </div>
      </div>

      <Card pad={false}>
        <div className="border-b border-line px-4 py-3">
          <p className="text-[13.5px] font-medium text-ink">Change plan</p>
          <p className="text-[11.5px] text-ink-4">
            Priced per room, so {rooms} rooms {cycle === "yearly" ? "per year" : "per month"}. Changes apply at the next renewal.
          </p>
        </div>
        <div className="grid gap-3 p-4 lg:grid-cols-3">
          {planTiers.map((tier) => {
            const active = tier.key === subscription.plan;
            const tierTotal = planPrice(tier.pricePerRoom, rooms, cycle);
            return (
              <div
                key={tier.key}
                className={cn(
                  "flex flex-col rounded-[10px] border p-3.5",
                  active ? "border-pine-400 bg-pine-50/60" : "border-line bg-surface",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13.5px] font-semibold text-ink">{tier.name}</p>
                  {active && (
                    <Badge tone="pine" dot>
                      Current
                    </Badge>
                  )}
                </div>
                <p className="tnum mt-1.5 font-display text-[22px] leading-none font-medium text-ink">
                  {money(tierTotal)}
                  <span className="ml-1 font-sans text-[11.5px] font-normal text-ink-4">
                    /{cycle === "yearly" ? "year" : "month"}
                  </span>
                </p>
                <p className="tnum mt-1 font-mono text-[11px] text-ink-4">
                  {money(tier.pricePerRoom)} per room · {rooms} rooms
                </p>
                <p className="mt-2 text-[12px] leading-snug text-ink-3">{tier.blurb}</p>
                <ul className="mt-2.5 flex-1 space-y-1.5 border-t border-line-soft pt-2.5">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-[12px] text-ink-2">
                      <Check className="mt-0.5 size-3 shrink-0 text-good" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  variant={active ? "quiet" : "outline"}
                  className="mt-3 w-full"
                  disabled={active}
                  icon={active ? undefined : ArrowUpRight}
                  onClick={() => setPlan(tier.key)}
                >
                  {active ? "Your plan" : tier.pricePerRoom > current.pricePerRoom ? `Upgrade to ${tier.name}` : `Move to ${tier.name}`}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>

      {isCardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-[14px] border border-line bg-surface p-5 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-line-soft pb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="size-4 text-pine-600" />
                <h3 className="text-[15px] font-medium text-ink">Update Payment Method</h3>
              </div>
              <button
                onClick={() => setIsCardModalOpen(false)}
                className="text-ink-4 hover:text-ink text-[18px] leading-none"
              >
                &times;
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[11.5px] font-medium text-ink-3">Cardholder Name</span>
                <input
                  type="text"
                  value={cardHolder}
                  onChange={(e) => setCardHolder(e.target.value)}
                  placeholder="The Taj Hotel BV"
                  className="mt-1 w-full rounded-[9px] border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-pine-400"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11.5px] font-medium text-ink-3">Card Brand</span>
                  <select
                    value={cardBrand}
                    onChange={(e) => setCardBrand(e.target.value)}
                    className="mt-1 w-full rounded-[9px] border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-pine-400"
                  >
                    <option value="Visa">Visa</option>
                    <option value="Mastercard">Mastercard</option>
                    <option value="American Express">American Express</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11.5px] font-medium text-ink-3">Expiry (MM/YY)</span>
                  <input
                    type="text"
                    value={cardExpiry}
                    maxLength={5}
                    onChange={(e) => setCardExpiry(e.target.value)}
                    placeholder="12/28"
                    className="mt-1 w-full rounded-[9px] border border-line bg-paper px-3 py-2 text-[13px] text-ink font-mono outline-none focus:border-pine-400"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-[11.5px] font-medium text-ink-3">Card Number (Last 4 Digits)</span>
                <input
                  type="text"
                  value={cardLast4}
                  maxLength={4}
                  onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, ""))}
                  placeholder="4417"
                  className="mt-1 w-full rounded-[9px] border border-line bg-paper px-3 py-2 text-[13px] text-ink font-mono outline-none focus:border-pine-400"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-line-soft pt-3.5">
              <Button size="sm" variant="quiet" onClick={() => setIsCardModalOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveCard} icon={Check}>
                Save Card
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- ai -- */

const modes: AiRule["mode"][] = ["Autonomous", "Human Approval", "Always Escalate"];

function AiPanel() {
  const aiMode = useApp((s) => s.aiMode);
  const rules = useApp((s) => s.aiRules);

  const globalModes = [
    { key: "Autonomous" as const, label: "Autonomous", note: "The AI replies on its own and escalates by rule." },
    { key: "Approval Required" as const, label: "Approval required", note: "Every reply waits for a person to approve it." },
    { key: "Suggestions Only" as const, label: "Suggestions only", note: "The AI drafts, nothing is sent automatically." },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
      <div className="space-y-4">
        <Card>
          <SectionTitle title="How much freedom the AI has" hint="This applies to guest-facing messages" />
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
            <p className="text-[11.5px] text-ink-4">Anything not listed follows the global setting above.</p>
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
          <Eyebrow>Always escalated</Eyebrow>
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
            These never receive an automatic answer, whatever the global mode. The guest is told a person is looking at it, and
            the escalation card reaches the manager immediately.
          </p>
        </Card>
        <Card>
          <Eyebrow>Escalation triggers</Eyebrow>
          <ul className="mt-2 space-y-1.5 text-[12.5px] text-ink-2">
            {[
              "The guest asks for a human",
              "Frustration or a complaint is detected",
              "Money, refunds or a legal matter",
              "The AI is not confident enough to answer",
              "Nothing in the knowledge base covers the question",
              "The same request comes back a third time",
            ].map((t) => (
              <li key={t} className="flex items-start gap-1.5">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ai" />
                {t}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
