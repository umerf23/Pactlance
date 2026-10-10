import { it, expect } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

it("distinguishes configured operator protection from unavailable operator endpoints", async () => {
  let operatorStatus = 503;
  const server = createServer((req, res) => {
    // The verifier must never authenticate a worker cycle while probing access.
    expect(req.headers.authorization).toBeUndefined();
    const health = req.url === "/api/health";
    res.statusCode = health
      ? 200
      : req.url === "/api/projects"
        ? 401
        : operatorStatus;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(
      JSON.stringify(
        health
          ? {
              network: "devnet",
              devnetEscrowConfigured: true,
              realMoneyPaymentsEnabled: false,
            }
          : { error: "Synthetic denial" },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture missing.");
  const dir = mkdtempSync(join(tmpdir(), "deployment-probe-"));
  const script = resolve("scripts/check-deployment.mjs");
  const run = () =>
    new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, [script], {
        cwd: dir,
        env: {
          ...process.env,
          APP_URL: `http://127.0.0.1:${address.port}`,
          NEXT_PUBLIC_SUPABASE_URL: "",
          SUPABASE_SERVICE_ROLE_KEY: "",
        },
        stdio: "ignore",
      });
      child.on("error", reject);
      child.on("exit", resolve);
    });
  try {
    for (const status of [503, 401, 200]) {
      operatorStatus = status;
      expect(await run()).toBe(1); // No server quota credentials are supplied.
      const report = JSON.parse(
        readFileSync(
          join(dir, "validation-results/deployment-check.json"),
          "utf8",
        ),
      );
      expect(
        report.checks.find(
          (c: { name: string }) =>
            c.name === "operator_endpoints_configured_and_protected",
        ).passed,
      ).toBe(status === 401);
      expect(report.liveWalletJourneyVerified).toBe(false);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}, 10000);
