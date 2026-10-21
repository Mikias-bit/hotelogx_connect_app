# IMAP ingestion and SMTP replies

## Old/new comparison

| Area | Old backend | Hotel-backend before this port | Implemented |
| --- | --- | --- | --- |
| Connections | IMAP login and SMTP verify | IMAP-only/partial tests could still save success | Both authenticated over verified TLS before atomic save |
| Credentials | Encrypted adapter credentials with environment/demo fallbacks | Shared password in accessToken; TLS certificate checking disabled for SMTP | Separate encrypted IMAP/SMTP passwords, separate optional usernames, no demo credentials or plaintext fallback |
| Incoming mail | UID polling with UIDVALIDITY, limited batches | Only latest messages, swallowed errors, body-based cross-tenant deduplication | Ordered UID batches, mailbox/UIDVALIDITY-scoped identity, durable receipts, retry cursor |
| Replies | SMTP with optional RFC headers | Conversation IDs could be used as RFC IDs | Stored inbound Message-ID, stable outbound Message-ID, accepted-recipient checks |
| Recovery | Cursor stays on processing failure | Sync could report success after failure | Transactional AI checkpoints, pending work resumes even after source deletion, uncertain SMTP send requires reconciliation |
| Scheduling | Worker polling support | Optional in-process timer | Cloud Scheduler OIDC worker with shared database lease across Cloud Run instances |
| UI | Separate old onboarding | Password was omitted and Settings test was simulated | Real test-and-connect in onboarding and Settings; failure never marks connection complete |

The implementation retains the new backend's hotel IDs, Neon database, AI policies,
conversation dashboard and realtime updates. Gmail and Microsoft stay on their own
ingestion paths. All providers share the hotel mailbox lease for safe connection changes.

## Credential and connection behavior

Use an internet-accessible IMAP/SMTP provider, e.g. Hostinger/Titan or another provider
that offers these protocols. Use the provider's actual server names and an app password
if required. Some providers only offer IMAP on certain plans; local desktop bridges
are not reachable from this Cloud Run deployment.

- IMAP: 993 with TLS, or 143 with mandatory STARTTLS.
- SMTP: 465 with TLS, or 587 with mandatory STARTTLS.
- Certificates must validate for the supplied hostname. Plaintext and self-signed
  connections are not accepted.
- Default username is the mailbox address. Separate IMAP/SMTP usernames and passwords
  are supported in the manual form.
- Public DNS addresses are checked and pinned for each connection; internal/metadata
  endpoints and DNS rebinding cannot receive the mailbox credentials.
- Connection checks authenticate both servers but do **not** send a test email.
  SMTP authentication does not establish inbox delivery; test that separately after setup.
- Only a hotel manager can save credentials. Failed checks leave the current connection
  untouched. A mailbox cannot belong to two hotels.
- New passwords use the existing AES-256-GCM token encryption utility and are never
  returned by API status or saved in browser local storage.
- Keep the existing encryption key stable (`DB_ENCRYPTION_KEY`, or existing
  `JWT_SECRET` fallback). Do not introduce a different key without migrating the
  already-encrypted Gmail/Microsoft tokens and other credentials.

The new schema stores IMAP/SMTP passwords in dedicated columns. Existing legacy
IMAP connections must be verified once again in the UI before polling/sending.
The migration does not delete legacy credentials; successful re-verification moves
them to the encrypted dedicated columns and clears accessToken.

One guest mailbox is supported per hotel. Disconnect the current provider before
switching; use a separate test hotel to preserve the working Gmail connection.

## Ingestion and retries

New connections capture UIDVALIDITY/UIDNEXT during verification, so only mail
arriving afterward enters automated processing. This avoids replying to old inbox mail.
Re-entering credentials for the same mailbox preserves any existing retry cursor.

Each poll reads up to 50 new messages in UID order, capped at 50 MB of source data
per batch (20 hotels per worker request).
It uses read-only INBOX access and does not change Seen flags. A failed batch does
not advance its UID cursor. Completed receipts prevent repeats, and pending AI or
send work resumes from the database even when the provider message is gone.

If UIDVALIDITY changes, the cursor resets to the new UID space. A persisted recovery
boundary suppresses automated replies to the recovered backlog across multiple batches.
New mail after that boundary can auto-reply. Provider UID reset recovery can import
previously seen historical messages for review; UID identity is not reused across resets.

Self-sent, draft/deleted, and automated/list mail are skipped or routed to review.
Existing autoReply=false/human-takeover/escalation rules still apply. A 25 MB source
message limit bounds MIME memory use; oversized or malformed messages retain the
cursor and require operator review instead of being silently discarded.

SMTP success means the server accepted the recipient and message. Delivery may still
bounce later. SMTP does not universally save sent mail to an IMAP Sent folder; this
implementation does not append a second copy there. Use the provider's delivery logs
or other delivery evidence to reconcile an uncertain result. A network timeout after
DATA might already have sent the message, so the worker does not blindly resend it.

Manager-authenticated endpoints:

- `POST /api/email/test-connection`: validate and save both servers.
- `POST /api/email/imap/sync`: sync this hotel's mailbox.
- `GET /api/email/imap/deliveries`: pending/uncertain receipts.
- `POST /api/email/imap/deliveries/:id/confirm-sent` with `{"confirmedSent":true}`.
- `POST /api/email/imap/deliveries/:id/retry` with `{"confirmedNotSent":true}`.
- `GET /api/email/status`: verification/sync errors, no passwords.
- `POST /api/email/disconnect`: remove the stored connection credentials.

The generic onboarding save endpoint cannot replace credentials or settings without
verification. It only acknowledges an already connected mailbox.

## Deploy from Hotel-backend (PowerShell)

```powershell
npm.cmd run test:imap
if ($LASTEXITCODE -ne 0) { throw 'IMAP tests failed' }
npm.cmd run prisma:deploy
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
npm.cmd run prisma:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed' }
.\scripts\setup-imap-ingestion.ps1
```

Migration `20261021010000_imap_ingestion` adds credential/cursor columns and the
`ImapInboundMessage` table, plus a case-insensitive IMAP mailbox uniqueness index.
If existing duplicates cause the index to fail, review the duplicate hotel bindings;
the migration deliberately does not delete either one automatically.

The setup script deploys the current source, creates `imap-worker-v2` and an
authenticated `imap-poll-v2` Scheduler job running every minute. It only updates:

```text
IMAP_WORKER_AUDIENCE=https://hotelogx-connect-backend-tkissahsva-ez.a.run.app
IMAP_WORKER_SERVICE_ACCOUNT=imap-worker-v2@hotelogx.iam.gserviceaccount.com
```

It preserves existing Cloud Run secret references and Gmail/Microsoft settings.
No new Pub/Sub topic, subscription, or Cloud Tasks queue is required for IMAP.
Keep `EMAIL_POLLING_ENABLED=false` when using Scheduler.

Push the changed `hotel-frontend` files and deploy Netlify. The manual settings form
now performs a real connection check rather than showing a simulated success toast.

## Acceptance test

1. In a separate test hotel, choose Other provider/advanced IMAP and SMTP setup.
2. Enter both server settings and credentials; select Test and connect.
3. Verify `/api/email/status` reports `mailVerifiedAt`, `ingestionReady=true`.
4. Send a new enquiry from another mailbox. Within the polling interval plus
   processing time, verify a reply and a conversation in the app.
5. Run the job twice without new mail; confirm there is no duplicate reply.
6. Verify an incorrect password fails without changing the saved connection.

```powershell
gcloud.cmd scheduler jobs run imap-poll-v2 --project=hotelogx --location=europe-west4
gcloud.cmd logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="hotelogx-connect-backend" AND httpRequest.requestUrl:imap-poll' --project=hotelogx --freshness=20m --limit=30 --format='table(timestamp,httpRequest.status,httpRequest.requestUrl)'
```

Automated verification: `npm.cmd run test:imap` mocks external servers;
`npm.cmd run test:imap:database` creates and removes a disposable Neon schema and
does not touch public application data or send emails.

References: https://imapflow.com/docs/api/imapflow-client/ and https://nodemailer.com/smtp
