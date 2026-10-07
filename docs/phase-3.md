# Phase 3 — Identity and project agreements

Implemented: wallet-standard connection, Supabase Solana Web3 sign-in with SSR sessions, private participant dashboards, display names, multi-milestone project editing, immutable agreement versions, two independent Ed25519 acceptances and historical signatures. Agreements preserve scope, acceptance criteria, amounts in integer token units, ordered deadlines, primary and backup reviewers, review and escalation periods, fee rules and revision policy.

## Backend activation

1. Apply every SQL file in `supabase/migrations` in filename order to the project's Supabase database. The migration creates new tables; use a new project or review existing schema conflicts first.
2. Enable Solana Web3 authentication in Supabase Auth. Allow the exact production site origin, plus localhost for local development. Avoid allowing arbitrary preview origins.
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (legacy anon key is also supported), and `SUPABASE_SERVICE_ROLE_KEY` in the server environment. The service-role key must never use a `NEXT_PUBLIC_` prefix or be committed.
4. Redeploy after setting public build-time variables.
5. Open `/workspace` with two separate wallet/browser sessions. Each signs in, sees the same project, reviews every milestone and signs the same version. Revise a draft and verify that the new version has no acceptances while old signatures remain in history. A third wallet must see no project.

The app reports that setup is incomplete when backend credentials are absent. It does not simulate an authenticated session or successful save.

## Authorization and integrity

Server authentication uses verified `getUser()` identities, never editable user metadata. RLS independently derives the wallet from the authenticated Web3 identity. Only the client and freelancer can read project terms; only the owner can read/write their profile. Anonymous reads and direct authenticated project mutations are denied. Server-only mutation functions use row locks and expected versions to reject stale writes. The API requires same-origin JSON requests and enforces a 128 KiB body limit.

Agreement commitments use a versioned canonical JSON encoding, SHA-256 and a random 32-byte salt. Acceptance signatures bind the site origin, devnet, project, version and commitment. The server verifies the Ed25519 signature against the authenticated wallet. Old versions are retained and their signatures cannot accept a new version. No participant can change the other participant's address through revisions.

## Verification

`npm run check` runs lint, TypeScript, Vitest and production build. Tests cover canonical commitments, signature tampering across all bound fields, multiple milestones, decimal precision, invalid deadlines and identities. PGlite executes the actual SQL migration with PostgreSQL roles and RLS, checking participant/outsider isolation, profile ownership, denied direct mutations, historical versions, duplicate acceptance, stale acceptance and locked revisions.

Hosted two-wallet end-to-end verification remains pending until Supabase is provisioned and configured. PGlite tests exercise database policies but do not replace that hosted Auth integration check.

## Phase boundary

These are off-chain test agreements. No funds are moved. The token mint and escrow program are deliberately unset, and the signed message explicitly requires fresh acceptance once those addresses are specified. Phase 4 adds the on-chain program and acceptance/funding transaction flow, with one separate vault per milestone and only one active funded milestone. No reduction to a one-milestone project model has been made.

## Hosted backend status

The Pactlance Supabase project was created in `ap-south-1` on the Free plan. Both migrations are applied, all five tables have RLS enabled, and the hosted security advisor reports no findings. Internal authorization helpers are in the non-exposed `private` schema with anonymous execution explicitly revoked. Dashboard authentication setup and Vercel environment configuration remain pending.
