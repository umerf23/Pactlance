# Pactlance

Milestone payment protection for Pakistani freelancers and overseas clients.
Previously called FreelancePay in the planning documents.

## Current progress

Wallet sign-in, profiles, private projects and immutable multi-milestone agreements are implemented. The Solana escrow contract and client support sequential funding, separate vaults, delivery commitments, approval, review-timeout claims, non-delivery refunds, disputes, exclusive primary/backup reviewer authority, mutual allocations, cancellation and jointly accepted revisions of future work.

The contract is verified locally. Payment screens, private evidence workflows and devnet integration are later phases; no escrow deployment exists yet. Vercel deployment is paused.

- [Phase 3 setup and verification](docs/phase-3.md)
- [Phase 4 escrow verification](docs/phase-4.md)
- [Phase 5 settlement rules and verification](docs/phase-5.md)

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

## Verify escrow

With Agave 2.3.0 installed:

```sh
cargo-build-sbf --tools-version v1.56 --manifest-path contracts/programs/pactlance/Cargo.toml -- --locked
npm run test:escrow
```

The runtime suite executes the compiled program and SPL Token instructions in LiteSVM, including adversarial settlement and deadline cases. It fails when the binary is absent. This is local runtime verification; it does not establish devnet or production readiness.

The committed program ID is a local-test identifier. Before deployment, generate your own keypair and update the Rust declaration, Anchor configuration and IDL together. Keep private keys untracked. Phase 5 changes account layouts; reset old local ledgers.

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

A project has multiple sequential milestones, one active funded milestone at a time, and a distinct vault per milestone. Remaining phases add private delivery/evidence access, reviewer and support screens, reminders, history, deployment, chain reconciliation and recovery, then user trials and submission assets.

Prototype tokens are labelled TEST tokens. Real funds, PKR cash-out and card funding are later work. Database caches and frontend eligibility helpers cannot authorize token movements. The Solana program enforces payment rules; claims need an actual transaction submitted by a user or worker.
