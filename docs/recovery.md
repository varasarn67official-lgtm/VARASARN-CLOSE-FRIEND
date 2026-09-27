# Deployment and recovery

Run `npm test` and `npm run build` before deployment. Vercel needs only `VITE_NEON_AUTH_URL` and `VITE_NEON_DATA_API_URL`; never expose database or OAuth secrets. Register each Vercel origin with Neon Auth and Data API CORS.

## Backups: automatic and manual

Every Neon project on this plan retains 6 hours of write-ahead log history automatically (`history_retention_seconds`, capped at 6 hours / 1 GB on the Free plan — already at the maximum here; verify with `neon projects get <project-id> --output json`). Neon's instant restore (point-in-time restore) can revert the production branch to any moment inside that window with no manual export step, so a backup covering the last 6 hours always exists without routine action. This is the "no manual action" recovery mechanism the release gate requires; it does not by itself satisfy a longer retention need.

For a checkpoint that outlives the 6-hour window — before every migration or cutover — also create a named snapshot, which Neon keeps until deleted:

```bash
npm run recovery:snapshot
neon snapshots list --branch production
```

If the project has reached its snapshot limit, create a separate branch from the current production state before migrating. Record the branch ID and parent LSN in the ticket, and retain that branch until the migration is verified. Keep this recovery branch inside the same owner-controlled Neon project; it contains production data.

**Access control:** both the 6-hour instant-restore window and named snapshots are scoped to the Neon project and require the same project-owner access as the production branch itself — there is no separate credential to manage, but anyone with project access can restore or read either. Keep project membership limited to owners for this reason.

Restore into an isolated Neon branch first, then verify catalog/review counts, Data API exposure, and authenticated access.

## Pausing cutover without losing writes

If cutover needs to pause or reverse, stop new writes to the live database before touching anything else, so a restore never races an in-flight write:

```bash
DATABASE_URL_UNPOOLED='postgresql://…?sslmode=require' npm run recovery:freeze
DATABASE_URL_UNPOOLED='postgresql://…?sslmode=require' npm run recovery:status   # confirm "paused": true
```

`recovery:freeze` revokes `authenticated`'s EXECUTE grant on every mutating `api` RPC (derived from the same `list_*`/`preview_*`/`current_access` naming convention `0001_security_api.sql` established, not a maintained list — see `scripts/api-write-classification.mjs`) while leaving every read RPC granted. The signed-in app keeps working read-only; every write attempt is denied at the database with `permission denied for function ...`. This is what makes "return to the old export read-only" concrete: the *new* database goes read-only in place, so returning to the old export never has to reconcile two systems that both accepted writes during the pause.

With writes frozen, any of the recovery paths above (instant restore or a named-snapshot restore) can proceed without a new write landing mid-restore. Once the incident is resolved:

```bash
DATABASE_URL_UNPOOLED='postgresql://…?sslmode=require' npm run recovery:unfreeze
DATABASE_URL_UNPOOLED='postgresql://…?sslmode=require' npm run recovery:status   # confirm "paused": false
```

`npm run test:pause-writes` (`scripts/verify-pause-writes.mjs`) exercises freeze/status/unfreeze on an isolated branch, including confirming a write is actually denied and a read still succeeds as the `authenticated` role, and that unfreeze restores the exact pre-freeze grant set.

## Free-tier terms and quotas

Re-check current Vercel eligibility and Neon quotas before launch. The Vercel Hobby plan is intended for personal, noncommercial work (confirmed against Vercel's published Hobby plan terms); choose an eligible plan before using this project for an organization or commercial service. If Vercel is unsuitable, deploy the Vite `dist/` output to another static host and register its origin in Neon.

Neon computes normally transition to idle after five minutes without activity and wake on the next request, typically within a few hundred milliseconds (confirmed against Neon's current Scale to Zero documentation; fixed and non-configurable on the Free plan). Test the first request after an idle period in the production-like release check.
