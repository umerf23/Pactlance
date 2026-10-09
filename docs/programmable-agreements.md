# Programmable Agreement Protocol (PAP v1)

## Implementation and trust boundary

PAP is an optional structured protocol inside existing `agreements.terms`. Existing membership, immutable agreement versions, wallet consent and evidence storage are reused. Legacy agreements and hashes remain compatible. Switching a saved project between legacy escrow and PAP is rejected.

**PAP executes off-chain and does not transfer funds.** The existing devnet contract enforces fixed single-submission and timeout rules. It cannot enforce configurable revisions, human-review timeouts or acknowledgement prerequisites. Binding PAP to that contract is rejected and the legacy claim worker skips PAP projects. Legacy escrow retains finalized-chain reconciliation. No Rust, IDL, account-layout change, deployment or token transfer is part of this feature. Never use mainnet during development.

`PAYMENT_PENDING` means accepted work or an allocation eligible for a future compatible adapter, never `PAID`. Agreement `COMPLETED` describes completed work decisions while payment may remain outstanding. A refund/allocation proposal is an off-chain decision, not an executed transfer. Cancellation uses authenticated timestamped consent, clearly distinct from wallet signatures. Activation and amendments use both existing wallet signatures bound to the exact version/hash/origin.

The server and database are trusted for identity, clocks, evidence validation and workflow decisions. This is not a trustless executor or proof of legal enforceability.

## Creation and execution

1. Authenticate with a supported Solana wallet. Create a project and enable **Use structured PAP terms**.
2. Select an editable template: website development, UI/UX design, graphic design, video editing, AI agents, content writing, custom software or custom work. Templates do not establish legal validity.
3. Customize scope, sequential amounts and deadlines. Date inputs use the browser's local zone and store UTC; the preview renders the configured IANA zone.
4. Define deliverables, measurable criteria and required evidence formats. Additional milestone-wide criteria also apply. Configure review hours, revision allowance, timeout, rejection and mutual cancellation rules. Optional bounded rules can require human review or open a dispute.
5. Save an immutable proposal, review all terms, compare versions and share the existing project invite link. Both participants independently sign the exact version. Then activate it.
6. The freelancer starts the next sequential milestone, uploads completed evidence and maps records to deliverables. Refresh evidence selections after uploads. Missing evidence and late submissions are rejected on the server.
7. The client acknowledges the review notice, accepts work, requests an available revision or opens a dispute. Revisions preserve the original delivery and first submission's review deadline.
8. Expiry defaults to human review. An explicitly agreed automatic-acceptance policy creates payment eligibility only after its prerequisites; required acknowledgement must come from the authenticated client. A freelancer's claim of an email notification is insufficient. Disputed work never becomes payable from a timer.
9. Reviewers find active PAP assignments in workspace operations. Only the primary reviewer before the handoff, then the backup after it, can resolve allocations. Exact base-unit refunds are bounded by the milestone amount; the balance belongs to the original freelancer.
10. Cancellation requires independent participant consent, cannot undo completed work and preserves accepted allocations. None of these workflow actions moves tokens.

Drafts are editable locally; saving appends immutable proposals. Execution remains pinned to the previous active version while a new proposal awaits both signatures. Activation cannot replace ongoing or disputed work. Completed milestone amounts, criteria, evidence requirements and per-milestone policies cannot change retroactively. Previous versions, hashes, consent and transitions remain append-only.

## Canonical format

`protocol.version = 1`; `serialization = pactlance-pap-json-v1`. New PAP strings are trimmed where the schema specifies and normalized to Unicode NFC. Object keys sort lexically, arrays preserve order, JSON escaping is encoded as UTF-8, numbers must be safe integers and financial amounts are base-unit strings. Missing optional fields are omitted. Server-derived milestone IDs, sequence numbers and the authenticated version proposer are included. Total amount is an exact BigInt sum of milestone amounts.

The existing commitment domain remains:

```
SHA-256(UTF-8("pactlance:agreement:v1\n" + salt + "\n" + canonicalJSON(terms)))
```

PAP version/serialization metadata is included in the hash. Mutable execution, counters, transition history, payment references and execution timestamps remain outside immutable terms. Legacy hashes are not normalized or rewritten. The hash identifies exact terms, not legal enforceability.

## State machine and declarative rules

Execution states: `ACTIVE`, `DISPUTED`, `COMPLETED`, `CANCELLED`. Proposal/awaiting-consent states derive from immutable versions and signatures. Milestones: `PENDING`, `IN_PROGRESS`, `UNDER_REVIEW`, `CHANGES_REQUESTED`, `DISPUTED`, `PAYMENT_PENDING`, `CANCELLED`. Submission enters review atomically; rejection uses the agreed revision/dispute path. Payment completion is absent until a verified adapter exists.

`src/lib/pap/engine.ts` centralizes authorization, version, deadlines, evidence, revisions, consent, cancellation and reviewer authority. Facts come from server reads and the server clock. Clients cannot inject state, facts, approvals or recipients.

Rules are limited to 12; facts are `review_elapsed`, `evidence_missing`, `revision_exhausted`, `submission_late`; the sole operator is `is` with a boolean. Actions: `require_human_review`, `request_information`, `open_dispute`, `mark_payment_eligible`. Rules run during explicit elapsed-review evaluation. Missing/late evidence is rejected before a valid submission, so those failure facts are normally false for recorded submissions. Human-review/dispute rules can veto payment eligibility. Eligibility rules cannot bypass agreed timeout or acknowledgement prerequisites. No eval, arbitrary JavaScript, external function invocation or token transfer is supported. In-app statuses and history notify parties; no email/push delivery is claimed.

## Persistence and rollout

Migration: `supabase/migrations/20261009111636_programmable_agreements.sql`.

- `agreement_execution`: active version, state and increasing per-project revision.
- `agreement_transitions`: append-only actor, previous/new state, timestamp, reason, triggered rules, version, request hash, idempotency key and revision. The row ID is the off-chain event reference.
- `commit_pap_transition`: service-role-only RPC, project lock, compare-and-swap revision, independent consent/version checks and payload-bound deduplication.
- Immutable version/consent triggers prevent update/delete; an amendment trigger protects completed milestones. Server validation also enforces these constraints.
- Browser reads use RLS; runtime writes and RPC are denied. Reviewers access only the active assigned version and disputed milestone evidence; file URLs remain short-lived/authenticated. Reviewer execution/history responses are filtered.

Apply the additive migration before feature deployment. It creates two tables and scoped functions/policies/triggers, with no data rewrite or contract change. Back up before rollout. Service tooling that deliberately edits/deletes terms or consent must instead append a new version. Disabling UI preserves history; do not drop history tables as a rollback.

## Verification and remaining gate

Run `npm run check`. Tests cover templates and rule injection; NFC/hash/precision; exact-version consent; evidence and deadline checks; bounded revisions without clock resets; human review; explicit timeout acknowledgement; dispute safeguards; reviewer handoff; exact allocations; independent cancellation; amendment protections; append-only history; RLS/RPC access; retries/concurrency; API origin/identity/evidence scoping; and legacy worker isolation.

PAP tests: `tests/pap-engine.test.ts`, `tests/pap-api.test.ts`, `tests/pap-database.test.ts`, `tests/pap-worker.test.ts`.

The earlier local checkout was unavailable after the session resumed. This branch restores the implementation from the conversation onto current GitHub `main` and reruns verification; it is a new recovery commit, not the inaccessible earlier local commit. Live browser-wallet flow is not claimed: verify two-party consent, acknowledgement, revisions, reviewer evidence access, amendment/cancellation after applying the migration and deploying the reviewed feature. A future payment adapter requires devnet contract tests, migration/compatibility review, explicit deployment authorization and finalized-chain reconciliation before exposing transfers.
