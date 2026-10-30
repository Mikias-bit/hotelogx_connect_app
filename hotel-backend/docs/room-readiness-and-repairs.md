# Room readiness and linked housekeeping repairs

Housekeeping task completion, room inspection and Front Office release are three
separate decisions. Neither task completion nor repair completion updates Mews
availability, completes unrelated work or sends a room-ready message to a guest.

## Room workflow

Open Housekeeping → Rooms or Front Office / Manager → Room readiness. The existing
Front Office Rooms ready tile opens the same workflow. Main dashboards retain their
layout and use verified readiness counts instead of counting all clean rooms as ready.

1. Complete individual cleaning tasks. The room then awaits inspection.
2. Housekeeping management or a manager records an inspection with findings.
3. Front Office or a manager explicitly approves internal room readiness.

For rooms without cleaning tasks, housekeeping can separately confirm cleaning is
finished before inspection. Marking a room as needing cleaning withdraws approvals
without reopening completed tasks. Add a new task when more work is needed.

Occupied/guest-inside, DND, manual maintenance and other restrictions are independent
of cleaning progress. Open repair tickets, maintenance tasks, PMS restrictions and
housekeeping access times also prevent release. PMS restrictions must be resolved
in PMS; clearing a manual checkbox does not bypass them. There is no manager bypass
for unresolved restrictions. Current implementation requires restrictions to be
resolved before inspection as well as before release.

Approvals record the authenticated staff ID, time and reason. A changed plan, new
work, reopened repair or changed PMS room context invalidates the approval. Stale
screens receive a conflict instead of overwriting newer state. New hotel-local days
require fresh inspection/approval. There is no automatic ready-with-exceptions mode.
Mews sync and room/check-in/check-out events revoke stored approvals when the room
context changes. The legacy room-status PATCH and unsigned WhatsApp action endpoint
now reject mutations; use the authenticated readiness controls and signed worker
task actions.

## Housekeeping → maintenance → housekeeping

- WhatsApp: the assigned housekeeper selects Problem → Maintenance. A linked issue
  is created immediately; the following description populates the repair details.
- Dashboard: an authorized housekeeping coordinator, manager or Front Office user
  can report a fault from the task's maintenance form.
- An exact normalized description at the same hotel/location can link to an existing
  open ticket. Unrelated faults remain separate. A provisional duplicate is retained
  as an audited Duplicate record rather than appearing as another open assignment.
  Assigned provisional work is not silently merged.
- Maintenance → Assignments shows the linked housekeeping task IDs. The coordinator
  assigns the issue through the existing technician acceptance workflow.
- Open linked repairs prevent completing or reassigning the affected housekeeping
  work. Other rooms/tasks remain independent.
- Technician or authorized staff completion creates one post-repair housekeeping
  cleaning/check task per repair cycle. This also applies to out-of-service issues.
  Replayed completion does not create duplicate follow-ups. Reopening the repair
  blocks its follow-ups; completing it again creates a new cycle's follow-up.
- The original housekeeping task is not automatically completed. Its manager reviews
  and reassigns it if still needed, then assigns the post-repair work. Worker
  notifications use the existing assignment workflow. Follow-ups are not silently
  assigned to an employee who may be off shift.
- Completing all necessary work leaves room inspection and release approval pending.

Dashboard updates use hotel-scoped events with polling as a fallback. Repairs and
follow-ups are linked in both assignment views. This feature does not add media
uploads, contractor scheduling or automatic cross-day task carry-forward.

## Deployment

Apply migration `20261030030000_room_readiness_and_repair_links` before deploying
the backend. From `hotel-backend`:

```powershell
npm.cmd run prisma:deploy
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
npm.cmd run prisma:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed' }
gcloud.cmd builds submit . --config=cloudbuild.yaml --project=hotelogx
if ($LASTEXITCODE -ne 0) { throw 'Backend deployment failed' }
```

Push the frontend for Netlify after the backend is ready. No MCP server or Python
engine deployment is required. No new WhatsApp template is needed for these task
actions; new follow-up assignments use the existing housekeeping assignment template.

## Tests

`node --test src/tests/roomReadiness.test.js src/tests/reportOperations.test.js
src/tests/maintenanceOperations.test.js` covers authorization and disabled legacy
mutation paths. `node scripts/test-operations-database.mjs .env` applies migrations
in a disposable test schema and exercises real database transactions for report
deduplication, signed worker repair completion, follow-up creation/reopening,
inspection/release separation, restrictions, stale writes and tenant isolation.
WhatsApp delivery is mocked. Perform a live staff-number smoke test after deployment.
