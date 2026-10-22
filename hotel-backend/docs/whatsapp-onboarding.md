# Real WhatsApp onboarding and messaging

## Configuration

Backend Cloud Run settings:

- `META_APP_ID`: the app that owns the Embedded Signup configuration.
- `META_APP_SECRET`: Secret Manager reference, never a frontend variable.
- `META_WEBHOOK_VERIFY_TOKEN`: a private randomly generated verification value, also configured in Meta's webhook screen.
- `META_GRAPH_VERSION=v25.0`: pin a version supported by your Meta app.
- Existing token encryption configuration (`DB_ENCRYPTION_KEY` or `JWT_SECRET`) must remain stable across deployments.

Netlify build settings (public identifiers only): `VITE_META_APP_ID`, `VITE_META_CONFIG_ID`, and `VITE_META_GRAPH_VERSION=v25.0`.

Configure Facebook Login for Business / WhatsApp Embedded Signup for the deployed frontend domain. The configuration must grant `whatsapp_business_management` and `whatsapp_business_messaging`. The app must be authorized for the business being connected. This implementation supports standard Cloud API onboarding; coexistence/migration-specific flows need their own onboarding configuration and are not simulated.

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
