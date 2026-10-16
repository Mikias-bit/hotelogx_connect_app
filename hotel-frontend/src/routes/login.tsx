import { useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, Eye, EyeOff, Sparkles, Wand2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui";
import { roleHome, signIn } from "@/lib/session";
import { startOnboarding, toast } from "@/lib/store";
import { api } from "@/lib/api";

export const Route = createFileRoute("/login")({
  component: Login,
});

const steps = [
  {
    title: "The guest writes wherever they already are",
    body: "WhatsApp, Gmail, Outlook or your own mailbox. One thread per guest, whatever they use.",
  },
  {
    title: "The AI answers, and knows when not to",
    body: "It replies from your own policies and live availability, and escalates complaints, refunds and safety to a human.",
  },
  {
    title: "Work reaches the right department on WhatsApp",
    body: "Housekeeping and maintenance update rooms and tickets with a tap. No new app to learn.",
  },
  {
    title: "Everyone sees only what needs them",
    body: "Managers get a morning briefing instead of an inbox. Reception gets prepared answers instead of questions.",
  },
];

interface DisplayUser {
  id: string;
  name: string;
  email: string;
  role: string;
  title: string;
  initials: string;
}

const RECENT_HOTEL_KEY = "hotelogx.recent_hotel_meta.v1";

function Login() {
  const navigate = useNavigate();
  const [authMode, setAuthMode] = useState<"signin" | "register">("signin");
  
  // Safe display-only cache from active/recent session (strictly non-sensitive metadata)
  const [recentHotel, setRecentHotel] = useState<{ id?: string; name?: string; users?: DisplayUser[] } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(RECENT_HOTEL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.users) && parsed.users.length > 0) {
          return parsed;
        }
      }
    } catch {}
    return null;
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Registration state
  const [regHotelName, setRegHotelName] = useState("");
  const [regManagerName, setRegManagerName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim()) {
      setError("Please enter your work email.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    setError(null);
    setBusy(true);

    try {
      const res = await api.login({ email: email.trim(), password });
      if (res && res.token && res.user) {
        window.localStorage.setItem("token", res.token);
        await signIn(res.user.id, res.user);

        // Fetch authorized tenant staff list to update display-only cache securely
        try {
          const staffList = await api.getUsers();
          if (Array.isArray(staffList) && staffList.length > 0) {
            const displayUsers: DisplayUser[] = staffList.map((u: any) => ({
              id: u.id,
              name: u.name,
              email: u.email,
              role: u.role,
              title: u.title || "Staff",
              initials: u.initials || u.name?.slice(0, 2).toUpperCase() || "ST",
            }));
            const updatedRecent = {
              id: res.user.hotelId,
              name: res.user.hotelName || recentHotel?.name || "Hotel Workspace",
              users: displayUsers,
            };
            window.localStorage.setItem(RECENT_HOTEL_KEY, JSON.stringify(updatedRecent));
            setRecentHotel(updatedRecent);
          } else {
            // Keep at least current authenticated user in display cache
            const singleUser: DisplayUser = {
              id: res.user.id,
              name: res.user.name,
              email: res.user.email,
              role: res.user.role,
              title: res.user.title || "Staff",
              initials: res.user.initials || "ST",
            };
            const updatedRecent = {
              id: res.user.hotelId,
              name: res.user.hotelName || recentHotel?.name || "Hotel Workspace",
              users: [singleUser],
            };
            window.localStorage.setItem(RECENT_HOTEL_KEY, JSON.stringify(updatedRecent));
            setRecentHotel(updatedRecent);
          }
        } catch {}

        toast("Signed in successfully", "good", `Welcome, ${res.user.name}`);
        setTimeout(() => navigate({ to: roleHome[res.user.role as keyof typeof roleHome] || "/manager" }), 150);
      } else {
        const msg = (res as any)?.message || "Invalid email or password.";
        setError(msg);
        toast("Sign in failed", "urgent", msg);
        setBusy(false);
      }
    } catch {
      setError("Invalid email or password.");
      toast("Sign in failed", "urgent", "Invalid email or password");
      setBusy(false);
    }
  };

  // Set up a new hotel: opens the onboarding wizard directly
  const firstLogin = () => {
    startOnboarding();
    navigate({ to: "/onboarding" });
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regHotelName.trim() || !regManagerName.trim() || !regEmail.trim() || !regPassword) {
      setError("All fields are required to register your hotel.");
      return;
    }
    if (regPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setError(null);
    setBusy(true);

    try {
      const res = await api.registerHotel({
        hotelName: regHotelName.trim(),
        managerName: regManagerName.trim(),
        email: regEmail.trim(),
        password: regPassword,
      });

      if (res && res.token && res.user) {
        if (typeof window !== "undefined") {
          window.localStorage.setItem("token", res.token);
        }
        startOnboarding();
        await signIn(res.user.id, res.user);
        toast("Hotel registered successfully", "good", `Welcome, ${res.user.name}`);
        setTimeout(() => navigate({ to: "/onboarding" }), 150);
      } else {
        const msg = (res as any)?.message || "Registration failed. Please verify your details.";
        setError(msg);
        toast("Registration failed", "urgent", msg);
        setBusy(false);
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to connect to the server. Please try again.";
      setError(msg);
      toast("Registration failed", "urgent", msg);
      setBusy(false);
    }
  };

  return (
    <div className="grain grid min-h-dvh bg-paper lg:grid-cols-[1.05fr_1fr]">
      {/* left — positioning */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-pine-900 px-10 py-12 text-pine-100 lg:flex xl:px-14">
        <span
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 15%, #4c8574 0%, transparent 45%), radial-gradient(circle at 85% 80%, #3f5c96 0%, transparent 40%)",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span>
              <span className="block font-display text-[16px] leading-tight font-semibold text-white">Hotelogx</span>
              <span className="block text-[10.5px] tracking-[0.14em] text-pine-200 uppercase">Connect</span>
            </span>
          </div>

          <h1 className="mt-12 max-w-lg font-display text-[38px] leading-[1.08] font-medium text-white xl:text-[44px]">
            An AI front office and operations assistant.
          </h1>
          <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-pine-200">
            Not a chatbot, not another inbox. The AI handles routine guest communication and coordinates your departments —
            your team sees only what genuinely requires a person.
          </p>
        </div>

        <ol className="relative mt-12 space-y-5">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3.5">
              <span className="tnum mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-pine-400/50 font-mono text-[11px] text-pine-200">
                {i + 1}
              </span>
              <div>
                <p className="text-[13.5px] font-medium text-white">{step.title}</p>
                <p className="mt-0.5 max-w-sm text-[12.5px] leading-snug text-pine-200/85">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="relative mt-10 flex max-w-md items-start gap-2 border-t border-pine-400/25 pt-5 text-[12px] leading-snug text-pine-200/75">
          <Sparkles className="mt-px size-3.5 shrink-0" />
          Reservations always complete on your own booking engine — the AI checks availability and pricing in your PMS, then
          hands the guest a direct link. It never takes payment.
        </p>
      </section>

      {/* right — sign in / register */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Logo />
            <span className="font-display text-[16px] font-semibold text-ink">Hotelogx Connect</span>
          </div>

          {authMode === "signin" ? (
            <>
              <p className="text-[11px] font-semibold tracking-[0.14em] text-ink-4 uppercase">Sign in</p>
              <h2 className="mt-1.5 font-display text-[26px] leading-tight font-medium text-ink">Workspace Sign In</h2>
              <p className="mt-1.5 text-[13px] text-ink-3">
                Sign in to your hotel operations workspace. Your assigned role determines available portals.
              </p>

              <form onSubmit={submit} className="mt-6 space-y-2.5">
                {error && (
                  <div className="flex items-center gap-2 rounded-[9px] border border-urgent-line bg-urgent-bg/80 px-3 py-2.5 text-[12.5px] font-medium text-urgent">
                    <AlertCircle className="size-4 shrink-0" />
                    <span className="flex-1">{error}</span>
                  </div>
                )}

                <label className="block">
                  <span className="text-[11.5px] font-medium text-ink-3">Work email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="manager@yourhotel.com"
                    className="mt-1 w-full rounded-[9px] border border-line bg-surface px-3 py-2 font-mono text-[12.5px] text-ink outline-none focus:border-pine-400"
                  />
                </label>
                <label className="block">
                  <span className="text-[11.5px] font-medium text-ink-3">Password</span>
                  <div className="relative mt-1">
                    <input
                      ref={passwordInputRef}
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="••••••••••"
                      className="w-full rounded-[9px] border border-line bg-surface px-3 py-2 pr-9 text-[13px] text-ink outline-none focus:border-pine-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      tabIndex={-1}
                      className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-ink-4 transition-colors hover:text-ink"
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </label>

                <Button type="submit" className="mt-5 w-full" disabled={busy || !email.trim() || !password} icon={ArrowRight}>
                  {busy ? "Signing in…" : "Sign In"}
                </Button>
              </form>

              <div className="mt-5 border-t border-line-soft pt-4">
                <p className="text-[12.5px] font-medium text-ink">New hotel?</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-ink-4">
                  Start from nothing: the onboarding wizard walks the manager through the profile, the PMS, email, both WhatsApp
                  numbers, the knowledge base, the team and the AI rules.
                </p>
                <div className="mt-2.5">
                  <Button variant="outline" size="sm" icon={Wand2} onClick={firstLogin} disabled={busy}>
                    Set up a new hotel
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-[11px] font-semibold tracking-[0.14em] text-ink-4 uppercase">New Registration</p>
              <h2 className="mt-1.5 font-display text-[26px] leading-tight font-medium text-ink">Register Your Hotel</h2>
              <p className="mt-1.5 text-[13px] text-ink-3">
                Create a dedicated account for your hotel property to begin setup.
              </p>

              <form onSubmit={handleRegister} className="mt-6 space-y-3">
                {error && (
                  <div className="flex items-center gap-2 rounded-[9px] border border-urgent-line bg-urgent-bg/80 px-3 py-2.5 text-[12.5px] font-medium text-urgent">
                    <AlertCircle className="size-4 shrink-0" />
                    <span className="flex-1">{error}</span>
                  </div>
                )}

                <label className="block">
                  <span className="text-[11.5px] font-medium text-ink-3">Hotel property name</span>
                  <input
                    type="text"
                    required
                    value={regHotelName}
                    onChange={(e) => {
                      setRegHotelName(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="e.g. Grand Horizon Hotel"
                    className="mt-1 w-full rounded-[9px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine-400"
                  />
                </label>

                <label className="block">
                  <span className="text-[11.5px] font-medium text-ink-3">General Manager name</span>
                  <input
                    type="text"
                    required
                    value={regManagerName}
                    onChange={(e) => {
                      setRegManagerName(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="e.g. Sarah Jenkins"
                    className="mt-1 w-full rounded-[9px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine-400"
                  />
                </label>

                <label className="block">
                  <span className="text-[11.5px] font-medium text-ink-3">Manager work email</span>
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => {
                      setRegEmail(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="manager@yourhotel.com"
                    className="mt-1 w-full rounded-[9px] border border-line bg-surface px-3 py-2 font-mono text-[12.5px] text-ink outline-none focus:border-pine-400"
                  />
                </label>

                <label className="block">
                  <span className="text-[11.5px] font-medium text-ink-3">Password (min 6 characters)</span>
                  <input
                    type="password"
                    required
                    value={regPassword}
                    onChange={(e) => {
                      setRegPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="••••••••••••"
                    className="mt-1 w-full rounded-[9px] border border-line bg-surface px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-pine-400"
                  />
                </label>

                <Button type="submit" className="mt-5 w-full" disabled={busy} icon={ArrowRight}>
                  {busy ? "Registering hotel…" : "Register & Start Setup"}
                </Button>
              </form>

              <div className="mt-5 border-t border-line-soft pt-4">
                <p className="text-[12.5px] font-medium text-ink">Already have an account?</p>
                <Button
                  variant="quiet"
                  size="sm"
                  className="mt-1"
                  onClick={() => {
                    setAuthMode("signin");
                    setError(null);
                  }}
                  disabled={busy}
                >
                  Return to sign in
                </Button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

