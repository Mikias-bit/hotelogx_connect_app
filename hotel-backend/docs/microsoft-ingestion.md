# Microsoft 365 / Outlook ingestion

## Comparison and implementation

The old backend supplied `MicrosoftOAuthService`, `MicrosoftGraphEmailAdapter`,
`MicrosoftPollingService`, `MicrosoftGraphWebhookService`, and
`MicrosoftGraphSubscriptionService`. The new backend previously had OAuth,
latest-inbox fetching, and send/reply calls, but no durable Graph notification,
subscription, or delta processing flow.

This port keeps the new backend's string hotel IDs, encrypted tokens, Neon models,
AI policies, and conversation dashboard. It adds:

- Authenticated manager-only OAuth; signed provider-specific state, offline access,
  no mailbox stealing between hotels, and a case-insensitive mailbox uniqueness index.
- Six-day Graph inbox subscriptions, lifecycle notifications, renewal within 48 hours
  of expiry, and remote subscription cleanup on disconnect/provider replacement.
- A durable `MicrosoftSyncJob` record before Cloud Tasks dispatch. Webhooks validate
  `clientState` and return 202 only after dispatch succeeds. Graph's validation token
  is echoed immediately as plain text. No background promises depend on Cloud Run
  continuing to execute after a response.
- OIDC-authenticated Cloud Tasks workers and scheduled fallback polling. Duplicate
  notifications serialize with the existing hotel mailbox database lease.
- Full paginated delta sync with immutable Graph IDs. A cursor commits only when
  every fetched message succeeds. Failures retain it; pending receipts survive
  message deletion. Expired cursors recover the inbox without retroactive replies.
- Durable AI checkpoints and tenant/mailbox/message deduplication. Replies use the
  inbound Graph message ID, not its conversation ID. A rejected send can retry;
  a timeout or ambiguous 5xx requires Sent Items reconciliation before another send.
- On initial connection, historical mail is imported for staff review; mail received
  after connection can auto-reply. Existing integrations without a connection date
  need an initial review-only baseline. Reauthorization preserves cursors.

The old adapter's result limit could truncate a delta round. This port reads every
page. The old webhook did long processing inline; this port queues it. The existing
new backend's reply-to-sendMail fallback could send twice; it has been removed.
No IMAP/SMTP migration is included in this change.

## Microsoft app registration

Use your existing Microsoft Entra app and its existing Cloud Run secret references
`MICROSOFT_OAUTH_CLIENT_ID` and `MICROSOFT_OAUTH_CLIENT_SECRET`.
Register this **Web** redirect URI:

`https://hotelogx-connect-backend-tkissahsva-ez.a.run.app/api/email-integrations/microsoft/callback`

Delegated permissions: `openid profile email offline_access User.Read Mail.Read Mail.Send`.
Use an account type supporting the mailboxes you intend to connect. For both work/
school and personal Outlook accounts, enable both in Entra and use tenant `common`.
An organization's administrator may need to consent to delegated permissions.
This uses the signed-in user's mailbox, not application-wide mailbox access.

## Validate, migrate, and deploy (PowerShell from Hotel-backend)

```powershell
npm.cmd run test:microsoft
if ($LASTEXITCODE -ne 0) { throw 'Microsoft tests failed' }
npm.cmd run prisma:deploy
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
npm.cmd run prisma:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed' }
```

Migration `20261021000000_microsoft_ingestion` adds columns and Microsoft receipt/job
tables; it does not delete application data. Duplicate Microsoft mailbox bindings,
if present, deliberately fail the unique-index migration and require review.

Configure Cloud Tasks, a dedicated worker identity, Scheduler jobs, and deploy:

```powershell
.\scripts\setup-microsoft-ingestion.ps1
```

The script defaults to project `hotelogx`, Cloud Run/Scheduler region `europe-west4`, service
`hotelogx-connect-backend`. It preserves existing Gmail settings and all secret
references. It creates queue `microsoft-inbound-v2`, worker identity
`microsoft-worker-v2`, and these jobs:

- `microsoft-fallback-poll-v2`: every five minutes.
- `microsoft-subscription-renew-v2`: every six hours.

Your signed-in gcloud user must have permission to configure IAM, Cloud Tasks,
Scheduler, and deploy Cloud Run. No service-account key file is needed.

Ordinary environment variables (not secrets):

```text
MICROSOFT_GRAPH_NOTIFICATION_URL=https://hotelogx-connect-backend-tkissahsva-ez.a.run.app/api/webhooks/email/microsoft/notifications
MICROSOFT_TASK_QUEUE=projects/hotelogx/locations/europe-west1/queues/microsoft-inbound-v2
MICROSOFT_WORKER_AUDIENCE=https://hotelogx-connect-backend-tkissahsva-ez.a.run.app
MICROSOFT_WORKER_SERVICE_ACCOUNT=microsoft-worker-v2@hotelogx.iam.gserviceaccount.com
```

Without Cloud Tasks configuration, webhook delivery returns 503 and persists work
for retry; fallback polling can still synchronize mail. It is not immediate push
delivery until the queue, IAM, and worker configuration are in place.

## End-to-end acceptance

Push the changed `hotel-frontend` files to GitHub and let Netlify rebuild before
testing. Its Microsoft button now starts real OAuth (the previous consent dialog
was simulated), and callback handling verifies the connected mailbox with the server.

1. Sign in as the hotel manager and connect Microsoft in onboarding/settings.
   The application currently supports one guest mailbox provider per hotel;
   connecting Microsoft to the Gmail hotel replaces that hotel's Gmail connection.
   Use a separate test hotel to retain the working Gmail connection.
2. Check authenticated `GET /api/email/status`: Microsoft connected,
   `ingestionReady=true`, future `watchExpiresAt`, no `watchError`.
3. Send a new enquiry from another mailbox. Check webhook 202, worker 200,
   the reply in Outlook Sent Items and the sender's inbox, and the conversation.
4. To distinguish push from fallback, temporarily pause only
   `microsoft-fallback-poll-v2`, send another new enquiry, then resume it.
5. Trigger `microsoft-subscription-renew-v2`; verify success and expiry extension.

```powershell
gcloud.cmd logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="hotelogx-connect-backend" AND httpRequest.requestUrl:microsoft' --project=hotelogx --freshness=20m --limit=50 --format='table(timestamp,httpRequest.status,httpRequest.requestUrl)'
```

## Delivery reconciliation

Manager-authenticated endpoints, scoped to the signed-in hotel:

- `GET /api/email/microsoft/deliveries`: pending/uncertain receipts.
- `POST /api/email/microsoft/deliveries/:id/confirm-sent` with
  `{"confirmedSent":true}` after verifying the actual reply in Sent Items.
- `POST /api/email/microsoft/deliveries/:id/retry` with
  `{"confirmedNotSent":true}` only after confirming it was not sent.
- `POST /api/email/microsoft/subscription`: register/renew manually.
- `POST /api/email/sync/microsoft`: synchronize manually.

Confirmation lets the next sync complete pending work and advance its cursor.
There is no claim of exactly-once external email delivery: ambiguous provider
responses require reconciliation rather than automatic duplicate sends.

## Tests and references

`npm.cmd run test:microsoft` uses mocked external calls; no real emails.
`npm.cmd run test:microsoft:database` creates and removes a disposable schema in
the designated `hotelogx_connect_v2` test database and never migrates public tables.

- https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks
- https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events
- https://learn.microsoft.com/en-us/graph/delta-query-messages
- https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0
- https://cloud.google.com/tasks/docs/creating-http-target-tasks

Cloud Tasks uses `europe-west1` by default because `europe-west4` is not a
supported Cloud Tasks location. Override it with `-TasksRegion`; `-Region`
controls Cloud Run and Scheduler. The deployment sets `MICROSOFT_TASK_QUEUE`
to the selected Tasks region automatically.
