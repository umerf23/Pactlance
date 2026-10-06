# FreelancePay — Phase 1 implementation workbook

Date: 6 October 2026. Status: engineering design and research preparation completed; interviews and user validation pending. This workbook develops the phase plan into implementation requirements. The original blueprint remains the scope authority. Proposed choices below resolve its unspecified details and may change before implementation if research exposes problems.

## 1. Product contract

FreelancePay helps Pakistani freelance video editors and small agencies agree on sequential batches of work with overseas clients, verify the next batch is funded, and settle under accepted rules.

The prototype supports multiple milestones in each project. Each funded milestone uses its own vault; the program permits only one active, unsettled milestone per project. Funding one milestone does not guarantee that future milestones will be funded.

The prototype demonstrates test-token escrow on Solana devnet. It does not demonstrate real PKR withdrawals, card payments, guaranteed work quality or independently validated savings. These limits must be visible in the interface and demo.

Success is a complete two-milestone journey plus the alternate settlement paths, with verifiable chain transactions and correct private evidence permissions. User interest and client willingness to pre-fund require separate evidence.

## 2. User stories and priority order

All stories are required; ordering controls implementation, not scope removal.

| ID | User story | Observable result |
| --- | --- | --- |
| U01 | As either party, sign in with my wallet | Session matches verified wallet ownership; wallet connection alone is not authentication |
| U02 | As freelancer, describe a project with multiple batches | Ordered milestone list with scope, acceptance criteria, amount and timing |
| U03 | As client, understand exactly what I accept | Full versioned terms, participants, review rules and both reviewers displayed |
| U04 | As freelancer, know when work can begin | Active milestone shows verified funding, not merely a submitted transaction |
| U05 | As client, fund only the next batch | Later funding is blocked until earlier work is settled or validly cancelled |
| U06 | As freelancer, submit work privately | Evidence accessible to authorized parties; chain stores only commitment/reference |
| U07 | As client, approve completed work | Exact payment reaches agreed freelancer wallet |
| U08 | As freelancer, claim after client silence | Claim becomes eligible at review expiry if no dispute is open |
| U09 | As client, recover money after non-delivery | Refund available at delivery expiry with no submission/dispute |
| U10 | As either party, contest delivery or agree a settlement | Dispute freezes ordinary settlement; matching mutual approvals enable agreed allocation |
| U11 | As reviewer, settle assigned disputes | Funds go only to the original client/freelancer; backup role has explicit timing |
| U12 | As either party, understand progress | Dashboard, reminders, transaction history and explorer links reflect chain state |
| U13 | As support, investigate an issue | Minimal status and support notes visible; no payment override or default private-file access |

## 3. Agreement template

This is a product data template, not a production legal contract.

| Field | Entry or rule |
| --- | --- |
| Project title | [Example: ten short-form edited videos] |
| Project ID and agreement version | Generated stable ID; increment version for amendments |
| Client / freelancer | Verified public wallet keys; optional private display names |
| Overall scope | [Work included, inputs supplied, exclusions] |
| Milestones | Ordered list; each contains unique ID, scope, deliverables and acceptance criteria |
| Amount | Positive integer token units; display decimals obtained from the allowed mint |
| Network and token | Solana devnet; configured project test-token mint; no real monetary value |
| Funding deadline | Exact UTC timestamp, with local-time display |
| Delivery deadline | Exact UTC timestamp after funding deadline |
| Review window | Proposed default: 72 hours from recorded submission |
| Reviewer and backup | Distinct identified public keys, neither a participant |
| Backup activation | Proposed default: 7 days after dispute opens; immutable accepted duration |
| Release on silence | Anyone may execute eligible claim at/after review expiry, always to the agreed freelancer |
| Non-delivery | Client may claim refund at/after delivery expiry when no submission/dispute exists |
| Mutual settlement | Both approve same milestone/version/nonce/allocation; total equals funded amount |
| Revisions | One recorded submission; no unilateral clock reset; additional work requires newly agreed scope |
| Fees | Zero platform fee; transaction submitter pays network fees |
| Future work | Separate funding required; no promise of funding remaining milestones |
| Acknowledgments | Test tokens; reviewer authority; possible locked disputed funds if no authorized actor settles |

Before signing, present scope, amount, deadlines and reviewer rules in readable form. Acceptance records bind the exact serialized terms commitment, network, program and project/milestone identities. Any changed terms require fresh acceptance; stale browser pages must not produce apparently current acceptance.

## 4. Worked two-milestone fixture

Use synthetic identities and files. Wallet keys are generated during setup, not invented in this document.

| Field | Milestone 1 | Milestone 2 |
| --- | --- | --- |
| Title | First five videos | Remaining five videos |
| Amount | 250 TEST | 250 TEST |
| Deliverables | Five MP4 files, 1080 × 1920, 30–60 seconds each | Same format for five different supplied clips |
| Acceptance | Files open; count/format/duration correct; captions match supplied script | Same checks against second batch script |
| Funding deadline | Setup time + 1 day | Setup time + 8 days |
| Delivery deadline | Setup time + 3 days | Setup time + 11 days |
| Review period | 72 hours | 72 hours |

Dates are computed once before both accept, then frozen. A dispute can delay milestone 1 beyond milestone 2's funding deadline. The app must show that milestone 2 has expired; it cannot silently extend the date. Parties may accept a new version for unfunded work. Prior funded/settled terms remain unchanged.

For an explicitly labelled accelerated demo fixture, use short agreed durations at creation. Do not change the chain clock, bypass guards or relabel test transfers as live payments.

## 5. Decisions needed for a complete state machine

The following are implementation defaults, not interview findings.

| Question | Decision |
| --- | --- |
| Who may create the project? | Either participant can propose; the other wallet must be specified and both must accept |
| Are roles global? | No. A wallet can be a freelancer on one project and a client on another |
| Are reviewers editable after funding? | No. Primary and backup are bound to accepted terms |
| Can milestone 3 bypass milestone 2? | No. Sequence advances only through terminal settlement or mutually authorized cancellation |
| What if an unfunded milestone expires? | Mark funding unavailable as a derived condition. Require fresh two-party terms or cancellation; do not advance unilaterally |
| What if cancellation targets future milestones? | Record their cancelled status; advance next eligible index only when all preceding indexes are terminal. Never clear another active milestone |
| Can cancellation remove a funded milestone? | Only through mutual settlement of the funded amount, not deletion |
| Can a dispute open before delivery? | Yes, while funded and strictly before delivery expiry |
| Can a late dispute defeat a refund/claim? | No: opening closes at the applicable delivery or review boundary |
| Who settles after escalation? | Proposed exclusive switch: primary before activation, backup at/after. Show the change in advance |
| Can a settlement proposal freeze payment? | No. Proposing does not freeze deadlines; opening a valid dispute does. Execution rechecks current state |
| Can an approval be withdrawn? | A participant may revoke its own proposal approval before execution; every change uses the current nonce. Once executed, settlement is final |
| Can an administrator release funds? | No. Only program-authorized paths; operational support is separate from reviewer authority |
| How are accidental extra tokens handled? | Settle the recorded amount; extra deposits never change the agreement. Residual-vault recovery/closure policy must be designed before implementing closure; no arbitrary administrator sweep |
| What if everyone is unavailable? | Escrow may remain locked in dispute. No invented default winner or undisclosed confiscation path |

## 6. Screen wireframe specifications

These are layout specifications for the later UI implementation, not a working clickable prototype.

| Screen | Top area | Main area | Primary action and important state |
| --- | --- | --- | --- |
| Dashboard | Network banner, wallet identity, role filter | Projects with active milestone, funding state and next action; reminders | Create project; empty state explains how to invite a client |
| Project editor | Title and participant wallets | Scope; ordered milestone cards with amount/deadlines; reviewer panel | Review agreement; inline errors for invalid dates/amounts |
| Agreement review | Version and acceptance status | Full scope, ordered schedule, release/refund rules, reviewer identities | Accept this version; disable if wallet is not a participant |
| Project detail | Project title; settled/funded/remaining amounts shown separately | Milestone timeline; active milestone expanded; future milestones visible | Role/state-specific next action; blocked milestone explains dependency |
| Milestone detail | Status, amount, funding transaction | Terms, deadlines, evidence and event history | Fund / submit / approve / claim / refund as eligible; dispute action visible within window |
| Delivery submission | Deadline and single-submission notice | Private upload/link, description, access check and preview | Submit delivery; show upload success separately from on-chain submission success |
| Dispute | Funds paused, assigned reviewer and escalation time | Accepted terms, private evidence, dated statements, settlement proposal | Participant: propose allocation; reviewer: resolve with final allocation preview |
| Reviewer queue | Active reviewer role | Only assigned cases; deadline and eligibility | Open case; backup can inspect assigned dispute, but settlement enabled only when eligible |
| History | Network and filters | Amount, recipient, action, pending/confirmed/finalized/failed status | Open explorer; failed action offers safe retry after reconciliation |
| Support | Operational access label | Project reference, status, error category, support notes | Add note; no fund-moving actions or automatic evidence downloads |

Mobile layout: single column, current action above history, readable amounts and full deadline details, review terms before signing. Never hide dispute timing in a tooltip. Display absolute timestamps alongside countdowns.

Suggested user-facing status text:
- Unfunded: “This milestone is not funded. Confirm funding before starting work.”
- Funding submitted: “Waiting for network confirmation.”
- Later milestone: “Available after the previous milestone is settled.”
- Review: “Review by [time]. After this time, payment can be claimed unless a dispute is open.”
- Claim eligible: “Payment is ready to claim. A transaction is required to release it.”
- Disputed: “Payment is paused while this dispute is resolved.”
- Worker unavailable: “You can still submit an eligible claim from this page.”

## 7. Implementation boundaries and data model

| Entity | Source of truth | Main relationships / constraints |
| --- | --- | --- |
| Project | Chain for sequence; database for descriptions | Fixed participants, ordered milestones, at most one active funded milestone |
| Agreement version | Immutable private document plus chain commitment | Project/version unique; acceptance bound to exact commitment |
| Milestone | Chain | Project/index unique; own vault; fixed token/amount/destinations; accepted version retained |
| Acceptance | Chain authorization with private display cache | Participant, commitment and version; connection/session alone cannot accept |
| Settlement proposal | Chain | Milestone, nonce, allocation, participant approvals; no replay |
| Evidence | Private storage/database; chain commitment | Milestone/version, author, hash/salt, upload status, storage key; no public deliverable URL |
| Dispute | Chain status plus private case material | Milestone, opened time, primary/backup eligibility, outcome |
| Transaction event | Verified chain-derived cache | Cluster, signature and event index unique; finalized history reconciled |
| Notification | Database-derived reminder | Recipient/action/deadline/version deduplication; recheck eligibility before presenting action |

All money-moving operations validate project/milestone binding, signer, account ownership, mint, token program, vault authority, recipients and state. Funding/settling shares a writable project account to serialize competing funding attempts. Use checked integer arithmetic; never floating-point token arithmetic.

Authentication establishes wallet control for private APIs. Program signatures separately authorize chain actions. A support role in the database cannot become a reviewer signer. Server-only administrative keys must not ship to the browser.

Evidence availability design: upload and verify private access before on-chain submission; commit exact evidence metadata; retain that immutable version through review. A hash proves commitment, not that a remote link remains accessible. Link availability problems must have a clear dispute route before review expiry. The product cannot automatically prove delivery quality.

## 8. Acceptance scenarios ready for implementation

These are test specifications, not executed tests.

| ID | Given / when | Expected result |
| --- | --- | --- |
| P1-01 | Only freelancer accepts; client attempts funding | Reject; vault amount unchanged |
| P1-02 | Both accept v1; UI changes amount to v2 | v1 unchanged; v2 needs fresh acceptances |
| P1-03 | Correct client funds milestone 1 | Exact amount in its vault; active pointer identifies milestone 1 |
| P1-04 | Milestone 1 active; milestone 2 funding attempted | Reject even if database falsely says milestone 1 settled |
| P1-05 | Two competing funding transactions | At most one valid active escrow; no double debit from a retried instruction |
| P1-06 | Freelancer submits at delivery deadline minus one second | Accept once; derive review deadline from chain submission time |
| P1-07 | Freelancer submits exactly at delivery deadline | Reject; eligible non-delivery refund remains possible |
| P1-08 | Claim one second before / exactly at review expiry | First rejected; second eligible if undisputed |
| P1-09 | Dispute exactly at review expiry | Reject; an earlier valid dispute blocks claim |
| P1-10 | Client approves, then retries or calls refund | First payment exact; later settlement rejected |
| P1-11 | Primary resolves at backup activation; backup resolves at activation | Primary rejected under proposed exclusive switch; backup permitted |
| P1-12 | Proposal allocation changes after one approval | Old approval cannot authorize new allocation |
| P1-13 | Both approve split of 100/150 TEST on 250 TEST escrow | Only original recipients receive amounts; total exactly 250 |
| P1-14 | Reviewer names an unrelated recipient or sum is 251 | Reject; balances and state unchanged |
| P1-15 | Milestone 1 settled; milestone 2 funded before its funding expiry | New distinct vault funded; milestone 1 cannot reopen |
| P1-16 | Milestone 2 expires during dispute on milestone 1 | No automatic date extension; new accepted terms needed to fund |
| P1-17 | Outsider guesses evidence ID/download URL | Access denied; no metadata or private link leaked |
| P1-18 | Browser closes after successful chain transaction before API update | Reconciliation restores correct state without resubmitting payment |
| P1-19 | Claim worker stops | Eligible manual claim still works |
| P1-20 | Extra tokens are sent directly to vault | Recorded payout unchanged; normal settlement still succeeds |
| P1-21 | Future milestone cancelled while earlier one remains active | Earlier active pointer preserved; later funding still blocked |

## 9. Research pack

Research is pending. Targets from the blueprint: interview 8–10 freelancers and 3–5 clients; later observe at least five freelancers and two clients using the prototype. Do not manufacture participants or treat recruitment goals as traction.

Interview sequence (15–20 minutes):
1. Describe the last project you arranged directly with a client/freelancer.
2. What did the agreement say about payment and acceptance? Ask to describe an example without exposing confidential material.
3. What happened from delivery until payment was usable? Separate service fees, conversion and elapsed time.
4. Describe a recent delay or disagreement. What did each party do?
5. How do you decide whether to pay upfront or start without payment?
6. Show the proposed two-milestone journey. Ask the participant to explain when each party can receive funds.
7. Would wallet-based funding prevent you from using it? Why?
8. Whom would you trust to resolve a dispute? Would your counterparty agree?
9. What review period would fit your workflow? What if you were unavailable?
10. Ask whether they will try a test-token prototype with a counterparty. Record commitment separately from general interest.

Record per interview: anonymous participant ID, role, segment, date, existing workflow, concrete incident, cost/time evidence, wallet familiarity, objections, reviewer preference, proposed next step and permission for anonymized quotation. Keep raw identifying material private.

Decision log to populate after research:

| Assumption | Evidence needed | Current status |
| --- | --- | --- |
| Payment uncertainty is frequent enough to change tools | Concrete recent incidents | Unvalidated |
| Clients will pre-fund via wallet | Client willingness and observed test completion | Unvalidated |
| Sequential funding fits batch work | Freelancer and client workflow descriptions | Unvalidated |
| 72-hour review is acceptable | Both sides explain timing and absence risks | Unvalidated |
| Independent reviewers are trusted and available | Both sides identify acceptable reviewers | Unvalidated |
| Users understand release on silence | Unprompted explanation in usability trial | Unvalidated |

## 10. Phase 1 handoff

Prepared: product contract; 13 user stories; agreement template; two-milestone fixture; explicit edge-case decisions; ten screen specifications; data ownership and authorization boundaries; 21 acceptance scenarios; interview pack.

Pending: actual interviews and feedback, clickable usability prototype and user trials. Tool installation, dependency pinning, repository scaffolding and CI belong to Phase 2. No runnable web application, contract or deployment is claimed here.

Implementation may proceed using the documented defaults while research runs. If research changes a payment rule, update its agreement field, state transition and acceptance scenario together before funding test escrows. Preserve the original blueprint's scope throughout.
