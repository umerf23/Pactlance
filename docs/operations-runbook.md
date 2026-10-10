# Pactlance operations and recovery runbook

This is a procedure to execute and record, not proof that hosted alerts, owners or restore drills already exist. Use synthetic work and devnet funds. Keep incident evidence private and redacted.

## Assign accountable owners

Before an external pilot, name the deployment owner, incident owner, upgrade authority custodian and reviewer coordinator in the release record. Each needs a named backup, access to their required tools and an observed handoff. Identify primary/backup reviewers and confirm availability, response expectations and fees before participants accept terms. Naming a wallet or checking an attestation is not that reviewer's cryptographic acceptance.

| Responsibility | Required readiness                                                                    |
| -------------- | ------------------------------------------------------------------------------------- |
| Deployment     | Knows candidate SHA, migration definitions, flags, compatible rollback                |
| Incident       | Receives tested alerts, coordinates recovery, preserves evidence                      |
| Upgrade        | Protects existing authority/backups; reviews code/binary; no mainnet use              |
| Reviewers      | Available primary/backup, correct exclusive handoff, authorization and evidence scope |

## Monitor and route alerts

`GET /api/monitor` requires the same server-only CRON_SECRET bearer as the worker (at least 32 characters). It is read-only and no-store. Store the token in the monitoring provider's secret field, never in a URL/browser or published log. Support members can refresh equivalent diagnostics in the workspace.

Metrics include active milestones, stale active snapshots (over 300 seconds), open disputes, pending/stuck claims (over 180 seconds), failed claims in 24 hours and agreements with PAP payment pending. Counts use head queries with a 15-second query timeout; errors/null counts produce unavailable with HTTP 503. They are operational indicators, not chain-finality or solvency proof. A stale snapshot can occur while an app has not reconciled it.

Route unavailable/attention metrics and failed/partial worker cycles to the incident owner. Configure your actual log/uptime provider, poll interval and escalation contacts; this patch sends no messages and installs no external alert routes. Trigger a synthetic failure, observe the alert, acknowledge and resolve it, and attach redacted evidence to G9.

Fixed log events: api_failure, api_unavailable, quota_unavailable, worker_cycle, monitor_unavailable. Only generated request IDs, timestamps and explicit numeric fields are logged. Unexpected API errors are not logged verbatim. Review hosted platform access and log/build retention separately; local credential redaction is heuristic.

Proposed initial response targets: acknowledge a service failure within 15 minutes during staffed devnet evaluation, inspect pending operations within 30 minutes, record recovery outcome before reopening affected actions. These are unmeasured targets, not achieved service-level claims. Assign and test actual availability before customer commitments.

## Triage pending or inconsistent operations

1. Record candidate/deployment, program/mint/genesis, agreement version/commitment, affected milestone, request ID and finalized transaction signature if available. Do not copy raw signed bytes, private evidence or credentials into public incidents.
2. Distinguish requested, signed, broadcast, confirmed, finalized and failed. Never set PAID from a button press or a pending signature.
3. Inspect the saved pending transaction and authoritative devnet signature status, block height, program accounts and actual recipient/vault base-unit balances through authorized tools.
4. Reconcile finalized state/history. An RPC outage or missing signature response does not prove expiration or failure.
5. Reuse the saved transaction recovery controls. Do not construct a replacement until expiration and authoritative reconciliation prove the first attempt cannot settle. Do not manually rewrite execution/payment state to make the UI appear successful.
6. Restore the intended RPC or rotate an exposed RPC credential. Confirm genesis and identity before resuming. Do not silently switch networks or wallets.
7. Verify exact allocation, duplicate rejection and converged application history; preserve final evidence and close the incident.

For outbox persistence failure, verify no new broadcast occurred, restore database availability and retry the guarded path. Concurrent workers rely on guarded ownership/constraints; do not bypass them. Missed history must reconcile from the saved cursor with verified finalized sequencing; do not skip signatures to clear a warning.

The legacy claim worker cannot automatically transfer PAP funds. PAP acceptance/allocation eligibility is off-chain; authorized wallet transactions execute payments. Use only recovery/actions supported by the bound payment profile.

## Stop/restart the worker safely

1. Stop the external scheduler/worker loop and revoke/rotate CRON_SECRET to prevent new authenticated cycles. Restrict worker signing credentials if compromised.
2. Preserve outbox records and reconciliation cursors in a restricted backup. Removing a key/token does not invalidate already signed transactions, which may still be broadcast.
3. Inspect/reconcile saved signatures before treating stopped work as cancelled. Never delete outbox rows to bypass pending ownership.
4. Restore database/RPC, restart one worker, verify recovery and then test intended concurrency. Confirm partial failure returns 503 rather than appearing healthy.
5. Record RPC 429/timeout, restart, concurrent worker, outbox and missed-event results in G8/G9.

## Handle disputes and reviewer absence

Keep ordinary payment/refund locked during a dispute. Verify the currently exclusive reviewer and the chain's handoff time before exposing evidence or signing allocation. Support membership is not reviewer/payment authority. If the primary cannot act, wait for the agreed exclusive backup boundary and use the authorized backup. If both cannot act, use only an existing permitted mutual-resolution route or human coordination. Do not invent an administrator payout, timer refund or bypass. Funded disputes may remain locked indefinitely without an authorized resolution; disclose and plan for this before funding.

## Compatible rollback

1. Stop deployment promotion and disable affected app payment actions using the server-only PAP flag while triaging. A flag does not revoke chain authority or invalidate signed transactions.
2. Preserve current database state, identities, binary hash and funded obligations. Identify the last compatible application commit.
3. Verify that application version understands current immutable agreements, schema and payment profile. Deploy a tested compatible build; never roll back to code that cannot read existing funded obligations.
4. Do not undo migrations or downgrade deployed contracts blindly. A contract rollback needs separate authorized review/tests of current account layouts and outstanding operations.
5. Reconcile pending/finalized actions, test private access, refresh activity and compare balances before restoring actions. Record G9 evidence.

## Hosted backup and restoration drill

1. Create an isolated restoration environment with no production scheduler, signing keys, external notifications or mainnet RPC. Restrict access.
2. Export/backup the database, including immutable agreement versions, consent, execution/history, escrow bindings/cache, event history, pending outbox and cursors. Protect the backup as sensitive.
3. Back up private evidence objects and their metadata separately. A database backup alone does not restore object contents. Preserve compatible Auth IDs/verified identities and configuration using the provider-supported process.
4. Restore database/Auth/object contents in the isolated environment. Verify migration definitions, grants, RLS, service-only functions, bucket privacy, size/MIME restrictions and secret configuration. Never make the evidence bucket public to simplify recovery.
5. Compare representative agreements/hashes/consent/history and object hashes. Test participant reads, outsider denial, support evidence denial and exclusive reviewer handoff. Check no pending signed bytes or private files reach clients/logs.
6. Reconcile funded/pending obligations against authoritative devnet state. Keep signing/scheduling disabled until the source of truth and restored cursors/outbox agree. No synthetic extra payment should be sent as part of recovery.
7. Record restore duration, data-loss window, missing objects, failures, owner and next action; keep traffic closed if funded obligations or privacy cannot be recovered. Attach real G9 evidence.

The local PGlite regression performs a real archive restore and checks metadata/roles/immutability. It uses synthetic Auth/storage rows, not hosted sessions or actual evidence-object bytes, and does not establish hosted restore capability, RPO or RTO.

## Risk register and handoff

| Risk                        | Required control/evidence                                                              | Owner to assign           |
| --------------------------- | -------------------------------------------------------------------------------------- | ------------------------- |
| RPC unreliable              | Intended genesis/identity, bounded failure reporting, saved transaction reconciliation | Incident owner            |
| Signed transaction retained | Restricted outbox, guarded retries, finalized balance verification                     | Incident/upgrade owners   |
| Reviewer unavailable        | Primary/backup availability and funded recovery procedure                              | Reviewer coordinator      |
| Evidence lost               | Private object plus database/Auth restore drill                                        | Deployment owner          |
| Bad rollback                | Tested compatible source/schema/account version                                        | Deployment/upgrade owners |
| Privileged key compromise   | Custody, restricted access, response and external review                               | Upgrade custodian         |
| Application abuse           | Quota denial and hosted authenticated negative tests                                   | Deployment owner          |

Leave ownership and gates blocked until real people accept responsibilities and actual evidence exists. Customer pilot and independent security/legal review remain external release requirements.
