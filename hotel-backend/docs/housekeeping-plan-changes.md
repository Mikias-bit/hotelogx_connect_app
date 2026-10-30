# Housekeeping changes during the day

The Python report remains the immutable morning baseline. Hotel staff can add a
task or save an operational overlay without changing that report. Manager,
Housekeeping and Front Office roles may change instructions; only Manager and
Housekeeping may assign workers or mark work complete.

## Staff controls

- Housekeeping → Assignments: **Add housekeeping task** or **Change instructions**.
- Front Office / Manager → Tasks → **Housekeeping plan**: add, review or change work.
- Choose a room or public location, task type, priority, instructions, access time,
  deadline and change reason. Times use the hotel's Neon timezone and today's
  hotel-local date, regardless of the browser's timezone.
- Use stayover cleaning when a guest extends; set an access time for late checkout;
  mark waiting-arrival work High/Urgent; add deliveries or public-area cleaning.
- Cancel an obsolete open task with a reason. The task, assignment and events remain
  stored. Later engine reruns cannot silently reactivate a cancelled task.
- Completed work cannot be edited or reopened. Add a new task for additional work.

Staff tasks can be assigned even before the morning report arrives. Report tasks
still require a successful current report. An access time prevents both WhatsApp
and dashboard start/completion before that time; it is not merely a displayed note.
Priorities and deadlines order the worker's queue. No automatic guest message or
PMS room-status write is performed.

## Reruns and history

Identical report reruns preserve all state. Changed unassigned, untouched tasks can
take the new engine instructions. Changed assigned, started or staff-edited tasks
retain their previous execution state and require staff review. Staff can adopt
the new instructions, keep/edit their operational instructions, or cancel the task.
Removed assigned tasks also require review. A new engine task for a room that has
protected work requires review rather than silently duplicating that work.

Completed and cancelled records remain unchanged as execution history when a
source changes. Staff-created tasks are not removed by a report rerun. Operational
overlays retain their author/reason and before/after values in
`HousekeepingPlanChange`; task events record changes and WhatsApp actions.
Deferred work and unfinished staff-created tasks now carry forward with their history.
See [blockers and follow-ups](operational-blockers.md) for the required daily carry review,
structured restrictions and explicit resolution workflow.

Instruction versions reject stale browser edits, assignment selections and signed
WhatsApp buttons. Existing assignment and acceptance/start timestamps survive an
instruction change. Workers use TASKS to retrieve the current instructions and
buttons. These checks are scoped to the authenticated hotel, assigned worker,
phone and assignment.

## Worker notifications

A saved change to assigned work requests a separate WhatsApp notification. Within
the existing messaging window the notification contains the new instructions,
priority, access time and deadline. Outside the window, configure an approved
plan-change template in Assignments → Workers & WhatsApp settings, using the same
language setting as the assignment template. Example name:
`housekeeping_plan_changed`. Example body with two positional variables:

> Hi {{1}}, your housekeeping instructions for {{2}} have changed. Reply TASKS to view the latest instructions.

The parameters are worker name and room/location. This is separate from the
assignment-count template. Meta approval is still needed for a new template.

If the window is closed and no change template is configured, the plan is saved
and the UI shows `waiting_window`: staff should contact the worker or ask them to
send TASKS. Failed/uncertain notifications remain visible; submission is not proof
of delivery or acceptance. HTTP retries reuse the change request ID and do not
automatically resend an uncertain message. Changes do not require a WhatsApp
connection to be saved. Live Meta delivery requires a connected internal number.

## Deployment

From `hotel-backend`, apply the additive migration before deploying backend code:

```powershell
npm.cmd run prisma:deploy
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
npm.cmd run prisma:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed' }
gcloud.cmd builds submit . --config=cloudbuild.yaml --project=hotelogx
if ($LASTEXITCODE -ne 0) { throw 'Backend deployment failed' }
```

Push the frontend changes to trigger Netlify after the backend is ready.
No Python engine or MCP server deployment is required for this change.

## Validation

`node --test src/tests/reportOperations.test.js src/tests/dailyReports.test.js`
checks access-time conversion, role restrictions and report contracts.
`node scripts/test-operations-database.mjs .env` applies migrations in a temporary
schema in the designated test-data database and exercises assignment, source
reruns, concurrent edits, stale controls, cancellation, completion preservation,
cross-hotel access, public-area tasks and notification outcomes. WhatsApp delivery
is mocked; a live staff-number test remains necessary after deployment.
