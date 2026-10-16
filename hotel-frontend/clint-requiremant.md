# Hotelogx Connect — Client Requirements & Business Objectives

**Project Title:** Hotelogx Connect (Hospitality Intelligence & Operations Suite)  
**Target Property Fiction / Model:** Hotel Mercier (48 rooms, Antwerp)  
**Document Version:** 1.0.0 (Production Blueprint)  
**Status:** Approved Architecture & Specification  

---

## 1. Executive Summary & Core Vision

**Hotelogx Connect** is an AI-augmented hotel communication and operations control platform. It bridges the gap between external multi-channel guest inquiries (**WhatsApp Cloud API, Google Workspace / Gmail, Microsoft 365 / Outlook, and standard IMAP/SMTP**) and internal floor operations across four specialized hotel departments:
1. **General Management (`manager`)** — Strategic oversight, AI autonomy guardrails, revenue intelligence, and live escalations.
2. **Front Office / Reception (`front-office`)** — Omnichannel guest inbox, stay context, 1-click AI takeover, and task dispatching.
3. **Housekeeping (`housekeeping`)** — Visual 48-room turnover grid, 8-stage cleaning states, linen restock, and mobile WhatsApp sync.
4. **Maintenance / Engineering (`maintenance`)** — Rapid issue ticketing, HVAC/Plumbing/Electrical triage, SLA countdowns, and room recheck loops.

### The Two Non-Negotiable Operational Axioms
1. **PMS Read-Only Boundary:** This platform is **NOT a PMS** (Property Management System). Reservations, room availability, and room rates are ingested as read-only data from external PMS engines (e.g. Mews, Opera, Apaleo). Pre-arrival booking flows terminate with a verified direct link hand-off (*"Book on Hotel Website"*). No financial transactions or credit card captures occur within the front-end directly.
2. **Dashboard as Control Centre, WhatsApp as Operational Layer:** While managers and receptionists operate from desktop and tablet displays, ground staff (housekeepers, technicians) operate primarily from mobile WhatsApp. Any action performed on the visual dashboard reflects instantaneously in the mobile WhatsApp simulator (`WhatsAppOps.tsx`), and any button tapped on WhatsApp moves the central operational state.

---

## 2. Core Business Problems Solved

| # | Industry Pain Point | Hotelogx Connect Solution | Measurable Business Impact |
|---|---------------------|---------------------------|----------------------------|
| **1** | **Floor Communication Lag**<br>Front Desk calls housekeepers or writes paper chits for extra towels, baby cots, or late checkout status. | Reactive global task distribution (`TaskComposer.tsx` -> `createTask()`) with instant WhatsApp card delivery to specific staff. | Reduces internal task dispatch time from ~8 minutes to < 10 seconds. |
| **2** | **Slow Guest Response Times**<br>Inquiries across email and WhatsApp pile up during peak shift changes or night audits. | Autonomous 24/7 AI agent backed by verified hotel policy PDFs (`KnowledgeDoc`), handling FAQs, amenities, check-in rules, and WiFi. | Cuts average first-response latency from 45 minutes to under 5 seconds. |
| **3** | **Unsynchronized Room Turnover**<br>Front Desk does not know if Room 401 is clean, inspected, or dirty, causing guests to wait in the lobby. | Live 8-state interactive room grid (`housekeeping.rooms.tsx`) tracking *Dirty, Cleaning, Clean, Inspected, DND, Guest Inside, Maintenance, Blocked*. | Speeds up room readiness verification by 60%, preventing early check-in lobby congestion. |
| **4** | **Untracked Maintenance Breakdowns**<br>AC or plumbing defects reported by guests are forgotten or not re-inspected after technician repair. | Closed-loop issue tracking (`maintenance.issues.tsx`) with auto-recheck workflow: completing a repair moves the room to `Dirty` for a mandatory housekeeping re-inspection. | Eliminates guest compensation due to assigning defective rooms. |
| **5** | **Lost Ancillary Revenue (Upsells)**<br>Hotel fails to monetize early check-ins, gourmet breakfast boxes, spa access, and airport transfers. | Pre-arrival and in-house AI upsell detection engine (`manager.upsells.tsx`) suggesting tailored add-ons over WhatsApp and email. | Unlocks an estimated €15-€30 incremental RevPAR per occupied room. |

---

## 3. Department Roles & Scope Matrix

```
                      ┌─────────────────────────────────────────┐
                      │          HOTELOGX CONNECT               │
                      │         Central App State               │
                      └────────────────────┬────────────────────┘
                                           │
         ┌──────────────────┬──────────────┴─────┬──────────────────┐
         │                  │                    │                  │
         ▼                  ▼                    ▼                  ▼
┌─────────────────┐┌─────────────────┐┌──────────────────┐┌──────────────────┐
│     MANAGER     ││  FRONT OFFICE   ││   HOUSEKEEPING   ││   MAINTENANCE    │
│  /manager/*     ││ /front-office/* ││ /housekeeping/*  ││  /maintenance/*  │
├─────────────────┤├─────────────────┤├──────────────────┤├──────────────────┤
│• Executive Brief││• Omnichannel    ││• 48-Room Visual  ││• Defect Work-    │
│  Occupancy/RevPA││  Guest Inbox    ││  Grid (8 States) ││  Orders (MT-*)   │
│• AI Guardrails  ││• 1-Click Human  ││• Cleaning Types  ││• SLA Priority    │
│  & Escalate Mode││  Takeover       ││  (Stayover, VIP) ││  (Urgent to Low) │
│• Upsell Revenue ││• Stay & VIP     ││• Linen & Supply  ││• Auto-Recheck    │
│  Pipeline       ││  Context        ││  Restock Tasks   ││  Loop to Dirty   │
│• Audit Trail    ││• Rapid Task     ││• Attendant Tag   ││• WhatsApp Tech   │
│  Activity Feed  ││  Dispatch       ││  Sync            ││  Dispatch        │
└─────────────────┘└─────────────────┘└──────────────────┘└──────────────────┘
```

### 3.1. General Manager (`manager`)
- **Executive AI Briefing (`Briefing.tsx`):** Aggregated morning pulse including overall occupancy rate, clean vs. dirty room tally, urgent escalations count, and RevPAR indicators.
- **Escalations Queue (`EscalationCard.tsx`):** Reviews guest sentiment disputes (e.g., billing disagreements, noise complaints) where AI automatically pauses and seeks GM intervention.
- **AI Policy & Knowledge Base (`manager.settings.tsx`):** Uploads and indexes property documents (`.pdf`, `.docx`, `.txt`) and sets behavioral rules (`Autonomous`, `Human Approval`, `Always Escalate`).
- **Upsell Management (`manager.upsells.tsx`):** Tracks accepted, pending, and declined ancillary offers across WhatsApp and email.

### 3.2. Front Office Agent (`front-office`)
- **Omnichannel Conversation Stream (`Inbox.tsx`):** Unified timeline merging WhatsApp and email threads into a single conversational pane.
- **AI Co-Pilot & Takeover:** Reads suggested AI replies; can edit or take over the thread with one click (`takeOver()`), locking out autonomous agent replies until released (`returnToAi()`).
- **Guest Stay Context:** Instant display of reservation number (`MRC-48219`), arrival/departure dates, stay length, language, country, and VIP badge.
- **Task Dispatcher (`TaskComposer.tsx`):** Creates urgent tasks for Housekeeping or Maintenance with room numbers, priorities, and due times.

### 3.3. Housekeeping (`housekeeping`)
- **Visual Room Matrix (`housekeeping.rooms.tsx`):** Full 48-room grid across 4 floors.
- **8 Distinct Room States:** `Dirty`, `Cleaning`, `Clean`, `Inspected`, `DND`, `Guest Inside`, `Maintenance`, `Blocked`.
- **Cleaning Type Classification:** `Departure`, `Stayover`, `Stayover + Linen`, `VIP Arrival`, `Deep Clean`, `Turndown`.
- **Attendant Assignments:** Work distributed across attendants (*Maria Silva, Inês Duarte, Kadir Yılmaz, Alina Popescu*).

### 3.4. Maintenance & Engineering (`maintenance`)
- **Work Order Management (`maintenance.issues.tsx`):** Ticketing system for HVAC, plumbing, electrical, lock/key, and furniture issues (`MT-101`, `MT-104`, etc.).
- **Priority & Out-of-Service Toggles:** Tickets marked `Urgent`, `High`, `Normal`, or `Low`. Setting `outOfService: true` automatically flags the room as `Maintenance` in Front Desk and Housekeeping grids.
- **Cross-Department Closure:** When a technician marks an issue `Completed`, the room is automatically reset to `Dirty` with an attached note requiring housekeeping verification.

---

## 4. Functional Requirements Matrix (P0 / P1 / P2)

| Priority | Feature / Module | Component / Route | Functional Specification |
|:---:|---|---|---|
| **P0** | **4-Role Session Switcher** | `login.tsx`, `session.ts` | Allows instant switching between Jonas (Manager), Amélie (Front Office), Rosa (Housekeeping), and Peter (Maintenance) with persistent session hydration. |
| **P0** | **Reactive Task Engine** | `store.ts`, `TaskComposer.tsx` | Instant mutation of `tasks` array with automatic trail timestamping (`dashboard`, `whatsapp`, `ai`) and zero page reload. |
| **P0** | **Visual Room Grid** | `housekeeping.rooms.tsx` | 48-room state rendering with floor filtering, attendant assignment, and direct 1-tap state transitions (`setRoomStatus()`). |
| **P0** | **Maintenance Issue Loop** | `maintenance.issues.tsx`, `store.ts` | Complete issue lifecycle (`Reported` -> `In Progress` -> `Completed`) triggering room state change to `Dirty`. |
| **P0** | **Interactive WhatsApp Simulator** | `WhatsAppOps.tsx` | Slide-out mobile drawer simulating ground staff WhatsApp chats with tap-action buttons (`waChoose()`) that sync dashboard state in real time. |
| **P1** | **7-Step Onboarding Wizard** | `onboarding.tsx`, `OnboardingWizard.tsx` | Guided property setup: Profile, PMS credentials, Email sync, Guest WhatsApp, Staff WhatsApp, Knowledge Docs, User invites. |
| **P1** | **Omnichannel Inbox** | `Inbox.tsx` | Split-view guest chat with channel badges (`whatsapp`, `gmail`, `outlook`), AI confidence indicators, and human takeover toggles. |
| **P1** | **AI Escalation & Rules** | `EscalationCard.tsx`, `manager.settings.tsx` | Policy rule toggles (`Autonomous`, `Human Approval`, `Always Escalate`) governing automated AI behavior. |
| **P2** | **Email Provider Detection** | `netlify/functions/email-detect.mts` | DNS MX and Autodiscover SRV resolver for incoming hotel mailboxes (Google Workspace, Microsoft 365, Zoho, Hostinger, IMAP/SMTP). |

---

## 5. Non-Functional Requirements (NFRs)

1. **Sub-50ms Reactive UI Latency:** Built using `@tanstack/react-store` and React 19 to guarantee that state mutations (room status updates, chat replies, task completions) reflect across all open views in < 50 milliseconds without HTTP polling loops.
2. **Mobile-First Responsive Footprint:** Floor-level views (`housekeeping.rooms.tsx`, `maintenance.issues.tsx`, `WhatsAppOps.tsx`) are strictly optimized for mobile viewports (`375px - 425px`) with tactile tap targets (minimum 44x44px).
3. **Deterministic Seed State:** System reboots cleanly to the standard morning scenario of Hotel Mercier upon session reset (`hotelogx.session.v1`), ensuring deterministic demo runs for stakeholders.
4. **Zero Typography / CSS Drift:** Strictly adheres to custom paper-toned theme tokens (`bg-paper`, `bg-surface`, `text-ink`, `text-wa`, `font-display: Fraunces`, `font-mono: IBM Plex Mono`).
