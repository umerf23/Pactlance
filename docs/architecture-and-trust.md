# Architecture and trust boundaries

Pactlance is a Solana devnet prototype for sequential milestone agreements. TEST tokens have no monetary value. It is not a production payment service.

## Components

| Component                           | Responsibility                                                               | Authority limit                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Next.js wallet interface            | Review agreement, prepare actions and request signatures                     | Cannot move funds without valid program authorization                 |
| Supabase Auth/Postgres              | Verified wallet session, private terms, evidence metadata and history caches | Database edits cannot authorize escrow payouts                        |
| Private Supabase Storage            | Synthetic delivery/dispute evidence and authorized short-lived access        | Evidence visibility follows participant/assigned reviewer permissions |
| Solana program and SPL Token vaults | Exact deposits, sequential funding, delivery commitments and settlement      | Enforces accepted terms, fixed recipients and chain-clock boundaries  |
| Reconciliation and worker           | Verify finalized state, backfill events and submit eligible claims           | May pay transaction fees; cannot override settlement conditions       |

## Payment and reviewer rules

Only one funded unsettled milestone is active per project. Review expiry can permit release without another client signature, but a transaction must still be submitted. A dispute blocks ordinary release/refund. Primary and backup reviewer authority is governed by the accepted escalation timing. Reviewers can allocate only the funded obligation between the original recipients. If neither an authorized reviewer nor mutual agreement acts, disputed funds may remain locked.

Read-only devnet verification on 9 October 2026 found upgrade authority `Aze8iw5WsDm1YSM78hfT9NscGrR5L4VWxtAVhUNtdRDY` and ProgramData `7YPr3mixggpZVSotDCPaQm3GUpTaGraH4JPdE7sFUP3w`. These are public identities, not keys. Authority was not revoked. The deployment uses an upgradeable program. The upgrade authority is a trust dependency: the deployed code can change. The prototype does not claim immutable code or an independent security audit. The mint authority can create TEST tokens; their balances are for testing, not value backing.

## Data and recovery

Commitments bind versioned terms and private evidence references; they do not store full evidence on chain or prove work quality, correctness, authorship or legal sufficiency. Format screening is not malware scanning. Finalized snapshots validate program/account identities, deployment-bound commitments and balances. Caches support the interface and do not replace program checks. Pending signed bytes are stored in the browser and recovered under the same signature; keep them until finalization or verified expiration reconciliation.

## Limitations and deferred evidence

Full devnet settlement, alternate paths, wallet compatibility, worker outage recovery and observed user trials remain pending until their records are attached. There are no PKR payouts, card deposits, embedded wallets, platform guarantees or production support commitments. Production key custody, upgrade governance, retention/deletion, monitoring, independent review and applicable payment arrangements require separate work.

Use synthetic evidence for demonstrations. Keep service keys, deployment/mint authority keys and worker secrets server-only and outside version control.

## Availability and abuse controls

Authenticated requests use database-serialized per-user limits: 120 ordinary reads, 30 mutations, 12 expensive escrow refreshes and 10 evidence mutations per per-user one-minute window. These are shared across serverless instances. Failures of the limiter fail closed; quotas are not a complete DDoS/Sybil control and do not throttle direct authenticated Supabase API usage. Supabase Auth applies its own authentication limits. Infrastructure-level protections need separate deployment configuration.

Supabase outages can prevent sign-in and private evidence access. RPC outages can delay transaction submission/finality/history. Chain-authorized manual claims remain possible with a compatible wallet and working RPC; the app cannot manufacture finality during an outage. Persist signed bytes before broadcast and reconcile ambiguous outcomes before producing replacement signatures.

Wallet discovery uses Wallet Standard. Payment signing now passes `solana:devnet` explicitly and rejects an account without devnet signing support. An Ethereum-only MetaMask account is unsupported; compatible Solana Wallet Standard providers still require observed wallet tests. Mobile deep-link support is not claimed.
