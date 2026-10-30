import { Store, useStore } from "@tanstack/react-store";
import { api } from "./api";
import {
  hotel,
  planTiers,
  subscription as defaultSubscription,
} from "./data";
import type {
  ActivityItem,
  AiRule,
  Channel,
  Conversation,
  Department,
  EmailMethod,
  EmailServerSettings,
  HotelProfile,
  Invoice,
  Issue,
  KnowledgeDoc,
  Message,
  Priority,
  OnboardingState,
  OnboardingStepKey,
  PlanKey,
  Role,
  Room,
  RoomStatus,
  StaffUser,
  Subscription,
  Task,
  TaskSource,
  TaskStatus,
  Upsell,
  WaConnection,
  WaConnectionType,
  WaTopology,
  WaThread,
} from "./types";
import { detectEmail } from "./onboarding";
import { clockNow, money, uid } from "./utils";

type Toast = { id: string; text: string; detail?: string; tone: "good" | "attend" | "urgent" | "ai" };

type AppState = {
  conversations: Conversation[];
  tasks: Task[];
  rooms: Room[];
  issues: Issue[];
  upsells: Upsell[];
  activity: ActivityItem[];
  waThreads: WaThread[];
  aiRules: AiRule[];
  knowledge: KnowledgeDoc[];
  hotelProfile: HotelProfile;
  users: StaffUser[];
  subscription: Subscription;
  invoices: Invoice[];
  onboarding: OnboardingState;
  aiMode: "Autonomous" | "Approval Required" | "Suggestions Only";
  integrations: {
    pms: { provider: string; connected: boolean; lastSync: string };
    email: { provider: "google" | "microsoft" | "other"; account: string; connected: boolean };
    whatsapp: { connected: boolean; number: string; waba: string; quality: string; templates: number };
  };
  toasts: Toast[];
};

/* ------------------------------------------------------------ onboarding -- */

const allStepsDone: Record<OnboardingStepKey, boolean> = {
  profile: true,
  pms: true,
  email: true,
  "wa-guest": true,
  "wa-internal": true,
  knowledge: true,
  users: true,
  ai: true,
};

const noStepsDone: Record<OnboardingStepKey, boolean> = {
  profile: false,
  pms: false,
  email: false,
  "wa-guest": false,
  "wa-internal": false,
  knowledge: false,
  users: false,
  ai: false,
};

function blankWa(connectionType: WaConnectionType): WaConnection {
  return {
    state: "not-started",
    connectionType,
    hotelId: null,
    wabaId: null,
    phoneNumberId: null,
    displayPhoneNumber: null,
    canSend: false,
    canReceive: false,
    lastActivity: null,
    error: null,
  };
}

/** The seeded hotel is already live, so its wizard reads as finished. */
export function connectedOnboarding(): OnboardingState {
  return {
    complete: true,
    startedAt: null,
    waTopology: "separate",
    done: { ...allStepsDone },
    pms: {
      state: "connected",
      provider: "Mews",
      propertyId: "MEWS-4471-MERCIER",
      propertyName: hotel.name,
      lastSync: "2 min ago",
      error: null,
    },
    email: {
      state: "connected",
      address: hotel.email,
      detection: null,
      method: "oauth",
      settings: null,
      connectedAt: "14 Feb 2026",
      lastMessage: "6 min ago",
      error: null,
    },
    waGuest: {
      state: "connected",
      connectionType: "guest",
      hotelId: "htl_mercier_01",
      wabaId: "waba_102944",
      phoneNumberId: "pn_884120",
      displayPhoneNumber: hotel.whatsappNumber,
      canSend: true,
      canReceive: true,
      lastActivity: "2 min ago",
      error: null,
    },
    waInternal: {
      state: "connected",
      connectionType: "internal",
      hotelId: "htl_mercier_01",
      wabaId: "waba_104471",
      phoneNumberId: "pn_884133",
      displayPhoneNumber: "+32 3 227 41 09",
      canSend: true,
      canReceive: true,
      lastActivity: "just now",
      error: null,
    },
    invites: [],
  };
}

/** A hotel opening the product for the first time. */
function freshOnboarding(): OnboardingState {
  return {
    complete: false,
    startedAt: clockNow(),
    waTopology: null,
    done: { ...noStepsDone },
    pms: { state: "not-started", provider: null, propertyId: null, propertyName: null, lastSync: null, error: null },
    email: {
      state: "not-started",
      address: "",
      detection: null,
      method: null,
      settings: null,
      connectedAt: null,
      lastMessage: null,
      error: null,
    },
    waGuest: blankWa("guest"),
    waInternal: blankWa("internal"),
    invites: [],
  };
}

const emptyHotelProfile: HotelProfile = {
  name: "",
  legalName: "",
  stars: 4,
  rooms: 0,
  languages: ["Dutch", "French", "English", "German"],
  address: "",
  postcode: "",
  city: "",
  country: "",
  timezone: "Europe/Brussels",
  currency: "€",
  phone: "",
  email: "",
  website: "",
  bookingEngine: "",
  whatsappNumber: "",
  checkIn: "15:00",
  checkOut: "11:00",
  vatNumber: "",
  description: "",
};

export const store = new Store<AppState>({
  conversations: [],
  tasks: [],
  rooms: [],
  issues: [],
  upsells: [],
  activity: [],
  waThreads: [],
  aiRules: [],
  knowledge: [],
  hotelProfile: emptyHotelProfile,
  users: [],
  subscription: defaultSubscription,
  invoices: [],
  onboarding: freshOnboarding(),
  aiMode: "Autonomous",
  integrations: {
    pms: { provider: "Mews", connected: false, lastSync: "—" },
    email: { provider: "google", account: "", connected: false },
    whatsapp: {
      connected: false,
      number: "",
      waba: "",
      quality: "High",
      templates: 0,
    },
  },
  toasts: [],
});

export function useApp<T>(selector: (state: AppState) => T): T {
  return useStore(store, selector);
}

export function resetStoreState() {
  store.setState(() => ({
    conversations: [],
    tasks: [],
    rooms: [],
    issues: [],
    upsells: [],
    activity: [],
    waThreads: [],
    aiRules: [],
    knowledge: [],
    hotelProfile: emptyHotelProfile,
    users: [],
    subscription: defaultSubscription,
    invoices: [],
    onboarding: freshOnboarding(),
    aiMode: "Autonomous",
    integrations: {
      pms: { provider: "Mews", connected: false, lastSync: "—" },
      email: { provider: "google", account: "", connected: false },
      whatsapp: {
        connected: false,
        number: "",
        waba: "",
        quality: "High",
        templates: 0,
      },
    },
    toasts: [],
  }));
}

function set(updater: (state: AppState) => Partial<AppState>) {
  store.setState((s) => ({ ...s, ...updater(s) }));
}

function pushActivity(item: Omit<ActivityItem, "id" | "at"> & { at?: string }) {
  set((s) => ({
    activity: [{ id: uid("a"), at: item.at ?? clockNow(), kind: item.kind, text: item.text, meta: item.meta }, ...s.activity],
  }));
}

function appendMessage(conversationId: string, message: Omit<Message, "id">) {
  set((s) => ({
    conversations: s.conversations.map((c) =>
      c.id === conversationId
        ? { ...c, messages: [...c.messages, { ...message, id: uid("m") }], lastAt: message.at }
        : c,
    ),
  }));
}

/* ---------------------------------------------------------------- toasts -- */

export function toast(text: string, tone: Toast["tone"] = "good", detail?: string) {
  const id = uid("toast");
  set((s) => ({ toasts: [...s.toasts, { id, text, detail, tone }] }));
  setTimeout(() => dismissToast(id), 5200);
}

export function dismissToast(id: string) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/* --------------------------------------------------------- conversations -- */

export function takeOver(conversationId: string, staffName: string) {
  set((s) => ({
    conversations: s.conversations.map((c) =>
      c.id === conversationId ? { ...c, aiStatus: "human-takeover", escalation: undefined, unread: 0 } : c,
    ),
  }));
  appendMessage(conversationId, {
    author: "system",
    channel: "internal",
    at: clockNow(),
    body: `${staffName} took over this conversation. The AI will stop replying until it is handed back.`,
  });
  pushActivity({ kind: "escalation", text: `${staffName} took over a conversation`, meta: "Dashboard" });
  toast("You are handling this conversation", "ai", "The AI has paused automatic replies");
  api.toggleTakeover(conversationId, "human-takeover");
}

export function returnToAi(conversationId: string) {
  set((s) => ({
    conversations: s.conversations.map((c) => (c.id === conversationId ? { ...c, aiStatus: "ai-handling" } : c)),
  }));
  appendMessage(conversationId, {
    author: "system",
    channel: "internal",
    at: clockNow(),
    body: "Handed back to the AI. Automatic replies resumed for this guest.",
  });
  toast("Returned to the AI", "ai", "Automatic replies resumed");
  api.toggleTakeover(conversationId, "ai-handling");
}

export function sendReply(conversationId: string, body: string, as: "ai" | "staff", staffName?: string) {
  const conversation = store.state.conversations.find((c) => c.id === conversationId);
  if (!conversation) return;
  appendMessage(conversationId, {
    author: as,
    channel: conversation.primaryChannel,
    at: clockNow(),
    body,
    staffName,
    confidence: as === "ai" ? 0.95 : undefined,
  });
  set((s) => ({
    conversations: s.conversations.map((c) =>
      c.id === conversationId
        ? {
          ...c,
          unread: 0,
          escalation: undefined,
          aiStatus: as === "ai" ? "ai-handling" : c.aiStatus === "escalated" ? "human-takeover" : c.aiStatus,
          aiHandledCount: as === "ai" ? c.aiHandledCount + 1 : c.aiHandledCount,
        }
        : c,
    ),
  }));
  pushActivity({
    kind: "ai-reply",
    text:
      as === "ai"
        ? `Approved AI reply sent to ${conversation.guest.name}`
        : `${staffName ?? "Staff"} replied to ${conversation.guest.name}`,
    meta: channelLabel(conversation.primaryChannel),
  });
  toast(as === "ai" ? "AI reply approved and sent" : "Reply sent", "good", `${conversation.guest.name} · ${channelLabel(conversation.primaryChannel)}`);
  const guestEmail = (conversation.guest as any)?.email || (conversation.guest?.tags as string[])?.find((t) => t.includes('@'));
  api.sendReply(conversationId, body, staffName, conversation.primaryChannel, guestEmail);
}

export function addNote(conversationId: string, body: string, staffName: string) {
  appendMessage(conversationId, { author: "staff", channel: "internal", at: clockNow(), body, staffName });
  toast("Internal note added", "ai", "Visible to staff only");
}

export function escalateConversation(conversationId: string, reason: string) {
  set((s) => ({
    conversations: s.conversations.map((c) =>
      c.id === conversationId
        ? {
          ...c,
          aiStatus: "escalated",
          escalation: {
            reason,
            urgency: "High",
            suggested: c.suggestedReply || "Review the thread and reply personally.",
            raisedAt: clockNow(),
          },
        }
        : c,
    ),
  }));
  pushActivity({ kind: "escalation", text: `Conversation escalated — ${reason}`, meta: "Dashboard" });
  toast("Escalated to the manager", "urgent", reason);
  api.escalateConversation(conversationId, reason);
}

export function resolveConversation(conversationId: string) {
  const conversation = store.state.conversations.find((c) => c.id === conversationId);
  set((s) => ({
    conversations: s.conversations.map((c) =>
      c.id === conversationId ? { ...c, aiStatus: "resolved", escalation: undefined, unread: 0 } : c,
    ),
  }));
  pushActivity({ kind: "ai-reply", text: `Resolved the conversation with ${conversation?.guest.name ?? "the guest"}`, meta: "Dashboard" });
  toast("Marked as resolved", "good");
  api.resolveConversation(conversationId);
}

export function markRead(conversationId: string) {
  set((s) => ({
    conversations: s.conversations.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)),
  }));
}

export function acceptUpsell(conversationId: string, label: string, value: string) {
  const conversation = store.state.conversations.find((c) => c.id === conversationId);
  if (!conversation) return;
  const numeric = Number(value.replace(/[^0-9.]/g, "")) || 0;
  set((s) => ({
    upsells: [
      {
        id: uid("up"),
        guest: conversation.guest.name,
        room: conversation.guest.room,
        offer: label,
        value: numeric,
        channel: conversation.primaryChannel,
        status: "Sent",
        date: `Today ${clockNow()}`,
      },
      ...s.upsells,
    ],
    conversations: s.conversations.map((c) =>
      c.id === conversationId ? { ...c, upsellIdeas: c.upsellIdeas.filter((u) => u.label !== label) } : c,
    ),
  }));
  appendMessage(conversationId, {
    author: "ai",
    channel: conversation.primaryChannel,
    at: clockNow(),
    confidence: 0.96,
    body: `One more thing — we can add ${label.toLowerCase()} for ${value}. Would you like me to arrange it?`,
    buttons: ["Yes please", "No thank you"],
  });
  pushActivity({ kind: "upsell", text: `Offered ${label} to ${conversation.guest.name}`, meta: value });
  toast("Offer sent to the guest", "good", `${label} · ${value}`);
}

/* ----------------------------------------------------------------- tasks -- */

export async function createTask(input: {
  title: string;
  detail?: string;
  room?: string;
  guest?: string;
  department: Department;
  priority: Priority;
  due?: string;
  assignee?: string;
  source: TaskSource;
  conversationId?: string;
}): Promise<string | null> {
  const result = await api.createTask(input);
  if (!result) {
    toast("Task could not be created", "urgent", "Server error — please try again");
    return null;
  }
  const serverTask = result as any;
  const task: Task = {
    id: serverTask.id,
    title: serverTask.title,
    detail: serverTask.detail ?? input.detail,
    room: serverTask.room ?? input.room,
    guest: serverTask.guest ?? input.guest,
    department: (serverTask.department ?? input.department) as Department,
    priority: (serverTask.priority ?? input.priority) as Priority,
    createdAt: serverTask.createdAt ?? clockNow(),
    due: serverTask.due ?? input.due,
    assignee: serverTask.assignee ?? input.assignee,
    status: (serverTask.status ?? (input.assignee ? "Assigned" : "New")) as TaskStatus,
    source: (serverTask.source ?? input.source) as TaskSource,
    conversationId: serverTask.conversationId ?? input.conversationId,
    trail: Array.isArray(serverTask.trail) ? serverTask.trail : [],
  };
  set((s) => ({
    tasks: [task, ...s.tasks],
    conversations: input.conversationId
      ? s.conversations.map((c) => (c.id === input.conversationId ? { ...c, taskIds: [...c.taskIds, task.id] } : c))
      : s.conversations,
  }));
  pushActivity({
    kind: "task",
    text: `${input.department} task created — ${input.title}${input.room ? ` (${input.room})` : ""}`,
    meta: input.assignee ? `Sent to ${input.assignee} on WhatsApp` : "Unassigned",
  });
  toast("Task created", "good", `${input.department}${input.assignee ? ` · ${input.assignee}` : ""}`);
  return task.id;
}

const guestClosingLine: Record<Department, (room?: string) => string> = {
  Housekeeping: () => "That is taken care of now — housekeeping has confirmed it. Anything else I can arrange?",
  Maintenance: (room) => `Our technician has finished the work${room ? ` in ${room}` : ""}. Please let me know if anything is still not right.`,
  "Front Office": () => "All arranged — reception has confirmed it for you.",
  "Guest Request": () => "Your request has been completed. Let me know if you need anything else.",
  VIP: () => "Everything is prepared for your arrival. We look forward to welcoming you.",
  Billing: () => "Your invoice has been corrected and a copy is on its way by email.",
  "Follow-up": () => "This is now closed on our side — thank you for your patience.",
};

export async function setTaskStatus(taskId: string, status: TaskStatus, note?: string) {
  const task = store.state.tasks.find((t) => t.id === taskId);
  if (!task) return;

  const result = await api.updateTaskStatus(taskId, status, note, "dashboard", undefined, task.reportContentHash);
  if (!result) {
    toast(`Failed to update task`, "urgent", "Server error — please try again");
    return;
  }

  const serverTask = result as any;
  set((s) => ({
    tasks: s.tasks.map((t) =>
      t.id === taskId
        ? {
          ...t,
          ...serverTask,
          status: (serverTask.status ?? status) as TaskStatus,
          trail: Array.isArray(serverTask.trail) ? serverTask.trail : t.trail,
        }
        : t,
    ),
  }));

  if (task.id.startsWith('rt-')) window.dispatchEvent(new Event('hotelogx:operations-updated'));

  if (status === "Completed") {
    pushActivity({ kind: "task", text: `Completed — ${task.title}${task.room ? ` (${task.room})` : ""}`, meta: task.department });
    if (task.conversationId) {
      appendMessage(task.conversationId, {
        author: "ai",
        channel: store.state.conversations.find((c) => c.id === task.conversationId)?.primaryChannel ?? "whatsapp",
        at: clockNow(),
        confidence: 0.97,
        body: guestClosingLine[task.department](task.room),
      });
      toast("Task completed — guest informed automatically", "good", task.title);
      return;
    }
    toast("Task completed", "good", task.title);
    return;
  }
  toast(`Task ${status.toLowerCase()}`, "ai", task.title);
}

export async function assignTask(taskId: string, assignee: string) {
  if (taskId.startsWith('rt-')) {
    toast('Use the Housekeeping Assignments page', 'attend', 'Select tasks and a registered worker, then Assign & Send WhatsApp.'); return;
  }
  const result = await api.updateTaskStatus(taskId, "Assigned", `Assigned to ${assignee}`, "whatsapp", assignee);
  if (!result) {
    toast(`Failed to assign task`, "urgent", "Server error — please try again");
    return;
  }
  const serverTask = result as any;
  set((s) => ({
    tasks: s.tasks.map((t) =>
      t.id === taskId
        ? {
          ...t,
          assignee: serverTask.assignee ?? assignee,
          status: (serverTask.status ?? "Assigned") as TaskStatus,
          trail: Array.isArray(serverTask.trail) ? serverTask.trail : t.trail,
        }
        : t,
    ),
  }));
  toast(`Sent to ${assignee}`, "good", "Delivered as a WhatsApp task card");
}

/* ----------------------------------------------------------------- rooms -- */

export async function setRoomStatus(
  roomNumber: string,
  status: RoomStatus,
  viaOrCleaner?: "dashboard" | "whatsapp" | string,
  cleanerName?: string,
  noteText?: string,
) {
  const isVia = viaOrCleaner === "dashboard" || viaOrCleaner === "whatsapp";
  const via = isVia ? (viaOrCleaner as "dashboard" | "whatsapp") : "dashboard";
  const cleaner = !isVia ? viaOrCleaner : cleanerName;
  const note = noteText;

  // Backend-first: call API, wait for confirmation
  const result = await api.updateRoomStatus(roomNumber, status, cleaner, note);
  if (!result) {
    toast(`Failed to update Room ${roomNumber}`, "urgent", "Server error — status unchanged");
    return;
  }

  const serverRoom: Room = (result as any).room ?? (result as any);
  const completedTaskIds: string[] = (result as any).completedTaskIds ?? [];

  // Update room from server response — not from local assumptions
  set((s) => ({
    rooms: s.rooms.map((r) => (r.number === roomNumber ? { ...r, ...serverRoom } : r)),
    // Backend completed these tasks in the same transaction — sync them
    tasks: s.tasks.map((t) =>
      completedTaskIds.includes(t.id)
        ? { ...t, status: "Completed" as TaskStatus }
        : t,
    ),
  }));

  pushActivity({
    kind: "room",
    text: `Room ${roomNumber} is now ${status}${cleaner ? ` by ${cleaner}` : ""}`,
    meta: via === "whatsapp" ? "WhatsApp" : "Dashboard",
  });

  // Guest notification for completed tasks (conversation message only — task mutation owned by backend)
  const released = status === "Clean" || status === "Inspected";
  if (released && completedTaskIds.length > 0) {
    const completedTasks = store.state.tasks.filter((t) => completedTaskIds.includes(t.id));
    completedTasks.forEach((t) => {
      if (t.conversationId) {
        appendMessage(t.conversationId, {
          author: "ai",
          channel: store.state.conversations.find((c) => c.id === t.conversationId)?.primaryChannel ?? "whatsapp",
          at: clockNow(),
          confidence: 0.98,
          body: "Good news — your room is ready. Come to reception whenever you like and we will hand over the key.",
        });
      }
    });
  }

  if (released) {
    const room = store.state.rooms.find((r) => r.number === roomNumber);
    if (room?.arrivalTime) {
      pushActivity({
        kind: "task",
        text: `Reception told room ${roomNumber} is ready for the ${room.arrivalTime} arrival`,
        meta: "Front Office",
      });
      toast(`Room ${roomNumber} released`, "good", `Reception notified for the ${room.arrivalTime} arrival`);
      return;
    }
    toast(`Room ${roomNumber} released`, "good", "Front Office dashboard updated");
    return;
  }
  toast(`Room ${roomNumber} — ${status}`, status === "Maintenance" ? "attend" : "ai");
}

/**
 * Apply live updates from Mews PMS Webhook stream without requiring full page refresh
 */
export function applyPmsLiveUpdate(eventType: string, data: any) {
  if (eventType === "pms:synced") {
    api.getRooms().then((rooms) => {
      if (rooms && Array.isArray(rooms)) set(() => ({ rooms }));
    }).catch(() => {});
    api.getTasks().then((tasks) => {
      if (tasks && Array.isArray(tasks)) set(() => ({ tasks }));
    }).catch(() => {});
    const countRooms = data?.synced?.rooms ?? 0;
    const countRes = data?.synced?.reservations ?? 0;
    toast("PMS Data Synchronized", "good", `${countRooms} rooms & ${countRes} reservations updated`);
    return;
  }
  if ((eventType === "pms:room_updated" || eventType === "room:status_changed") && (data?.roomNumber || data?.number)) {
    const roomNum = String(data.roomNumber || data.number);
    const status = data.status as RoomStatus;
    set((s) => ({
      rooms: s.rooms.map((r) =>
        r.number === roomNum
          ? {
            ...r,
            status: status || r.status,
            cleaner: data.cleaner !== undefined ? data.cleaner : r.cleaner,
            updatedAt: data.updatedAt || data.time || "just now",
          }
          : r,
      ),
    }));
    if (eventType === "pms:room_updated") {
      toast(`Room ${roomNum} is ${status}`, "ai", "Live from Mews PMS");
    }
  } else if (eventType === "pms:reservation_updated" && data?.roomNumber) {
    const roomNum = String(data.roomNumber);

    set((s) => ({
      rooms: s.rooms.map((r) =>
        r.number === roomNum
          ? {
            ...r,
            guest: data.isCheckOut ? null : data.guestName || r.guest,
            guestStatus: data.isCheckIn ? "Occupied" : data.isCheckOut ? "Vacant" : r.guestStatus,
            status: data.isCheckOut ? "Dirty" : r.status,
            updatedAt: data.time || "just now",
          }
          : r,
      ),
    }));
    if (data.isCheckIn) {
      toast(`Guest Checked In · Room ${roomNum}`, "good", `${data.guestName || "Guest"} arrived (Mews)`);
    } else if (data.isCheckOut) {
      toast(`Guest Checked Out · Room ${roomNum}`, "attend", `Room set to Dirty (Mews)`);
    } else {
      toast(`Reservation Updated · Room ${roomNum}`, "ai", `${data.guestName || "Guest"} (Mews)`);
    }
  } else if (eventType === "activity:new" && data?.text) {
    pushActivity({
      kind: data.kind || "room",
      text: data.text,
      meta: data.meta || "Mews PMS",
    });
  } else if (eventType === "conversation:updated" && data?.channel === 'whatsapp') {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    void api.getConversations().then(rows => {
      if (rows && typeof localStorage !== 'undefined' && localStorage.getItem('token') === token) set(() => ({ conversations: rows }));
    });
  } else if (eventType === "conversation:updated" && (data?.conversationId || data?.conversation)) {
    const convId = data.conversationId || data.conversation?.id;
    set((s) => {
      const exists = s.conversations.some((c) => c.id === convId);
      if (exists) {
        return {
          conversations: s.conversations.map((c) => {
            if (c.id !== convId) return c;
            const newMessages = data.conversation?.messages || c.messages;
            return {
              ...c,
              ...(data.conversation || {}),
              unread: (c.unread || 0) + 1,
              lastAt: data.time || data.conversation?.lastAt || "just now",
              summary: data.lastMessage ? `"${data.lastMessage}"` : data.conversation?.summary || c.summary,
              messages: newMessages,
            };
          }),
        };
      } else if (data.conversation) {
        return {
          conversations: [data.conversation as Conversation, ...s.conversations],
        };
      } else {
        const fallbackConv: Conversation = {
          id: convId,
          stage: "pre-arrival",
          channels: [data.channel || "email"],
          primaryChannel: data.channel || "email",
          aiStatus: "ai-handling",
          sentiment: "neutral",
          subject: data.subject || "Guest Inquiry",
          summary: data.lastMessage ? `"${data.lastMessage}"` : "New guest message received",
          suggestedReply: `Dear ${data.guestName || "Guest"},\n\nThank you for reaching out to us. We have received your message and will assist you shortly.\n\nWarm regards,\nFront Desk Team`,
          knowledgeUsed: [],
          upsellIdeas: [],
          taskIds: [],
          unread: 1,
          lastAt: data.time || "just now",
          aiHandledCount: 0,
          guest: {
            id: data.guestId || `gst_${convId}`,
            name: data.guestName || "Guest",
            country: "BE",
            language: "en",
            vip: false,
            previousStays: 0,
            tags: [data.channel === "whatsapp" ? "WhatsApp Contact" : "Email Contact"],
            reservation: {
              number: "ENQ-" + String(convId).slice(-4).toUpperCase(),
              arrival: "Today",
              departure: "Pending",
              nights: 1,
              adults: 1,
              children: 0,
              roomType: "Standard Room",
              status: "Enquiry",
              rate: "€0",
            },
          },
          messages: [
            {
              id: `m-${Date.now()}`,
              author: "guest",
              channel: data.channel || "email",
              body: data.lastMessage || data.subject || "Guest inquiry",
              at: data.time || "just now",
            },
          ],
        };
        return {
          conversations: [fallbackConv, ...s.conversations],
        };
      }
    });
    const channelLabel = data.channel === "whatsapp" ? "WhatsApp" : "Email";
    toast(`New Guest ${channelLabel}: ${data.subject || data.guestName || "Inquiry"}`, "good", data.guestName ? `From ${data.guestName}` : `Guest ${channelLabel}`);
  }
}

/* ---------------------------------------------------------------- issues -- */

export async function createIssue(input: {
  room: string;
  title: string;
  detail?: string;
  priority: Priority;
  reportedBy: string;
  via: string;
  assignee?: string;
}): Promise<string> {
  try {
    const serverIssue = await api.createIssue(input);
    if (!serverIssue) throw new Error("Backend did not return created issue");
    const issue: Issue = serverIssue as Issue;
    set((s) => ({ issues: [issue, ...s.issues] }));
    pushActivity({ kind: "maintenance", text: `${issue.id} opened — ${issue.title} (${issue.room})`, meta: issue.via });
    toast(`${issue.id} created`, "good", `Room ${issue.room}`);
    return issue.id;
  } catch (err) {
    toast("Could not create issue", "urgent", "Check your connection and try again");
    console.error("createIssue failed:", err);
    return "";
  }
}

export async function setIssueStatus(issueId: string, status: Issue["status"], note?: string) {
  const issue = store.state.issues.find((i) => i.id === issueId);
  if (!issue) return;

  try {
    const serverIssue = await api.updateIssueStatus(issueId, status, note, "dashboard");
    if (!serverIssue) throw new Error("Backend did not return updated issue");

    const updated = serverIssue as Issue;

    // Backend is authoritative — sync store from server response
    set((s) => ({
      issues: s.issues.map((i) => (i.id === issueId ? { ...i, ...updated } : i)),
    }));

    window.dispatchEvent(new Event('hotelogx:maintenance-updated'));
    pushActivity({ kind: "maintenance", text: `${issueId} — ${status}`, meta: issue.room });
    toast(`${issueId} — ${status}`, status === "Escalated" ? "urgent" : "attend", note);
  } catch (err) {
    toast(`Could not update ${issueId}`, "urgent", "Check your connection and try again");
    console.error("setIssueStatus failed:", err);
  }
}

export async function assignIssue(issueId: string, assignee: string) {
  try {
    const serverIssue = await api.assignIssue(issueId, assignee);
    if (!serverIssue) throw new Error("Backend did not return updated issue");

    const updated = serverIssue as Issue;
    set((s) => ({
      issues: s.issues.map((i) => (i.id === issueId ? { ...i, ...updated } : i)),
    }));
    toast(`${issueId} assigned to ${assignee}`, "good");
  } catch (err) {
    toast(`Could not assign ${issueId}`, "urgent", "Check your connection and try again");
    console.error("assignIssue failed:", err);
  }
}

/* ------------------------------------------------------- whatsapp engine -- */

export async function waChoose(threadId: string, messageId: string, label: string) {
  const thread = store.state.waThreads.find(t => t.id === threadId);
  if (!thread) return;
  try {
    await api.sendWaAction({ threadId, messageId, label, staffName: thread.contact });
    const rows = await api.getWaThreads();
    if (rows) set(() => ({ waThreads: rows }));
    toast('Action saved', 'good', label);
  } catch (error) { toast('Action failed', 'urgent', error instanceof Error ? error.message : 'Please retry'); }
}

/* -------------------------------------------------------------- settings -- */

export function setAiMode(mode: AppState["aiMode"]) {
  set(() => ({ aiMode: mode }));
  toast(`AI mode set to ${mode}`, "ai");
  api.saveAiRules({ aiMode: mode }).catch((err) => {
    console.warn("Failed to persist AI mode to server:", err);
  });
}

export function setAiRule(topic: string, mode: AiRule["mode"]) {
  set((s) => ({ aiRules: s.aiRules.map((r) => (r.topic === topic ? { ...r, mode } : r)) }));
  toast(`${topic} — ${mode}`, "ai");
  api.saveAiRules({ rules: [{ topic, mode }] }).catch((err) => {
    console.warn("Failed to persist AI rule to server:", err);
  });
}

export function setEmailProvider(provider: "google" | "microsoft" | "other", account: string) {
  set((s) => ({ integrations: { ...s.integrations, email: { provider, account, connected: true } } }));
  toast("Mailbox connected", "good", account);
}



export async function updateHotelProfile(patch: Partial<HotelProfile>): Promise<boolean> {
  try { await api.saveHotelProfile(patch); }
  catch (error) {
    toast("Could not save profile", "urgent", error instanceof Error ? error.message : "Please sign in and try again.");
    return false;
  }
  set((s) => ({
    hotelProfile: { ...s.hotelProfile, ...patch },
    onboarding: {
      ...s.onboarding,
      done: { ...s.onboarding.done, profile: true },
    },
  }));
  return true;
}

export async function inviteStaffUser(data: { email: string; role: Role; name?: string; title?: string; phone?: string; whatsapp?: boolean }) {
  let res;
  try { res = await api.inviteUser(data); }
  catch (error) {
    toast("Invitation failed", "urgent", error instanceof Error ? error.message : "Could not send invitation");
    return false;
  }
  if (res) {
    set((s) => ({
      users: [...s.users.filter((u) => u.email !== res.email), res],
      onboarding: {
        ...s.onboarding,
        invites: [...s.onboarding.invites, { email: res.email, role: data.role }],
        done: { ...s.onboarding.done, users: true },
      },
    }));
    toast("Invitation submitted", "good", `${res.email} · ${res.role}`);
    return true;
  } else {
    toast("Invitation failed", "urgent", "Could not invite user");
    return false;
  }
}

export async function updateStaffRole(id: string, role: Role) {
  set((s) => ({
    users: s.users.map((u) => (u.id === id ? { ...u, role } : u)),
  }));
  const res = await api.updateUserRole(id, role);
  if (res) {
    toast("Role updated", "good", `${res.name} is now ${res.role}`);
  } else {
    toast("Update failed", "urgent", "Could not update user role");
  }
}

export async function deleteStaffUser(id: string) {
  const target = store.state.users.find((u) => u.id === id);
  set((s) => ({
    users: s.users.filter((u) => u.id !== id),
  }));
  const res = await api.deleteUser(id);
  if (res) {
    toast("User removed", "good", target?.name || "Staff member");
  }
}

export function setBillingCycle(billingCycle: Subscription["billingCycle"]) {
  set((s) => ({ subscription: { ...s.subscription, billingCycle } }));
  api.updateSubscription({ billingCycle });
  toast(
    billingCycle === "yearly" ? "Switched to yearly billing" : "Switched to monthly billing",
    "good",
    billingCycle === "yearly" ? "Two months free — applied at the next renewal" : "Billed on the 14th of each month",
  );
}

export function setPlan(plan: PlanKey) {
  const tier = planTiers.find((t) => t.key === plan);
  if (!tier) return;
  set((s) => ({ subscription: { ...s.subscription, plan } }));
  api.updateSubscription({ plan });
  const rooms = store.state.subscription.rooms;
  toast(`Plan changed to ${tier.name}`, "good", `${rooms} rooms · ${money(tier.pricePerRoom * rooms)} per month`);
}

export async function uploadKnowledgeDoc(file: File, category: KnowledgeDoc["category"] = "Hotel Policies") {
  const tempId = uid("k-temp");
  const ext = (file.name.split(".").pop() ?? "pdf").toUpperCase();
  const format: KnowledgeDoc["format"] =
    ext === "DOC" || ext === "DOCX" ? "DOCX" : ext === "CSV" ? "CSV" : ext === "TXT" ? "TXT" : "PDF";

  const tempDoc: KnowledgeDoc = {
    id: tempId,
    name: file.name,
    category,
    format,
    size: `${(file.size / 1024).toFixed(1)} KB`,
    updated: "Uploading...",
    status: "Processing",
    aiReady: false,
    usedToday: 0,
  };

  // 1. Temporary optimistic uploading item
  set((s) => ({ knowledge: [tempDoc, ...s.knowledge] }));
  toast("Uploading document", "ai", `${file.name} is being uploaded and indexed`);

  try {
    // 2. Call real backend multipart upload
    const res = await api.uploadKnowledgeDoc(file, category);
    if (res && res.id) {
      // 3. Replace temporary item with server response
      const serverDoc: KnowledgeDoc = {
        id: res.id,
        name: res.name || file.name,
        category: (res.category as KnowledgeDoc["category"]) || category,
        format: (res.format?.toUpperCase() as KnowledgeDoc["format"]) || format,
        size: res.size || `${(file.size / 1024).toFixed(1)} KB`,
        updated: res.updated || "Just now",
        status: res.status === "error" ? "Needs Review" : res.status === "indexed" ? "Indexed" : "Processing",
        aiReady: res.aiReady ?? (res.status === "indexed"),
        usedToday: res.usedToday || 0,
      };
      set((s) => ({
        knowledge: s.knowledge.map((k) => (k.id === tempId ? serverDoc : k)),
      }));
      toast(
        serverDoc.status === "Indexed" ? "Indexed and ready" : "Upload processed",
        serverDoc.status === "Indexed" ? "good" : "attend",
        file.name
      );
      return serverDoc;
    } else {
      set((s) => ({
        knowledge: s.knowledge.map((k) => (k.id === tempId ? { ...k, status: "Needs Review", updated: "Failed" } : k)),
      }));
      toast("Upload failed", "urgent", `Could not process ${file.name}`);
    }
  } catch (err) {
    set((s) => ({
      knowledge: s.knowledge.map((k) => (k.id === tempId ? { ...k, status: "Needs Review", updated: "Error" } : k)),
    }));
    toast("Upload error", "urgent", `Network or server error uploading ${file.name}`);
  }
}

export function addKnowledgeDoc(name: string, category: KnowledgeDoc["category"]) {
  const mimeType = name.endsWith(".csv")
    ? "text/csv"
    : name.endsWith(".docx")
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : name.endsWith(".pdf")
        ? "application/pdf"
        : "text/plain";
  const blob = new Blob([`Knowledge base document content for ${name}\nGenerated policies and hotel rules.`], { type: mimeType });
  const file = new File([blob], name, { type: mimeType });
  return uploadKnowledgeDoc(file, category);
}

export async function removeKnowledgeDoc(id: string) {
  const doc = store.state.knowledge.find((k) => k.id === id);
  set((s) => ({ knowledge: s.knowledge.filter((k) => k.id !== id) }));
  toast("Source removed", "attend", doc?.name);

  if (!id.startsWith("k-temp")) {
    try {
      await api.deleteKnowledgeDoc(id);
    } catch (e) {
      console.warn("Backend knowledge deletion notice:", e);
    }
  }
}

export async function loadBackendData() {
  return initBackendSync();
}


export async function syncKnowledgeWithBackend() {
  try {
    const serverDocs = await api.getKnowledgeDocs();
    if (serverDocs && Array.isArray(serverDocs)) {
      const mapped: KnowledgeDoc[] = serverDocs.map((s: any) => ({
        id: s.id,
        name: s.name || s.fileName || "Document",
        category: (s.category as KnowledgeDoc["category"]) || "Hotel Policies",
        format: (s.format?.toUpperCase() as KnowledgeDoc["format"]) || "PDF",
        size: s.size || (s.fileSize ? `${(s.fileSize / 1024).toFixed(1)} KB` : "0 KB"),
        updated: s.updated || "Just now",
        status: s.status === "error" ? "Needs Review" : s.status === "indexed" ? "Indexed" : "Processing",
        aiReady: s.aiReady ?? (s.status === "indexed"),
        usedToday: s.usedToday || 0,
      }));

      set(() => ({
        knowledge: mapped,
      }));
    }
  } catch (e) {
    console.warn("Knowledge backend sync notice:", e);
  }
}

/* ------------------------------------------------------ onboarding flow -- */

export function startOnboarding() {
  set(() => ({
    hotelProfile: {
      name: "",
      legalName: "",
      stars: 4,
      rooms: 0,
      languages: ["Dutch", "French", "English", "German"],
      address: "",
      postcode: "",
      city: "",
      country: "",
      timezone: "Europe/Brussels",
      currency: "€",
      phone: "",
      email: "",
      website: "",
      bookingEngine: "",
      whatsappNumber: "",
      checkIn: "15:00",
      checkOut: "11:00",
      vatNumber: "",
      description: "",
    },
    onboarding: freshOnboarding(),
    integrations: {
      pms: { provider: "", connected: false, lastSync: "never" },
      email: { provider: "google", account: "", connected: false },
      whatsapp: { connected: false, number: "", waba: "", quality: "—", templates: 0 },
    },
    rooms: [],
    tasks: [],
    issues: [],
    conversations: [],
    upsells: [],
    activity: [],
  }));
}

export function disconnectPms() {
  set((s) => ({
    onboarding: {
      ...s.onboarding,
      pms: {
        state: "not-started",
        provider: "Mews",
        propertyId: "",
        propertyName: "",
        lastSync: null,
        error: null,
      },
      done: { ...s.onboarding.done, pms: false },
    },
    integrations: {
      ...s.integrations,
      pms: {
        provider: "Mews",
        connected: false,
        lastSync: "never",
      },
    },
  }));
  api.disconnectPms().catch(() => {});
}

export function markOnboardingStep(step: OnboardingStepKey, done = true) {
  set((s) => ({ onboarding: { ...s.onboarding, done: { ...s.onboarding.done, [step]: done } } }));
  if (typeof window !== "undefined" && window.localStorage.getItem("token")) {
    api.saveOnboardingStep(step).catch(() => {});
  }
}

export function setWaTopology(waTopology: WaTopology) {
  set((s) => ({
    onboarding: {
      ...s.onboarding,
      waTopology,
      // Topology alone does not establish a verified connection.
      done: { ...s.onboarding.done, "wa-internal": s.onboarding.waInternal.state === "connected" },
    },
  }));
  if (typeof window !== "undefined" && window.localStorage.getItem("token")) {
    api.saveTopology(waTopology).catch(() => {});
  }
}

export async function connectPms(provider: string, propertyId: string, clientToken?: string): Promise<boolean> {
  try {
    const res = await api.connectPms(provider, propertyId, clientToken);
    if (res && (res.success || res.status === "connected")) {
      set((s) => ({
        onboarding: {
          ...s.onboarding,
          pms: {
            ...s.onboarding.pms,
            state: "connected",
            provider: res.provider || provider,
            propertyId: res.propertyId || propertyId,
            propertyName: res.propertyName || s.hotelProfile.name,
            lastSync: res.lastSyncAt ? "Live" : "just now",
            error: null,
          },
          done: { ...s.onboarding.done, pms: true },
        },
        integrations: {
          ...s.integrations,
          pms: {
            provider: res.provider || provider,
            connected: true,
            lastSync: res.lastSyncAt ? "Live" : "just now",
          },
        },
      }));
      api.saveOnboardingStep("pms", { provider, propertyId });
      toast(`${provider} connected`, "good", `Validated enterprise: ${res.propertyName || propertyId}`);
      return true;
    } else {
      const errorMsg = (res as any)?.message || "Could not validate Mews credentials against Mews API";
      set((s) => ({
        onboarding: {
          ...s.onboarding,
          pms: {
            ...s.onboarding.pms,
            state: "error",
            error: errorMsg,
          },
        },
        integrations: {
          ...s.integrations,
          pms: {
            ...s.integrations.pms,
            connected: false,
          },
        },
      }));
      toast("Mews connection failed", "urgent", errorMsg);
      return false;
    }
  } catch (err: any) {
    const errorMsg = err?.message || "Mews connection error";
    set((s) => ({
      onboarding: {
        ...s.onboarding,
        pms: {
          ...s.onboarding.pms,
          state: "error",
          error: errorMsg,
        },
      },
    }));
    toast("Mews connection failed", "urgent", errorMsg);
    return false;
  }
}

export async function syncPmsWithBackend() {
  toast("Starting PMS sync…", "ai", "Communicating with Mews Connector API");
  try {
    const res = await api.syncPms();
    if (res && res.success) {
      const [rooms, tasks, issues, convs] = await Promise.all([
        api.getRooms().catch(() => null),
        api.getTasks().catch(() => null),
        api.getIssues().catch(() => null),
        api.getConversations().catch(() => null),
      ]);
      if (rooms && Array.isArray(rooms)) set(() => ({ rooms }));
      if (tasks && Array.isArray(tasks)) set(() => ({ tasks }));
      if (issues && Array.isArray(issues)) set(() => ({ issues }));
      if (convs && Array.isArray(convs)) set(() => ({ conversations: convs }));

      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      set((s) => ({
        integrations: {
          ...s.integrations,
          pms: {
            ...s.integrations.pms,
            connected: true,
            lastSync: nowTime,
          },
        },
        onboarding: {
          ...s.onboarding,
          pms: {
            ...s.onboarding.pms,
            state: "connected",
            lastSync: nowTime,
          },
          done: { ...s.onboarding.done, pms: true },
        },
      }));

      const countRooms = res.synced?.rooms ?? 0;
      const countRes = res.synced?.reservations ?? 0;
      toast("Synced with Mews", "good", `${countRooms} rooms & ${countRes} reservations updated`);
      return res;

    } else {
      toast("PMS sync failed", "urgent", res?.message || "Failed to sync data from Mews API");
      return null;
    }
  } catch (err: any) {
    toast("PMS sync failed", "urgent", err?.message || "PMS synchronization error");
    return null;
  }
}

/**
 * Runs the backend lookup chain (MX -> provider, then autodiscovery) and stores the
 * verdict. Connecting is a separate step, because the method depends on the answer.
 */
export async function runEmailDetection(address: string) {
  set((s) => ({
    onboarding: {
      ...s.onboarding,
      email: { ...s.onboarding.email, address, state: "in-progress", detection: null, error: null },
    },
  }));

  const detection = await detectEmail(address);

  set((s) => ({
    onboarding: {
      ...s.onboarding,
      email: {
        ...s.onboarding.email,
        address,
        state: "in-progress",
        detection,
        method: detection.method,
        settings: detection.settings,
      },
    },
  }));

  return detection;
}

export async function connectEmail(method: EmailMethod, settings: EmailServerSettings | null = null, password?: string, overrideAddress?: string, smtpPassword?: string) {
  const detection = store.state.onboarding.email.detection;
  const address = overrideAddress || store.state.onboarding.email.address;
  let provider: "google" | "microsoft" | "other" =
    method === "oauth" ? "google" : detection?.provider === "google" ? "google" : detection?.provider === "microsoft" ? "microsoft" : "other";

  if (method === "oauth") {
    try {
      const status = await api.getEmailStatus();
      if (!status?.connected || !status.email || status.email.toLowerCase() !== address.toLowerCase() || !['google', 'microsoft'].includes(status.provider || '')) {
        failEmailConnection("Complete authorization for this hotel's mailbox first");
        return false;
      }
      provider = status.provider as "google" | "microsoft";
    } catch {
      failEmailConnection("Could not verify the mailbox connection");
      return false;
    }
  }

  if (method !== "oauth") {
    try {
      const result = await api.testEmailConnection({ email:address,password,smtpPassword,settings,method });
      if (!result?.verified) {
        failEmailConnection(result?.message || "Both IMAP and SMTP must authenticate before connecting");
        return false;
      }
      provider = "other";
    } catch (err: any) {
      failEmailConnection(err?.message || "Could not verify IMAP and SMTP");
      return false;
    }
  }

  const finalAccount = address || store.state.onboarding.email.address;

  set((s) => ({
    onboarding: {
      ...s.onboarding,
      email: {
        ...s.onboarding.email,
        address: finalAccount,
        state: "connected",
        method,
        settings: settings ?? s.onboarding.email.settings,
        connectedAt: "just now",
        lastMessage: "waiting for the first message",
        error: null,
      },
      done: { ...s.onboarding.done, email: true },
    },
    integrations: { ...s.integrations, email: { provider, account: finalAccount, connected: true } },
  }));

  // The backend connection service commits completion; passwords never enter local storage.
  if (method === "oauth") api.saveOnboardingStep("email", { method, address: finalAccount });
  return true;
}

export function failEmailConnection(message: string) {
  set((s) => ({ onboarding: { ...s.onboarding, email: { ...s.onboarding.email, state: "error", error: message } } }));
  toast("Could not connect the mailbox", "urgent", message);
}

/**
 * Handles the callback of Meta's Embedded Signup or simulator: stores verified identifiers
 * and synchronizes with backend multi-tenant database.
 */
export async function refreshWhatsAppStatus() {
  const result = await api.getWhatsAppStatus();
  const rows = result?.connections || [];
  const connection = (kind: WaConnectionType): WaConnection => {
    const row = rows.find((r: any) => r.connected && [kind, 'both'].includes(r.targetType));
    return { state: row ? 'connected' : 'not-started', connectionType: kind, hotelId: row?.hotelId || null,
      wabaId: row?.wabaId || null, phoneNumberId: row?.phoneNumberId || null, displayPhoneNumber: row?.number || null,
      canSend: Boolean(row), canReceive: Boolean(row?.lastInboundAt), lastActivity: row?.lastInboundAt || null, error: null };
  };
  const guest = connection('guest'), internal = connection('internal');
  set(s => ({ onboarding: { ...s.onboarding, waGuest: guest, waInternal: internal,
    done: { ...s.onboarding.done, 'wa-guest': guest.state === 'connected', 'wa-internal': internal.state === 'connected' } },
    integrations: { ...s.integrations, whatsapp: { connected: Boolean(result?.connected), number: result?.number || '', waba: result?.wabaId || '', quality: result?.quality || 'Unknown', templates: 0 } } }));
  return result;
}

export async function addOnboardingInvite(email: string, role: Role): Promise<boolean> {
  try {
    await api.saveOnboardingStep("users", { email, role });
    set((s) => ({ onboarding: { ...s.onboarding,
      invites: [...s.onboarding.invites.filter(i => i.email !== email), { email, role }],
      done: { ...s.onboarding.done, users: true },
    } }));
    toast("Invitation submitted", "good", "The email provider accepted the invitation. Check the recipient's inbox or spam folder.");
    return true;
  } catch (error) {
    toast("Invitation failed", "urgent", error instanceof Error ? error.message : "Could not send invitation");
    return false;
  }
}

export function removeOnboardingInvite(email: string) {
  set((s) => ({ onboarding: { ...s.onboarding, invites: s.onboarding.invites.filter((i) => i.email !== email) } }));
}

export function completeOnboarding() {
  set((s) => ({ onboarding: { ...s.onboarding, complete: true } }));
  api.completeOnboarding();
  toast("Setup finished", "good", "Your workspace is live");
}

/* ------------------------------------------------------------- selectors -- */

export function channelLabel(channel: Channel | string) {
  switch (channel) {
    case "whatsapp":
      return "WhatsApp";
    case "gmail":
      return "Gmail";
    case "outlook":
      return "Outlook";
    case "email":
      return "Email";
    case "ai":
      return "AI";
    case "staff":
      return "Staff";
    default:
      return "Internal";
  }
}

export const selectors = {
  openTasks: (s: AppState) => s.tasks.filter((t) => t.status !== "Completed"),
  escalations: (s: AppState) => s.conversations.filter((c) => c.aiStatus === "escalated"),
  openIssues: (s: AppState) => s.issues.filter((i) => i.status !== "Completed"),
  urgentIssues: (s: AppState) => s.issues.filter((i) => i.status !== "Completed" && i.priority === "Urgent"),
  roomsToClean: (s: AppState) => s.rooms.filter((r) => r.status === "Dirty"),
  roomsCleaning: (s: AppState) => s.rooms.filter((r) => r.status === "Cleaning"),
  roomsClean: (s: AppState) => s.rooms.filter((r) => r.status === "Clean" || r.status === "Inspected"),
  pendingRelease: (s: AppState) => s.rooms.filter((r) => r.arrivalTime && r.status !== "Clean" && r.status !== "Inspected"),
  guestRequests: (s: AppState) => s.conversations.filter((c) => c.aiStatus !== "resolved" && c.stage === "in-house"),
  acceptedUpsellTotal: (s: AppState) =>
    s.upsells.filter((u) => u.status === "Accepted").reduce((sum, u) => sum + u.value, 0),
  housekeepingStats: (s: AppState) => {
    const toClean = s.rooms.filter((r) => r.status === "Dirty").length;
    const cleaning = s.rooms.filter((r) => r.status === "Cleaning").length;
    const cleaned = s.rooms.filter((r) => r.status === "Clean" || r.status === "Inspected").length;
    const dnd = s.rooms.filter((r) => r.status === "DND" || r.status === "Guest Inside").length;
    const vip = s.rooms.filter((r) => r.vip).length;
    const earlyArrivals = s.rooms.filter((r) => r.arrivalTime && r.arrivalTime < "15:00").length;
    const late = s.rooms.filter(
      (r) => r.arrivalTime && r.status !== "Clean" && r.status !== "Inspected" && r.arrivalTime < "15:00",
    ).length;
    return {
      total: s.rooms.length,
      toClean,
      cleaning,
      cleaned,
      dnd,
      vip,
      earlyArrivals,
      late,
    };
  },
  housekeepingTeam: (s: AppState) => {
    const staffCleaners = s.users
      .filter(
        (u) =>
          u.role === "housekeeping" ||
          u.title?.toLowerCase().includes("cleaner") ||
          u.title?.toLowerCase().includes("housekeep"),
      )
      .map((u) => u.name);
    const roomCleaners = s.rooms.map((r) => r.cleaner).filter(Boolean) as string[];
    const all = Array.from(new Set([...staffCleaners, ...roomCleaners])).filter(Boolean);
    return all;
  },
  floors: (s: AppState) => {
    const floorList = Array.from(new Set(s.rooms.map((r) => r.floor))).sort((a, b) => a - b);
    return floorList;
  },
};

export async function initBackendSync() {
  if (typeof window !== "undefined") {
    if (window.location.pathname.startsWith("/login")) {
      return;
    }
    const token = window.localStorage.getItem("token");
    const sessionUserId = window.localStorage.getItem("hotelogx.session.v1");
    if (!token && !sessionUserId) {
      return;
    }
  }
  try {
    const [
      rooms,
      tasks,
      issues,
      convs,
      upsells,
      activities,
      onboardingData,
      knowledgeData,
      aiRulesData,
      usersData,
      subData,
      invoicesData,
      waThreadsData,
      pmsStatusData,
      hotelProfileData,
    ] = await Promise.all([
      api.getRooms().catch(() => null),
      api.getTasks().catch(() => null),
      api.getIssues().catch(() => null),
      api.getConversations().catch(() => null),
      api.getUpsells().catch(() => null),
      api.getActivity().catch(() => null),
      api.getOnboarding().catch(() => null),
      api.getKnowledgeDocs().catch(() => null),
      api.getAiRules().catch(() => null),
      api.getUsers().catch(() => null),
      api.getSubscription().catch(() => null),
      api.getInvoices().catch(() => null),
      api.getWaThreads().catch(() => null),
      api.getPmsStatus().catch(() => null),
      api.getHotelProfile().catch(() => null),
    ]);

    const isOnboardingPage = typeof window !== "undefined" && window.location.pathname.startsWith("/onboarding");
    const isFreshSetup = isOnboardingPage && !store.state.onboarding.complete;
    const freshProfile = hotelProfileData || onboardingData?.hotelProfile || onboardingData?.hotel;
    if (freshProfile && (!isFreshSetup || onboardingData?.complete)) {
      set((s) => ({
        hotelProfile: { ...s.hotelProfile, ...freshProfile },
      }));
    }


    if (rooms && Array.isArray(rooms)) {
      set(() => ({ rooms }));
    }
    if (tasks && Array.isArray(tasks)) {
      set(() => ({ tasks }));
    }
    if (issues && Array.isArray(issues)) {
      set(() => ({ issues }));
    }
    if (waThreadsData && Array.isArray(waThreadsData)) {
      set(() => ({ waThreads: waThreadsData }));
    }
    if (convs && Array.isArray(convs)) {
      const normalizedConvs: Conversation[] = convs.map((c: any) => ({
        ...c,
        channels: Array.isArray(c.channels) && c.channels.length > 0 ? c.channels : [c.primaryChannel || "whatsapp"],
        messages: Array.isArray(c.messages) ? c.messages : [],
        taskIds: Array.isArray(c.taskIds) ? c.taskIds : [],
        knowledgeUsed: Array.isArray(c.knowledgeUsed) ? c.knowledgeUsed : [],
        upsellIdeas: Array.isArray(c.upsellIdeas) ? c.upsellIdeas : [],
        guest: {
          ...c.guest,
          tags: Array.isArray(c.guest?.tags) ? c.guest.tags : [],
          reservation: c.guest?.reservation || c.guest?.reservations?.[0] || {
            number: "N/A",
            arrival: "—",
            departure: "—",
            nights: 1,
            adults: 1,
            children: 0,
            roomType: "Standard",
            status: "Confirmed",
            rate: "—",
          },
        },
      }));
      set(() => ({ conversations: normalizedConvs }));
    }
    if (upsells && Array.isArray(upsells)) {
      set(() => ({ upsells }));
    }
    if (activities && Array.isArray(activities)) {
      set(() => ({ activity: activities }));
    }
    if (usersData && Array.isArray(usersData) && usersData.length > 0) {
      set(() => ({ users: usersData }));
      if (typeof window !== "undefined") {
        try {
          const hotelName = freshProfile?.name || store.state.hotelProfile?.name || "Hotel Workspace";
          const displayUsers = usersData.map((u: any) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            title: u.title || "Staff",
            initials: u.initials || u.name?.slice(0, 2).toUpperCase() || "ST",
          }));
          window.localStorage.setItem(
            "hotelogx.recent_hotel_meta.v1",
            JSON.stringify({
              name: hotelName,
              users: displayUsers,
            })
          );
        } catch {}
      }
    }
    if (subData) {
      set((s) => ({
        subscription: {
          ...s.subscription,
          ...subData,
        },
        invoices: Array.isArray(subData.invoices) ? subData.invoices : (Array.isArray(invoicesData) ? invoicesData : s.invoices),
      }));
    } else if (invoicesData && Array.isArray(invoicesData)) {
      set(() => ({ invoices: invoicesData }));
    }
    if (knowledgeData && Array.isArray(knowledgeData)) {
      const mappedDocs: KnowledgeDoc[] = knowledgeData.map((d: any) => ({
        id: d.id,
        name: d.name || d.fileName || "Document",
        category: (d.category as KnowledgeDoc["category"]) || "Hotel Policies",
        format: (d.format?.toUpperCase() as KnowledgeDoc["format"]) || "PDF",
        size: d.size || (d.fileSize ? `${(d.fileSize / 1024).toFixed(1)} KB` : "—"),
        updated: d.updated || "Recently",
        status: d.status === "error" ? "Needs Review" : d.status === "indexed" ? "Indexed" : "Processing",
        aiReady: d.aiReady ?? (d.status === "indexed"),
        usedToday: d.usedToday || 0,
      }));
      set(() => ({ knowledge: mappedDocs }));
    }
    if (aiRulesData) {
      if (aiRulesData.aiMode) {
        set(() => ({ aiMode: aiRulesData.aiMode }));
      }
      const rawRules = aiRulesData.rules || (Array.isArray(aiRulesData) ? aiRulesData : null);
      if (rawRules && Array.isArray(rawRules)) {
        const mappedRules: AiRule[] = rawRules.map((r: any) => ({
          topic: r.topic,
          mode: r.mode === "Autonomous" ? "Autonomous" : r.mode === "Human Approval" ? "Human Approval" : "Always Escalate",
          note: r.note || "",
        }));
        set(() => ({ aiRules: mappedRules }));
      }
    }
    if (onboardingData) {
      const isOnboardingPage = typeof window !== "undefined" && window.location.pathname.startsWith("/onboarding");
      const isFreshSetup = isOnboardingPage && !store.state.onboarding.complete;
      if (!isFreshSetup || onboardingData.complete) {
        const isPmsActuallyConnected = pmsStatusData?.status === "connected" || pmsStatusData?.connected === true || Boolean(onboardingData.done?.pms);
        const emailDone = Boolean(onboardingData.done?.email);
        const waGuestDone = Boolean(onboardingData.done?.['wa-guest']);
        const waInternalDone = Boolean(onboardingData.done?.['wa-internal']);
        const waConnected = waGuestDone || waInternalDone;

        set((s) => ({
          onboarding: {
            ...s.onboarding,
            waTopology: onboardingData.waTopology || s.onboarding.waTopology,
            complete: onboardingData.complete !== undefined ? onboardingData.complete : s.onboarding.complete,
            done: onboardingData.done ? { ...s.onboarding.done, ...onboardingData.done, pms: isPmsActuallyConnected } : s.onboarding.done,
            pms: {
              ...s.onboarding.pms,
              state: isPmsActuallyConnected ? "connected" : "not-started",
              provider: isPmsActuallyConnected ? (pmsStatusData?.provider || "Mews") : null,
              propertyId: pmsStatusData?.propertyId || s.onboarding.pms.propertyId,
              propertyName: pmsStatusData?.propertyName || freshProfile?.name || s.hotelProfile.name,
              lastSync: pmsStatusData?.lastSyncAt ? new Date(pmsStatusData.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (isPmsActuallyConnected ? "Live" : null),
            },
            email: {
              ...s.onboarding.email,
              state: emailDone ? "connected" : "not-started",
              address: onboardingData.hotelProfile?.email || s.hotelProfile.email || "",
            },
            waGuest: {
              ...s.onboarding.waGuest,
              state: waGuestDone ? "connected" : "not-started",
              displayPhoneNumber: onboardingData.hotelProfile?.whatsappNumber || s.hotelProfile.whatsappNumber || null,
            },
            waInternal: {
              ...s.onboarding.waInternal,
              state: waInternalDone ? "connected" : "not-started",
            },
          },
          hotelProfile: freshProfile ? { ...s.hotelProfile, ...freshProfile } : s.hotelProfile,
          integrations: {
            pms: {
              provider: pmsStatusData?.provider || "Mews",
              connected: isPmsActuallyConnected,
              lastSync: pmsStatusData?.lastSyncAt ? new Date(pmsStatusData.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (isPmsActuallyConnected ? "Live" : "Not connected"),
            },
            email: {
              provider: "google",
              account: (onboardingData.hotelProfile?.email || s.hotelProfile.email || ""),
              connected: emailDone,
            },

            whatsapp: {
              connected: waConnected,
              number: onboardingData.hotelProfile?.whatsappNumber || s.hotelProfile.whatsappNumber || "",
              waba: waConnected ? `${s.hotelProfile.legalName || 'Hotel'} · WABA Connected` : "",
              quality: "Unknown",
              templates: 0,
            },
          },
        }));
      }
    }
    if (waThreadsData && Array.isArray(waThreadsData)) {
      set(() => ({ waThreads: waThreadsData }));
    }
  } catch (err) {
    console.warn("Backend sync failed:", err);
  }
}

if (typeof window !== "undefined") {
  initBackendSync();

  // Multi-device live sync loop (every 12 seconds on active manager dashboards)
  setInterval(async () => {
    try {
      const token = window.localStorage.getItem("token");
      const sessionUserId = window.localStorage.getItem("hotelogx.session.v1");
      if (!token && !sessionUserId) return;

      const isOnboardingPage = typeof window !== "undefined" && window.location.pathname.startsWith("/onboarding");
      const isFreshSetup = isOnboardingPage && !store.state.onboarding.complete;
      if (isFreshSetup) return;

      const [rooms, tasks, issues, convs, waThreads, users, profile, upsellsData] = await Promise.all([
        api.getRooms().catch(() => null),
        api.getTasks().catch(() => null),
        api.getIssues().catch(() => null),
        api.getConversations().catch(() => null),
        api.getWaThreads().catch(() => null),
        api.getUsers().catch(() => null),
        api.getHotelProfile().catch(() => null),
        api.getUpsells().catch(() => null),
      ]);
      if (profile) {
        set((s) => ({ hotelProfile: { ...s.hotelProfile, ...profile } }));
      }
      if (rooms && Array.isArray(rooms)) {
        set(() => ({ rooms }));
      }
      if (tasks && Array.isArray(tasks)) {
        set(() => ({ tasks }));
      }
      if (issues && Array.isArray(issues)) {
        set(() => ({ issues }));
      }
      if (upsellsData && Array.isArray(upsellsData)) {
        set(() => ({ upsells: upsellsData }));
      }
      if (users && Array.isArray(users)) {
        set(() => ({ users }));
      }
      if (waThreads && Array.isArray(waThreads)) {
        set(() => ({ waThreads }));
      }
      if (convs && Array.isArray(convs)) {
        const remoteMapped: Conversation[] = convs.map((rc: any) => ({
          ...rc,
          channels: Array.isArray(rc.channels) && rc.channels.length > 0 ? rc.channels : [rc.primaryChannel || "email"],
          messages: Array.isArray(rc.messages) ? rc.messages : [],
          taskIds: Array.isArray(rc.taskIds) ? rc.taskIds : [],
          knowledgeUsed: Array.isArray(rc.knowledgeUsed) ? rc.knowledgeUsed : [],
          upsellIdeas: Array.isArray(rc.upsellIdeas) ? rc.upsellIdeas : [],
          guest: {
            ...rc.guest,
            tags: Array.isArray(rc.guest?.tags) ? rc.guest.tags : [],
            reservation: rc.guest?.reservation || rc.guest?.reservations?.[0] || {
              number: "N/A",
              arrival: "—",
              departure: "—",
              nights: 1,
              adults: 1,
              children: 0,
              roomType: "Standard",
              status: "Confirmed",
              rate: "—",
            },
          },
        }));

        set(() => ({ conversations: remoteMapped }));
      }
    } catch {
      // Quiet fail on network flutter
    }
  }, 8000);
}
