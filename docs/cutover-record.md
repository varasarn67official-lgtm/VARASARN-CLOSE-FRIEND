# Production cutover record

Complete this record only after `npm run release:gate` passes its automated checks.

| Item | Evidence |
| --- | --- |
| Fresh spreadsheet export timestamp and checksum | Pending |
| Course and review source counts | Pending |
| Imported database counts and unmatched rows | Pending |
| Recovery snapshot / isolated restore branch | `snap-wispy-river-b3otmaob`; restored and verified on `br-damp-king-b33kw7dp` |
| Two-account authorization checks | Pending |
| Deployed Google sign-in and idle-resume checks | Pending |
| Vercel deployment target and activation time | Pending |
| Rollback decision and old export location | Pending |

Do not activate the production deployment until every row has an owner-recorded value.
