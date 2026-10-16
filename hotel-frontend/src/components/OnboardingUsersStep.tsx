import { useState } from "react";
import { MessageCircle, Trash2, UserPlus } from "lucide-react";
import { roleLabel } from "@/lib/session";
import { addOnboardingInvite, removeOnboardingInvite, useApp } from "@/lib/store";
import type { Role } from "@/lib/types";
import { isEmailish } from "@/lib/onboarding";
import { Badge, Button, Card, Eyebrow, SectionTitle } from "./ui";

const roleAccess: Record<Role, string> = {
  manager: "Dashboard, Conversations, Tasks, Upsells, Settings",
  "front-office": "Dashboard, Conversations, Tasks",
  housekeeping: "Dashboard, Rooms, Tasks — mostly works from WhatsApp",
  maintenance: "Dashboard, Issues, Tasks — mostly works from WhatsApp",
};

export function OnboardingUsersStep() {
  const invites = useApp((s) => s.onboarding.invites);
  const profile = useApp((s) => s.hotelProfile);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("front-office");

  const domain = profile.website || "yourhotel.com";
  const duplicate = invites.some((i) => i.email === email.trim().toLowerCase());

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px] lg:items-start">
      <Card>
        <SectionTitle title="Who else works here?" hint="Their role decides their workspace — you can change it later" />

        <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="text-[11.5px] font-medium text-ink-3">Work email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isEmailish(email) && !duplicate) {
                  addOnboardingInvite(email.trim().toLowerCase(), role);
                  setEmail("");
                }
              }}
              placeholder={`colleague@${domain}`}
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
              {(Object.keys(roleLabel) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {roleLabel[r]}
                </option>
              ))}
            </select>
          </label>
          <Button
            icon={UserPlus}
            disabled={!isEmailish(email) || duplicate}
            onClick={() => {
              addOnboardingInvite(email.trim().toLowerCase(), role);
              setEmail("");
            }}
          >
            Invite
          </Button>
        </div>
        <p className="mt-2 text-[11.5px] leading-snug text-ink-4">{roleAccess[role]}.</p>

        <div className="mt-4 border-t border-line-soft pt-3.5">
          <Eyebrow>Invited</Eyebrow>
          {invites.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-ink-4">
              Nobody yet. You can run the hotel on your own account and invite the team later.
            </p>
          ) : (
            <ul className="mt-2">
              {invites.map((invite) => (
                <li key={invite.email} className="flex flex-wrap items-center gap-2.5 border-b border-line-soft py-2 last:border-b-0">
                  <span className="tnum min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">{invite.email}</span>
                  <Badge tone={invite.role === "manager" ? "pine" : "mute"}>{roleLabel[invite.role]}</Badge>
                  {(invite.role === "housekeeping" || invite.role === "maintenance") && (
                    <Badge tone="good">
                      <MessageCircle className="size-3" /> WhatsApp
                    </Badge>
                  )}
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => removeOnboardingInvite(invite.email)} />
                </li>
              ))}
            </ul>
          )}
        </div>
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
          <Eyebrow>Housekeeping rarely signs in</Eyebrow>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
            Invite them anyway — the invitation is how their WhatsApp number is recognised when they message the operations
            number.
          </p>
        </Card>
      </div>
    </div>
  );
}
