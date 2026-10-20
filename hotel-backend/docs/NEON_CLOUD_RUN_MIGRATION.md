# Phase 1: PostgreSQL / Neon and Cloud Run

This phase retains the Hotel backend's ES modules, string hotel IDs, feature modules,
and frontend API contracts. It adopts the original backend's PostgreSQL connection
conventions and Cloud Run deployment foundation. It is not a wholesale replacement
of the operational domain model with the original backend's numeric-ID schema.

## Configuration

- `DATABASE_URL`: Neon pooled PostgreSQL URL for runtime connections.
- `DIRECT_DATABASE_URL`: direct PostgreSQL URL for Prisma migrations.
- `BACKEND_BASE_URL`: `https://hotelogx-connect-backend-tkissahsva-ez.a.run.app`.
- `FRONTEND_BASE_URL`: primary frontend origin; comma-separated additional origins
  are accepted. `CORS_ORIGINS` adds development or alternate origins.
- Original `GOOGLE_OAUTH_*` and `MICROSOFT_OAUTH_*` settings are supported, with the
  Hotel backend's older variable names retained as fallbacks.
- `JWT_SECRET` and integration encryption keys must be supplied through runtime
  secrets. Preserve existing encryption keys for existing encrypted records.
- `EMAIL_POLLING_ENABLED=true` enables the transitional in-process poller. It is
  disabled by default: do not rely on an in-process timer on request-only Cloud Run
  instances. Pub/Sub, scheduled workers and subscription renewal are later phases.

Registered callback URLs supported by this phase:

- `/api/email-integrations/google/callback`
- `/api/email-integrations/microsoft/callback`
- Existing `/api/email/oauth/google/callback` and Microsoft equivalent remain valid.
- `/api/webhooks/whatsapp/:hotelId` aliases the current WhatsApp webhook handlers.
  They resolve the tenant from the provider integration, not the old numeric URL ID.
  Existing integration credentials must be migrated before these callbacks are usable.

Frontend production configuration uses the Cloud Run host with `/api` appended.
Local development can use `VITE_API_LOCAL_URL=http://localhost:5000/api`.

## Database preparation

Use a separate empty database/branch for validation first. The original backend uses
different table names, relationships and numeric IDs. Its database contents do not
automatically become compatible with this schema. The initial migration creates
the Hotel application's schema; it does not convert legacy data or MySQL data.

1. Install dependencies with `npm ci`.
2. Set both database URLs for the intended validation database.
3. Run `npm run prisma:validate` and `npm run prisma:deploy`.
4. Run the integration tests only against that disposable test database. Existing
   tests write/delete fixtures; never point them at the live hotel's database.
5. Plan and validate a separate data migration if existing records must be retained.

Do not use `prisma db push` or reset against the live Neon database. No database
migrations are run by application startup or by the Docker build.

## Cloud Run

Build from the `hotel-backend` directory using its `cloudbuild.yaml`. It retains the
original service `hotelogx-connect-backend`, Artifact Registry repository
`hotelogx-connect`, and region `europe-west4`. Build images use Cloud Build's BUILD_ID.
The final build step updates that existing service; running this pipeline is a live
deployment, so validate migrations, secrets and frontend compatibility first.

The service update preserves existing Cloud Run environment/secrets configuration.
Inspect that configuration before release: the new schema and encryption settings
are not necessarily compatible with the old service's data. Roll back the container
revision separately from database changes; never assume a schema rollback is automatic.

No Pub/Sub or Microsoft subscription endpoints are added in phase 1. Do not switch
live email delivery to this revision until those capabilities have been ported.
Knowledge files currently use local storage; durable storage must be addressed before
relying on uploaded files across Cloud Run instance replacement.
