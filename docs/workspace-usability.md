# Guided workspace

Pactlance now guides the connected client or freelancer through agreement, delivery, and payment. The interface keeps work acceptance separate from a verified settlement. All existing capabilities retain their original API endpoints, rule validation, and wallet authorization.

## Where existing features are available

| Capability                                                                                                                      | Location                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Wallet connect, sign-in, sign-out, account mismatch guidance                                                                    | Workspace header and sign-in screen                                    |
| Client/freelancer project filters and profile                                                                                   | Your projects; expandable Your profile                                 |
| Wallet balances and test-asset setup                                                                                            | Check wallet balance & test-token setup                                |
| Agreement creation, editable video template, roles, reviewers, deadlines, up to 20 milestones                                   | Numbered project setup                                                 |
| PAP enable/disable, work templates, evidence types, predicates, review notices, revisions, timeout/cancellation/rejection rules | Delivery & review rules in project setup                               |
| Private project sharing                                                                                                         | Invite your client or freelancer                                       |
| Agreement review, document acceptance, earlier versions and proposed amendments                                                 | Agreement & terms                                                      |
| Agreement fingerprint and PAP preview/change history                                                                            | Agreement & terms and its verification details                         |
| Workflow activation, start, review acknowledgement, submit, accept, revision requests                                           | Work & delivery                                                        |
| Workflow reject, deadline evaluation, dispute, refund proposal and joint cancellation                                           | Resolve a problem in Work & delivery                                   |
| File and link uploads, delivery/dispute purpose, notes, integrity verification, expiring downloads                              | Work files & evidence                                                  |
| Select attachments per required deliverable                                                                                     | Delivery requirements, after uploads; selections refresh automatically |
| Escrow setup, chain acceptance, milestone funding, delivery publication, client approval                                        | Payments                                                               |
| Legacy timeout claims, non-delivery refunds and disputes                                                                        | Resolve a problem in Payments                                          |
| Exact split proposal/acceptance/execution and eligible reviewer resolution                                                      | Resolve a problem in Payments                                          |
| Joint future-work revision/cancellation and shared signature package                                                            | Update or cancel future work in Payments                               |
| Saved transaction recovery and explorer links                                                                                   | Check pending transaction in Payments                                  |
| Program-bound fingerprint, participants, upgradeability and PAP trust details                                                   | Payment terms & technical details                                      |
| Workflow event history, raw states and rule IDs                                                                                 | Work & review history; Workflow technical details                      |
| Reminders, dismissal, finalized transactions, recipient amounts and raw metadata                                                | Activity and reminders; Transaction details                            |
| Legacy and PAP reviewer assignments, evidence, allocations                                                                      | Activity on the project-list screen                                    |
| Authorized support health, diagnostics and notes                                                                                | Existing support view in Activity                                      |
| Read-only sample project                                                                                                        | Existing preview page                                                  |

## Payment review

Ordinary escrow actions now open an accessible native dialog before the wallet prompt. It explains the action and, for transfers/splits, shows the amount. The transaction still refreshes and validates the live agreement and actor immediately before signing. A changed milestone or proposal requires another review. Recovery continues to use the saved transaction.

The zero/zero proposal nonce created during delivery is no longer presented as an acceptable payment split. A recorded proposal must conserve the funded amount; full refunds, full freelancer payments, and partial splits remain available.

## Verification and review

Automated guidance tests cover role-specific review, pending recovery, amendments, cancellation, finalized settlement references, and valid payment splits. The existing authorization, evidence, payment, database, and recovery suites remain the regression gate.

Browser review is still required: local browser download failed and the browser connector timed out. No visual screenshots or new live wallet transactions were verified for this update. Before production promotion, check:

1. Desktop and narrow mobile widths: project navigation, long addresses, forms, progress, and modal scrolling.
2. Client and freelancer: agreement signing, activation, funding, upload/select/submit, client review, delivery recording, wallet review, and verified payment.
3. Expand Agreement, Technical details, Resolve a problem, history, balances, profile, reviewer, and support sections; ensure their original controls remain usable.
4. Dialog keyboard behavior: initial focus, Tab stays inside, Escape/Go back cancels without signing, and focus returns to the trigger.
5. Existing proposal versus edited refund amounts; pending transaction recovery; mismatched wallet/version guidance.

No database migration or contract upgrade is required for this interface update.
