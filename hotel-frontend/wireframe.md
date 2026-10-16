# Hotelogx Connect — Visual Layouts & Component Hierarchy

**Document Version:** 1.0.0 (Design Specification)  
**Design Philosophy:** Light, warm paper-toned palette (`bg-paper`, `bg-surface`), hairline borders (`border-line`), Fraunces serif headings (`font-display`), monospace metadata (`font-mono`), tactile micro-animations.

---

## 1. Global Layout Shell Architecture (`AppShell.tsx`)

Every authenticated route renders inside `<AppShell>`, providing a unified top bar, role switcher dropdown, navigation ribbon, and slide-out WhatsApp operational drawer.

```
+---------------------------------------------------------------------------------------------------------+
| [Logo: Hotel Mercier]   Role: [ Amélie Duprez (Front Office) v ]   PMS: [🟢 Synced]   AI: [🤖 Auto]  [📱 WA] |
+---------------------------------------------------------------------------------------------------------+
|  Overview   |   Conversations (3)   |   Tasks (8)   |   Rooms (48)   |   Issues (2)   |   Settings      |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|  PAGE CONTENT CONTAINER (max-w-7xl mx-auto px-4 py-6)                                                   |
|                                                                                                         |
|                                                                                                         |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
| [Floating Toasts Context: "Task created for Room 208"  ✓]                                               |
+---------------------------------------------------------------------------------------------------------+
```

---

## 2. ASCII Screen Layouts for Core Views

### 2.1. General Manager Dashboard (`manager.index.tsx` + `Briefing.tsx`)

```
+---------------------------------------------------------------------------------------------------------+
| [Morning Pulse Ribbon]                                                                                  |
| +--------------------+ +--------------------+ +--------------------+ +--------------------+             |
| | OCCUPANCY          | | REVPUR / ADR       | | OPEN TASKS         | | LIVE ESCALATIONS   |             |
| | 85%  (41/48 Rooms) | | €184.50 (▲ 6.2%)   | | 7 Pending          | | 2 Needs GM Action  |             |
| +--------------------+ +--------------------+ +--------------------+ +--------------------+             |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
| +-------------------------------------------------------+ +-------------------------------------------+ |
| | EXECUTIVE AI BRIEFING (Briefing.tsx)                  | | LIVE CROSS-DEPT ACTIVITY (ActivityFeed.tsx)| |
| |                                                       | |                                           | |
| | "Good morning Jonas. 6 departures today with 4 early  | | • 08:35 [Maint] MT-104 AC repair started  | |
| | arrivals. Room 401 VIP arrival at 13:00 is currently   | | • 08:30 [HK] Room 208 baby cot placed ✓   | |
| | cleaning by Maria. 2 guest escalations require review.| | • 08:15 [Front Desk] VIP letter printed  | |
| |                                                       | | • 08:02 [AI] Handled breakfast inquiry   | |
| | [Review Escalations (2)]    [View Revenue Pipeline]   | | • 07:45 [WA] Maria claimed Room 401       | |
| +-------------------------------------------------------+ +-------------------------------------------+ |
|                                                                                                         |
| +-----------------------------------------------------------------------------------------------------+ |
| | ESCALATIONS QUEUE (EscalationCard.tsx)                                                               | |
| | • Nadia Haddad (Room 411) — Disputed Minibar Charge (€42.00) [Approve Refund] [Reject] [Call Guest]  | |
| | • Clara Bertrand (Room 302) — Late Checkout Request (14:00)   [Grant 13:00]   [Decline] [Message]    | |
| +-----------------------------------------------------------------------------------------------------+ |
+---------------------------------------------------------------------------------------------------------+
```

---

### 2.2. Front Office Omnichannel Inbox (`front-office.conversations.tsx` + `Inbox.tsx`)

A high-density 3-pane split view for real-time guest communication across WhatsApp and Email.

```
+---------------------------------------------------------------------------------------------------------+
| LEFT: CONVERSATION LIST          | MIDDLE: CHAT TIMELINE            | RIGHT: GUEST & STAY CONTEXT       |
| [🔍 Search guest or room...]     | [Grace Okonkwo - Room 401]       | [GUEST PROFILE]                   |
| Filter: [All] [Unread] [AI]      | Channel: WhatsApp • VIP: No      | Name: Grace Okonkwo               |
+----------------------------------+----------------------------------+ Country: United Kingdom 🇬🇧        |
| > Grace Okonkwo (Room 401)       | 07:15 [Guest - WhatsApp]         | Language: English                 |
|   "Can I check in at 13:00?"     | "Good morning, my train arrives  | Previous Stays: 0                 |
|   07:15 • 🟢 WA • Urgent         | early. Can I check in at 13:00?" | Tags: [Early Arrival 13:00]       |
|----------------------------------+----------------------------------+-----------------------------------|
|   Yuki Tanabe (Room 307)         | 07:16 [AI Assistant]             | [RESERVATION: MRC-48288]          |
|   "Thank you for the breakfast"  | "Good morning Grace! Standard    | Room: 401 (Deluxe King)           |
|   06:45 • 🔵 Email • Positive    | check-in is 15:00, but our team  | Dates: 18 Aug - 20 Aug (2 Nights) |
|----------------------------------+ is expediting Room 401 now."     | Rate: €196 / night                |
|   Clara Bertrand (Room 302)      |                                  | Status: Confirmed                 |
|   "Late checkout possible?"      |----------------------------------+-----------------------------------|
|   Yesterday • 🟢 WA • Neutral    | [ 🤖 AI Autonomy Active ]        | [RAPID ACTIONS]                   |
|----------------------------------+ [ ⏸️ Click to Take Over Thread ]  | [+ Create HK Task]                |
|   Nadia Haddad (Room 411)        |----------------------------------+ [+ Report Room Issue]             |
|   "Bill discrepancy"             | [Type a reply as Amélie...     ] | [+ Offer Late Checkout (€35)]     |
|   Yesterday • 🔴 Email • Urgent  | [ Send via WhatsApp > ]          | [View PMS Folio Link]             |
+----------------------------------+----------------------------------+-----------------------------------+
```

---

### 2.3. Housekeeping 48-Room Visual Grid (`housekeeping.rooms.tsx`)

Tactile room status cards grouped by floor with 1-tap state toggling.

```
+---------------------------------------------------------------------------------------------------------+
| Filter: [All (48)]  [Dirty (12)]  [Cleaning (4)]  [Clean (22)]  [Inspected (8)]  [Maintenance (2)]      |
| Floor:  [All Floors]  [Floor 1]  [Floor 2]  [Floor 3]  [Floor 4]                                        |
+---------------------------------------------------------------------------------------------------------+
| FLOOR 4 (12 Rooms)                                                                                      |
|                                                                                                         |
| +--------------------+ +--------------------+ +--------------------+ +--------------------+             |
| | ROOM 401      [VIP]| | ROOM 402           | | ROOM 403           | | ROOM 404           |             |
| | State: CLEANING    | | State: CLEAN       | | State: DIRTY       | | State: INSPECTED   |             |
| | Type: Departure    | | Type: Stayover     | | Type: Departure    | | Type: VIP Arrival  |             |
| | Due: 13:00 (Early) | | Attendant: Maria   | | Attendant: Inês    | | Attendant: Alina   |             |
| | Attendant: Maria   | | [Set Dirty]        | | [Start Clean]      | | [Release to Front] |             |
| | [✓ Mark Clean]     | |                    | |                    | |                    |             |
| +--------------------+ +--------------------+ +--------------------+ +--------------------+             |
|                                                                                                         |
| +--------------------+ +--------------------+ +--------------------+ +--------------------+             |
| | ROOM 405           | | ROOM 406           | | ROOM 407           | | ROOM 408           |             |
| | State: CLEAN       | | State: DND         | | State: CLEAN       | | State: DIRTY       |             |
| | Type: Stayover     | | Type: Stayover     | | Type: Departure    | | Type: Stayover     |             |
| | Attendant: Inês    | | [Bypass]           | | Attendant: Alina   | | Attendant: Kadir   |             |
| | [Set Inspecting]   | |                    | | [Set Inspecting]   | | [Start Clean]      |             |
| +--------------------+ +--------------------+ +--------------------+ +--------------------+             |
+---------------------------------------------------------------------------------------------------------+
```

---

### 2.4. Maintenance Defect & Issue Board (`maintenance.issues.tsx`)

Visual triage board organizing repair tickets by severity with SLA indicators.

```
+---------------------------------------------------------------------------------------------------------+
| [ + Report New Defect ]     Filter: [All Open (2)]  [In Progress (1)]  [Waiting Parts (0)]  [Resolved]  |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
| +-----------------------------------------------------------------------------------------------------+ |
| | TICKET MT-104  •  ROOM 112  •  PRIORITY: 🔴 HIGH  •  SLA: 45 min remaining                          | |
| | Title: AC Thermostat not cooling below 24°C                                                         | |
| | Category: [❄️ HVAC]   Reported By: Amélie Duprez (Front Office) at 08:20                             | |
| | Out of Service: [YES - Room Blocked]                                                                 | |
| | Assignee: [ Peter Janssens (Technical Lead) v ]                                                      | |
| | Updates:                                                                                             | |
| |   • 08:20 [Front Office] Reported by morning guest during check-out                                  | |
| |   • 08:35 [WhatsApp] Peter inspecting compressor unit                                                | |
| |                                                                                                     | |
| | [ Update Status: IN PROGRESS v ]      [ ✓ Complete & Send Room to HK Recheck ]                      | |
| +-----------------------------------------------------------------------------------------------------+ |
|                                                                                                         |
| +-----------------------------------------------------------------------------------------------------+ |
| | TICKET MT-105  •  ROOM 204  •  PRIORITY: 🟡 NORMAL  •  SLA: 4 hours remaining                        | |
| | Title: Bathroom sink slow drain                                                                     | |
| | Category: [🚰 Plumbing]   Reported By: Inês Duarte (Housekeeping) at 09:00                           | |
| | Out of Service: [NO]                                                                                 | |
| | Assignee: [ Unassigned v ]                                                                           | |
| |                                                                                                     | |
| | [ Accept Ticket ]                     [ Assign to Milan ]                     [ Resolve ]           | |
| +-----------------------------------------------------------------------------------------------------+ |
+---------------------------------------------------------------------------------------------------------+
```

---

### 2.5. 7-Step Onboarding Setup Wizard (`onboarding.tsx` + `OnboardingWizard.tsx`)

```
+---------------------------------------------------------------------------------------------------------+
| STEP PROGRESS TRACKER:                                                                                  |
| (1) Profile  ->  (2) PMS  ->  (3) Email  ->  (4) WA Guest  ->  (5) WA Internal  -> (6) Docs  -> (7) Team|
| [═══════════════════════════════════════●────────────────────────────────────────────────────────────]  |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
| STEP 3: HOTEL EMAIL & INBOX INTEGRATION (OnboardingEmailStep.tsx)                                      |
|                                                                                                         |
| Enter the official guest contact email for Hotel Mercier:                                               |
| [ reception@hotelmercier.be                                                     ] [ Detect Provider ]   |
|                                                                                                         |
| +-----------------------------------------------------------------------------------------------------+ |
| | 🟢 DETECTED PROVIDER: Google Workspace (Gmail API)                                                  | |
| | MX Records Found: aspmx.l.google.com (Priority 1), alt1.aspmx.l.google.com                          | |
| | Connection Method: 1-Click Secure OAuth 2.0 (No password stored)                                    | |
| |                                                                                                     | |
| | [ 🔑 Sign In with Google Workspace ]  -->  Status: Connected as reception@hotelmercier.be          | |
| +-----------------------------------------------------------------------------------------------------+ |
|                                                                                                         |
| [ < Back: PMS Setup ]                                                       [ Next: WhatsApp Setup > ] |
+---------------------------------------------------------------------------------------------------------+
```

---

## 3. Component Breakdown Matrix

| Component File | Parent Route / Usage | Core Props Interface | Store Action Dependencies |
|---|---|---|---|
| `AppShell.tsx` | All `/manager/*`, `/front-office/*`, `/housekeeping/*`, `/maintenance/*` routes | `{ children, title, wide?, flush? }` | `useApp(s => s.currentStaffId)`, `session.ts` |
| `Briefing.tsx` | `manager.index.tsx`, `front-office.index.tsx` | `{ role?: Role }` | `selectors.occupancy`, `selectors.escalations` |
| `Inbox.tsx` | `front-office.conversations.tsx`, `manager.conversations.tsx` | `{ variant?: "front-office" \| "manager" }` | `sendReply`, `takeOver`, `returnToAi` |
| `TaskComposer.tsx` | `front-office.tasks.tsx`, `manager.tasks.tsx`, `Inbox.tsx` | `{ open: boolean, onClose: () => void, defaults? }` | `createTask` |
| `TaskRow.tsx` | Tasks list across all 4 department views | `{ task: Task }` | `setTaskStatus`, `assignTask` |
| `IssueCard.tsx` | `maintenance.issues.tsx`, `manager.index.tsx` | `{ issue: Issue }` | `setIssueStatus`, `assignIssue` |
| `EscalationCard.tsx` | `manager.index.tsx`, `front-office.index.tsx` | `{ conversation: Conversation }` | `resolveEscalation`, `sendReply` |
| `ActivityFeed.tsx` | `manager.index.tsx`, `front-office.index.tsx` | `{ limit?: number }` | `useApp(s => s.activity)` |
| `WhatsAppOps.tsx` | Right slide-out drawer inside `AppShell.tsx` | `{ open: boolean, onClose: () => void }` | `waChoose`, `setRoomStatus`, `setTaskStatus` |
| `OnboardingWizard.tsx` | `onboarding.tsx` | `None` (Standalone page) | `updateOnboardingStep`, `completeOnboarding` |
| `ui.tsx` | Everywhere | `Card`, `Badge`, `Button`, `StatCard`, `Empty`, `Toaster` | Direct UI primitive kit |
