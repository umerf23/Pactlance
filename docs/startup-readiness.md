# Pactlance: customer workflow and startup validation

## Product scope

Pactlance provides milestone payment protection for direct freelance relationships. Start with Pakistani video editors working with overseas agencies: each batch has agreed scope, proof of funding, private evidence and enforceable settlement rules. Solana escrow is functional application infrastructure; TEST assets currently limit it to devnet use. No claim of customer adoption, usable PKR income, independent security certification or real-money readiness is made.

Implemented entry points: `/` explains the customer proposition; `/workspace` provides authenticated work; `/workspace?project=<uuid>` opens a shared project after wallet authorization; `/guide` explains rules; `/preview` contains explicitly labelled sample data. A project link grants no access and does not accept an agreement.

The workflow is: connect and authenticate → create terms as either client or freelancer → share the private project link → inspect/accept terms → create escrow → both parties accept deployed terms on chain → client funds the exact next milestone → freelancer saves evidence and submits its commitment → client reviews/approves or eligible alternatives apply → verify finalized settlement and recipient balances → proceed to the next milestone.

## Submission acceptance gates

| Gate                | Required evidence                                                                                                               | Current state at this checkpoint                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Hosted dependencies | Quota migration applied, correct app revision, authenticated smoke test                                                         | Quota migration applied and verified; authenticated smoke test pending |
| Ordinary payment    | Two separate wallets; accepted commitment; finalized deposit and payout; correct recipient/vault balances; reload both sessions | Not observed in this checkpoint                                        |
| Alternate outcomes  | Eligible non-delivery refund, review expiry, primary/backup dispute and mutual settlement; invalid paths rejected               | Existing runtime tests; live browser observations pending              |
| Privacy             | Participant can open shared link/evidence, unrelated wallet cannot; revoked/stale access refused                                | Existing database/API tests; hosted signed-in check pending            |
| Recovery            | Unknown transaction outcome, rejection and retry; saved transaction recovery; correct state after refresh                       | Automated fault tests; real outage drill pending                       |
| Usability           | Phone/desktop, keyboard, compatible wallets, readable amounts and clear next action                                             | New onboarding and amount controls; browser observations pending       |
| Customer demand     | Actual observed sessions, objections, alternatives and willingness to use/pay                                                   | No participant results recorded                                        |

Use `docs/validation-runbook.md` to record outcomes and public transaction references. Unchecked gates stay unchecked. A working unit-test suite is not a substitute for these observations.

## Deployment and operator handover

1. Apply the reviewed `20261009094002_audit_api_limits.sql` to the matching Supabase project before deploying authenticated API changes. Verify the quota function and browser-role denial. This is an additive migration; do not recreate/delete projects to repair it.
2. Deploy the reviewed app revision with the correct Supabase, devnet RPC, program and TEST mint configuration. Keep server credentials and authority/worker keys outside Git/browser bundles.
3. On the operator's configured checkout, set `APP_URL` to the deployed origin and run `npm run check:deployment`. This checks unsigned-route rejection, app configuration and RPC availability without consuming a quota or broadcasting a transaction. It is not an authenticated workflow test.
4. Run `npm run devnet:preflight` to verify public chain identity. Use the local mint-authority tooling to provision disposable TEST assets to the client; each transaction signer needs devnet SOL. Never upload an authority key to the website or ask users for seed phrases.
5. Observe the payment workflow, record finalized balances/signatures, and complete the privacy, recovery and mobile checks. Use a limited-balance worker fee signer distinct from upgrade/mint authority. Verify the manual claim action while the worker is offline.
6. Define an operator responsible for failed uploads/RPC calls, support access, reviewer availability and incident response. In-app reminders require visits; external notification delivery is not implemented. No guaranteed reviewer service is offered.

## Reviewer operating agreement

Before naming primary/backup wallets, participants should obtain each person's agreement to serve. Agree on availability, contact method, response time, any compensation, evidence handling and conflicts of interest. The current checkbox is an attestation by the project creator; it is not a cryptographic reviewer acceptance or proof of availability. Contract reviewers can allocate only between the two original participants. The backup is exclusively eligible after its activation deadline. If neither reviewers nor parties act, disputed funds can remain locked indefinitely.

## Startup hypotheses to test

- **Buyer:** a small overseas agency commissioning recurring video batches from a Pakistani editor. The freelancer may introduce the tool; the client must still agree to fund and use a wallet.
- **Differentiation hypothesis:** portable direct-client agreements, visibly committed milestone funds and participant-approved settlement rules. Escrow itself is not unique. Compare against each participant's actual current alternative.
- **Distribution hypothesis:** recruit through existing editor/agency relationships, not a new job marketplace. Request introductions only with participant consent.
- **Revenue hypothesis:** test willingness to pay for agreement/operations service or a disclosed future transaction fee. Current platform fees are zero. No paid reviewer service or revenue is implemented; do not present hypothetical pricing as customer evidence.
- **Cost model:** account for database/storage, RPC, worker fees, support, reviewer operations, security work and eventual payment partners. Cheap on-chain fees alone do not establish low total cost.
- **Payment expansion:** a verified stablecoin, suitable client funding and legitimate payout partners need separate integration and review. No partner agreement or PKR route currently exists.

## Verification of this checkpoint

Local `npm run check` passed: secret-pattern screening, lint, TypeScript, 94 tests in 18 files, and the production build. HTTP checks against that build passed for `/`, `/guide`, `/preview` and a UUID shared-project workspace URL; these confirm server-rendered content and navigation, not wallet interactions or mobile layout. Five new tests cover exact decimal refund conversion, wrong-chain refusal, missing token accounts versus RPC errors, token account ownership/mint/spendability, and link validation. An additional SQL test verifies that the operator's invalid-limit probe leaves counters unchanged.

The deployed health route returned revision `4f3ca710ce58b845ca23db3b580d1f7ddabb6f5a`, devnet configuration enabled and real-money payments disabled. Unsigned `/api/projects` returned 401. A read-only query on the connected Supabase project returned `api_limits_available: false`, and its migration history omitted the quota migration. The local deployment-check command exited 1 because local operator credentials were unavailable; this is separate from the SQL evidence that the hosted function is absent.

Browser installation failed: the headless Chromium archive URL returned a 195-byte HTML response, so wallet/mobile/browser tests were not run. The first local server start without an explicit hostname hit `uv_interface_addresses`; specifying `127.0.0.1` started successfully. HTTP checks ran with the server and client in the same process environment. No customer-journey app changes, hosted migration, on-chain writes or fabricated participant results were published during this checkpoint.

## Observed-session worksheet

Recruit five freelancers and two clients when feasible; this is a target, not traction. Obtain consent and use synthetic work plus disposable devnet assets. Avoid recording private keys or real confidential evidence.

For each session record: date, role and anonymized identifier; current payment method; last relevant payment problem; completion time for each task; failures/help required; understanding of funding, review expiry and reviewer authority; willingness to use a wallet and pre-fund; reason to prefer/reject the product; willingness to pay; and one concrete requested change.

Report completion counts against actual attempts, not invitations. Keep measured devnet usability separate from unmeasured real-income savings. Prioritize repeatable failures and customer objections before expanding features.

## Approved rollout update — 9 October 2026

After explicit user approval, `audit_api_limits` was applied to Supabase project `cuwftcupacfgmtvspbhm`. The function exists; counters have RLS; service-role execution is allowed; anon/authenticated execution and browser counter updates are denied. A service-role test inside a rolled-back transaction confirmed that one request passes and the second fails at limit 1, leaving no test quota changes persisted. This closes the missing-function deployment blocker. Authenticated browser settlement still needs observation.

The security advisor notes [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) on the private counters: intentional default denial for clients, with the server service role using its explicit grants. The pre-existing [leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains outside the supported wallet-only sign-in path.
