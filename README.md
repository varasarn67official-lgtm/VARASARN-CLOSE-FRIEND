# Varasarn Close Friends

Vue 3 application for authenticated course discovery and anonymous reviews.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set the following browser-safe values in `.env.local`:

```dotenv
VITE_NEON_AUTH_URL=https://your-branch.neonauth.region.aws.neon.tech/neondb/auth
VITE_NEON_DATA_API_URL=https://your-branch.apirest.region.aws.neon.tech/neondb/rest/v1
```

The database connection string belongs only in `DATABASE_URL`. Keep it out of any `VITE_` variable and Vercel’s browser environment.

## Database migrations

Drizzle owns the typed schema in `db/schema.ts` and migration history in `db/drizzle/`.

```bash
npm run db:generate
DATABASE_URL_UNPOOLED='postgresql://…?sslmode=require' npm run db:migrate
```

`0000_initial_review_tracer.sql` creates the private tables. `0001_security_api.sql` enables row-level security, removes table grants, and exposes only the anonymous catalog/review RPCs. Configure Neon Data API to expose `api` only; do not expose `app_private` or `neon_auth`.

## Owner bootstrap and administrator access

`0002_owner_and_admin_access.sql` keeps role memberships and their audit trail private. Only the project owner can call the grant, revoke, member-list, and verified-account-list RPCs. The database trigger accepts a role membership only for a non-banned, email-verified Google account.

After Google OAuth is configured, the intended project owner must sign in once. A database owner retrieves the verified Google account UUID with:

```sql
SELECT u.id, u.name, u.email
FROM neon_auth."user" AS u
JOIN neon_auth.account AS a ON a."userId" = u.id AND a."providerId" = 'google'
WHERE u."emailVerified" AND NOT u.banned
ORDER BY u.email;
```

The database owner then runs [db/bootstrap-owner.sql](db/bootstrap-owner.sql), replacing its UUID placeholder with that selected account ID. This one-time database-owner action creates the only owner role and its audit record; no browser email or environment variable can bootstrap ownership.

## Neon and Vercel release setup

1. Create an owner-controlled Neon project and enable Managed Better Auth.
2. Enable Google as the sole sign-in provider. Disable email/password, OTP, magic-link, phone, and every other provider in Neon.
3. Configure the Google redirect URI supplied by Neon and add the Vercel preview and production origins as trusted origins.
4. Apply the Drizzle migrations with a database-owner connection, then refresh Neon Data API’s schema cache.
5. Configure Neon Data API with `api` as its only exposed schema and the Vercel origins as allowed CORS origins.
6. In Vercel, set `VITE_NEON_AUTH_URL` and `VITE_NEON_DATA_API_URL` for Preview and Production. Do not add `DATABASE_URL` to the frontend deployment.
7. Deploy a preview and test Google sign-in, session refresh, sign-out, the seeded `JC100` offering, review creation, duplicate rejection, and anonymous review visibility using two Google test accounts.

## Verification

```bash
npm test
npm run build
npm run preview
```

`npm run build` type-checks and bundles; it does not prove the bundle boots. `npm run preview` serves the built `dist/` output exactly as a static host would (no dev-server transforms), so it is the production-like build check: confirm it loads the sign-in screen with no console errors before every release.
