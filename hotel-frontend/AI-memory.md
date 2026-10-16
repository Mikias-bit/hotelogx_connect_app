# Hotelogx Connect — AI Agent Context Memory & System Knowledge

**Document Version:** 1.0.0 (Persistent Memory Bank)  
**Target Audience:** Autonomous AI coding agents, subagents, and LLM code synthesizers modifying this repository.

---

## 1. Project DNA & Foundational Axioms

1. **System Identity:** `hotelogx-connect` is an AI-driven hotel operations control suite for **Hotel Mercier** (a 48-room boutique hotel in Antwerp).
2. **Architecture State:** The frontend is a **design-complete UI prototype with an in-memory reactive state engine** (`@tanstack/react-store`). A dedicated backend exists in `/backend` (Express + Prisma + MySQL `hotel_db`).
3. **The Four Operating Roles:**
   - `manager`: High-level briefing, RevPAR/Occupancy KPIs, AI autonomy guardrails, escalations, upsell pipeline.
   - `front-office`: Omnichannel guest inbox (WhatsApp & Email), stay context, rapid task dispatching.
   - `housekeeping`: 48-room visual turnover grid, 8-state cleaning statuses, linen restock, mobile WhatsApp parity.
   - `maintenance`: Equipment defect ticketing (MT-*), HVAC/plumbing priority triage, auto-recheck to `Dirty`.
4. **The Core Axiom:** The dashboard is the desktop control centre; WhatsApp is the mobile floor operations layer. Any change made in one MUST update the other instantaneously.

---

## 2. Canonical Implementation Patterns (Boilerplate)

### 2.1. Creating a Cross-Department Task
When adding UI functionality to trigger a new task for floor staff:

```typescript
import { createTask, toast } from "@/lib/store";
import type { Department, Priority } from "@/lib/types";

function dispatchTowelTask(roomNumber: string, guestName: string) {
  createTask({
    title: `Deliver 2 extra bath towels to Room ${roomNumber}`,
    detail: "Guest requested high-priority fresh towels via chat.",
    room: roomNumber,
    guest: guestName,
    department: "Housekeeping",
    priority: "High",
    due: "14:00",
    assignee: "Maria Silva",
    source: "Guest WhatsApp",
  });

  toast({
    title: "Task Dispatched",
    detail: `Towel delivery assigned to Maria Silva for Room ${roomNumber}`,
    tone: "good",
  });
}
```

---

### 2.2. Changing Room Status with Cross-Department Cascades
When updating a room's cleaning or inspection state:

```typescript
import { setRoomStatus } from "@/lib/store";
import type { RoomStatus } from "@/lib/types";

function markRoomClean(roomNumber: string, cleanerName: string) {
  // Automatically closes matching HK turnover tasks and notifies Front Desk
  setRoomStatus(roomNumber, "Clean", `Cleaned by ${cleanerName}`);
}

function flagRoomMaintenance(roomNumber: string, issueNote: string) {
  // Automatically blocks room from front desk assignment
  setRoomStatus(roomNumber, "Maintenance", issueNote);
}
```

---

### 2.3. Toggling AI vs Human Guest Takeover
When an agent or receptionist needs to take manual control of an automated chat:

```typescript
import { takeOver, returnToAi, sendReply } from "@/lib/store";

// 1. Take over (pauses AI autonomy)
function handleTakeOver(conversationId: string) {
  takeOver(conversationId);
}

// 2. Send staff response
function handleSendStaffMessage(conversationId: string, replyText: string, staffName: string) {
  sendReply(conversationId, replyText, staffName);
}

// 3. Return control back to AI co-pilot
function handleReleaseToAi(conversationId: string) {
  returnToAi(conversationId);
}
```

---

### 2.4. Resolving a Maintenance Issue (Auto-Recheck Workflow)
When a technician finishes a repair work order:

```typescript
import { setIssueStatus } from "@/lib/store";

function completeRepairTicket(issueId: string, repairNote: string) {
  // NOTE: This automatically resets the room to 'Dirty' for a housekeeping inspection
  setIssueStatus(issueId, "Completed", repairNote);
}
```

---

## 3. Strict Blacklist (Anti-Patterns to AVOID)

| Anti-Pattern | Why it is Forbidden | Proper Solution |
|---|---|---|
| **Direct Mutation of State**<br>`store.state.rooms[0].status = "Clean"` | Breaks reactivity and skips cross-department side-effects (activity logging, notifications). | Always invoke exported actions from `src/lib/store.ts` (`setRoomStatus()`, etc.). |
| **Local React `useState` for Department Data**<br>`const [tasks, setTasks] = useState(...)` | Isolates state inside one component, breaking sync between Front Office, Housekeeping, and Manager. | Read shared state with `useApp(s => s.tasks)` from `src/lib/store.ts`. |
| **Third-Party UI Libraries**<br>(MUI, AntD, Chakra, Bootstrap) | Violates the lightweight, warm paper-toned design system and introduces bundle bloat. | Compose exclusively from `src/components/ui.tsx` and Tailwind CSS 4 utility tokens. |
| **Direct Reservation / PMS Mutations**<br>Attempting to cancel/charge a reservation | Violates the read-only PMS boundary architectural rule. | Hand off to direct booking engine or show read-only PMS reference. |
| **Modifying `routeTree.gen.ts` Manually** | Gets wiped on every Vite re-bundle. | Create or edit files in `src/routes/` following flat dotted naming conventions. |

---

## 4. Engineering Roadmap & Upcoming Phases

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ROADMAP PHASES                                │
├─────────────────────────────────────────────────────────────────────────┤
│ [PHASE 1] ✅ Frontend Complete (4 Portals, In-Memory Store, UI Kit)     │
│ [PHASE 2] ✅ Dedicated Backend Folder (/backend, Express, Prisma, MySQL) │
│ [PHASE 3] 🔄 Wire Frontend Store to Backend REST APIs (/api/*)           │
│ [PHASE 4] ⏳ Connect Live Meta WhatsApp Cloud API Webhook Handlers       │
│ [PHASE 5] ⏳ Production RAG Ingestion Pipeline with pgvector / OCR       │
└─────────────────────────────────────────────────────────────────────────┘
```

### Next Immediate Focus:
- When instructed to connect the frontend to the real backend, replace the in-memory action bodies inside `src/lib/store.ts` with `fetch()` calls to `http://localhost:5000/api/*` (or `VITE_API_BASE_URL`), keeping component contracts 100% unchanged.
