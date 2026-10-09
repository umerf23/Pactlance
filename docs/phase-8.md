# Phase 8 — usability, validation and submission

Status: in progress. Live testing is deferred at the user's request, not marked complete.

## Implemented in this checkpoint

- Escrow actions have visible button boundaries, spacing and touch targets.
- Refresh reports progress, success and failure; it explains that it does not request signatures.
- A next-step message distinguishes creation, acceptance, funding, active work and completion.
- Pending signatures block new actions and direct users to recover their saved transaction.
- Joint cancellation/revision is collapsed behind an explicit summary and explains when to use its package field.
- Long addresses, commitments and revision JSON wrap on narrow screens; wallet controls can wrap.
- Ordinary actions include an explicit compute-unit limit and price before signing. Exact message and signature checks remain enforced. Joint packages retain their existing exact-instruction validation.

## Evidence already reported by the developer

The user deployed and ran the verification script successfully:

- Program: `9T95KC5YSQ7LV2KwUcY7SyBu6cYF6Urv8fXd7kYaWNpL`
- TEST mint: `JCEk9179tFu5y8UQ6oMFSPrDybkXDkhoxMiom2FpyuU7`
- A browser screenshot showed a created project with both on-chain acceptances pending.
- The invalid local server API key was corrected; the escrow endpoint subsequently returned HTTP 200.
- Explicit compute-budget instructions allowed a signed create transaction to enter the saved recovery flow.

These are user-reported results, not an independent complete devnet test run. The public deployment identity edits and manifest were reviewed, committed on `devnet-local-fixes` and merged into this branch. Private keys and local environment settings remain outside version control.

## Deferred final verification

Record the date, Git commit, public signatures and result for each item. Do not include secret keys, private evidence or participant personal information.

| Gate                 | Required evidence                                                                                      | Status  |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ------- |
| Identical terms      | Both participants accept the same deployment-bound version; stale and one-sided acceptance cannot fund | Pending |
| Sequential funding   | Exact TEST funding; second milestone blocked while first is active                                     | Pending |
| Ordinary payout      | Private delivery, client approval, exact freelancer balance, duplicate payout rejected                 | Pending |
| Time boundaries      | Before/at review expiry and delivery deadline; manual timeout claim and eligible refund                | Pending |
| Disputes             | Primary/backup eligibility, split conservation, outsider rejection and next milestone unlocking        | Pending |
| Mutual actions       | Matching current proposals, stale nonce rejection, joint cancellation and future-only revision         | Pending |
| Recovery             | Reload while pending; same-byte rebroadcast; expired transaction reconciliation; missed-event backfill | Pending |
| Worker outage        | Scheduler interruption/restart without duplicate settlement; manual claim remains available            | Pending |
| Wallet networks      | Phantom and MetaMask devnet signing explicitly verified; mainnet-labelled prompt rejected              | Pending |
| Mobile/accessibility | 375px, 768px and desktop; keyboard controls, focus, readable addresses and no horizontal page overflow | Pending |
| Observed trials      | At least five freelancers and two clients; record comprehension, completion, friction and objections   | Pending |

Use the blueprint's A01–A15 acceptance matrix in `docs/build-phases.md` for detailed adversarial cases. Run `npm run check`, the compiled SBF runtime suite and the opt-in live devnet suite before declaring completion. Automated checks do not substitute for observed wallet journeys.

## Trial worksheet

For each consenting participant use an anonymous code, role and date. Ask them to create/review terms, identify funding proof, explain when silence causes release, find the reviewer rule, submit/view synthetic evidence and locate transaction history. Record success without help, time, misunderstandings and exact feedback. Ask them to explain sequential funding and the fact that TEST tokens have no monetary value. Do not invent trial results or payment savings.

## Submission handoff

Use `docs/demo-script.md` for the recording and `docs/architecture-and-trust.md` for limitations. Capture the final workflow only after verification. Hosting remains paused. Phase 7 and Phase 8 completion gates remain open.
