# Pactlance

Milestone payment protection for Pakistani freelancers and overseas clients.
Previously called FreelancePay in the planning documents.

## Current progress

Wallet sign-in, profiles, private projects and immutable multi-milestone agreements are implemented. The Solana escrow contract and client support sequential funding, separate vaults, delivery commitments, approval, review-timeout claims, non-delivery refunds, disputes, exclusive primary/backup reviewer authority, mutual allocations, cancellation and jointly accepted revisions of future work.

CI verifies the contract in native tests and LiteSVM. Private evidence uploads/links, reviewer evidence screens, in-app reminders, support notes and transaction history are implemented. Phase 7 payment/settlement screens, joint signatures, finalized chain reconciliation, missed-event recovery, a durable claim worker and deployment tooling are implemented. The devnet program, TEST mint and upgrade authority were independently read at finalized slot 509137571 on 9 October 2026. The app is hosted at https://pactlance.vercel.app/. Full browser-wallet settlement, wallet compatibility, live recovery and observed user trials remain pending. Phase 8 validation and submission preparation is in progress.

CI baseline: [`44e487d`](https://github.com/umerf23/Pactlance/actions/runs/37909740880) passed all three jobs, including 18 SBF/LiteSVM cases. See [audit remediation and verification matrix](docs/audit-remediation.md) for the current patch, evidence and limits. This is not an independent security audit or a claim of production readiness.

- [Phase 3 setup and verification](docs/phase-3.md)
- [Phase 4 escrow verification](docs/phase-4.md)
- [Phase 5 settlement rules and verification](docs/phase-5.md)
- [Phase 6 evidence and operations](docs/phase-6.md)
- [Phase 7 recovery, deployment and remaining live verification](docs/phase-7.md)
- [Phase 8 usability, validation and deferred test checklist](docs/phase-8.md)
- [Architecture and trust boundaries](docs/architecture-and-trust.md)
- [Demo and submission outline](docs/demo-script.md)

## Run the application

Use Node.js 24.19.0 from `.nvmrc`:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Configure `.env.local` from `.env.example` and follow the Phase 3 instructions for wallet authentication and the Supabase backend. Never commit secrets.

```sh
npm run check        # ESLint, TypeScript, application tests, production build
npm run test:program # Native Rust tests; Rust 1.90.0
```

## Apply the audit hardening checkpoint

Apply `supabase/migrations/20261009094002_audit_api_limits.sql` to the matching Supabase project **before** deploying this checkpoint. The shared API limiter fails closed with HTTP 503 when its database function is unavailable. Review the migration and rollout steps in [the audit report](docs/audit-remediation.md). No hosted schema or app changes are automatically applied by local tests.

## Verify escrow

With Agave 2.3.0 installed:

```sh
cargo-build-sbf --tools-version v1.56 --manifest-path contracts/programs/pactlance/Cargo.toml -- --locked
npm run test:escrow
```

The runtime suite executes the compiled program and SPL Token instructions in LiteSVM, including adversarial settlement and deadline cases. It fails when the binary is absent. This is local runtime verification; it does not establish devnet or production readiness.

The committed program ID and public manifest record the user's devnet deployment. The Rust declaration, Anchor configuration and IDL share that identity. Keep the matching private keys backed up and untracked; a clone does not contain deployment authority. Use `npm run deploy:devnet` only with the matching local identities, or a fresh checkout without the existing manifest for a separate deployment. Phase 5 changes account layouts; reset old local ledgers.

## Repository

- `src/app/`, `src/components/`: application and APIs.
- `src/lib/agreements/`: terms, commitments and agreement signatures.
- `src/lib/escrow/`: verified account decoding and instruction builders.
- `contracts/`: Anchor contract, generated IDL and native tests.
- `tests/`: application/client tests.
- `integration/`: SBF/SPL Token runtime tests.
- `supabase/`: database migrations.
- `docs/`: blueprint, phase specifications, setup and verification.
- `.github/workflows/ci.yml`: web, native contract and runtime checks.

## Full project scope

A project has multiple sequential milestones, one active funded milestone at a time, and a distinct vault per milestone. The remaining Phase 7 gate is complete end-to-end devnet and recovery verification. Phase 8 covers usability, recorded user trials and submission assets; unfinished tests remain on the final checklist.

Prototype tokens are labelled TEST tokens. Real funds, PKR cash-out and card funding are later work. Database caches and frontend eligibility helpers cannot authorize token movements. The Solana program enforces payment rules; claims need an actual transaction submitted by a user or worker.
