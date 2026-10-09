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

The deployment uses an upgradeable program. The upgrade authority is a trust dependency: the deployed code can change. The prototype does not claim immutable code or an independent security audit. The mint authority can create TEST tokens; their balances are for testing, not value backing.

## Data and recovery

Commitments bind versioned terms and private evidence references; they do not store full evidence on chain or prove that submitted work is good. Finalized snapshots validate program/account identities, deployment-bound commitments and balances. Caches support the interface and do not replace program checks. Pending signed bytes are stored in the browser and recovered under the same signature; keep them until finalization or verified expiration reconciliation.

## Limitations and deferred evidence

Full devnet settlement, alternate paths, wallet compatibility, worker outage recovery and observed user trials remain pending until their records are attached. There are no PKR payouts, card deposits, embedded wallets, platform guarantees or production support commitments. Production key custody, upgrade governance, retention/deletion, monitoring, independent review and applicable payment arrangements require separate work.

Use synthetic evidence for demonstrations. Keep service keys, deployment/mint authority keys and worker secrets server-only and outside version control.
