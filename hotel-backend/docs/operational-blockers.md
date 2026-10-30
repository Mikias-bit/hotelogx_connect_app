# Blockers, follow-ups and carried housekeeping work

Housekeeping and maintenance work can be put on hold with a specific reason and a scheduled next action. Open blockers remain in Neon until an authorized coordinator records a resolution. A new engine report does not clear them.

## Staff workflow

Use **Record blocker** beside open work on the housekeeping plan/assignment page or maintenance assignment page. Choose the type, explain the situation, name the follow-up owner and responsible department, and record the next action and date/time in the hotel's timezone.

| Type | Required additional information | Meaning of scheduled time |
| --- | --- | --- |
| Do not disturb | Description and guest instructions | Next permitted contact or entry |
| Guest still inside | Description and guest instructions | Next permitted contact or entry |
| Guest declined service | Service declined and requested alternative (or “None requested”) | Next follow-up |
| Missing linen / supplies | Required item | Delivery or next check |
| Waiting for parts | Required part | Expected availability or next check |
| Contractor required | Contractor or trade required | Appointment or next follow-up |
| Repair unsuccessful | Remaining fault | Next action / follow-up |

The **Follow-ups** navigation link opens a separate operational queue. The main manager and Front Office dashboards remain unchanged. Filters show open, due/overdue, needs scheduling, upcoming and recently resolved work. Search by room, owner or department. All open blockers remain visible regardless of age; the recently resolved view covers the last seven days. Older audit records remain in Neon.

Housekeeping coordinators manage housekeeping blockers; maintenance coordinators manage maintenance blockers. Front Office can manage housekeeping follow-ups and read maintenance follow-ups. Managers can manage both. Every operation uses the authenticated hotel's identity.

The queue refreshes on operational events, browser focus and every minute. **This release does not send automatic outbound WhatsApp reminders at the scheduled time.** Due time means staff should take the recorded next action. It never clears DND, authorizes entry, completes a task or releases a room automatically.

## WhatsApp

Housekeepers use **Problem** for DND or a linked maintenance ticket, or **Other blocker** for guest inside, declined service or missing supplies. Technicians use **Problem** for parts/help, or **Other blocker** for a contractor, unsuccessful repair or room access restriction. Room access offers DND and guest inside.

A worker's report immediately holds the work and creates a **Needs scheduling** blocker. The worker supplies a short description in their next message. An authorized coordinator fills the structured fields, owner, date/time and next action. The system does not guess an owner, appointment or ETA from free text.

TASKS/HOUSEKEEPING and MAINTENANCE continue to offer actionable assignments. When all assigned work is held, the response explains the restrictions and known follow-up details. Resolve the blocker in Follow-ups, then ask the worker to request their current work again. No new Meta template is needed for these replies within the worker's active messaging window.

## Resolution and safeguards

- Assignment, acceptance, start, completion and generic status changes cannot bypass an open blocker on that work. Existing signed housekeeping controls become stale when blocker instructions change.
- DND and guest-inside blockers with a future permitted time cannot be resolved early. If the guest changes their instructions, a coordinator must update the permitted time and retain the explanation in the audit history.
- Resolve each blocker explicitly with a note. Resolving only one of several blockers keeps the work on hold.
- Resolution restores the task to Accepted, Assigned or unassigned work. It preserves assignment, acceptance and first-start timestamps. It does not mark work completed or clear a linked open maintenance ticket.
- Work with unresolved blockers cannot be cancelled to hide it. Record the actual resolution/decision before cancellation.
- Room inspection/release remains separate. Open blockers appear as room restrictions, and changes invalidate previous inspection/release approvals.
- Version checks reject competing coordinator edits. Create requests use idempotency keys; tenant scoping applies to work references, blockers, history and mutations.

## Across dates and shifts

Deferred report tasks and unfinished staff-created/post-repair tasks carry forward with the same IDs, report date, worker assignment and history. Staff see “Carried from …”. Each new hotel-local day requires a coordinator to confirm that the work is still appropriate for the current room and guest before execution. Resolving a blocker also records today's carry review, but does not bypass a separate changed-source review or linked repair restriction.

If today's engine produces new work for a room with deferred report work, the new task requires source review. The system does not silently merge work belonging to different stays. Review both tasks, retain the appropriate work and cancel obsolete work only after its blocker has been resolved with a reason. Completed tasks do not carry forward as unfinished work.

## Storage and deployment

Migration `20261030040000_operational_blockers` adds `OperationalBlocker`, `OperationalBlockerEvent` and ReportTask carry fields. It recovers historical unresolved housekeeping Problem/Waiting/Escalated tasks and marks them for review. Existing DND and maintenance Waiting Parts records become unscheduled drafts. It does not invent follow-up times or rewrite completed work.

From `hotel-backend`, apply the migration and generate Prisma, then deploy the backend before deploying the frontend:

```powershell
npm.cmd run prisma:deploy
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
npm.cmd run prisma:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed' }
gcloud.cmd builds submit . --config=cloudbuild.yaml --project=hotelogx
if ($LASTEXITCODE -ne 0) { throw 'Backend deployment failed' }
```

Push the frontend changes to the GitHub branch connected to Netlify after the backend deployment. No Python engine or MCP deployment is required.

Validation commands:

```powershell
npm.cmd run test:blockers
npm.cmd run test:blockers:database
node scripts/test-maintenance-database.mjs .env
npm.cmd run test:operations:database
```

Database tests use random disposable schemas in the designated test-data database and remove those schemas afterward. WhatsApp sends are mocked. They do not migrate the application's public schema or send real staff messages.
