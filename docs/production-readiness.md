# Release qualification and remaining production gates

Pactlance remains devnet-only. This work improves failure reporting, privacy and repeatability. It does not establish independent security review, completed browser/customer trials, or real-money readiness.

The changes start from main commit `24ea17200f230dbae3ba102685d54d73f7d55ffb`. Qualify the new candidate commit; do not reuse results from an earlier source revision. No contract instructions, account layout, program/mint identity, recipients or financial rules changed. IDL changes are formatting only.

## Implemented controls

| Gap                        | Control                                                                                                              | Evidence still needed                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Mixed test results         | Clean SHA/tree, lockfile hash, actual pinned tools, outcomes and SBF hash in release reports                         | Successful checks on the exact candidate                        |
| Formatting omitted         | `npm run check` now includes Prettier; pre-existing failures corrected                                               | Fresh full application check                                    |
| CI evidence missing        | Separate JSON artifacts on success/failure and sensitive-change classification                                       | Review actual changes and successful CI jobs                    |
| Stale deployment reports   | Preflight/upgrade attempts replace earlier success with `in_progress` then actual outcome                            | Fresh intended-deployment observations                          |
| Deployment identity        | Finalized slots, manifest authority, mint decimals, PAP capability and optional exact binary plus zero-padding check | Reviewed intended RPC and independent source reproduction       |
| Misleading PAP reminders   | Bound payment profile verified; unknown fails closed; PAP requires explicit wallet authorization                     | Observed wallet/UI compatibility                                |
| Hidden worker failures     | Partial failure returns 503 and safe numeric diagnostics; signed retry records use the new attempt timestamp         | Hosted scheduler/restart/outage drills                          |
| Stuck-operation visibility | Support diagnostics and protected `/api/monitor`; missing counts are unavailable, never healthy zero                 | Alert routing and incident owners                               |
| Error privacy              | Fixed log events and request IDs replace raw API errors; diagnostic log credential redaction                         | Hosted log/build review; heuristics are not a complete detector |
| Backup recovery            | Actual PGlite archive restore checks terms, consent, execution/history, evidence metadata, outbox/cursor and RLS     | Hosted database/Auth/private-object restore                     |
| Unsupported release claims | Evidence gates reject stale, dirty, wrong-source, wrong-environment or incomplete results                            | Accountable review of genuine observations                      |

## Run exact-candidate checks

Use Node 24.19.0/npm 11.9.0, native Rust 1.90.0, Agave 2.3.0 and SBF platform-tools v1.56. Commit reviewed changes first, then run from a clean checkout:

```sh
npm ci
npm run verify:release -- --suite web
npm run verify:release -- --suite native
npm run verify:release -- --suite runtime
```

Native/runtime tools must be on PATH. Use Ubuntu/WSL on Windows. Reports are `validation-results/ci/<suite>.json`; redacted logs stay local. Missing tools, failures, dirty source or changed source cannot pass. The runtime verifier also checks that the selected Solana compiler belongs to platform-tools v1.56 (Rust 1.89.0); a silent fallback cannot pass. Runtime tests stop if compilation fails, preventing use of an old binary after a failed build.

CI uploads JSON only, with 30-day retention. PR merge refs may differ from proposed head commits; requalify after merging changes the identity. Never combine different commits' results. Reports expire after 72 hours; refresh sooner after material environment changes.

## Initialize and assess a release

```sh
npm run release:init -- --app https://YOUR_PREVIEW_HOST --target pap-preview
npm run release:assess
```

Use the actual app origin. Initialization refuses to overwrite existing records/templates. All live gates start NOT_RUN and owners remain unset. Generated observation templates contain the required IDs and no fabricated results. Keep validation-results private and ignored. Securely archive previous records before starting a new candidate.

| Gate | Required evidence                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| G1   | Fresh clean same-source web/native/runtime checks with executed test counts; manual PASS cannot override                                  |
| G2   | Read-only preflight: devnet genesis, exact identities, six decimals, PAP version 1, matching tested artifact bytes and padding            |
| G3   | Migration/access metadata, participant access, reviewer handoff, outsider/support evidence denial, private storage, quota failure         |
| G4   | Explicitly authorized upgrade, finalized binary/capability verification, compatible recovery plan                                         |
| G5   | Scripted PAP devnet workflow, finalized transaction slots and verified balances                                                           |
| G6   | B01–B06/B15: two wallets, same identity, dual acceptance, sequential funding, delivery, exact payout, duplicate denial and history        |
| G7   | B07–B13: stale delivery, valid refund, deadline boundaries, dispute lock, authorized reviewer, mutual allocation, amendments/cancellation |
| G8   | B14 plus RPC 429/timeout, outbox failure, worker restart/concurrency, missed events, stale snapshots, manual recovery                     |
| G9   | Hosted access, tested alerts, recovery, backup restore, compatible rollback, operator handoff; all four owners assigned                   |
| G10  | Observed synthetic-work sessions with five freelancers and two clients                                                                    |
| G11  | Independent security/source review, key governance, legal/payment assessment and funded recovery                                          |

Preview requires G1–G5 and only means ready for controlled browser validation. A devnet pilot requires G1–G9; G10 records observed customer validation. Mainnet always returns NO_GO because mainnet execution is unsupported, regardless of gate selections.

Run deployment observations without sending transactions:

```sh
npm run devnet:preflight -- --pap --artifact contracts/target/deploy/pactlance.so --report validation-results/devnet-preflight.json
npm run check:deployment
```

Configure public devnet identities and intended RPC locally. Deployment check additionally needs APP_URL and server credentials. Never commit credentials. Byte equality establishes an observation under the selected RPC; it is not an independent reproducible build.

Only an explicitly authorized operator holding the existing authority and backups may perform the upgrade and scripted transactions:

```sh
npm run upgrade:pap:devnet -- --upgrade
npm run test:pap:devnet
```

These require clean source and use devnet SOL/TEST. Keep PAP disabled until compatible upgrade, capability, schema and script checks pass. See [PAP payments](pap-payments.md) for controlled enablement/browser validation. Do not run the initial-deployment helper to replace a funded deployment.

After reviewing a real report:

```sh
npm run release:attach -- --gate G2 --evidence validation-results/devnet-preflight.json --reviewer YOUR_REVIEWER_NAME
npm run release:assess
```

Attachment computes a digest; it alone cannot pass a gate. Assessment verifies source, target, freshness, digest and required observations. Changes to an attached file require another review/attachment.

Each automated suite must have exactly one report with the recorded pinned Node/npm and relevant Rust/SBF versions. Manual observation reports must contain each required ID exactly once, all with PASS and a nonblank evidence reference. Duplicate, conflicting, missing or unexpected observations block the gate; a passing entry cannot hide a failed entry.

Starting an assessment replaces any previous decision with NO_GO before reading evidence. A rejected assessment therefore cannot leave an earlier approval available. Attaching replacement evidence also invalidates the prior decision until reassessment succeeds. Keep archived decisions separately; use only the current release-decision.json for the current candidate.

For manual templates, fill each observation from an actual run with PASS, FAIL, BLOCKED or NOT_RUN and a redacted screenshot/log/transaction/balance reference. Mark the report `passed` only after every required observation passed; record its actual checkedAt. Preserve app/source/program/mint identity. Reviewer names are timestamped operator records, not cryptographic signatures. This local tool does not independently authenticate reviewer identity or observation truth and does not change deployment flags.

`validation-results/release-decision.json` contains all gates. NO_GO exits nonzero. Automated test fixtures are synthetic and must never be attached as hosted/browser proof.

## Hosted metadata observation

A read-only inspection on 2026-10-10 confirmed all 18 public/private application tables have RLS enabled and no anonymous SELECT grants; the evidence bucket is private with a 20 MiB limit. Eight migrations are present. Hosted timestamps for phase3/private_auth_helpers and the final three migrations differ from local filenames: compare reviewed definitions and names instead of assuming timestamp equality.

The earlier security review found an intentional no-policy notice on private.api_limits (default browser denial) and disabled leaked-password protection. Review password protection if password authentication is exposed; do not add permissive policies to silence the private-table notice. [Password security remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

The advisory backlog includes uncovered foreign keys, per-row Auth function evaluations and multiple permissive policies. It is not resolved by this patch; optimize without weakening access semantics. [Index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [RLS evaluation guidance](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan).

Metadata inspection is not an authenticated G3/G9 privacy pass. Participant, outsider, support, reviewer, session revocation and private signed-download paths still need target-environment testing.

## External requirements

The remaining gates need independently controlled browser wallets, a deployed candidate, hosted authenticated sessions, alert routing, isolated hosted restore, available primary/backup reviewers, observed pilot users, and independent security/legal assessment. No such evidence is manufactured by this work. Do not share seed phrases, service keys, sessions or private RPC URLs.

Use the [operations runbook](operations-runbook.md) to assign accountable owners and conduct recovery. Mainnet and real funds remain NO_GO.
