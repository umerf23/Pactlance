import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicOrigin } from "./lib/release-policy.mjs";

// Operator-only, read-only checks. Never publish credential values or raw errors.
const checks = [];
let revision = null;
async function check(name, run) {
  try {
    await run();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({
      name,
      passed: false,
      reason:
        error instanceof Error && error.message === "OPERATOR_ENV_MISSING"
          ? "operator_environment_missing"
          : "check_failed",
    });
  }
}
await check("application_configuration", async () => {
  const origin = new URL(publicOrigin.parse(process.env.APP_URL));
  const response = await fetch(new URL("/api/health", origin), {
    signal: AbortSignal.timeout(15000),
  });
  const health = await response.json();
  if (
    !response.ok ||
    health.network !== "devnet" ||
    !health.devnetEscrowConfigured ||
    health.realMoneyPaymentsEnabled !== false
  )
    throw new Error("Configuration mismatch.");
  revision = /^[a-f0-9]{40}$/.test(health.revision ?? "")
    ? health.revision
    : null;
});
await check("operator_endpoints_configured_and_protected", async () => {
  const origin = publicOrigin.parse(process.env.APP_URL);
  for (const path of ["/api/monitor", "/api/worker"]) {
    // No bearer is sent, so this cannot start an authorized worker cycle.
    // 503 means missing/invalid CRON_SECRET, not healthy operator protection.
    const response = await fetch(new URL(path, origin), {
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (
      response.status !== 401 ||
      typeof body.error !== "string" ||
      !response.headers.get("cache-control")?.includes("no-store")
    )
      throw new Error("Operator authentication unavailable.");
  }
});
await check("unsigned_projects_rejected", async () => {
  const response = await fetch(new URL("/api/projects", process.env.APP_URL), {
    signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 401) throw new Error("Expected authenticated route.");
});
await check("quota_rpc_available_to_server", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("OPERATOR_ENV_MISSING");
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Limit zero is rejected before INSERT: probes function/grant availability without consuming a quota or creating a user.
  const { error } = await db.rpc("consume_api_limit", {
    p_user: "00000000-0000-4000-8000-000000000000",
    p_scope: "read",
    p_limit: 0,
  });
  if (error?.code !== "P0001" || error.message !== "invalid limit")
    throw new Error("Quota RPC unavailable.");
});
const report = {
  checkedAt: new Date().toISOString(),
  revision,
  mode: "read-only-configuration-check",
  checks,
  liveWalletJourneyVerified: false,
};
mkdirSync("validation-results", { recursive: true });
writeFileSync(
  resolve("validation-results/deployment-check.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
for (const { name, passed } of checks)
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
console.log(
  "Public check results saved to validation-results/deployment-check.json. This does not verify authenticated wallet settlement.",
);
if (checks.some((entry) => !entry.passed)) process.exitCode = 1;
