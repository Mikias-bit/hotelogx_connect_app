# Room availability and chat reservations

Booking uses the existing hotel-scoped MCP connection and Neon credentials. Mews task import is not included. Staff collect payment or arrange preauthorization through the hotel's established procedure; this feature neither requests card details nor creates payment links or payment transactions.

## Setup and deployment

1. Apply the Connect migration `20261102010000_pms_bookings` (`npm.cmd run prisma:deploy` and `npm.cmd run prisma:generate`).
2. Deploy the updated `hotelogx-pms-mcp` service, then the Connect backend.
3. Push/deploy the frontend.
4. In Manager → Settings → PMS, open **Chat reservations and staff payment procedure**. Load services, choose the daily accommodation service, load room categories/public rates, and select up to three categories and two rates.
5. Enter rate-specific cancellation terms, inclusions, city tax/other additional charges, hotel-local arrival/departure times, and the guest-facing staff payment procedure. Review any Mews payment automation associated with those rates before enabling.
6. Enable chat bookings. Optional automatic creation also requires Autonomous hotel mode, auto-replies enabled, an AI-handled conversation and an Autonomous **Availability & pricing** rule. VIP approval rules still apply. Otherwise staff approve the request.

Existing hotels default to disabled. Missing or incomplete configuration fails closed.

## Guest and staff flow

The guest provides dates, adults and child ages. `search_booking_availability` checks inventory on every night and base room capacity, and prices eligible room/rate combinations with Mews. It does not reserve inventory. Extra-bed arrangements and multiple rooms require staff.

After selecting a room/rate, the guest supplies first/last name, email and international phone. `quote_booking` saves an exact quote, contact details and terms, expiring in 15 minutes. The guest must reply **BOOK &lt;code&gt;** after the exact quote is recorded as sent/delivered/read. No existing reservation verification is required to request a new booking; existing-reservation access retains its separate verification controls.

`create_accepted_booking` rechecks availability, price, configuration, policy and consent. Mews overbooking and rate-applicability checks stay enabled. Potentially applicable PMS restrictions are conservatively flagged for staff review rather than interpreted automatically. Staff must verify their exceptions/conditions in Mews before approval.

Confirmed creation escalates the conversation to Front Office for payment follow-up. Pending approvals and uncertain results use the same existing escalation/conversation pages; no new dashboard panel. Approval controls are under **Reservation check & approvals**. Staff approval saves a suggested reply but does not send it automatically. Staff send it using the conversation composer.

**Record staff follow-up** records what staff did; it does not mark a Mews bill paid, charge a card or claim payment succeeded. Mews confirmation emails are disabled for these API calls so staff/Hotelogx can communicate the correct payment procedure.

## Idempotency and limits

Quotes have unique request keys. An atomic database claim prevents concurrent or repeated booking submission. A timeout, interrupted write or missing reservation response becomes `posting`/`uncertain` and is never automatically retried. Staff check Mews using the offer reference in the reservation notes. Customer creation is also treated as a write: it never overwrites or automatically links an existing customer based only on email. If that email already exists, staff must resolve the profile and complete the booking in Mews. A newly created customer ID is retained for reconciliation if reservation creation fails.

The price is rechecked immediately before creation; the PMS remains authoritative during concurrent inventory/rate updates. Rate terms are manager-maintained text and must match Mews. Photo display, payment links, automatic cancellation/amendment and multi-room/group booking creation are outside this version. Cancellation/amendment requests and extra-bed approvals use the staff workflow documented in `reservation-requests.md`.

## Verification

Backend: `node --test src/tests/pmsBookings.test.js src/tests/pmsAiTools.test.js src/tests/pmsMcp.test.js src/tests/pmsHandoff.test.js`.

MCP: `python -m pytest tests/mews/test_bookings.py tests/mcp -q` in the MCP environment. Disposable database validation: `node scripts/test-bookings-database.mjs .env` (only the designated test-data database; creates and drops its own random schema).

Live test in a Mews demo/test property: verify one-night and multi-night availability, occupancy limits and terms; obtain a quote; accept it; confirm exactly one Mews reservation and the payment handoff. Repeat with auto-book disabled, a changed price, restricted rate and an expired quote. No live booking or deployment is performed by the automated tests.

References: [Mews reservations](https://docs.mews.com/connector-api/operations/reservations), [availability](https://docs.mews.com/connector-api/operations/services), [restrictions](https://docs.mews.com/connector-api/operations/restrictions), [customer creation](https://docs.mews.com/connector-api/operations/customers).
