# Guest messaging connection at check-in

Implemented locally on 18 November 2026, including automatic check-in invitations. This feature requires deployment before hotels can use it. QR codes are deferred.

## Automatic invitations

Managers can enable **Automatic invitations after check-in** on the Guest messaging page, select email, WhatsApp, or email-first, and configure the Mews enterprise, integration, and accommodation service IDs. The hotel must confirm that its staying-guest profiles contain the guests' own contact details. Enterprise and bookable service membership are checked live before enabling.

The flow is independent of the check-in operator. Reception, online check-in and kiosks all qualify when Mews has `State: Started`, an actual check-in timestamp, an assigned room, and a future checkout. Online registration/pre-check-in while the reservation remains `Confirmed` never qualifies. Only check-ins at/after enabling automation are eligible; existing stays retain the manual flow.

The authenticated General Webhook receives `ServiceOrderUpdated` events and stores hotel-scoped jobs before acknowledging. Guest addresses and claimed reservation states in webhook payloads are ignored. A worker retrieves the live reservation and its owning customer's profile. Missing contacts, known OTA proxy addresses, or contacts shared with a separate booker go to Front Office review. Contact checks cannot conclusively identify every agency/shared address; correct PMS guest profiles remain essential. The guest must redeem the code before a conversation is verified.

Manual and automatic sending use the same invitation table and transactional lock. Any previous invitation for the reservation, including expired, failed, uncertain or revoked invitations, suppresses further automatic sends across channels. Explicit staff replacement/companion invitations remain possible. There is no automatic resend or fallback to WhatsApp after an uncertain email delivery. Code lifetime remains ten minutes; reception can revoke/reissue an expired invitation.

The worker uses durable leases and processes up to five recovery pages and ten queued reservations per hotel per run. Updated reservations are scanned with two-minute overlap and one-day windows, storing pagination checkpoints only after jobs are durable. Repeated notifications and concurrent workers cannot bypass the sending guard. Failures remain visible on the Guest messaging page. **Recheck PMS** retries evaluation, not delivery of an already-recorded invitation. **Dismiss review** closes the current review; a new reservation update can reopen it.

Checkout/cancellation events revoke pending invitations and check-in conversation bindings. Live verification also blocks access if the PMS no longer shows an active stay, even if an event was missed. Room moves continue using the current PMS assignment rather than the invitation's original room.

## Automatic deployment and webhook registration

1. Deploy both additive migrations, including `20261118030000_automatic_guest_messaging`, regenerate Prisma Client, and deploy backend and frontend.
2. Configure independent random secrets (at least 32 characters) in backend Secret Manager/environment: `MEWS_GENERAL_WEBHOOK_SECRET` and `CHECKIN_WORKER_SECRET`. These are not the Marketplace onboarding token.
3. Register **General Webhooks / ServiceOrderUpdated** in Mews with your backend URL plus `/api/pms/webhook/mews/general`. Authenticate with `x-webhook-secret` if supported by the sender, otherwise append `?secret=<MEWS_GENERAL_WEBHOOK_SECRET>` privately. Redact/exclude request URL logs containing secrets at the platform/proxy layer; do not publish this URL. The webhook rejects missing/incorrect secrets and requires an exact, unique enabled `EnterpriseId` + `IntegrationId` mapping. It does not trust a caller-supplied Hotelogx hotel ID. Unmapped integrations receive 409; register/enable in a coordinated setup.
4. For Cloud Run, configure Cloud Scheduler to POST `/api/pms/guest-messaging-worker` every minute with `Authorization: Bearer <CHECKIN_WORKER_SECRET>` over HTTPS. Allow a request timeout sufficient for your hotel count and configure retries. The endpoint processes jobs within the request; it does not rely on work continuing after an HTTP response. Set an appropriate Cloud Run request timeout as well. An in-process minute timer also runs while the application has CPU, but it is not a substitute for Cloud Scheduler on request-throttled or scale-to-zero instances. Database leases protect overlapping runs.
5. In the manager page, enter the Mews enterprise ID, integration ID from the General Webhook subscription, and accommodation service ID; configure the approved WhatsApp template if applicable; enable automation and confirm guest contact quality. Use a controlled reservation/contact to verify reception, online/kiosk, duplicate notification, room move and checkout cases.

Read permissions used by automation: `configuration/get`, `services/getAll`, `reservations/getAll/2023-06-06` (exact IDs and paginated `UpdatedUtc` intervals), and `customers/getAll` (exact owner/booker IDs). No reservation-start endpoint is called: Hotelogx observes check-in and never checks guests in itself. Existing MCP reservation verification is still used immediately before sending and when redeeming codes.

References: [Mews General Webhooks](https://docs.mews.com/connector-api/events/wh-general), [reservation states and updated filters](https://docs.mews.com/connector-api/operations/reservations), [bookable service data](https://docs.mews.com/connector-api/operations/services).

## Reception workflow

1. Complete check-in and assign the room in Mews. A reservation in `Confirmed`, cancelled, no-show or checked-out state cannot receive an invitation.
2. Open **Guest messaging** in the Front Office or manager menu. Search the synced reservation list by name, reservation number or room.
3. Select the reservation, choose email or WhatsApp, and confirm the guest's own contact details at reception. Staff must verify the guest's identity and authorisation. Do not use a booking agent's address. An authorised companion can have a separate invitation for the same reservation.
4. Send the invitation. Hotelogx checks Mews live before sending. Sending does not verify the conversation.
5. The guest replies on the same channel/from the invited contact with the supplied `CONNECT …` command. The code expires after ten minutes, is single-use and is stored only as a hash in the invitation table. The inbound command remains in the conversation history; restrict inbox access accordingly.
6. Hotelogx rechecks Mews, then links this conversation to the reservation until its scheduled checkout. Verification does not close an escalation or override staff takeover. In manual mode, staff see the suggested acknowledgment rather than an automatic reply.

After linking, routine housekeeping delivery requests use the current Mews assigned room, resolved through the hotel's synced room records. A conflicting supplied room requires clarification and creates no housekeeping delivery task. An unavailable PMS or missing synced room must not fall back to a previous room. Early checkout blocks use on the next live check. Checkout extensions beyond the original link expiry require reception to revoke/reconnect; the feature deliberately does not extend an old contact's access silently.

The link belongs to the conversation: WhatsApp uses the hotel's number/contact conversation; email uses the provider's email thread. A new email thread needs its own verification. Another sender replying in a linked email thread cannot inherit the connection. Existing pre-arrival reservation verification remains available for booking questions; contact matching alone never verifies this check-in connection.

## Status and revocation

- **Sent** means the provider accepted the message, not proof of delivery or guest verification.
- **Redeemed** records successful code use; it is not a guarantee that the stay is still active.
- **Uncertain** means delivery could have occurred despite a timeout. Check the mailbox/WhatsApp delivery before considering another invitation. There is no automatic resend.
- **Failed** means sending was not confirmed. Confirm contact/integration settings before retrying.
- **Revoke** invalidates the invitation and removes the matching binding. Revoking an older invitation cannot remove a later connection.

Issuance is serialised per hotel, with duplicate active-invitation checks and a one-minute contact/reservation cooldown. The staff list shows the latest 100 invitations. Record issuer, redemption time/message/conversation, and revoking staff identity. A fresh live Mews check is required for sensitive AI access and remembered-room use.

## WhatsApp setup

In the manager Guest messaging page, configure an approved template name and language for this hotel's guest WhatsApp connection. Invitations always use a template, including when a conversation window might be open. The template must have **one body text parameter**, replaced by the full `CONNECT <code>` command. Example body to submit for approval:

> Welcome to our hotel. Your stay is checked in. To connect guest messaging, reply with only {{1}}. This code expires in 10 minutes. Keep it private. If this is not your stay, contact Front Office.

Use the language code matching the approved template. Email can be used without this WhatsApp configuration, through the hotel's connected mailbox. No messages are sent merely by saving configuration.

## Deployment

1. Deploy the additive Prisma migration `20261118020000_guest_messaging` to the production database (`npm run prisma:deploy` from `hotel-backend`, with the production database environment).
2. Generate Prisma Client as part of the backend build/install (`npm run prisma:generate`) and deploy the backend.
3. Build and deploy the frontend. The feature adds `/front-office/guest-messaging` and `/manager/guest-messaging`.
4. Ensure the hotel's Mews MCP connection, room/reservation sync and receiving/sending email or guest WhatsApp integration work. Existing MCP `get_reservations` permission is used; no new Mews endpoint is required.
5. Configure the WhatsApp template if needed, then perform a controlled check-in/invite/reply/room-move/revoke test with a test reservation/contact.

No production migration, deployment, invitation or live guest message is performed by the local implementation/tests.

## Validation

Run `node --test src/tests/checkinAutomation.test.js src/tests/guestMessaging.test.js src/tests/guestMessagingRoutes.test.js src/tests/guestVerification.test.js` in the backend, plus the email/WhatsApp regression suites. Frontend: `npm run lint` and `npm run build`. Prisma: `npm run prisma:validate`.
