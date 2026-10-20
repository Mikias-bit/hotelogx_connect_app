import { Store, useStore } from "@tanstack/react-store";
import { api } from "./api";
import { initBackendSync, resetStoreState } from "./store";
import type { Role, StaffUser } from "./types";

const KEY = "hotelogx.session.v1";
const USER_KEY = "hotelogx.user.v1";

interface SessionState {
  userId: string | null;
  user: StaffUser | null;
  ready: boolean;
}

export const sessionStore = new Store<SessionState>({ userId: null, user: null, ready: false });

export async function hydrateSession() {
  if (typeof window === "undefined") return;
  const token = window.localStorage.getItem("token");
  if (token) {
    try {
      const meRes = await api.getMe();
      if (meRes?.user) {
        const freshUser: StaffUser = {
          id: meRes.user.id,
          name: meRes.user.name,
          email: meRes.user.email,
          role: meRes.user.role as Role,
          title: meRes.user.title || "Staff",
          phone: meRes.user.phone || "",
          initials: meRes.user.initials || "ST",
          lastActive: "now",
          whatsapp: Boolean(meRes.user.whatsapp),
        };
        window.localStorage.setItem(USER_KEY, JSON.stringify(freshUser));
        sessionStore.setState(() => ({ userId: freshUser.id, user: freshUser, ready: true }));
        if (typeof initBackendSync === "function") {
          initBackendSync();
        }
        return;
      }
    } catch {}
  }

  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(USER_KEY);
  sessionStore.setState(() => ({ userId: null, user: null, ready: true }));
}

export async function signIn(userId: string, customUser?: StaffUser) {
  if (typeof window === "undefined" || !window.localStorage.getItem("token") || !customUser || customUser.id !== userId) {
    throw new Error("Please sign in with your email and password.");
  }
  window.localStorage.setItem(KEY, userId);
  window.localStorage.setItem(USER_KEY, JSON.stringify(customUser));
  sessionStore.setState(() => ({ userId, user: customUser, ready: true }));
  initBackendSync();
}

// API failures clear authentication immediately; cached display data is not a session.
if (typeof window !== "undefined") {
  window.addEventListener("hotelogx:session-expired", () => {
    sessionStore.setState(() => ({ userId: null, user: null, ready: true }));
  });
}

export function signOut() {
  if (typeof window !== "undefined") {
    // Clear explicit authentication and user session keys
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(USER_KEY);
    window.localStorage.removeItem("token");

    // Remove any other hotelogx.*, tenant.*, or auth.* keys from localStorage,
    // but preserve strictly non-sensitive display metadata (hotelogx.recent_hotel_meta.v1)
    const localKeysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (
        k &&
        k !== "hotelogx.recent_hotel_meta.v1" &&
        (k.startsWith("hotelogx.") ||
          k.startsWith("hotelogx_") ||
          k === "token" ||
          k.startsWith("auth_") ||
          k.startsWith("session_") ||
          k.startsWith("tenant_"))
      ) {
        localKeysToRemove.push(k);
      }
    }
    localKeysToRemove.forEach((k) => window.localStorage.removeItem(k));

    // Clear sessionStorage authentication and tenant keys
    const sessionKeysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (
        k &&
        k !== "hotelogx.recent_hotel_meta.v1" &&
        (k.startsWith("hotelogx.") ||
          k.startsWith("hotelogx_") ||
          k === "token" ||
          k.startsWith("auth_") ||
          k.startsWith("session_") ||
          k.startsWith("tenant_"))
      ) {
        sessionKeysToRemove.push(k);
      }
    }
    sessionKeysToRemove.forEach((k) => window.sessionStorage.removeItem(k));
  }

  // Reset in-memory session store
  sessionStore.setState(() => ({ userId: null, user: null, ready: true }));

  // Reset in-memory application store (clears tenant-specific state)
  resetStoreState();
}

export function useSession() {
  return useStore(sessionStore, (s) => s);
}

export function useCurrentUser(): StaffUser | null {
  const { userId, user } = useStore(sessionStore, (s) => s);
  if (!userId) return null;
  return user;
}

export const roleHome: Record<Role, string> = {
  manager: "/manager",
  "front-office": "/front-office",
  housekeeping: "/housekeeping",
  maintenance: "/maintenance",
};

export const roleLabel: Record<Role, string> = {
  manager: "Hotel Manager",
  "front-office": "Front Office",
  housekeeping: "Housekeeping",
  maintenance: "Maintenance / Technical",
};
