# Gmail ingestion on Cloud Run

The port uses the existing PostgreSQL/Neon schema, string hotel IDs, encrypted
OAuth tokens, current conversation/AI engine, and tenant-scoped SSE. No new npm
dependencies are required.

## Behavior

- `GoogleWorkspaceEmailAdapter` traverses every history page, reads nested MIME
  bodies, refreshes credentials through `gmailClient`, filters outbound and
  self-sent mail, and implements watch/stop/provider operations.
- `GmailPubSubService` decodes the envelope and resolves exactly one connected
  mailbox. Notifications are hints: their history IDs never become checkpoints.
- `GmailPollingService` retries durable pending work, processes every fetched
  page, then advances `EmailIntegration.historyId` only after complete success.
  Any provider, persistence, automation, or delivery failure retains the cursor
  and produces a non-2xx push response. Page size is not a total-message cap.
- `GmailWatchService` registers on OAuth, renews expiring watches, and stops before
  disconnect. Renewal does not overwrite history. Reauthorizing the same Gmail
  account also preserves history. Watch failures are visible in `/api/email/status`
  and are retried by the scheduler.
- `GoogleOidcVerifier` verifies Google's RSA signature, issuer, expiry, audience,
  service-account identity and verified-email claim. Missing configuration fails
  closed. Worker requests use a separate authorized service account.
- A PostgreSQL lease prevents concurrent processing across Cloud Run instances.
  It expires after 15 minutes if a worker dies; normal work has an 8-minute budget.
  Pending receipts, tenant/mailbox/message IDs, and transactional AI checkpoints
  prevent duplicate ingestion and repeated completed automation.
- New OAuth connections start at the profile cursor captured during authorization.
  An expired/missing cursor triggers a paginated full inbox recovery. Recovery
  mail is imported for staff review without sending retroactive automatic replies.
  Automated/list mail also goes to staff review without automatic replies.
- Incoming messages use Gmail threads within each hotel/mailbox. They do not create
  artificial PMS reservations. Existing AI policies decide approval/escalation;
  `AiConfig.autoReply=false` prevents automated sends.

This ports Gmail transport and ingestion, not the old backend's entire automation
engine. It uses Hotel-backend's existing AI rules and answer generation. Review
those rules before enabling autonomous replies.

## Database changes

Migration: `prisma/migrations/20261018000000_gmail_ingestion/migration.sql`.
Adds `watchExpiresAt` and `watchError`, `GmailMailboxLock`, `GmailInboundMessage`,
and a partial unique index preventing the same Gmail mailbox from belonging to
two hotels (case-insensitive). It does not remove existing data. If duplicate
Google integrations exist, explicitly resolve ownership before migrating:

```sql
SELECT lower("email"), count(*) FROM public."EmailIntegration"
WHERE "provider" = 'google' GROUP BY lower("email") HAVING count(*) > 1;
```

The partial expression index is maintained by SQL migration; Prisma's schema
cannot represent it. Use `prisma migrate deploy`, not `db push`, for deployments.

From `Hotel-backend`, with the saved Neon URLs in `.env`:

```powershell
npm.cmd run prisma:deploy
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
npm.cmd run prisma:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed' }
```

Run migration before deploying the new code. Keep the current DATABASE_URL,
DIRECT_DATABASE_URL, JWT_SECRET and OAuth credentials as Secret Manager bindings.
The migration has been tested in a disposable schema; it is not automatically
applied to your application's `public` schema by this port.

## Google Cloud setup

The Pub/Sub topic must be in the Google Cloud project owning the Gmail OAuth
client. The commands below assume that is `hotelogx`. Verify that assumption in
Google Cloud Console before running. These commands create dedicated v2
resources; they do not alter an old backend's subscriptions.

Run each block from `Hotel-backend`, checking that each command succeeds.
Creating resources with an existing name returns ALREADY_EXISTS; inspect the
existing resource instead of deleting it.

```powershell
$GmailProject = 'hotelogx'
$GmailRegion = 'europe-west4'
$GmailService = 'hotelogx-connect-backend'
$GmailBase = (gcloud.cmd run services describe $GmailService --project=$GmailProject --region=$GmailRegion --format='value(status.url)').Trim()
if ($LASTEXITCODE -ne 0 -or !$GmailBase) { throw 'Cannot resolve backend URL' }
$GmailProjectNumber = (gcloud.cmd projects describe $GmailProject --format='value(projectNumber)').Trim()
$GmailPushAccount = "gmail-push-v2@$GmailProject.iam.gserviceaccount.com"
$GmailWorkerAccount = "gmail-worker-v2@$GmailProject.iam.gserviceaccount.com"
$GmailTopic = "projects/$GmailProject/topics/gmail-inbound-v2"
$GmailSubscription = "projects/$GmailProject/subscriptions/gmail-inbound-v2-push"

gcloud.cmd services enable gmail.googleapis.com pubsub.googleapis.com cloudscheduler.googleapis.com --project=$GmailProject
gcloud.cmd iam service-accounts create gmail-push-v2 --project=$GmailProject
gcloud.cmd iam service-accounts create gmail-worker-v2 --project=$GmailProject
gcloud.cmd pubsub topics create gmail-inbound-v2 --project=$GmailProject
gcloud.cmd pubsub topics add-iam-policy-binding gmail-inbound-v2 --project=$GmailProject --member='serviceAccount:gmail-api-push@system.gserviceaccount.com' --role='roles/pubsub.publisher'

# Allow the Pub/Sub service agent to mint the push identity token.
gcloud.cmd iam service-accounts add-iam-policy-binding $GmailPushAccount --project=$GmailProject --member="serviceAccount:service-$GmailProjectNumber@gcp-sa-pubsub.iam.gserviceaccount.com" --role='roles/iam.serviceAccountTokenCreator'
gcloud.cmd run services add-iam-policy-binding $GmailService --project=$GmailProject --region=$GmailRegion --member="serviceAccount:$GmailPushAccount" --role='roles/run.invoker'
gcloud.cmd run services add-iam-policy-binding $GmailService --project=$GmailProject --region=$GmailRegion --member="serviceAccount:$GmailWorkerAccount" --role='roles/run.invoker'
```

The deploying account needs permission to act as these service accounts when
creating the subscription and Scheduler jobs. Cloud Scheduler's service agent
must retain its standard `roles/cloudscheduler.serviceAgent` role.

Deploy source while preserving all existing secret bindings:

```powershell
$GmailSettings = @(
  "GOOGLE_PUBSUB_TOPIC=$GmailTopic"
  "GOOGLE_PUBSUB_SUBSCRIPTION=$GmailSubscription"
  "GOOGLE_PUBSUB_AUDIENCE=$GmailBase"
  "GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT=$GmailPushAccount"
  "GMAIL_WORKER_AUDIENCE=$GmailBase"
  "GMAIL_WORKER_SERVICE_ACCOUNT=$GmailWorkerAccount"
) -join ','

gcloud.cmd run deploy $GmailService --source . --project=$GmailProject --region=$GmailRegion --timeout=900 --update-env-vars=$GmailSettings
if ($LASTEXITCODE -ne 0) { throw 'Backend deployment failed' }
```

Do not pass JWT_SECRET, DATABASE_URL, DIRECT_DATABASE_URL or OAuth secrets as
literal environment variables. `--update-env-vars` above only adds the nonsecret
Gmail settings. Existing polling configuration is preserved; a Cloud Run timer is
not relied upon for Gmail. Scheduler provides the fallback polling.

```powershell
gcloud.cmd pubsub subscriptions create gmail-inbound-v2-push --project=$GmailProject --topic=$GmailTopic --push-endpoint="$GmailBase/api/webhooks/email/google/pubsub" --push-auth-service-account=$GmailPushAccount --push-auth-token-audience=$GmailBase --ack-deadline=600 --min-retry-delay=10s --max-retry-delay=600s --message-retention-duration=7d

gcloud.cmd scheduler jobs create http gmail-watch-renew-v2 --project=$GmailProject --location=$GmailRegion --schedule='0 4 * * *' --time-zone='Etc/UTC' --uri="$GmailBase/api/workers/email/gmail-watch/renew" --http-method=POST --oidc-service-account-email=$GmailWorkerAccount --oidc-token-audience=$GmailBase --attempt-deadline=600s
gcloud.cmd scheduler jobs create http gmail-fallback-poll-v2 --project=$GmailProject --location=$GmailRegion --schedule='*/5 * * * *' --time-zone='Etc/UTC' --uri="$GmailBase/api/workers/email/gmail-poll" --http-method=POST --oidc-service-account-email=$GmailWorkerAccount --oidc-token-audience=$GmailBase --attempt-deadline=600s

# Register watches for already-connected mailboxes without reconnecting them.
gcloud.cmd scheduler jobs run gmail-watch-renew-v2 --project=$GmailProject --location=$GmailRegion
```

Do not leave another old subscription/worker actively processing the same Gmail
mailbox. Inspect and retire the old subscription after confirming the v2 path;
do not delete shared Pub/Sub topics or OAuth credentials.

References: [Gmail push setup and renewal](https://developers.google.com/workspace/gmail/api/guides/push),
[Gmail history recovery](https://developers.google.com/workspace/gmail/api/guides/sync),
[authenticated Pub/Sub push](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions).

## Verify activation

1. Sign in as Hotel A's manager and connect Gmail for **Hotel A**. A mailbox
   owned by another hotel must first be disconnected by that hotel's manager;
   the callback no longer silently steals another hotel's connection.
2. `GET /api/email/status` with the application's Bearer token should show the
   expected mailbox, a future `watchExpiresAt`, `ingestionReady: true`, and no
   `watchError`. `lastSyncAt` changes only after a complete sync.
3. Send a new test message from a different mailbox. Verify the conversation in
   the app and the rows below. Approval/escalation policies can prevent replies.
4. Confirm Cloud Run's push POST returns 204. A 401 means invalid push identity;
   503 can mean missing OIDC configuration or a busy mailbox; 500 means processing
   failed and Pub/Sub must retry. Check Scheduler's execution logs too.

```sql
SELECT "hotelId", "email", "historyId", "watchExpiresAt", "lastSyncAt",
       "lastError", "watchError"
FROM public."EmailIntegration" WHERE "provider" = 'google';

SELECT "hotelId", "providerMessageId", "status", "replyStatus", "lastError"
FROM public."GmailInboundMessage" ORDER BY "createdAt" DESC LIMIT 20;
```

Manager-only endpoints: `POST /api/email/gmail/watch`, `POST /api/email/gmail/watch/stop`,
`GET /api/email/gmail/deliveries`. Stop pauses ingestion and renewal until OAuth
reconnection. Disconnect calls Gmail stop before deleting credentials; if stop
fails, credentials remain available to retry.

## Ambiguous outbound sends

Gmail sending and the database cannot commit atomically. If the send response is
lost, the receipt remains `sending`/`uncertain`. On retry the processor searches
Sent Mail for the deterministic `Message-ID` and records delivery if found. If
not found it retains the history cursor and does not blindly resend.

Use `GET /api/email/gmail/deliveries` as the hotel manager, inspect Sent Mail, and
only if the message was definitely not sent, POST
`/api/email/gmail/deliveries/RECEIPT_ID/retry` with
`{"confirmedNotSent":true}`. The next sync retries delivery. An explicit provider
rejection retries automatically. Monitor pending deliveries and push failures;
an unresolved delivery intentionally blocks that mailbox's cursor.

## Tests

```powershell
node --test src/tests/gmailIngestion.test.js src/tests/postgresFoundation.test.js src/tests/staffInvitation.test.js
```

`gmailDatabase.test.js` is opt-in and refuses to run unless the URL points to a
schema named `gmail_test_<hex>`. It verifies migrations, lease contention,
rollback, deduplication, delivery retry, recovery, actual AI persistence, and HTTP
routes. All Gmail/AI provider calls are mocked or disabled in that suite. Run `npm.cmd run test:gmail:database` to create and remove that disposable schema
in `hotelogx_connect_v2` using your local `.env`. This never runs against the
application tables.
