import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  BedDouble,
  ClipboardList,
  Gauge,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  Sparkles,
  TrendingUp,
  Wrench,
  X,
} from "lucide-react";
import { roleLabel, signOut, useCurrentUser, useSession } from "@/lib/session";
import { initBackendSync, selectors, useApp } from "@/lib/store";
import { useRealtimeSync } from "@/lib/useRealtimeSync";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ActivityPanel } from "./ActivityFeed";
import { Logo } from "./Logo";
import { WhatsAppOps } from "./WhatsAppOps";
import { Avatar, Badge, Toaster } from "./ui";

type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }> };

const navByRole: Record<Role, NavItem[]> = {
  manager: [
    { to: "/manager", label: "Dashboard", icon: Gauge },
    { to: "/manager/conversations", label: "Conversations", icon: MessageSquare },
    { to: "/manager/tasks", label: "Tasks", icon: ClipboardList },
    { to: "/manager/upsells", label: "Upsells", icon: TrendingUp },
    { to: "/manager/settings", label: "Settings", icon: Settings },
  ],
  "front-office": [
    { to: "/front-office", label: "Dashboard", icon: Gauge },
    { to: "/front-office/conversations", label: "Conversations", icon: MessageSquare },
    { to: "/front-office/tasks", label: "Tasks", icon: ClipboardList },
  ],
  housekeeping: [
    { to: "/housekeeping", label: "Dashboard", icon: Gauge },
    { to: "/housekeeping/rooms", label: "Rooms", icon: BedDouble },
    { to: "/housekeeping/tasks", label: "Tasks", icon: ClipboardList },
  ],
  maintenance: [
    { to: "/maintenance", label: "Dashboard", icon: Gauge },
    { to: "/maintenance/issues", label: "Issues", icon: Wrench },
    { to: "/maintenance/tasks", label: "Tasks", icon: ClipboardList },
  ],
};

export function AppShell({
  children,
  title,
  wide,
  flush,
}: {
  children: ReactNode;
  title?: string;
  wide?: boolean;
  flush?: boolean;
}) {
  const session = useSession();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const escalations = useApp(selectors.escalations).length;
  const openTasks = useApp(selectors.openTasks).length;
  const hotel = useApp((s) => s.hotelProfile);
  const [mounted, setMounted] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [drawer, setDrawer] = useState<null | "activity" | "whatsapp">(null);
  const currentHotelId = (user as any)?.hotelId || hotel.name || "the-taj-hotel-mydnh7";
  useRealtimeSync(currentHotelId);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (session.ready && !session.userId) {
      navigate({ to: "/login", replace: true });
    } else if (session.ready && session.userId) {
      if (typeof initBackendSync === "function") {
        initBackendSync();
      }
    }
  }, [session.ready, session.userId, navigate]);

  useEffect(() => {
    setMobileNav(false);
  }, [pathname]);

  if (!mounted || !user) {
    return (
      <div className="grain flex min-h-dvh items-center justify-center bg-paper">
        <p className="text-[13px] text-ink-4">Loading your workspace…</p>
      </div>
    );
  }

  const userRole = (user?.role && navByRole[user.role] ? user.role : "manager") as Role;
  const nav = navByRole[userRole] || navByRole.manager;
  const counterFor = (label: string) => {
    if (label === "Conversations" && escalations) return { value: escalations, tone: "urgent" as const };
    if (label === "Tasks" && openTasks) return { value: openTasks, tone: "mute" as const };
    return null;
  };

  const navList = (
    <nav className="space-y-0.5">
      {nav.map((item) => {
        const active = item.to === pathname || (item.to !== `/${userRole}` && pathname.startsWith(item.to));
        const Icon = item.icon;
        const counter = counterFor(item.label);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "relative flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13.5px] transition-colors",
              active ? "bg-pine-50 font-medium text-pine-700" : "text-ink-2 hover:bg-paper-2",
            )}
          >
            {active && <span className="absolute top-1/2 -left-2.5 h-4 w-[3px] -translate-y-1/2 rounded-full bg-pine-600" />}
            <Icon className={cn("size-4 shrink-0", active ? "text-pine-600" : "text-ink-4")} />
            <span className="flex-1">{item.label}</span>
            {counter && (
              <span
                className={cn(
                  "tnum rounded-full px-1.5 py-px font-mono text-[10.5px]",
                  counter.tone === "urgent" ? "bg-urgent-bg text-urgent" : "bg-paper-2 text-ink-3",
                )}
              >
                {counter.value}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="grain min-h-dvh bg-paper">
      <div className="flex">
        {/* sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col border-r border-line bg-surface/70 px-5 py-5 lg:flex">
          <Link to={nav[0].to} className="flex items-center gap-2.5">
            <Logo />
            <span>
              <span className="block font-display text-[15px] leading-tight font-semibold text-ink">Hotelogx</span>
              <span className="block text-[10.5px] tracking-[0.12em] text-ink-4 uppercase">Connect</span>
            </span>
          </Link>

          <div className="mt-7 flex-1">{navList}</div>

          <div className="space-y-2">
            <button
              onClick={() => setDrawer("whatsapp")}
              className="flex w-full items-center gap-2 rounded-[9px] border border-line bg-paper px-2.5 py-2 text-left text-[12.5px] text-ink-2 transition-colors hover:border-ink-4"
            >
              <MessageSquare className="size-3.5 text-wa" />
              WhatsApp ops layer
            </button>
            <p className="flex items-start gap-1.5 px-1 text-[10.5px] leading-snug text-ink-4">
              <Sparkles className="mt-px size-3 shrink-0 text-ai" />
              The AI is watching every channel. You only see what needs you.
            </p>
          </div>
        </aside>

        {/* main */}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
            <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
              <button onClick={() => setMobileNav(true)} className="text-ink-3 lg:hidden">
                <Menu className="size-5" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ink">
                  {hotel.name}
                  <span className="ml-2 hidden text-[12px] font-normal text-ink-4 sm:inline">
                    {hotel.city} · {hotel.rooms} rooms
                  </span>
                </p>
                {title && <p className="truncate text-[11.5px] text-ink-4">{title}</p>}
              </div>

              <Badge tone="pine" className="hidden sm:inline-flex">
                {roleLabel[user.role]}
              </Badge>

              <button
                onClick={() => setDrawer("activity")}
                className="relative inline-flex size-9 items-center justify-center rounded-full border border-line bg-surface text-ink-3 transition-colors hover:text-ink"
              >
                <Bell className="size-4" />
                {escalations > 0 && (
                  <span className="tnum absolute -top-1 -right-1 inline-flex min-w-4 items-center justify-center rounded-full bg-urgent px-1 font-mono text-[9.5px] text-white">
                    {escalations}
                  </span>
                )}
              </button>

              <div className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-1 pl-1.5">
                <Avatar initials={user.initials} size={26} />
                <span className="hidden text-[12.5px] font-medium text-ink-2 sm:inline">{user.name.split(" ")[0]}</span>
                <button
                  onClick={() => {
                    signOut();
                    navigate({ to: "/login", replace: true });
                  }}
                  title="Sign out"
                  className="inline-flex size-7 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-paper-2 hover:text-ink"
                >
                  <LogOut className="size-3.5" />
                </button>
              </div>
            </div>
          </header>

          <main className={cn(flush ? "" : "px-4 py-5 sm:px-6 sm:py-7", !wide && !flush && "mx-auto max-w-[1180px]")}>
            {children}
          </main>
        </div>
      </div>

      {/* mobile nav */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-ink/25" onClick={() => setMobileNav(false)} aria-label="Close menu" />
          <div className="slide-in-right absolute inset-y-0 left-0 w-[262px] border-r border-line bg-surface px-5 py-5">
            <div className="mb-6 flex items-center justify-between">
              <Link to={nav[0].to} className="flex items-center gap-2.5">
                <Logo size={28} />
                <span className="font-display text-[15px] font-semibold text-ink">Hotelogx</span>
              </Link>
              <button onClick={() => setMobileNav(false)} className="text-ink-4">
                <X className="size-4.5" />
              </button>
            </div>
            {navList}
            <button
              onClick={() => {
                setMobileNav(false);
                setDrawer("whatsapp");
              }}
              className="mt-4 flex w-full items-center gap-2 rounded-[9px] border border-line bg-paper px-2.5 py-2 text-[12.5px] text-ink-2"
            >
              <MessageSquare className="size-3.5 text-wa" />
              WhatsApp ops layer
            </button>
          </div>
        </div>
      )}

      {/* right drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50">
          <button className="absolute inset-0 bg-ink/20" onClick={() => setDrawer(null)} aria-label="Close panel" />
          <aside className="slide-in-right absolute inset-y-0 right-0 flex w-[min(420px,100vw)] flex-col border-l border-line bg-surface">
            <div className="flex items-center gap-1 border-b border-line px-4 py-3">
              {(["activity", "whatsapp"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDrawer(tab)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                    drawer === tab ? "bg-pine-50 text-pine-700" : "text-ink-3 hover:text-ink",
                  )}
                >
                  {tab === "activity" ? "AI activity" : "WhatsApp ops"}
                </button>
              ))}
              <button onClick={() => setDrawer(null)} className="ml-auto text-ink-4 transition-colors hover:text-ink">
                <X className="size-4" />
              </button>
            </div>
            <div className={cn("min-h-0 flex-1 p-4", drawer === "activity" ? "overflow-y-auto" : "overflow-hidden")}>
              {drawer === "activity" ? <ActivityPanel /> : <WhatsAppOps />}
            </div>
          </aside>
        </div>
      )}

      <Toaster />
    </div>
  );
}
