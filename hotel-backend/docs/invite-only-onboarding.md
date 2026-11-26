# Invite-only Hotelogx One onboarding

Implemented locally on 26 November 2026. Deployment and a live Netlify invitation acceptance test are still required. This controls application accounts and hotel data; the public login and access-request pages remain visible.

## Flow

1. A prospective hotel submits **Request access** on `/login`. This saves a `HotelAccessRequest` in Neon. It does not create a user, issue a session, send email or grant access. Repeated requests for an email do not overwrite the original record.
2. A trusted Hotelogx operator approves the hotel using the script below. It creates the hotel with incomplete onboarding and manual AI mode, and a pending `HotelOnboardingInvite` containing hotel ID, normalized email, manager name, role, approver and expiry. `manager` is the application's hotel-administrator role. Hotel managers cannot approve new tenants.
3. The operator sends the same address an invitation from the configured Netlify Identity dashboard. Set the invitation path to `/login`. Netlify emails carry `#invite_token=...`; links landing at the app root are forwarded to login while preserving the fragment. Do not put tokens in query strings or logs.
4. The login page calls `handleAuthCallback()`, asks for a password, and calls `acceptInvite()`. Tokens are not saved in application onboarding records. The Identity SDK manages its own session cookies.
5. Cloud Run validates the Identity bearer session by calling `GET https://<configured-site>/.netlify/identity/user`. It requires a verified email and an active approval. The hotel and role come exclusively from Neon, never browser claims, user-editable metadata or request fields.
6. An atomic transaction attaches the Identity ID/issuer to the approved user and consumes the invitation. Repeated sign-ins reuse that exact mapping. Unknown identities, mismatched emails, expired/revoked approvals, cross-hotel accounts and role conflicts fail closed.
7. Hotelogx loads the approved hotel profile before opening the existing onboarding wizard. Managers complete the profile and connect Mews, email, WhatsApp, knowledge and staff as appropriate. Completed hotels go to their dashboard.

## Deployment

1. Apply the additive migration against the intended Neon database: from `hotel-backend`, run `npm run prisma:deploy`. New migration: `20261126010000_invite_only_identity`.
2. Generate Prisma Client with `npm run prisma:generate`, then deploy Cloud Run with `NETLIFY_IDENTITY_SITE_URL=https://YOUR-CANONICAL-SITE`. Use only an HTTPS origin, without a path, credentials or query. This must be the same site serving the browser's Identity service. Missing configuration denies Identity access; there is no permissive fallback.
3. Deploy the frontend. `hotel-frontend/netlify.toml` enables `VITE_NETLIFY_IDENTITY_ENABLED=true` and Node 22. If build settings override these values, set them in Netlify too. Keep the existing `VITE_API_BASE_URL` pointing at Cloud Run and its frontend CORS allowlist correct.
4. Keep Netlify Identity registration **Invite only**, set its site URL to the canonical app origin, and configure the invitation email path as `/login`. Test on that HTTPS origin; a normal Vite localhost server and independent deploy-preview domains do not automatically provide the production Identity endpoint.
5. Deploy backend and frontend together: old public signup is now always denied with HTTP 403, including when Identity configuration is absent. There is no public-signup environment switch.

The Netlify SDK is `@netlify/identity`. Browser login does not grant hotel access without the independent Neon approval. [Netlify's invitation and callback documentation](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/get-started/) describes the callback and password-acceptance steps.

## Operator approval

Run only from a trusted operator environment with the intended database configured. The script uses the backend's existing environment loader. Do not give its database credentials to hotel managers or expose it as a public endpoint.

```powershell
cd hotel-backend
node scripts/manage-hotel-access.mjs list
node scripts/manage-hotel-access.mjs approve approval.json
```

Example `approval.json` for a new hotel:

```json
{
  "email": "manager@example.com",
  "name": "Hotel Manager",
  "hotelName": "Example Hotel",
  "approvedBy": "operator@example.com"
}
```

For an existing hotel, provide its exact `hotelId` instead of `hotelName`. Linking an existing manager account additionally requires `"linkExistingUser": true`; the account must already belong to that hotel with the manager role and must not have another Identity ID. A known email alone never migrates an account automatically. Invitations default to 14 days; an explicit future ISO `expiresAt` can be supplied.

The command prints the approved hotel ID and invitation ID, then instructs the operator to send the Netlify invitation. It deliberately does not send email or store a Netlify operator token. A failed Netlify send leaves the pending record available for the operator to send the correct invitation later. Existing approvals are never silently overwritten. Expired/revoked approval records require operator review in Neon before reissuing; do not clear accepted mappings to move someone between hotels.

To revoke an unaccepted approval:

```powershell
node scripts/manage-hotel-access.mjs revoke manager@example.com
```

This revokes only pending onboarding permission. It does not disable a previously accepted account. Disable/delete the corresponding Identity account and remove its application User access when offboarding an accepted administrator, following your account-retention policy.

## Existing users and sessions

- Existing users retain their IDs, hotel profiles, roles and stored password hashes. They choose **Existing hotel or staff account** at login. Authorized manager-to-staff invitations remain available through the existing hotel invitation workflow; they cannot create new tenants publicly.
- New Netlify administrators have no local password hash and cannot use legacy password login. Development/demo password bypasses have been removed: existing users must use their actual password.
- Approved migration of an existing manager preserves the local password. Disabling Netlify alone therefore does not remove that manager's legacy access; remove application access as well when offboarding.
- Identity admission issues a 30-minute Hotelogx JWT. API renewal revalidates a current Identity session; the legacy refresh endpoint cannot extend Identity-issued JWTs. Revoking Identity may leave an already-issued application JWT usable until its expiry (up to 30 minutes). Deleting the application user blocks subsequent authenticated requests immediately. Existing legacy sessions retain their previous lifetime.
- Signing out clears the application session and asks the Identity SDK to sign out too. Backend access always requires an application session; Identity cookies alone grant no hotel access.
- Onboarding writes are manager-only. Loading `/onboarding` anonymously cannot create an account or hotel. Invitation and access-request endpoints include a bounded per-instance request limit; for multi-instance production abuse protection, configure the platform's shared rate limits too.

## Validation and release check

Run `node --test src/tests/identityAdmission.test.js src/tests/staffInvitation.test.js`, Prisma validation/generation, and frontend `npm run lint` / `npm run build`.

Before rollout, use a controlled test hotel/email to check: approved invitation acceptance; the correct hotel in the wizard; repeated login without duplicate users; unapproved Netlify identity denied; expired/revoked approval denied; public `/api/auth/register` denied; anonymous onboarding denied; existing manager and staff login; Identity session renewal; and sign-out. Local tests do not send real invitations or apply production migrations.
