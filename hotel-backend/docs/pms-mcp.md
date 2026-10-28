# Mews MCP integration

Private service: https://hotelogx-pms-mcp-tkissahsva-ez.a.run.app/mcp
Project: hotelogx. Region: europe-west4.

Backend module: src/modules/pms/pmsMcpClient.js. Its callTool and listTools methods
require the authenticated backend user object; never construct hotel/user context
from tool arguments or a caller-supplied request-body hotel ID.

The backend obtains a Google ID token from its Cloud Run runtime identity and
sends it in X-Serverless-Authorization. A distinct short-lived HS256 context token
in Authorization binds the hotel, user, role, audience and issuer. The MCP service
rechecks staff membership in Neon before calling Mews. Only the backend service
account has the service-level Cloud Run invoker grant; no anonymous grant exists.

Environment: PMS_MCP_URL is the service base URL. PMS_MCP_CONTEXT_KEY is mounted
from the dedicated Secret Manager secret. Neither value should be supplied by AI.
The Python service reads DATABASE_URL from Secret Manager and exact-hotel
PmsIntegration records from Neon. Its PMS_ENCRYPTION_KEY matches the backend
DB_ENCRYPTION_KEY, or JWT_SECRET fallback, for token decoding.

Onboarding now persists clientTokenEncrypted and baseUrl along with the existing
access token and verified enterprise ID. The client token is encrypted using the
existing Connect tokenCrypto format. Existing access-token storage is unchanged.
Connections created before this change must reconnect to save missing fields.
The migration is additive and does not overwrite any hotel credentials.

Authenticated managers/front office can GET /api/pms/mcp/status to perform a live
connection check. This returns a clear reconnect error if credentials are incomplete.
No guest records or payment changes are involved in that diagnostic.

Cloud deployment verification on 2026-10-26: hosted MCP initialization and all ten
tools listed successfully; anonymous requests rejected; Neon access and unknown-hotel
rejection verified. Both existing connected records lacked clientTokenEncrypted and
baseUrl. A real Mews business-data lookup remains pending reconnection.

Tests: node --test src/tests/pmsMcp.test.js src/tests/pmsCredentials.test.js.
Python project README documents its 13 pipeline/runtime tests and deployment script.

## Upsell tools and OpenAI

`pmsAiTools.js` connects the existing OpenAI Chat Completions model to the MCP
manifest. Only search_upsell_products, get_my_reservation and quote_upsell are
offered to the model. Exact `ACCEPT <offer code>` messages invoke
post_accepted_upsell directly. The server independently verifies persisted guest
acceptance of a delivered quote. The model cannot supply a hotel, reservation,
customer, price or approval override. Other PMS staff tools are forbidden for
the signed conversation role.

Managers use **Manager → Upsells → Reservation extras and folio approvals**.
Front Office opens **Escalated** on the dashboard, selects a conversation, and uses
**Reservation check & approvals** in its details. The dashboard has no approval panel.
Pending folio approvals and uncertain PMS outcomes join this ordinary escalation
queue alongside reservation verification handoffs. Review loads only the selected
hotel conversation's offers and bindings; staff resolve or return the conversation
to AI after handling it. These routing changes require a backend deployment as well
as the frontend deployment. Staff must
verify guest identity and link the conversation to its Mews reservation UUID when
automatic guest verification cannot complete.
Do not infer ownership from a room number, name or message text.

PMS prices work directly. To use a knowledge-base price, a manager selects the
actual Mews product, approves its unit price/currency and identifies an indexed
hotel knowledge document. Free-text retrieval is informational, not charge
authorization. Relative prices and incomplete tax metadata require staff review.

Automatic posting defaults off per product and also obeys hotel/conversation/VIP
policy. Early check-in and late checkout always need staff approval. Staff approval
does not replace guest acceptance. Offers expire after one hour; price/policy or
reservation-binding changes require a new offer. Approval and rejection endpoints
are restricted to the current hotel's manager/front-office staff.

The write calls Mews orders/add with explicit one-time quantity, approved unit
amount/tax codes and LinkedReservationId. It does not multiply quantity by nights
or persons. It creates a product order linked to the reservation; it does not
settle a bill, charge a card, refund, or send a payment link.

Atomic database claims prevent repeated external writes for an offer. A timeout
or interrupted posting remains `uncertain`/`posting`: inspect the Mews folio and
the `hotelogx-upsell-<offer code>` external reference before any manual action.
There is deliberately no automatic retry or reset of uncertain offers.

Migration: `20261026020000_pms_upsell_tools` (three additive tables).
Tests: pmsAiTools.test.js, pmsUpsellRoutes.test.js, pmsMcp.test.js;
Python tests/mews/test_upsells.py. Run `node scripts/check-upsell-database.mjs`
for disposable Neon schema checks. It expects the sibling MCP repository/venv;
PMS_MCP_ROOT and PMS_MCP_PYTHON can override these paths. No real Mews write is
performed by any test. Live end-to-end posting still requires a connected hotel,
verified reservation and explicitly accepted test offer.

Deployment on 2026-10-26: MCP revision hotelogx-pms-mcp-00003-pxv and backend
revision hotelogx-connect-backend-00050-z5r serve the upsell integration. The hosted
manifest lists 14 tools; anonymous access and unknown hotels are rejected. The
upsell migration is applied. Frontend type checking and production build passed;
publishing the new screens remains pending because Netlify CLI is not logged in
or linked to a site on this machine. No live Mews folio write has been performed.

## Guest verification

Before reservation-specific reads or an upsell quote/write, the backend collects
the full booking name, check-in date, check-out date, total guests, booking email
and WhatsApp number, followed by the hotel's booking confirmation number. The
reference must exactly match Mews `Reservation.Number` (case-insensitive); an OTA
reference alone is not substituted for the hotel's confirmation number. The
private `match_guest_for_verification` MCP tool matches
all fields against one current Mews reservation within the hotel's verified
services and hotel-local dates. No match, ambiguous bookings, incomplete results
or mismatches require front-desk assistance; partial guest details are not exposed.

Matching alone is not proof of ownership. A six-digit, single-use code is sent
through the hotel's connected mailbox to the matched booking email. It expires
after ten minutes and allows five attempts. A successful code requires a fresh
PMS match before creating the conversation binding. The binding expires within
24 hours (or checkout plus twelve hours, if earlier); both reads and the atomic
folio-write claim enforce expiry. Manual verified staff bindings remain supported.

The verification matcher is not in the AI's tool allowlist. Guest fields are
encrypted in the verification session and erased on completion/cancellation or
failure; code hashes use the server's context signing key. Outgoing codes are
not written to the conversation. Collected verification exchanges are excluded
from later OpenAI history. Incoming messages retain the normal conversation
audit history. Public hotel questions remain available; `CANCEL VERIFICATION`
cancels the collection workflow. An uncertain email send is not automatically
repeated. Verification does not replace guest price acceptance or hotel approval.

Migration: `20261027010000_guest_verification`. Tests:
`node --test src/tests/guestVerification.test.js`, and
`node scripts/test-verification-database.mjs .env` (disposable Neon schema, mocked
PMS/mailbox). The sibling MCP tests validate exact matching and expiring bindings.
Live verification still requires complete Mews credentials and the reservation's
actual contact fields, plus a working connected hotel mailbox.

Failed/missing matches and failed identity checks use the same generic guest
message: “I could not locate and verify your reservation with the details
provided. A member of our Front Office team will help you.” No partial matches,
candidate records, room numbers or stored contact details are returned. Replying
`AGENT` also enters this path. The backend saves an ordinary conversation
escalation for Front Office (`kind: reservation_verification`), sends the handoff
acknowledgment subject to the existing auto-reply policy, and pauses automation.
It creates no separate operational task or manager dashboard error panel. These
handoffs remain available in the Front Office queue and conversation inbox.
Existing pre-confirmation code challenges cannot bypass the reference check.
General hotel replies no longer inherit an unverified PMS guest name or room.

Deployment on 2026-10-28: MCP revision `hotelogx-pms-mcp-00004-svt` and backend
revision `hotelogx-connect-backend-00051-4l9` serve guest verification. Hosted
initialization lists 15 tools, including the private matcher. Anonymous access and
unknown hotels remain rejected. The verification migration is applied; 27 Python
tests and the disposable Neon verification/expired-binding checks passed. This
does not certify a live guest verification or folio posting against Mews.

Confirmation-number / Front Office handoff update on 2026-10-28: backend
`hotelogx-connect-backend-00052-z5b` was deployed first, followed by MCP
`hotelogx-pms-mcp-00005-l44`. Validation: 76 targeted backend tests, 29 MCP tests,
the isolated Neon verification/escalation check, and frontend type/build checks.
The dashboard adjustment is in source and awaits the frontend GitHub/Netlify push.
