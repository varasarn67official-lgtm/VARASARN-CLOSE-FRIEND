# Production cutover gate

Run `bash scripts/release-gate.sh` against the production branch. It intentionally exits nonzero until the owner records the following external evidence:

1. Fresh live spreadsheet export with reconciled course/review counts and relationships.
2. Neon recovery snapshot and an isolated-branch restore exercise.
3. Two-account browser tests: Google sign-in, protected reads, anonymous reviews, owner/admin permissions, proposals, lifecycle, moderation, and private timetable.
4. Vercel deployment URL and rollback decision.

Do not point a production domain at the replacement application until every item is recorded in Ticket 16. Keep the prior export read-only during cutover and stop writes before choosing rollback.
