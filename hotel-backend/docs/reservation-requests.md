# Reservation changes and extra-bed approvals

Deploy migrations `20261108010000_reservation_service_requests` and `20261108020000_reservation_origin_routing`, regenerate Prisma, and deploy the backend and frontend. No deployment or live PMS write is performed by the automated tests.

## Request intake

Cancellation/amendment request phrases create durable routing records and check the verified reservation source. Only confirmed direct bookings enter the Front Office/management resolution queue. Extra-bed and sofa-bed requests continue to require staff approval regardless of booking source. Email and guest WhatsApp ingestion capture requests even during human takeover. Suppressed historical/automated email and internal WhatsApp messages do not generate requests. The AI's normal booking/upsell/task flow is bypassed for recognized requests. The acknowledgment is a suggested reply for staff; it is not sent automatically.

One pending request per conversation and kind is reused. Message/kind uniqueness protects provider retries. The original text is retained and later messages remain in the conversation. Requests in other languages or unusual wording that are not recognized by the phrase detector still require staff review in the inbox; detection is not a substitute for staff monitoring.

## Staff review

Open **Reservation requests — Front Office and management** in the conversation sidebar. Both roles can review; Housekeeping cannot approve a request.

- Direct-booking cancellation/amendment: verify the guest and check the source, handle the change in Mews, contact the guest, then record the actual outcome or decline with a reason. This endpoint never cancels or changes a reservation in the PMS.
- Extra bed: verify/link the reservation using the existing reservation controls. Approval reads the live reservation, checks its customer against the verified binding, and resolves the assigned PMS resource to a synced hotel room. Missing assignment, expired verification, inactive reservation, or customer mismatch blocks approval.
- Staff explicitly confirm the hotel permits the arrangement, room capacity and bed availability were checked, and the guest agreed to any charges. Unsupported arrangements are declined with a reason. No charge is posted or payment collected by this workflow.
- Choose a hotel-local work date within the stay, the arrangement (extra/rollaway bed or sofa bed), quantity and preparation instructions.
- Review existing room/date bed tasks. If a task covers the full request, link it with explicit confirmation. Otherwise adjust the existing plan before approval; the endpoint refuses to create a duplicate.

Approval and task creation/linking are atomic under the same hotel lock used by report reconciliation. Staff-approved work uses the existing `ReportTask` lifecycle, including assignment, WhatsApp actions, access restrictions, readiness invalidation and completion. Future work has a not-before time. Linked guest follow-up records require Front Office to confirm the guest outcome separately.

Pending requests block resolving the conversation or returning it to AI. Staff decisions do not automatically clear unrelated escalations or send guest notifications. Communicate the outcome through the existing composer or hotel contact procedure.

## Relationship to the Neon housekeeping report

Existing report tasks such as `make_sofa_bed` and `extra_bed_requested` remain authoritative operational inputs. The app does not infer approval, quantity or charges from occupancy alone.

When an engine report arrives after guest-request work was approved for that room/date, reconciliation retains the staff work item instead of creating a second bed task. It flags the overlap for staff comparison of quantity and instructions, and invalidates room readiness. Changed report instructions cannot silently overwrite the approved setup. Completed work is reopened for review when new report evidence overlaps it; prior history is retained.

## Validation

- `npm.cmd run test:bookings` includes request classification checks.
- `node scripts/test-upsell-outreach-database.mjs .env` applies migrations in a disposable schema and tests escalation, staff permissions, hotel boundaries, missing approval, reservation verification, concurrent approval, task linking and later-report reconciliation. Providers are mocked; no guest messages, bookings or charges are sent.


## Booking-origin routing

Source checks use the authenticated hotel's PMS connection and the conversation's unexpired verified reservation/customer binding. The source lookup reads only the bound reservation, checks customer ownership, and records the source and check time. Missing verification or unavailable/ambiguous PMS data stays `awaiting_origin`, outside the direct-booking resolution queue. Staff can verify/link the reservation and select **Check verified reservation source** to retry. Pending source checks still prevent closing or returning the conversation to AI.

A source is external when PMS agency/channel references or channel-origin information establish mediation. Known provider names in PMS origin details can appear in the suggested reply; otherwise the guest is directed to the travel agency or booking service on their confirmation. Channel-manager names are not presented as guest-facing booking providers. The request becomes `referred`, not hotel-resolved, and no cancellation/amendment approval is offered. Suggested replies remain subject to staff review; this workflow does not automatically send them.

Explicit direct origins include the Mews booking engine, guest services, and supported direct staff-entry origins. Generic `Connector`, import and unspecified Commander sources are not assumed direct. A Connector reservation is direct only when a successful Hotelogx booking record proves it was created by this app and no agency/channel evidence conflicts.

The review endpoint refreshes the source before a decision. Unknown/external sources cannot be resolved or declined through the direct-booking control, including with a crafted API request. Extra-bed approval continues independently, so mixed messages can receive provider guidance for an amendment and staff review for bed preparation.

Source fields and enum semantics: [Mews reservations API](https://docs.mews.com/connector-api/operations/reservations). Older pending requests are moved to `awaiting_origin` by migration and require checking before resolution. No historical requests are treated as direct without evidence.
