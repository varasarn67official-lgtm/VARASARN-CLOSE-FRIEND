# Deploy the rebuilt app to the existing Vercel project

Target project: https://vercel.com/varasarn67/varasarn-close-friend
Repository: varasarn67official-lgtm/VARASARN-CLOSE-FRIEND
Production origin: https://varasarn-close-friend.vercel.app

Google login browser recovery and the optional same-origin Auth endpoint are
documented in [auth-browser-recovery.md](auth-browser-recovery.md). Enable the
endpoint on a preview and complete its real-device acceptance before release.

## Preview first

The release branch is `codex/rebuilt-app-cutover`. It preserves the original repository history and imports application source from `EverydayImcalculating/varasarn-friends-test` commit `c84b6d6`, plus the existing synthetic importer test fixtures and test updates. Vercel configuration specifies Vite, `npm ci`, `npm run build`, `dist`, and the SPA rewrite.

1. Confirm this project is connected to the repository above, root directory is the repository root, and Production tracks `main`.
2. Set `VITE_NEON_AUTH_URL` and `VITE_NEON_DATA_API_URL` to the existing production Neon endpoints in Preview and Production. These are browser configuration values. Never add a database password or `DATABASE_URL` as a browser variable. Reuse the already migrated database; do not rerun imports or create a replacement database.
3. Allow the preview origin and exact production origin in Neon Auth trusted origins and Data API CORS configuration.
4. Deploy the release branch as Preview and verify Google sign-in, catalog, reviews, and account timetable against the intended database.
5. Resolve the outstanding release evidence in `docs/cutover-record.md` before merging into `main`, which can trigger production deployment.

## Activate and verify

Serve the rebuilt application directly at the exact old HTTPS origin. A redirect to another hostname cannot read the old origin's localStorage. In the preserved browser profile, sign in with the original account and verify TU109 and JC232 recovery, persistence after reload, and no duplicates on a repeat visit. Preserve the original browser storage.

The legacy review import and schedule backfill are already completed in the existing production database according to the source workspace release report. This code change performs no database migration or import.

## Rollback

The old repository tip is `c40a9ba15ff2e515262bcc501165c653de6c3ffb`. Keep the existing Vercel production deployment available for rollback. Record its deployment ID before activation. If rollback becomes necessary, follow `docs/cutover-record.md` and the recovery procedure, accounting for writes made after cutover. Reverting frontend code does not reverse database writes.
