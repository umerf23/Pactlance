# Pactlance

Milestone payment protection for Pakistani freelancers and overseas clients.
Previously called FreelancePay in the planning documents.

## Current status — Phase 2

Working Next.js development preview with a two-milestone project, agreement outline,
shared TypeScript models, integer amount helpers, tests and CI. The Anchor scaffold
contains a signed `ping` instruction and settlement arithmetic unit tests only.
**No wallet authentication, real escrow, token transfers, Supabase backend or devnet deployment exists yet.**

## Run the web application

Install Node.js from `.nvmrc` (24.19.0), then:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. No credentials are required for the preview.
Copy `.env.example` to `.env.local` when beginning the integrations; never commit secrets.

```sh
npm run check       # ESLint, TypeScript, unit tests, production build
npm run doctor      # Reports missing development tools; nonzero if any are missing
npm run test:program # Native Rust unit tests; Rust 1.90.0 required
```

## Structure

- `src/app/`: Next.js App Router and health endpoint.
- `src/components/`: responsive project preview.
- `src/lib/`: shared models, sample data, token units and configuration validation.
- `tests/`: TypeScript foundation tests.
- `contracts/`: Anchor workspace, pinned versions and native tests.
- `docs/`: product scope, Phase 1 specification and setup/validation notes.
- `.github/workflows/ci.yml`: web and native program checks.

## Solana development

See `docs/development.md`. Anchor 0.32.2 and Solana 2.3.0 are the selected baseline.
The client uses `@anchor-lang/core` with web3.js v1. The program's committed address
is a scaffold identifier, **not a deployed address**. Generate local keys and run
`anchor keys sync` before building/deploying. Keep keypair files untracked.

Native `cargo test` does not prove that SBF builds or validator integration work.
`anchor build` and local-validator transaction tests are separate gates.

## Full scope retained

Projects contain multiple sequential milestones, with one active funded milestone
at a time and a distinct vault per milestone. Later phases add wallet authentication,
both-party agreement acceptance, deposits, private delivery, release, timeout claims,
non-delivery refunds, mutual settlement/cancellation, disputes, primary/backup
reviewers, history, reminders, reconciliation and support views.

TEST tokens are only for devnet demonstrations. PKR cash-out and card funding are
later work. Frontend eligibility helpers are presentation logic, never authority
to move money. All payment rules must ultimately be enforced by the program.

## Next phase

Phase 3: wallet sign-in, authenticated project membership, versioned agreements,
private database policies and role-based dashboards. Refer to the original blueprint
and Phase 1 workbook in `docs/` before changing product scope.
