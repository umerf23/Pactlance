# Hosted access and outage verification

Observed on 10 October 2026. Baseline main is `f803d6960a2fc46c1aaa1afea79581292b418bd0` (merged PR #9). This work does not establish production-money readiness or complete the browser, object-download, alert-routing, restore or customer gates.

## Database observations

The connected Supabase project is `pactlance`, ref `cuwftcupacfgmtvspbhm`, with eight installed migrations. Historical names/timestamps still require reconciliation as described in the README. No customer row content was included in reports.

The operator-run [hosted access probe](../scripts/hosted-access-probe.sql) passed **38 assertions** on the existing hosted schema. It uses disposable synthetic Auth/identity rows and `SET LOCAL ROLE` plus simulated request claims. Its temporary helpers, storage metadata, project, evidence, profiles and quota increments are enclosed in one transaction that ends in ROLLBACK. A separate query confirmed zero remaining synthetic projects/identities; local before/after tests also verify that no data or helpers remain.

Coverage includes client/freelancer terms and evidence, exact reviewer milestone/file metadata, exclusive primary/backup handoff, allocation-pending access, paid/settled revocation, stale legacy snapshots, outsider/support/anonymous denial, profile-owner reassignment denial, protected execution/outbox/cursors and service-only quota allow/cutoff.

This proves the tested hosted database predicates under simulated roles. It does **not** authenticate browser users, mint access tokens, upload/download Storage object bytes, check signed URL expiry, execute payments or qualify G3/G9 by itself. Do not convert it into a passing browser-observation report.

The probe is repeatable through an authorized SQL session on the intended project. It must be sent as a single transaction, including ROLLBACK; do not execute selected fixture inserts independently. Use synthetic wallets only. Any failed assertion aborts the transaction. The 30-second statement and 5-second lock limits bound individual statements, not the whole multi-statement transaction. The local regression executes this exact script both before and after the proposed migration, and requires identical passing case lists.

## Reviewed schema improvement, pending application

[20261010104341_access_policy_performance.sql](../supabase/migrations/20261010104341_access_policy_performance.sql) was generated with Supabase CLI 2.120.0 and is **not installed on the hosted project**. Automatic approval review rejected application because this persistent hosted schema/security change needs explicit approval for the exact destination and SQL. No workaround was used.

The migration:

- Adds six indexes covering the advisory's currently uncovered foreign keys.
- Wraps seven invariant `auth.uid()` policy checks in scalar SELECTs so Postgres can cache them once per query.
- Consolidates existing permissive SELECT policies on agreements, evidence and storage metadata into their existing OR union. It preserves participant, legacy reviewer, PAP reviewer, uploader, freshness and handoff predicates.
- Uses a transaction, 5-second lock timeout and 30-second statement timeout. It changes no money rules, identity bindings, grants, security-definer helpers or customer rows.

Local tests prove legacy/PAP access equivalence, reviewer revocation, profile init-plan use and creation of all six indexes. No hosted performance benchmark or after-application advisor result is claimed. The measured tables are small (under 100 KiB individually at inspection), but locking and an incorrect authorization rewrite remain rollout risks.

After approval: recheck migration history/definitions and backup readiness, apply this migration exactly once to the named project, record its actual hosted timestamp, repeat the rollback probe, query indexes/policies, and rerun security/performance advisors. Do not replay under another timestamp. Historical initial migrations remain unchanged.

Official remediation guidance: [foreign-key indexes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [RLS init plans](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan), [permissive policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

The no-policy notice for private.api_limits is intentional default browser denial. Existing unused-index notices are not grounds to remove authorization/query indexes from a young database. [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains a hosted Auth configuration item; this app supports verified wallet identities, and this patch changes no Auth provider settings.

## RPC failure and retry controls

Browser and server Connections now share a 15-second per-request timeout, preserve caller cancellation, and disable the library's hidden HTTP 429 retries. Failures surface to existing recovery/error handling. These controls do not switch networks, remove saved transactions, construct replacement payments or weaken finality requirements.

An actual local HTTP JSON-RPC fixture, using the real web3 Connection, proves that 429 and stalled responses fail without broadcasting. After saving/reloading signed bytes and creating a new Connection, retry sends those identical bytes with preflight enabled and no validator retry. Finalized and expired outcomes cause no additional broadcast; expiration still requires authoritative reconciliation. This is an automated transport/recovery regression, not a hosted outage drill or real wallet-provider test.

## Hosted application observations and blocker

The public app at https://pactlance.vercel.app reported baseline revision `f803d6960a2fc46c1aaa1afea79581292b418bd0`, devnet configured and real-money payments disabled. Protected projects/support/PAP reads returned 401. Responses had no-store, nosniff, DENY framing, no-referrer and restrictive framing/base/object CSP headers.

`/api/monitor` and `/api/worker` returned **503, Operator access is not configured**. They fail closed, but operational monitoring/worker authentication is unavailable. The deployment checker now requires unauthenticated **401** responses from configured operator endpoints; it rejects 503/unprotected responses rather than reporting readiness.

The Vercel connector returned 403 for the project's team `umerf23s-projects` (`team_q6m1IcSxcHt9zgpPUKKqGS8N`); no authenticated CLI fallback exists in this workspace. That blocks configuration inspection and setup through this session. Do not replace the team or publish credentials to bypass it.

An authorized operator must configure a server-only CRON_SECRET of at least 32 characters in the intended environment, redeploy the compatible candidate and run the deployment check. Then verify protected aggregate monitoring, install/test alert routing and observe worker/recovery drills with the correct payment profile. Never put this token in a browser, query string or public log. This patch does not configure a scheduler or send alert messages.

## Remaining external gates

Two independent browser wallets and actual hosted sessions are still needed for B01–B15, session revocation, signed downloads and provider compatibility. Hosted backup/Auth/object restoration, tested alerts/operator handoff, five freelancer/two client trials, independent security review and governance/legal/payment assessment remain unverified. Existing release gates remain blocked until genuine exact-candidate evidence is supplied.
