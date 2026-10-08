# Phase 7 — devnet integration and recovery

Status: **software reconstructed; live completion gate pending**. The original local Phase 7 Git objects/files were unavailable after the workspace reverted. This branch rebuilds the implementation from the available checkpoint details on top of the verified Phase 6 remote commit. It restores both SQL migrations exactly from the connected Supabase migration history. The new commit supersedes the unavailable `f5f79bc` checkpoint; it is not a byte-for-byte recovery of that Git object.

## Implemented software

- Wallet screens cover escrow creation and deployment-bound acceptance, sequential milestone funding, private delivery commitments, approval, review-timeout claims, non-delivery refunds and disputes.
- Mutual settlement screens show exact client/freelancer allocations, proposal nonce, both approvals and whether future work will be cancelled. Fresh account state is reviewed before accepting or executing a proposal.
- Eligible primary/backup reviewers can resolve a dispute only between the original participants. Reviewer access is checked independently against the fresh chain clock and the original milestone version.
- Joint cancellation/revision packages verify the exact intended instruction, participant fee payer, first signature, blockhash and bounded expiry. Added transfer instructions or changed messages are rejected. Only future work can change; historical settled milestone terms remain immutable.
- Finalized snapshot reads verify devnet genesis, executable program, mint/config, immutable commitments and account ownership, historical milestone versions, vault balances/authority, settlement totals, sequencing and RPC freshness. Big integers remain strings in API responses.
- Service-only reconciliation writes immutable deployment bindings and slot-ordered caches. Slow snapshots cannot overwrite later finalized state. Existing deployment identities cannot be rebound. Database caches never authorize token movement.
- Durable history cursors backfill missed events in bounded pages across restarts, using compare-and-swap. Recorded transactions show network, obligation, fixed recipients and authenticated actual settlement splits. Other-program events and spoofed log messages are ignored.
- Signed transaction bytes are saved before broadcast and isolated by wallet/project. Recovery retries the same bytes/signature. Confirmed and finalized statuses stay distinct. An expired absent history result requires a fresh finalized snapshot before another signature.
- A secret-protected worker reconciles projects/history and optionally submits eligible review-expiry claims. The durable outbox wins before broadcast; losing concurrent workers discard their transaction. Saved claims recover after RPC outages or key rotation/removal. Omitting the worker key leaves manual claims available.
- Scripts prepare a matching deployment identity, pinned SBF build, devnet deployment, six-decimal TEST mint, config initialization, preflight, TEST minting, opt-in live workflow and standalone scheduler loop.

Original off-chain agreement acceptances are not token-transfer authorization. Both participants accept the deployment-bound commitment again on chain. Program checks enforce deadlines and payment rules.

## Recovery and verification

The migrations `20261008054824_phase7_reconciliation.sql` and `20261008060103_phase7_worker_hardening.sql` were recovered from Supabase's stored statements, without reapplying them or changing existing user data. Local database tests apply them after Phases 3 and 6 and check reconciliation permissions, immutable binding/deployment rules, stale-slot rejection and cursor concurrency.

Application tests cover wallet transaction recovery, wrong-network refusal, extra-instruction tampering, partial signatures/expiry, active vault verification, historical versions, stale RPC responses, log spoofing, scheduler authorization and durable/concurrent worker claims. **70 application tests**, lint, TypeScript and the production build passed during reconstruction. Run `npm run check` to repeat those checks.

Contract source and IDL are unchanged from the Phase 6 remote. The existing 18-test SBF runtime suite remains available through `npm run test:escrow` after compiling the program. Earlier recorded runtime results do not replace fresh verification of the reconstructed application. Live workflow tests are opt-in and have not run in this recovery session.

## Deployment steps

1. Copy `.env.example` to `.env.local` and restore the Supabase URL, publishable key and server-only service-role key. Never commit or share secrets.
2. Install Agave 2.3.0 with platform-tools v1.56 and the contract's pinned Rust toolchain. Set `DEPLOYER_KEYPAIR` to your local **funded devnet** keypair file. Deployment checks a one-SOL initial minimum, then estimates program rent and fee requirements. A larger balance may be needed.
3. Run `npm run deploy:devnet`. Generated program/mint/buffer keys are ignored by git. Back them up securely outside this workspace. A restart refuses missing identity keys rather than generating replacements. The script verifies devnet, deployed binary, upgrade authority, mint and config; public program/mint values are written to `.env.local` while other settings are preserved.
4. Review and commit the public Rust/Anchor/IDL identity changes and `contracts/devnet-deployment.json` after successful deployment. Rebuild/restart the app. Run `npm run devnet:preflight`.
5. Set `MINT_AUTHORITY_KEYPAIR` to the mint-authority keypair path and run `npm run mint:test -- WALLET_ADDRESS 1000` to provide TEST tokens to participants.
6. Run `npm run test:devnet` using the deployment signer that controls the TEST mint. It creates isolated synthetic wallets/project accounts, funds two sequential milestones, approves one, resolves a dispute split on the other and verifies finalized recovery/balances. It spends only devnet SOL and TEST tokens; it does not edit existing Supabase projects.
7. Run `npm run dev` and verify the authenticated client, freelancer and reviewer browser journeys, including reload/retry, joint packages and alternative settlement paths. Joint packages expire quickly; exchange them promptly or create a fresh package.

The deployment script needs `solana` and `cargo-build-sbf` on PATH; Anchor CLI is not required. `DEPLOY_CLI_RPC_URL` optionally provides a separate transport and is independently checked against devnet genesis. No deployment is attempted unless the signer and funding checks pass.

## Worker setup

Set a server-only random `CRON_SECRET` of at least 32 characters. Optionally set `CLAIM_WORKER_SECRET_KEY` to a separate devnet fee payer with SOL, as base58 or JSON secret-key bytes. Never prefix either with `NEXT_PUBLIC_`.

Start the app, then run `npm run worker`. It invokes the endpoint after each completed job plus a one-minute interval and resumes using persisted cursors/outbox records. A hosted scheduler can issue `GET /api/worker` with `Authorization: Bearer <CRON_SECRET>` over HTTPS. `WORKER_APP_URL` defaults to the local app. No Vercel schedule has been enabled.

Without a worker key, reconciliation and recovery of already signed claims still work; users retain manual claims. Claims need real submitted transactions, not an on-chain timer. Live timed-claim and outage/resume verification remains required.

## Remaining completion gate

No escrow deployment or TEST mint has been created by this recovery. The workspace lacks the local Supabase environment settings and a funded deployment signer. Phase 7 remains open until the full devnet/browser journey, missed-event recovery and worker outage/resume have recorded live results. Vercel deployment remains paused; user trials and submission assets follow in Phase 8.
