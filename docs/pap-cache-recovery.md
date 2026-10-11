# PAP submitted milestone recovery

`submit_pap_delivery` deliberately sets `review_deadline = 0`: PAP requires
explicit wallet authorization and does not support legacy timer payouts. The
old `milestone_cache_check2` constraint required a non-null deadline for every
submitted milestone. A valid finalized PAP submission therefore caused
`reconcile_escrow` to fail, leaving GET `/api/escrow` at HTTP 500 and the cached
milestone at funded.

Migration `20261011074159_pap_submitted_cache.sql` adds an `is_pap` cache flag,
backfills it from the immutable escrow binding, and derives it from each
milestone's own bound agreement version during reconciliation. Only PAP
submissions may omit the review deadline. Legacy deadline checks, settlement
conservation, immutable binding checks, RLS, and RPC grants remain intact.
No contract upgrade, replacement funding, or fabricated payment record is needed.

Apply the migration once to the intended database and retain its migration
history entry. It uses a transaction with a five-second lock timeout and a
30-second statement timeout. It does not replay older migrations or submit a
Solana transaction. If executed manually in SQL Editor, record the successful
application using the matching local migration file before any future db push.

After application, use **Refresh chain status** in the same agreement. If the
browser retains a saved transaction, use **Recover saved transaction**. The
existing finalized delivery should be reconciled. Review the delivery and exact
allocation before authorizing the client payment. Do not fund the milestone again.

The regression test reproduces the old failure, then checks PAP backfill,
insert/update reconciliation, legacy deadline enforcement, stale-slot handling,
immutable bindings, exact settlement conservation, and browser RPC denial. The
hosted access probe also runs against the full migration sequence.
