# Catalogue upsells and pre-arrival outreach

Both staff and automation now use configured `PmsUpsellProduct` entries and live
PMS/manager-approved prices. The legacy hard-coded suggestion prices and browser-only
"Offer sent" action have been removed. Invitations are not binding quotes: the existing
verified-reservation, exact guest acceptance, approval and PMS posting flow still applies.

## Hotel setup

In Manager → Upsells, select catalogue products, their categories and optional comma-separated
conversation keywords. Select **Include in automatic pre-arrival offers** for campaign products.
Automatic outreach defaults to **3 days before arrival**, configurable from 0 to 365 days.
It starts disabled until a manager enables it and selects products. Reservations confirmed
inside the hotel's configured window (including same-day arrivals) are eligible immediately
after confirmation is received from the PMS; they do not wait another three days after booking.
For example, a booking confirmed two days before arrival is checked at confirmation; a booking
confirmed ten days before arrival waits until three days before arrival with the default setting.
One campaign message contains up to three not-yet-offered products.
Dates are evaluated in the hotel timezone; cancelled/changed reservations are checked against
live Mews before dispatch. The configuring manager must still belong to that hotel.

Email is preferred when a booking address and connected mailbox are available. Otherwise,
WhatsApp requires a connected guest number and an approved template configured by the hotel.
The template must have **one body text parameter**, containing the product names and per-unit
prices, with fixed text requesting quantity/date and explaining availability/quotation follow-up.
Staff can send ordinary WhatsApp messages within an active 24-hour guest conversation.
Hotel autonomy, Upsells policy, VIP handling and human takeover are respected by automation.

## Duplicate prevention

`UpsellOutreach` has a unique `(hotelId, reservationId, productId)` constraint.
An advisory database lock serializes claims from staff, AI and campaign workers. Claims are
persisted before provider dispatch; pending, failed and uncertain claims all prevent another
automatic send. A changed schedule, changed channel, process restart or repeated inbound
message cannot reset a claim. A campaign is also limited to one message per reservation.

Before claiming, the app examines existing PMS offers and recorded outgoing staff/AI messages
across related email and WhatsApp conversations. Matching uses exact normalized booking contact
details, verified reservation bindings, product labels, categories and hotel keywords. It never
uses names or room numbers to assert guest identity. Contact association for suppression does
not create a verified PMS binding. Ambiguous/missing reservation associations fail closed.

Free-text staff offers are checked before dispatch. Existing message matching is conservative
and cannot reliably identify every paraphrase or language. Offers made outside synchronized
channels (phone, external email, etc.) must be recorded using **Already offered by staff**.
WhatsApp Business app messages already imported through Coexistence are included in history.

An invitation can progress to an explicitly requested binding quote; that is not a second
unsolicited offer. Quote creation checks prior reservation/product quotes under the same lock.
`PmsUpsellOffer.deliveryMessageId` atomically prevents staff and AI from delivering a quote twice.
Changed/expired quotes are referred to Front Office instead of automatically re-offered.
Uncertain outcomes are never automatically retried. Staff must inspect provider/PMS history.

The pipeline reports invitations and PMS offers together, replacing an invitation with its
subsequent quote. Revenue means **posted to PMS**, not payment collected. Pending, failed and
uncertain deliveries are visible. Legacy editable `Upsell` rows are no longer revenue authority.

## Deployment

1. Apply Prisma migration `20261105010000_upsell_outreach` and regenerate the Prisma client before
   deploying the backend. The migration adds tables/columns without deleting existing records.
2. Deploy backend and frontend together. Re-sync PMS guests to populate booking email/phone
   fields. Existing guest tags remain supported for conversation matching.
3. For Cloud Run, schedule an authenticated POST to `/api/workers/upsell-campaigns` every five
   minutes. Configure `UPSELL_WORKER_AUDIENCE` to the expected OIDC audience and
   `UPSELL_WORKER_SERVICE_ACCOUNT` to the scheduler identity. The endpoint validates Google OIDC
   signatures and exact audience/account. Request bodies cannot select a hotel or recipient.
   The in-process five-minute timer also runs while the server has CPU, but is not a substitute
   for Cloud Scheduler on scale-to-zero/request-throttled instances. Concurrent ticks are safe.
4. Configure products, template and enable each hotel's schedule. Enabling can send to existing
   reservations already inside the configured window; there is no retroactive send after arrival.

Successful PMS syncs immediately check eligible offers. Reservation/service-order webhooks
authenticated with `MEWS_WEBHOOK_SECRET` trigger a fresh PMS sync and then the same check.
Webhook contacts/status are not used as authority for dispatch. The periodic worker remains
the catch-up path for already-synced reservations. Immediate confirmation delivery requires
the PMS webhook to be configured; otherwise it follows the next PMS sync and campaign check.
Changing the default does not overwrite a hotel's explicitly saved schedule or reset send claims.

Tests: `npm run test:upsells`, `npm run test:upsells:database`, frontend `npm run lint` and
`npm run build`. The database test creates a randomly named disposable schema, runs all
migrations and uses mocked messaging/PMS clients. It never sends guest messages or posts a
real PMS order, and removes only its disposable schema afterwards.
