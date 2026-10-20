import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, ShieldCheck, User } from "lucide-react";
import { toast, updateHotelProfile, useApp } from "@/lib/store";
import { api } from "@/lib/api";
import { signIn, useCurrentUser } from "@/lib/session";
import type { HotelProfile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, Card, Eyebrow, SectionTitle } from "./ui";

type ProfileTextKey = {
  [K in keyof HotelProfile]-?: NonNullable<HotelProfile[K]> extends string ? (K extends "id" ? never : K) : never;
}[keyof HotelProfile];

const hotelFields: { key: ProfileTextKey; label: string; mono?: boolean; placeholder?: string }[] = [
  { key: "name", label: "Hotel name", placeholder: "Hotel Mercier" },
  { key: "legalName", label: "Legal entity", placeholder: "Hotel Mercier BV" },
  { key: "address", label: "Street", placeholder: "Leopoldstraat 42" },
  { key: "postcode", label: "Postcode", mono: true },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "phone", label: "Reception phone", mono: true },
  { key: "website", label: "Website", mono: true, placeholder: "yourhotel.com" },
  { key: "checkIn", label: "Check-in from", mono: true },
  { key: "checkOut", label: "Check-out by", mono: true },
];

const languageOptions = ["English", "Dutch", "French", "German", "Spanish", "Italian", "Hindi"];

export function OnboardingProfileStep({ onDraftChange }: { onDraftChange?: (draft: HotelProfile) => void } = {}) {
  const profile = useApp((s) => s.hotelProfile);
  const currentUser = useCurrentUser();

  const [draft, setDraft] = useState<HotelProfile>(profile);
  const [managerName, setManagerName] = useState(currentUser?.name || "");
  const [managerEmail, setManagerEmail] = useState(currentUser?.email || "");
  const [managerPassword, setManagerPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  const setField = (key: ProfileTextKey, next: string) => {
    setDraft((d) => ({ ...d, [key]: next }));
    setSavedSuccess(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // If user is not yet authenticated, register and create the hotel tenant
      if (!window.localStorage.getItem("token") || !currentUser) {
        if (currentUser || !managerPassword.trim()) {
          toast("Manager sign-in required", "urgent", "For an existing hotel, sign in on the login page. For a new hotel, enter the manager account details below.");
          return;
        }
        if (!managerEmail.trim() || !managerPassword.trim()) {
          toast("Manager credentials required", "urgent", "Please provide a Manager Email and Password to create your hotel account");
          setSaving(false);
          return;
        }
        if (managerPassword.length < 6) {
          toast("Password too short", "urgent", "Password must be at least 6 characters");
          setSaving(false);
          return;
        }

        const regRes = await api.registerHotel({
          hotelName: draft.name.trim() || "My Hotel",
          managerName: managerName.trim() || "General Manager",
          email: managerEmail.trim(),
          password: managerPassword,
          phone: draft.phone.trim() || undefined,
        });

        if (regRes && regRes.token && regRes.user) {
          if (typeof window !== "undefined") {
            window.localStorage.setItem("token", regRes.token);
          }
          await signIn(regRes.user.id, regRes.user);

          const updatedDraft: HotelProfile = {
            ...draft,
            id: regRes.user.hotelId || regRes.hotel?.id,
            name: draft.name || regRes.hotel?.name || "My Hotel",
          };
          setDraft(updatedDraft);
          if (!await updateHotelProfile(updatedDraft)) return;
          toast("Hotel account created & profile saved", "good", `Welcome, ${regRes.user.name}`);
          setSavedSuccess(true);
        } else {
          toast("Registration error", "urgent", (regRes as any)?.message || "Could not create hotel workspace");
        }
      } else {
        if (!await updateHotelProfile(draft)) return;
        toast("Hotel profile saved", "good", "The AI uses these details when answering guests");
        setSavedSuccess(true);
      }
    } catch (err: any) {
      toast("Could not save profile", "urgent", err?.message || "Check your connection and try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-ink-3">
        Already created your hotel? <a href="/login" className="underline">Sign in to your existing manager account</a> before saving.
      </p>
      {/* Manager Account Section */}
      <Card>
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-pine-600" />
          <SectionTitle
            title="Manager Account & Access"
            hint={currentUser ? "You are signed in as the authorized administrator for this property." : "Create your administrator account to secure your hotel workspace and connect PMS/Email/WhatsApp."}
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-[11.5px] font-medium text-ink-3">Manager full name *</span>
            <div className="mt-1 flex items-center gap-2 rounded-[9px] border border-line bg-surface px-2.5 focus-within:border-pine-400">
              <User className="size-3.5 shrink-0 text-ink-4" />
              <input
                type="text"
                value={managerName}
                onChange={(e) => {
                  setManagerName(e.target.value);
                  setSavedSuccess(false);
                }}
                placeholder="e.g. Sarah Jenkins"
                className="w-full bg-transparent py-2 text-[12.5px] text-ink outline-none"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-[11.5px] font-medium text-ink-3">Manager work email *</span>
            <div className="mt-1 flex items-center gap-2 rounded-[9px] border border-line bg-surface px-2.5 focus-within:border-pine-400">
              <Mail className="size-3.5 shrink-0 text-ink-4" />
              <input
                type="email"
                value={managerEmail}
                onChange={(e) => {
                  setManagerEmail(e.target.value);
                  setSavedSuccess(false);
                }}
                placeholder="manager@yourhotel.com"
                className="w-full bg-transparent py-2 font-mono text-[12.5px] text-ink outline-none"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-[11.5px] font-medium text-ink-3">
              {currentUser ? "Password (set)" : "Password (min 6 chars) *"}
            </span>
            <div className="mt-1 flex items-center gap-2 rounded-[9px] border border-line bg-surface px-2.5 focus-within:border-pine-400">
              <Lock className="size-3.5 shrink-0 text-ink-4" />
              <input
                type={showPassword ? "text" : "password"}
                value={managerPassword}
                onChange={(e) => {
                  setManagerPassword(e.target.value);
                  setSavedSuccess(false);
                }}
                placeholder={currentUser ? "••••••••••" : "••••••••••"}
                className="w-full bg-transparent py-2 font-mono text-[12.5px] text-ink outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-ink-4 hover:text-ink"
              >
                {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </label>
        </div>

        <p className="mt-3 flex items-start gap-1.5 border-t border-line-soft pt-2.5 text-[11px] leading-snug text-ink-4">
          <ShieldCheck className="mt-px size-3.5 shrink-0 text-pine-600" />
          Administrator credentials are encrypted and scoped strictly to your hotel property tenant.
        </p>
      </Card>

      {/* Hotel Information Section */}
      <Card>
        <SectionTitle
          title="Hotel Property Profile"
          hint="These facts are treated by the AI as ground truth for availability, policies, and guest assistance."
          action={
            <Button
              size="sm"
              icon={saving ? Loader2 : Check}
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? "Saving…" : savedSuccess ? "Saved ✓" : "Save Profile & Account"}
            </Button>
          }
        />

        <div className="grid gap-3 sm:grid-cols-2">
          {hotelFields.map((f) => (
            <label key={f.key} className="block">
              <span className="text-[11.5px] font-medium text-ink-3">{f.label}</span>
              <input
                value={draft[f.key] || ""}
                placeholder={f.placeholder}
                onChange={(e) => setField(f.key, e.target.value)}
                className={cn(
                  "mt-1 w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 outline-none focus:border-pine-400",
                  f.mono ? "tnum font-mono text-[12.5px]" : "text-[13px]",
                )}
              />
            </label>
          ))}
          <label className="block">
            <span className="text-[11.5px] font-medium text-ink-3">Total rooms inventory</span>
            <input
              value={draft.rooms || ""}
              inputMode="numeric"
              placeholder="e.g. 48"
              onChange={(e) => {
                const roomsVal = Number(e.target.value.replace(/\D/g, "")) || 0;
                setDraft((d) => ({ ...d, rooms: roomsVal }));
                setSavedSuccess(false);
              }}
              className="tnum mt-1 w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 font-mono text-[12.5px] outline-none focus:border-pine-400"
            />
          </label>
          <label className="block">
            <span className="text-[11.5px] font-medium text-ink-3">Hotel star rating</span>
            <select
              value={draft.stars || 4}
              onChange={(e) => {
                const starsVal = Number(e.target.value);
                setDraft((d) => ({ ...d, stars: starsVal }));
                setSavedSuccess(false);
              }}
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

        <div className="mt-4 border-t border-line-soft pt-3.5">
          <Eyebrow>Languages your team can proofread</Eyebrow>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {languageOptions.map((language) => {
              const on = (draft.languages || []).includes(language);
              return (
                <button
                  key={language}
                  type="button"
                  onClick={() => {
                    const langs = draft.languages || [];
                    const nextLangs = on ? langs.filter((l) => l !== language) : [...langs, language];
                    setDraft((d) => ({ ...d, languages: nextLangs }));
                    setSavedSuccess(false);
                  }}
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
            The AI answers in whatever language the guest writes in. These are the ones a person here can check.
          </p>
        </div>

        <label className="mt-4 block border-t border-line-soft pt-3.5">
          <span className="text-[11.5px] font-medium text-ink-3">How should the AI describe the hotel?</span>
          <textarea
            value={draft.description || ""}
            rows={3}
            onChange={(e) => {
              const desc = e.target.value;
              setDraft((d) => ({ ...d, description: desc }));
              setSavedSuccess(false);
            }}
            placeholder="A boutique townhouse hotel five minutes from the city centre…"
            className="mt-1 w-full resize-none rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-pine-400"
          />
        </label>
      </Card>
    </div>
  );
}

