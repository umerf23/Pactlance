# PAP explicit devnet payments

## What this adapter enforces

PAP's workflow remains a trusted off-chain service. Structured evidence, review windows, revisions, cancellation conditions and declarative rules are evaluated by the server. `PAYMENT_PENDING` is eligibility; the agreed automatic timeout policy never creates an automatic token transfer in this adapter. A client must explicitly authorize a payment, both parties must authorize a mutual allocation, or the currently eligible reviewer must sign a dispute allocation. The program cannot establish that a deliverable objectively satisfies subjective criteria, or verify a Supabase decision. This is not trustless execution of all PAP rules.

PAP binds the complete terms to `schemaVersion: 3` and `paymentProfile: pap_explicit_v1`, the configured devnet program, and the six-decimal TEST mint. Both wallets separately accept this bound commitment on chain. Existing off-chain signatures are retained and do not replace those on-chain acceptances. The payment profile is distinguished from legacy escrow with `ProjectTerms.review_seconds = 0`. Legacy create/revise instructions reject zero. PAP create/revise require zero. Legacy submit/approve/timer claim/non-delivery refund instructions reject PAP accounts. Existing Project, Milestone and EscrowConfig layouts and their discriminators remain unchanged. Existing legacy escrows retain their prior behavior.

PAP uses the existing project/milestone/vault PDAs and SPL Token transfers. Each funded milestone stores its version/hash and amount. A freelancer publishes the hash of the complete server-verified delivery selection; a resubmission replaces that hash and invalidates pending settlement proposals. Client approval must name the exact currently published hash. Only the original freelancer receives that payout. Settlements conserve the recorded obligation, exclude vault donations, preserve nonce/replay protection and enforce the exclusive primary/backup handoff. PAP disputes can be locked on chain after a deadline because funds do not auto-release from a timer.

An off-chain dispute alone is not an on-chain lock: a participant must confirm **Lock the PAP dispute on chain**. Until that transaction finalizes, the application's workflow can block its own buttons but cannot prevent direct transactions outside the app. The same distinction applies to off-chain cancellation/amendment consent. Financial authority comes from the chain's signatures and state. Both-party settlement is an explicit new financial agreement and can resolve an allocation differently from an earlier off-chain decision. History records the actual finalized allocation without silently rewriting earlier terms or decisions.

## Verified payment completion

The existing finalized snapshot validates the program/config/mint, canonical terms, milestone accounts, sequencing, vault identities and recorded settlement totals. The server then independently checks a successful finalized transaction's `MilestoneSettled` event from the expected program/project against that account's exact allocation. Only then does the centralized PAP reconciliation enter `PAID` (positive freelancer payout) or `REFUNDED` (full client refund). It stores the signature, slot, time and exact allocation in execution and appends a payload-bound, idempotent audit event through the existing CAS RPC. Failed, pending, missing or unverifiable transactions never mark a milestone paid. A reconciliation race requires a fresh read rather than overwriting newer execution.

The legacy claim worker skips PAP at both batch and per-project boundaries. No scheduler holds a participant/reviewer key for this adapter. The upgrade authority can still change the program, and the server is trusted for private evidence and workflow rules.

## Operator rollout

This branch prepares an upgrade; it does not establish that the hosted devnet program contains this code. Keep `PAP_PAYMENTS_ENABLED=false` until these gates pass.

Local verification on 2026-10-09 passed the application production build, 132 application/database cases, eight native contract cases and 24 actual SBF/LiteSVM cases. The reviewer-access migration was applied to the existing hosted Pactlance database and verified: anonymous execution remains denied and agreement/execution/history RLS remains enabled. The hosted migration history records it as `20261009180141_pap_payment_reviewer_access`; its checked-in source was generated locally as `20261009174010`. Do not reapply it to that database under a different timestamp. No devnet program upgrade or browser-wallet payment was performed by this verification.

1. Review source, IDL, this compatibility statement, and the exact commit. Preserve the existing deployment/mint/authority backups. A clone contains no authority keys.
2. Run `npm run check`, `npm run test:program`, compile with pinned Agave 2.3.0/platform-tools v1.56, then run `npm run test:escrow`. Do not change dependencies or use an older platform Rust to get a build through. The application, database and actual SBF tests include legacy compatibility and adversarial PAP payment paths.
3. Review and explicitly authorize the narrow migration `supabase/migrations/20261009174010_pap_payment_reviewer_access.sql` for the intended Supabase project. It retains exclusive reviewer reads while their allocation awaits payment and removes that access after PAID/REFUNDED reconciliation. Apply it before enabling payment UI for reviewer decisions. The existing `programmable_agreements` migration must already be installed.
4. Explicitly authorize the existing devnet program upgrade. On the operator's computer, configure `DEPLOYER_KEYPAIR` as the existing local authority path and ensure the public program/mint environment values match `contracts/devnet-deployment.json`. Keep these local files out of Git. With the matching toolchain on PATH, run:

   ```sh
   npm run upgrade:pap:devnet -- --upgrade
   ```

   Without `--upgrade`, this command only prints instructions. With the flag it verifies both RPC genesis hashes, manifest and deployed authority, compiles the source, upgrades the existing program if necessary, compares finalized deployed bytes/authority, and initializes the version-1 `pap-capability` PDA with the upgrade-authority signature. It never generates replacement program/mint identities or rotates the mint. It writes public results to `validation-results/pap-upgrade.json`. Do not use the older initial-deployment script to upgrade this program.

5. Run the explicitly requested synthetic program journey with `npm run test:pap:devnet`. This spends devnet fees and mints TEST with the configured authority. It records public finalized signatures in `validation-results/pap-devnet-workflow.json`. It uses generated signers and synthetic hashes; it does not prove the browser/Supabase journey. A failed run remains `in_progress`.
6. Set server-only `PAP_PAYMENTS_ENABLED=true` in the intended local/preview environment and rebuild. The backend also checks the owned capability PDA at finalized commitment; the env flag alone cannot make the old contract compatible. Test the preview before enabling the production environment and deploying/promoting the reviewed commit.
7. Complete the browser run below with independent wallets. Preserve exact signatures/balance deltas and record passed/failed/blocked outcomes. Only claim live completion after actual observations.

Upgrade rollback needs review: never downgrade the program to legacy-only code while PAP funds remain locked. Disabling `PAP_PAYMENTS_ENABLED` hides app payment preparation and retains terms/history, but does not revoke existing chain authority. Keep a compatible manual recovery procedure available for funded projects. Do not drop history tables or rewrite agreed hashes.

### Deployment upload expiry

If compilation succeeds but `Data writes to account failed` follows repeated `Blockhash expired` messages, the upgrade is not verified. Keep `PAP_PAYMENTS_ENABLED=false`. The upgrade script reuses `contracts/deploy-keys/buffer-keypair.json` and the existing program identity on retry; preserve those files. It sends through RPC with 20 blockhash retries and a priority fee of 10,000 micro-lamports per compute unit, following [Solana's deployment guidance](https://solana.com/docs/programs/deploying#deployment-flags). This can improve transaction inclusion but does not guarantee that a delayed or restricted RPC will deliver uploads.

Use the devnet RPC endpoint that worked for the original deployment, or a dedicated provider's devnet endpoint, for local `DEPLOY_CLI_RPC_URL`. Avoid blindly repeating the same failing transport. The script checks both the verification RPC and deployment RPC against devnet genesis before any deployment. Keep provider API keys in the ignored `.env.local`; do not put them in Git or share the full endpoint. Then rerun `npm run upgrade:pap:devnet -- --upgrade`. Continue to the synthetic test only after the script verifies finalized deployed bytes, authority and PAP capability.

## Two-wallet browser run

1. Sign in with separate client and freelancer profiles. Create and jointly sign/activate a fresh PAP agreement. In the payment workspace review profile, version, both identities, program/mint and bound commitment. Create escrow and independently accept deployed terms with both wallets.
2. Client funds milestone 1 with exact TEST units. Confirm finalized funding before treating the work as financially protected. The next milestone cannot be funded simultaneously.
3. Freelancer saves all required private delivery evidence, refreshes selections, selects it for each deliverable, and submits it in Agreement execution. Status becomes UNDER_REVIEW. In the payment workspace, publish that validated delivery with the freelancer wallet.
4. Client requests a permitted revision; freelancer resubmits and publishes the new delivery hash. An old hash cannot be paid through the PAP approval instruction. Revisions do not reset the off-chain review clock.
5. Client accepts the work. Refresh chain status; the payment action appears only for matching accepted delivery, version and client identity. Confirm **Approve and pay freelancer** in the devnet wallet. The pending signed transaction is persisted before broadcast and recovered under the same signature.
6. Refresh finalized chain status after confirmation. The server backfills/validates the settlement event and updates the protocol timeline with PAID and the finalized signature. Verify the freelancer's exact token balance delta. A second attempt must not create another payout.
7. On separate projects, exercise missing evidence, wrong wallet, timeout human review (no timer payout), dispute lock, primary/backup allocation, both-party partial/full refund, cancellation, completed-term amendment rejection and two-signature future-work revision. Record the allocation decision off-chain before the reviewer executes that exact allocation on chain; the chain's reviewer clock remains authoritative. If submitted delivery was never published before its chain deadline, use an authorized dispute/mutual allocation rather than bypassing the deadline.
8. Test reload during a pending transaction, RPC failure, delayed history and concurrent refreshes. Keep ambiguous signed bytes until finalized failure or verified expiry plus reconciliation. Test every wallet/provider claimed as supported; never use mainnet assets.

Existing `npm run test:devnet` remains the legacy program journey; use `test:pap:devnet` specifically for this adapter. Neither script replaces observed browser-wallet testing.
