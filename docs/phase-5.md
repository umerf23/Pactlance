# Phase 5 — complete settlement rules

Historical Phase 5 checkpoint: contract and TypeScript client were verified locally; deployment and payment UI followed in Phase 7. See the [current audit status](audit-remediation.md).

## Settlement rules

All timestamps use the Solana clock and all amounts use integer token base units. Every terminal settlement clears the active flag and advances the sequence exactly once. All recipients are token accounts owned by the original client or freelancer and denominated in the configured mint.

| Instruction           | Eligibility                                                                                                     | Effect                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `claim_after_review`  | Any signer; submitted; now >= review deadline                                                                   | Full payout to freelancer                                                                                  |
| `refund_non_delivery` | Client; funded with no submission; now >= delivery deadline                                                     | Full refund to client                                                                                      |
| `open_dispute`        | Either participant; funded strictly before delivery expiry, or submitted strictly before review expiry          | Stops ordinary approval, claim and refund; records salted evidence commitment and escalation timestamp     |
| `resolve_dispute`     | Primary reviewer before escalation; backup exclusively at/after escalation                                      | Exact client/freelancer split whose checked sum equals the funded obligation                               |
| `propose_settlement`  | Either participant; current active funded/submitted/disputed milestone; expected current nonce                  | Increments nonce, records exact allocation/cancellation intent, and approves only for proposer             |
| `accept_settlement`   | Other participant; exact current nonce, amounts and cancellation intent                                         | Records approval of that proposal                                                                          |
| `execute_settlement`  | Any signer; both current approvals                                                                              | Pays the accepted split; optionally cancels all remaining work                                             |
| `cancel_remaining`    | Both participant signatures in one transaction; inactive project with future work; exact version and commitment | Permanently blocks further funding                                                                         |
| `revise_project`      | Both participant signatures; inactive, uncancelled project; exact previous commitment and higher version        | Updates future work while retaining settled economic terms and original project identity/participants/mint |

The existing client-approval path remains available only while submitted and undisputed. A dispute raised at the exact review deadline is rejected; an eligible review claim can succeed then. A funded dispute raised at the exact delivery deadline is rejected; an eligible refund can succeed then. Primary authority expires at the exact backup timestamp.

## Mutual authorization and revisions

Allocations must satisfy `client_amount + freelancer_amount == recorded_amount` using checked arithmetic. Zero allocation to one recipient is supported. Payouts use the recorded obligation, so unsolicited donations cannot inflate it.

Each new mutual proposal requires the expected current nonce and invalidates previous approvals. Acceptance includes both amounts and the cancellation flag. Submission, dispute and terminal settlement also increment the nonce and clear approvals. A stale signed proposal, stale acceptance or stale execution cannot settle a newer allocation. A participant can replace a pending proposal; replacement requires the other participant to approve again.

Cancellation of inactive future work and joint revision use both signatures on one transaction. They bind the current version/commitment rather than storing asynchronous proposal approvals. Revision cannot change an active milestone, remove or alter the settled economic prefix, change project identity/participants/mint, or use a stale previous commitment. New future deadlines must be valid and future at execution time. Both signatures accept the new reviewed commitment; the client rejects changes to any settled milestone's private terms as well.

Each funded milestone records its agreement version and commitment. Later revisions preserve its account bytes and historical settlement totals. Reviewer decisions continue future work; they do not cancel it. Mutual settlement can explicitly cancel future work.

## Account/client changes

The project gains a permanent cancellation flag. Milestones gain agreement references, dispute timestamps/commitment, exact settlement totals and proposal state. Every new settlement route shares the same PDA, mint, Token-program and fixed-recipient checks, and both transfers plus state changes are atomic.

`src/lib/escrow/client.ts` includes all instruction builders and a verified milestone decoder. The generated `contracts/idl/pactlance.json` contains all 15 instructions. The runtime CI command now executes both Phase 4 and Phase 5 suites.

These account layouts are incompatible with an old Phase 4 local ledger. Reset local test state before testing the new binary. The project has not deployed escrow to devnet, so no live account migration has been performed. Use a fresh deployment keypair and update the program ID/configuration/IDL together before deployment.

## Verification evidence

- 30 application/client unit tests pass.
- Seven native Rust contract tests pass.
- 18 Solana runtime tests pass: seven Phase 4 regressions and 11 Phase 5 tests executing the SBF program and SPL Token instructions.
- ESLint, TypeScript checks, Rust formatting and the Next.js production build pass.
- The IDL regenerates and validates with Anchor's builder.

The Phase 5 suite verifies exact review, delivery and escalation boundaries; unauthorized callers; fixed recipients; invalid amounts; ordinary settlement blocked by disputes; primary splits and full payouts; backup refunds; mutual splits/full payouts/refunds; changed-proposal and state-change invalidation; cancellation; revisions of expired future work; preservation of settled history; donation conservation; replay rejection; and atomic rollback when a frozen second recipient prevents a split transfer. Runtime fixtures use generated test keys and local synthetic tokens, never real funds.

Reproduce with the pinned Node/Rust/Agave tools:

```sh
npm ci
npm run check
cargo +1.90.0 test --manifest-path contracts/Cargo.toml --locked
cargo +1.90.0 fmt --manifest-path contracts/Cargo.toml --all --check
cargo-build-sbf --tools-version v1.56 --manifest-path contracts/programs/pactlance/Cargo.toml -- --locked
npm run test:escrow
```

These are in-process Solana runtime tests. Devnet, browser payment signing and hosted transaction recovery remain Phase 7 work. Local checks do not imply that GitHub CI has run.

## Remaining project work

Phase 6 adds private evidence, reviewer screens, reminders, support views and transaction history. Phase 7 adds deployment and end-to-end wallet integration/reconciliation. Eligible claims require a submitted transaction; there is no automatic on-chain timer. If neither reviewer nor both participants act, disputed funds can remain locked. Recovery of donated excess is deferred; it does not prevent settlement of the recorded obligation. Hosting is now available at https://pactlance.vercel.app/; see the current [audit status](audit-remediation.md).
