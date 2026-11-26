import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2 } from "lucide-react";
import { toast, updateHotelProfile, useApp } from "@/lib/store";
import { useCurrentUser } from "@/lib/session";
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
      if (!window.localStorage.getItem('token') || currentUser?.role !== 'manager') {
        toast('Manager sign-in required', 'urgent', 'Accept your hotel invitation or sign in to your existing account.');
        return;
      }
      if (!await updateHotelProfile(draft)) return;
      toast('Hotel profile saved', 'good', 'The AI uses these details when answering guests');
      setSavedSuccess(true);
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
      <Card>
        <div className="flex items-center gap-2"><KeyRound className="size-4 text-pine-600" /><SectionTitle title="Manager account" hint="Your approved account is linked to this hotel." /></div>
        <p className="mt-2 text-sm">{currentUser?.name} ? {currentUser?.email}</p>
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

