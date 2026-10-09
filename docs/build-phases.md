# FreelancePay — Build phases and Phase 1 specification

Original plan prepared 6 October 2026. Source of scope: FreelancePay_Project_Blueprint.md.

Current status (9 October 2026): Phases 2–7 software is implemented on `main`; Phase 7 live completion and Phase 8 validation gates remain open. CI for merge commit `44e487d6711721fd16a426bb2cb893bd2ae7b47c` passed web, native program and SBF/LiteSVM jobs. The program/TEST mint/upgrade authority were independently read on devnet at finalized slot 509137571. The web app is hosted at https://pactlance.vercel.app/. Complete browser-wallet lifecycle tests and observed user trials have not been demonstrated.

See [audit remediation and evidence](audit-remediation.md) for exact verification and remaining gates. The Phase 1 sections below are the original planning baseline, not statements about today's implementation.

## Scope commitment

Implement the full devnet prototype in the blueprint. A project supports multiple sequential milestones; each milestone has its own escrow vault, and only one funded, unsettled milestone may be active per project. Disputes, mutual settlement/cancellation, backup reviewer, private evidence, reminders and support views remain in scope. The blueprint's subsequent-work items remain subsequent work: PKR payouts, card funding, embedded wallets, agency splits, subscriptions and richer exports. No AI or marketplace is added.

## Delivery phases

Phases are dependency gates, not promises to finish within the hackathon deadline. The source estimate remains approximately six weeks for two developers under its stated assumptions. Each implementation phase ends with working code, relevant verification, a demonstration and a short progress record. Report incomplete work honestly at submission time.

| Phase | Work | Completion gate |
| --- | --- | --- |
| 1. Product and engineering specification | User journeys, multi-milestone model, payment rules, architecture, acceptance matrix, research script | Engineering specification recorded; proposed boundary rules identified; research tracked separately |
| 2. Development foundation | Repository structure, pinned tools, Next.js shell, shared types, Anchor workspace, local configuration, CI | Web app builds; sample program tests run; no secrets committed; reproducible setup instructions |
| 3. Identity and project agreements | Wallet sign-in, profiles, roles, dashboards, project/milestone editor, immutable agreement versions and both acceptances, database policies | Two users accept identical terms; outsiders cannot access private projects; changed draft terms require fresh acceptance |
| 4. Sequential milestone escrow | Project sequencing account, milestone accounts/vaults, allowed mint, exact deposit, delivery commitment, approval payout | First milestone settles; second can then fund; attempted simultaneous funding and duplicate payment fail |
| 5. Complete settlement rules | Review timeout, non-delivery refund, disputes, primary/backup reviewer, mutual settlement/cancellation | Boundary, authorization, conservation and replay tests pass for every settlement path |
| 6. Evidence and operational interface | Private uploads/links, reviewer evidence screen, reminders, support view, transaction history and explorer links | Correct roles access evidence; reminders reflect state; support cannot move funds or access private evidence by default |
| 7. Devnet integration and recovery | Deploy program/test mint, configure application, chain reconciliation, retries, scheduled eligible claims plus manual claims | Full multi-milestone workflow works on devnet; missed events and worker failure recover without duplicate settlement |
| 8. Validation and submission | Security-focused testing, observed user trials, mobile fixes, README, architecture/trust notes, demo and submission assets | Blueprint acceptance criteria have recorded evidence; limitations and unfinished items disclosed; submission materials prepared |

User research begins in Phase 1 and continues alongside engineering. Hosting selection and actual dependency versions are verified in Phase 2; this specification does not assert compatibility was tested.

## Phase 1 — Product definition

First segment: Pakistani freelance video editors and small editing agencies working with overseas clients on fixed-price batches.

Promise: agree on the work, verify the next milestone is funded, submit delivery, and settle under known rules.

Roles:
- Freelancer: proposes work, accepts terms, submits delivery, claims eligible payment, opens disputes and agrees to settlements.
- Client: accepts terms, funds the next milestone, reviews work, approves payment, claims eligible refunds and participates in disputes/settlements.
- Primary reviewer: accesses assigned dispute evidence and settles only between the original participants.
- Backup reviewer: gains settlement eligibility after the agreed escalation deadline.
- Support: sees minimal operational metadata and support notes; cannot sign for participants or settle escrow through database edits.

## Multi-milestone journey

Example: a project for ten videos has milestone 1 for five videos and milestone 2 for five videos, each for 250 test tokens. These are illustrative amounts.

1. Freelancer creates project scope and the ordered milestone schedule.
2. Both parties see and accept the exact versioned terms, including reviewer, backup, amounts and timing rules.
3. Client funds milestone 1. Its vault and chain status are displayed before work starts.
4. Freelancer submits private evidence and an on-chain commitment before its delivery deadline.
5. Approval, eligible timeout claim, refund, mutual settlement or reviewer decision settles the milestone.
6. Only after settlement can the next agreed milestone be funded. A dispute leaves the current milestone active and blocks later funding.
7. Repeat until all milestones are settled or remaining work is mutually cancelled.

Proposed continuation rule: settlement of a dispute does not itself cancel future milestones. Funding the next accepted milestone is a separate client action. Both parties can cancel remaining unfunded work; one party cannot force the other to fund it. Expired unfunded milestones must be cancelled or superseded through newly accepted terms before proceeding.

## Agreement structure

Project identity, client and freelancer wallet keys, ordered milestone IDs, terms version, scope, acceptance criteria, allowed mint, integer amounts, funding and delivery deadlines, review duration, reviewer identities, backup delay, revision rule and network-fee responsibility form the agreement.

Use a deterministic, versioned serialization with a cryptographic commitment and private salt. Display the same version that is accepted on chain. Editing an unaccepted draft is allowed. Any superseding agreement requires both acceptances; it cannot alter a funded milestone or retroactively change previous acceptances. Keep evidence of previous versions.

Proposed defaults for implementation: 72-hour review period; configurable backup escalation interval recorded before acceptance; transaction initiator pays transaction fees; zero platform fee. Exact delivery and funding dates are agreement-specific. Short demo timings must be clearly labelled and configured before acceptance, never changed during escrow.

Revision handling follows the blueprint's single recorded submission: no silent reset of the review clock. Additional work needs a new milestone/agreement; parties may use dispute or mutual settlement when the accepted scope is contested.

## Proposed state and time rules

These make unspecified boundaries explicit for implementation review. They are design choices, not claims of user validation.

| Current state | Action | Required conditions | Result |
| --- | --- | --- | --- |
| Awaiting acceptance | Accept terms | Correct participant signs the exact commitment | Ready when both accept |
| Ready | Fund | Agreed client; exact allowed token amount; now < funding deadline; funding deadline < delivery deadline; correct sequence; no active escrow | Funded; project active pointer set |
| Funded | Submit work | Freelancer; now < delivery deadline; one submission | Submitted; review deadline = recorded submission time + accepted duration |
| Submitted | Approve | Client; no dispute | Settled to fixed freelancer recipient |
| Submitted | Claim after review | Any caller; now >= review deadline; no dispute | Settled to fixed freelancer recipient |
| Funded | Refund non-delivery | Client; now >= delivery deadline; no submission/dispute | Settled to fixed client recipient |
| Funded | Open dispute | Either participant; now < delivery deadline | Disputed |
| Submitted | Open dispute | Either participant; now < review deadline | Disputed |
| Funded, Submitted, Disputed | Mutual settlement | Both authorize identical current allocation and nonce; allocation sum equals funded amount | Settled to original recipients |
| Disputed | Reviewer settlement | Primary reviewer before escalation; backup at/after escalation; allocation sum equals funded amount | Settled to original recipients |
| Unfunded | Mutual cancellation | Both accept cancellation of the identified version | Cancelled; sequence advances only under defined project rules |
| Settled, Cancelled | Any money movement | Never permitted | Reject |

Proposed backup policy: authority switches from primary to backup at the escalation timestamp to avoid competing reviewer authority. Blueprint requires backup eligibility but does not specify exclusivity; review this choice before contract implementation. If no authorized reviewer or mutual agreement acts, disputed funds can remain locked.

All time checks use chain time. Every settlement atomically records terminal status and clears the project active pointer. Completion advances the sequence exactly once. No transaction scheduler can bypass program checks. Non-delivery disputes close at delivery expiry so late disputes cannot indefinitely preempt an already eligible refund.

Mutual settlement implementation proposal: store a proposal nonce, allocation and each participant's approval on chain; amendments increment the nonce and invalidate prior approvals. Final execution checks the current state and both approvals, preventing replay. Unfunded cancellation uses the same two-party authorization principle without token transfers.

## Architecture and data ownership

Retain the blueprint stack: Next.js/React/TypeScript/Tailwind; Next.js server routes; Supabase authentication, Postgres and private storage; Rust/Anchor escrow; SPL Token with one configured devnet test mint; compatible Anchor client and wallet integration; reconciliation worker; Vitest/Playwright and program tests.

On-chain Project account: stable project identity, participants, next eligible sequence number, active milestone pointer, agreement references needed to enforce sequencing. On-chain Milestone account: project identity and index, participants, mint, recorded amount, vault authority, agreement commitment, acceptances, deadlines, reviewer/backup rules, submission commitment, state, dispute time and settlement totals. Settlement proposals bind their milestone, version, nonce and allocations.

Use a separate milestone PDA and token vault per milestone. Make funding and settlement take the same writable project account so competing funding transactions cannot create two active escrows. Program constraints verify the supplied project, milestone, vault and recipient accounts belong together.

Off-chain tables: profiles, projects, project_members, agreements, milestone_cache, evidence, disputes, transaction_events, notifications; add acceptance display metadata and settlement proposal caches only as needed. Cache entries never authorize funds movement. Database roles and storage rules independently enforce access.

Evidence: private files/links, versioned metadata, salted commitment, short-lived download authorization. An unrelated user cannot obtain evidence by guessing a URL or ID. Reviewer access is limited to assigned disputes; support receives no blanket evidence access. Proposed retention for the prototype: retain synthetic evidence for the demo/testing period, with a documented deletion process; production retention remains an explicit later decision.

Chain reconciliation: show pending/confirmed/finalized distinctly; verify the program, accounts and state instead of trusting a submitted transaction signature. Use idempotent event identifiers and periodic account reconciliation. Recover after missed events, reloads and retries. Manual claims remain available if the worker is offline.

## Screens and routes to implement

| Screen | Essential content |
| --- | --- |
| Sign-in | Wallet connection, authentication, devnet/test-token disclosure |
| Dashboard | Role-specific projects, next action, reminders, pending transactions |
| Project editor/detail | Scope, ordered milestones, accepted version, active milestone and future work |
| Agreement review | Exact terms, reviewers, deadlines, token/network, both acceptance states |
| Milestone detail | Funding proof, private delivery, review countdown, allowed payment/refund/dispute actions |
| Dispute detail | Authorized evidence, settlement proposals, reviewer decision and escalation timing |
| Reviewer queue | Assigned disputes only, primary/backup eligibility |
| Support view | Minimal operational metadata, status, support notes; no escrow override |
| Transaction history | Status, amount, fixed recipients, network and explorer links |

## Acceptance matrix

| ID | Required verification | Phase |
| --- | --- | --- |
| A01 | Both participants accept identical immutable terms; one-sided or stale acceptance cannot fund | 3–4 |
| A02 | Client funds exact test amount into correct vault; wrong signer, mint, token program or vault rejected | 4 |
| A03 | Milestone 2 cannot fund while milestone 1 is active/disputed, including competing transactions | 4–5 |
| A04 | Approval pays exact recorded amount to fixed freelancer; duplicate settlement fails | 4 |
| A05 | Timeout claim fails before review expiry and succeeds at expiry only if undisputed | 5 |
| A06 | Non-delivery refund fails before delivery expiry and after recorded delivery; succeeds at expiry if eligible | 5 |
| A07 | Disputes block ordinary payout/refund; exact boundary behavior matches rules | 5 |
| A08 | Reviewer/backup eligibility and split conservation hold; arbitrary recipients rejected | 5 |
| A09 | Mutual settlement requires matching current approvals; stale proposal/replayed approval rejected | 5 |
| A10 | Unrelated wallets cannot read evidence, alter terms, settle or impersonate reviewers | 3, 5–6 |
| A11 | Settlement clears active milestone and permits only the correct next milestone | 4–5 |
| A12 | Reloads, missed events and transaction retries reconcile without false or duplicate payment | 7 |
| A13 | Worker outage leaves eligible manual claims usable | 7 |
| A14 | Unexpected unsolicited token deposits cannot inflate recorded settlement obligations or block normal payout | 5 |
| A15 | Users understand sequential funding, silence-based release, reviewer authority and test-token limitations | 8 |

Blueprint feature coverage: wallet/auth and dashboards (3); shared agreement and both acceptances (3–4); per-milestone vault (4); private delivery/on-chain reference (4,6); approval (4); timeout and refund (5); mutual settlement/cancellation (5); disputes/reviewer (5–6); history/explorer (6–7); reminders/support (6). All 13 required feature groups are retained.

## Research workstream

Recruit 8–10 freelancers and 3–5 clients for interviews as in the blueprint. Later target observed trials with at least five freelancers and two clients. No interviews or trials have yet been performed.

Ask: describe your last direct-client project; how was payment agreed; what was funded upfront; what caused delay or dispute; how much time went into follow-up; would the client fund each milestone through a wallet; what release/review period is acceptable; whom would both parties trust to review a dispute? Record actual evidence and objections. Do not claim savings, adoption or demand from hypothetical answers.

## Original Phase 1 status and next handoff (6 October 2026)

Completed: scope mapping, phase breakdown, initial journeys, architecture/account design, proposed transition rules, screen inventory and acceptance matrix.

Still open: user interviews, usability validation of proposed defaults, actual reviewer identities and test-wallet keys, concrete environment/version selection, infrastructure accounts and deployment configuration. These are tracked work, not completed validation.

Next phase: inspect available Node/Rust/Solana/Anchor tools, verify compatible versions against official documentation, create the reproducible development foundation, and begin with a project containing at least two milestones in its fixtures. Do not collect wallet seed phrases or private keys in chat. No application or escrow has been implemented in Phase 1.
