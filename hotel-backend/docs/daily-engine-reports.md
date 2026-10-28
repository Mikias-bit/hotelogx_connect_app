# Daily engine reports

All hotels use the existing Neon database. DailyReportSource, DailyReport and
DailyReportReview are scoped by the authenticated Connect hotel ID. No demo hotel
is automatically mapped to a real engine hotel. New hotels need no schema changes.

## Deployment

From hotel-backend run `npm.cmd run prisma:deploy` then deploy the backend source.
Deploy the frontend build after the backend. The migration is additive and does
not seed reports or change existing tasks. The engine changes are already installed
in the sibling hotelogx_app checkout; deploy that checkout through its usual process.

## Connect each real hotel

1. Sign in as that hotel's manager and open Settings > Connect reporting engine.
2. Enter the exact hotel ID from the Python engine configuration and create an engine key.
3. Store the key in Secret Manager, never frontend variables or source control.
4. Configure the engine with CONNECT_REPORTS_URL set to the backend HTTPS URL ending
   in /api/reports/ingest. Set CONNECT_REPORTS_TOKENS from a secret containing a JSON
   object mapping each engine hotel ID to its own key. For a single-hotel job, use
   CONNECT_REPORTS_HOTEL_ID and CONNECT_REPORTS_TOKEN instead.
5. Let the hotel's normal scheduled workflow publish its next result. Confirm the
   report date and rows in Connect. Never run accounting workflows merely to test uploads.

Replacing a key immediately revokes its predecessor. An engine hotel ID can belong
to only one Connect hotel. Each upload token determines its destination hotel;
a hotel ID supplied by the client cannot override that destination.

## Report behavior

The engine keeps its existing JSON/PDF bucket exports, then archives and sends a
structured snapshot. Connect stores housekeeping, VIP and departure-bill snapshots
in Neon and projects them into operational tasks, VIP preparation and departure
balance follow-ups. See [report-operations.md](report-operations.md) for worker
assignment, WhatsApp execution and dashboard updates. Source history remains
available for audit. Operational completion is separate from live PMS room status.
Managers/front office see all three reports; housekeeping sees housekeeping only.
Dates use the engine hotel timezone. The latest available report is clearly dated;
older reports are flagged and users can select an explicit date.

Repeated delivery of the same run is idempotent. A reused run ID with changed
content is rejected. Older runs cannot replace newer snapshots. Missing or failed
reports never mean all-clear; the last complete snapshot remains visible with a
failure warning. A successful empty snapshot can clear old exceptions. Staff
notes and completion are stored separately; changed source content requires review
again. Completing a checklist item does not alter PMS balances or room state.

Positive unpaid balances and negative overpayments are displayed separately.
An overpayment is not proof of overcharging. Explicit overcharge rows are supported,
but the current engine does not detect incorrect pricing/overcharges independently.

## Retry and recovery

Transient upload failures retry the same snapshot up to three times. After failure,
replay the saved connect_*.json artifact with the same run ID:

    python -m services.report_publisher --replay path/to/connect_snapshot.json

Configure the same URL and scoped secret first. Do not regenerate the business
workflow to retry delivery. Snapshots contain guest information and must remain in
the existing private report storage. Logs do not include access keys or report bodies.

## Validation

    npm.cmd run test:reports
    node scripts/test-reports-database.mjs .env
    python -m unittest discover -s integrations/python -p test_report_publisher.py

In the engine checkout (pytest-asyncio required):

    python -m pytest tests/test_accounting_departure_bills.py tests/test_vip_guest_names.py tests/test_housekeeping_room_lookup.py --asyncio-mode=auto -q

In hotel-frontend: npm.cmd run lint and npm.cmd run build.

For another engine checkout, review and run integrations/python/install_engine_reports.py
with --engine-root pointing to it. The installer is tailored to this engine's current
source structure; inspect its diff before deployment.
