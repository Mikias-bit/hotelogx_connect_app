# Real WhatsApp onboarding and messaging

## Configuration

Backend Cloud Run settings:

- `META_APP_ID`: the app that owns the Embedded Signup configuration.
- `META_APP_SECRET`: Secret Manager reference, never a frontend variable.
- `META_WEBHOOK_VERIFY_TOKEN`: a private randomly generated verification value, also configured in Meta's webhook screen.
- `META_GRAPH_VERSION=v25.0`: pin a version supported by your Meta app.
- Existing token encryption configuration (`DB_ENCRYPTION_KEY` or `JWT_SECRET`) must remain stable across deployments.

Netlify build settings (public identifiers only): `VITE_META_APP_ID`, `VITE_META_CONFIG_ID`, and `VITE_META_GRAPH_VERSION=v25.0`.

Configure Facebook Login for Business / WhatsApp Embedded Signup for the deployed frontend domain. The configuration must grant `whatsapp_business_management` and `whatsapp_business_messaging`. The app must be authorized for the business being connected. The connection form supports standard Cloud API and WhatsApp Business app Coexistence. Coexistence still requires Meta account eligibility and a compatible Embedded Signup configuration; it does not migrate existing API numbers between businesses.

Webhook callback: `https://hotelogx-connect-backend-tkissahsva-ez.a.run.app/api/whatsapp/webhook`.
Set the same verification token in Meta and subscribe to the `messages` field on `whatsapp_business_account`. The backend subscribes the authorized WABA to the app during connection. Registration uses a six-digit PIN when the number is not already registered. Enter it in the connection form, never in source control or chat.

## Deploy

From `hotel-backend`:

```powershell
npm.cmd run test:whatsapp
if ($LASTEXITCODE -ne 0) { throw 'WhatsApp tests failed' }
npm.cmd run prisma:deploy
if ($LASTEXITCODE -ne 0) { throw 'Migration failed' }
npm.cmd run prisma:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed' }
```

After creating the two secrets and granting the Cloud Run runtime identity Secret Manager Secret Accessor, deploy with:

```powershell
.\scripts\setup-whatsapp.ps1 -AppId YOUR_APP_ID -AppSecretName YOUR_APP_SECRET_NAME -VerifyTokenSecretName YOUR_VERIFY_TOKEN_SECRET_NAME
```

These arguments are identifiers, not secret values. Rebuild the frontend in Netlify with its public Meta settings. The migration marks old connections unverified, clears placeholder phone IDs, and adds a unique real phone-ID constraint. Duplicate real phone IDs must be reviewed before migration; they are not silently assigned to a hotel. Reconnect previously saved WhatsApp accounts through Settings or onboarding after deployment.

## Behavior

Only authenticated managers may connect, inspect, disconnect, or send a test. Hotel context comes from the authenticated account. The backend verifies the token's app, validity, permissions, phone/WABA ownership, phone registration, and webhook subscription. Tokens are encrypted at rest and excluded from responses. A failed verification or database write cannot report a successful connection. One number can serve both purposes explicitly.

Incoming requests require the exact raw-body HMAC signature. Every message and status in each batch is processed. Routing uses the exact phone ID plus WABA, never a default hotel or a partial phone match. Webhooks await processing before returning 200; failures return 503 so Meta can retry. A database lease serializes processing across instances; durable receipt checkpoints prevent duplicate replies. No processing relies on promises running after Cloud Run returns a response.

Guest messages appear in Conversations. AI replies require Autonomous mode, enabled auto reply, a text message, and no human takeover or escalation. Internal messages appear in WhatsApp operations threads, where managers can send real replies; staff identity uses the exact saved international phone number. Unknown senders cannot change rooms or tasks. This change does not implement new task-card/Flow automation.

Provider acceptance is not delivery. The UI shows Meta acceptance and the last delivery receipt separately. Conversation reply IDs are mapped to provider IDs so delivery/read receipts update the message. Ambiguous sends remain `uncertain` in `WhatsAppReceipt` and are not automatically resent. Review the actual recipient history before manually replying; no exactly-once external delivery guarantee is claimed. Unsupported media is represented by a placeholder for staff review, without automatic AI replies.

Disconnect removes local authorization and stops routing/sending. It does not unsubscribe the entire WABA remotely, since the same WABA may contain other connected numbers.

## Live acceptance

1. Connect the intended hotel through Meta Embedded Signup. Confirm the UI displays Meta's actual phone number and verified status. Refresh and reload to confirm persisted state.
2. From a separate test phone, send a new text message to the business number. Confirm webhook 200, the new conversation, and an updated last-inbound time. For internal connections, check WhatsApp operations.
3. With AI disabled or in human takeover, verify no automatic reply. Reply from the conversation dashboard and verify actual receipt on the test phone and the delivery status.
4. Enable Autonomous mode for the test hotel if desired; send another text and verify exactly one AI reply and its conversation entry.
5. In Settings, enter the test phone explicitly and send a test reply. The recipient should have messaged the business within the customer-service window; otherwise use an approved template. Confirm recipient delivery, not only API acceptance.
6. Verify bad signatures fail, duplicate notifications do not duplicate messages, and reconnecting invalid credentials does not mark the hotel connected.

```powershell
gcloud.cmd logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=hotelogx-connect-backend AND httpRequest.requestUrl:whatsapp' --project=hotelogx --freshness=30m --limit=50 --format='table(timestamp,httpRequest.status,httpRequest.requestUrl)'
```

Automated tests mock Meta; passing tests do not establish live receipt or Meta app approval.

References: [Meta Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation), [Meta Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api), [Meta webhook signature verification](https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests).

## WhatsApp Business app Coexistence

In Settings > Connections > WhatsApp Business > Connect WhatsApp, choose **Keep my WhatsApp Business app (Coexistence)**, then **Continue with Facebook**. A number must already use the Business mobile app and pass Meta eligibility checks. An existing API-only number should use existing API credentials instead. Do not delete the mobile account or register it again as a workaround.

Before enabling customers, subscribe the Meta app's WhatsApp Business Account webhook to `messages`, `smb_message_echoes`, `history`, and `smb_app_state_sync`, preserving existing fields and the current verified callback. Meta app review/advanced permissions and the current Embedded Signup configuration must allow customer onboarding. The backend checks the webhook fields before accepting a Coexistence connection.

The frontend requests `whatsapp_business_app_onboarding` and accepts `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`. This event may contain only a WABA ID. The backend resolves a number only when exactly one eligible Coexistence phone exists in that authorized WABA; ambiguous accounts must supply the intended Phone Number ID through the manual form. The backend verifies `is_on_biz_app=true` and `platform_type=CLOUD_API`, skips `/register`, stores authorization, and requests contacts and history through `/smb_app_data` immediately. Standard connections are also checked for existing Business app sharing, so manual connections cannot accidentally re-register a Coexistence phone.

History/contact requests are claimed durably before the external call. A timeout or rejection is shown as `needs-review`; it is not blindly retried because these requests are one-time operations. A crash while requesting leaves `requesting` for operator review. Resolve failures promptly in Meta's onboarding sync window; reconnecting is not assumed to reset an already requested sync. `received` means a webhook batch arrived, not proof of complete historical coverage. A history-sharing refusal is shown as `not-shared`. Media is represented by a placeholder, not downloaded.

Phone replies are imported as outbound staff messages. They put the conversation into human takeover and cancel pending AI retries. New Coexistence conversations start in human takeover; staff can explicitly resume AI. Echoes are handled first within a webhook entry. A phone reply whose webhook arrives after an API reply was sent cannot recall that reply; simultaneous independent sending cannot be guaranteed duplicate-free. Duplicate echoes do not undo a later deliberate AI resume. Historical imports never trigger AI, add unread counts, grant staff access, or move the conversation timestamp backwards. Contact deletion removes the synced display name, not conversation records.

Live checks: connect an eligible Business app account; verify the number and Coexistence label; approve or decline history sharing and check the displayed status; send a guest message; reply in the phone app and confirm one outbound dashboard entry and human takeover; reply from the dashboard and verify phone delivery; explicitly resume AI and test a new guest message. Existing automated tests use mocked Meta responses, so successful live signup and delivery remain required.

References: [Meta Business app onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users), [Coexistence webhook payloads](https://docs.360dialog.com/partner/onboarding/whatsapp-coexistence/coexistence-webhooks).

To configure the webhook fields using the existing Secret Manager entries (requires permission to read them), run from `hotel-backend`:

```powershell
node scripts/configure-whatsapp-coexistence.mjs --app-id=1018045903953347
# Review the callback and fields, then apply:
node scripts/configure-whatsapp-coexistence.mjs --app-id=1018045903953347 --apply
```

The script preserves the callback and existing subscribed fields, keeps credentials in memory, and verifies Meta's resulting subscription. Deploy the backend before enabling the new fields. WhatsApp webhook bodies accept up to 10 MB; other API request limits are unchanged.
