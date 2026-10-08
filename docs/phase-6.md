# Phase 6 — private evidence and operations

Implemented: private file/link evidence, reviewer evidence screens, in-app reminders, support notes, and transaction history with devnet explorer links. Vercel deployment remains paused. No escrow program is deployed; Phase 7 supplies the wallet payment flows and trusted chain reconciliation that populate live activity.

## Evidence workflow

Participants choose an immutable agreement version and milestone, add delivery/dispute evidence, and save a file or HTTPS link. Delivery evidence is reserved for the freelancer. Files go directly from the authenticated browser to the private `pactlance-evidence` bucket, not through the Next.js request body. The server downloads the reserved object, verifies its size and SHA-256 against the registered metadata, and atomically completes the record with a random salt, canonical manifest and domain-separated commitment. Saving evidence alone does not submit work or open an on-chain dispute.

Files are limited to 20 MiB: PDF, PNG, JPEG, MP4, ZIP or plain text. Browser clients cannot overwrite/delete objects or edit completed evidence. Paths use project/evidence UUIDs instead of filenames. Download URLs require authenticated Storage RLS and expire after 60 seconds; recipients should treat these temporary bearer URLs as private. Access changes cannot recall a file already downloaded. External links use HTTPS without embedded credentials; availability and sharing permissions remain with the provider. The server never fetches arbitrary link URLs.

A reservation expires after ten minutes. At most ten pending reservations per wallet are admitted during that window. Interrupted uploads require a new reservation after expiry. Pending rows/objects are retained; automated orphan cleanup and operational retention policies remain follow-up work. The prototype has no malware scanning or remote link availability verification.

## Access model

- Participants can read evidence for their own project and its historical versions.
- A reviewer can read only the exact agreement/evidence associated with a currently disputed assigned milestone. The primary reviewer has access before escalation; the backup has exclusive access at or after escalation.
- Reviewer access fails closed when verified chain cache data is older than two minutes or dated in the future. Phase 7 must keep that cache fresh. Browser clients cannot create or edit the cache or transaction events.
- Support membership must be assigned by an authorized server/database administrator. Support sees operational status and internal notes through a separately authenticated API. It grants no private-file access, agreement access, payment override, or reviewer authority.
- Outsiders and anonymous requests cannot read private evidence or create download links. Notification dismissal receipts belong only to the current user.

Support staff who separately participate in a project retain their participant permissions. No support account was enrolled automatically.

## Operations interface

Project detail now includes milestone evidence and scoped activity. The main workspace includes reminders, transaction history, an assigned review queue and a support view for authorized staff. Reviewers see agreed scope, acceptance criteria, evidence and escalation eligibility. Reminder keys change with milestone state and deadline boundaries so dismissing one stage does not hide later stages. Times inform users; they do not settle escrow automatically.

The activity tables are intentionally empty until trusted Phase 7 reconciliation writes verified on-chain state and events. The UI does not fabricate payment confirmations. Reviewer settlement signing, mutual allocation screens, transaction submission/recovery and scheduled/manual claims remain Phase 7 integration work.

## Database setup

`supabase/migrations/20261008045813_phase6_evidence_operations.sql` creates six RLS-protected tables, private authorization helpers, a service-only atomic completion function, the private bucket and append-only Storage policies. It was applied to the connected Pactlance Supabase project using the plugin. Existing projects, agreement versions and acceptances were preserved (1 project, 4 versions, 3 acceptances at verification).

Fresh deployments should apply all repository migrations in order. This phase requires the same Supabase public configuration and server-only service key as Phase 3; it adds no environment variable. Keep the service key out of browser configuration.

## Verification

- 43 application tests pass, including real PostgreSQL RLS tests in PGlite with Storage table fixtures.
- New coverage includes participant/outsider/support isolation; primary/backup handoff; stale and settled reviewer revocation; exact-version access; append-only file policies; service-only completion; hash mismatch and replay rejection; private reminder receipts; canonical commitments; bounded inputs; authenticated download signing; and cross-origin mutation rejection.
- TypeScript, ESLint and the Next.js production build pass. An incompatible restored Turbopack cache was moved aside before rebuilding.
- Live Supabase checks confirm all six tables have RLS, the bucket is private with a 20 MiB limit, and browser roles cannot rewrite evidence, complete it directly, or self-enroll as support.
- Supabase security advisors reported no table/function security issues. The existing password-auth configuration warning is unrelated to the wallet-only sign-in path: [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Authenticated browser upload/download and assigned-review journeys have not been demonstrated in this workspace: `.env.local` is absent. The role, API and database tests are not a claim of full browser or devnet verification. Configure local variables as in Phase 3, sign in, open a project, save evidence, then test downloads from both participants and denial from an unrelated wallet. Reviewer journeys need a verified disputed chain fixture supplied by the Phase 7 integration; do not hand-edit browser cache data as payment proof.

Run `npm run check` to reproduce application checks. Contracts are unchanged by Phase 6; their earlier native and SBF runtime verification remains recorded in Phase 5.
