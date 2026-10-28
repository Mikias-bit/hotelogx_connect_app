# Daily operational tasks

Hotelogx Python determines the daily work. Its existing authenticated report ingest writes immutable snapshots into the shared Neon database, scoped by the source credential to one Connect hotel. Connect projects those rows into operational records; it does not ask a language model to invent tasks, balances, benefits or completion state.

The dashboard uses `/api/operations` and the ordinary tasks feed. It shows housekeeping assignments, VIP preparation and departure-balance follow-ups. Source date, missing runs, stale snapshots and failed runs stay visible. Raw report pages remain available as audit history, but are no longer primary dashboard panels or navigation items. Engine connection settings are under Manager settings.

## Source and execution state

- `ReportTask`: hotel, report kind/date, stable source item key/hash, source data, active flag, assignment, status and timestamps.
- `HousekeepingWorker`: stable worker ID, hotel, name, international phone, active/WhatsApp-enabled flags and language preference. Initial messages are English.
- `HousekeepingAssignment`: an idempotent bulk assignment and its provider submission outcome.
- `ReportTaskEvent`: retained task audit history.
- `HousekeepingConfig`: optional approved Meta notification template name/language.

All reads and writes derive hotel context from authentication or the verified Meta integration. Worker phones are attributes, not primary identities. Changing a worker phone keeps history and clears the previous messaging window.

Identical report reruns preserve execution progress. A changed row reopens that task, clears its assignment and invalidates old buttons. Removed rows and prior-day tasks become inactive. Successful empty snapshots clear active work; failed runs retain the last successful snapshot and never imply an all-clear. Assignments and task actions require a current successful source and recheck it under the same PostgreSQL advisory lock used by ingestion. A late or stale WhatsApp button cannot complete changed work.

VIP rows create preparation tasks with the actual reported benefits. Departure rows preserve decimal amounts and distinguish an open balance, credit balance/overpayment, and a reported overcharge. Marking reviewed records a staff review only: no settlement, refund or PMS change is performed.

## Housekeeping workflow

1. Connect the hotel's real internal (or both-use) WhatsApp integration.
2. In the housekeeping dashboard, open **Workers & WhatsApp settings** and register/enable the hotel's housekeepers.
3. Ask each worker to send `TASKS` to the internal number. Otherwise configure an approved Meta template before sending business-initiated notifications.
4. Select the generated tasks, choose a saved worker, then **Assign & Send WhatsApp**. The worker picker shows current workload. A saved assignment does not imply the message was delivered: inspect the displayed submission status.
5. The worker taps **Accept**, **Start**, **Completed**, or **Problem**. Problems offer **Do not disturb** and **Maintenance**, then accept a text description. `TASKS` refreshes current assignments.
6. Neon stores acceptance/start/completion timestamps. SSE refreshes dashboards; a 60-second poll is a fallback. The dashboard shows task counts, per-worker completion, unaccepted work, problems and average completed task duration.

Room completion means all current housekeeping tasks for that room are completed. It does not automatically mark the PMS room inspected or released. Arrival deadlines and overdue statistics are not invented when the source has no deadline.

## WhatsApp notification requirements

Reply buttons use signed, expiring IDs bound to the hotel, worker, assignment and task. The verified webhook identifies the worker from the sender and checks the current assignment and valid state transition. Webhook IDs deduplicate messages. Message titles and arbitrary guest text cannot mark work complete.

Free-form assignment messages require a recent worker message (the implementation uses a conservative 23.5-hour window). Outside that window, configure a Meta-approved template with **two body variables in this order: worker name, task count**. Suggested body: `Hi {{1}}, you have {{2}} housekeeping tasks. Reply TASKS to accept and view your assignments.` Configure the exact approved name and language. Without a template/window, the assignment is saved as `waiting_window` and no message is sent. On acceptance the delivery state becomes `accepted`.

Provider acceptance is not proof of delivery. Unknown sends are recorded as `uncertain` and are not retried automatically. Repeating the same HTTP request ID cannot create/send a second assignment. The worker can send `TASKS` to recover the current task view.

## Validation and rollout

Run `npm run prisma:deploy`, `npm run prisma:generate`, and deploy the backend. Push the frontend changes for the Netlify deployment.

`node --test src/tests/reportOperations.test.js` covers authorization, sender controls and signing. `node scripts/test-operations-database.mjs .env` applies all migrations to a disposable schema and checks source projection, tenant isolation, assignment, acceptance, completion, problems, changed/failed/empty runs, replay and uncertain sends. It never sends real WhatsApp messages.

A live acceptance test still requires a current report, an enabled worker and a verified internal number: assign a task, accept/start/complete it from the worker's WhatsApp account, then confirm dashboard timestamps and audit events. Guest verification is documented separately in `pms-mcp.md`.

Deployment on 2026-10-28: both additive migrations are applied. Backend revision
`hotelogx-connect-backend-00051-4l9` is serving traffic; health/database checks pass
and anonymous operations requests return 401. The frontend production build and
authentication regression checks pass; Netlify publication awaits the GitHub push.
No real worker messages or guest folio writes were sent during validation.
