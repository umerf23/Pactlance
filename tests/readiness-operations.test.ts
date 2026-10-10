import { it, expect, vi, beforeEach, afterEach } from "vitest";
const f = vi.hoisted(() => ({ admin: vi.fn(), run: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/supabase/server", () => ({
  adminSupabase: f.admin,
  serverSupabase: vi.fn(),
}));
vi.mock("../src/lib/escrow/server/worker", () => ({ runWorker: f.run }));
import { operationalHealth } from "../src/lib/operations/server/health";
import { GET as monitor } from "../src/app/api/monitor/route";
import { GET as worker } from "../src/app/api/worker/route";
import { failure } from "../src/lib/api";
const secret = "s".repeat(32),
  request = () =>
    new Request("http://localhost/api/monitor", {
      headers: { authorization: `Bearer ${secret}` },
    });
function database(counts: (number | null)[], error = false) {
  let index = 0;
  const select = vi.fn();
  const from = vi.fn(() => {
    const i = index++;
    const q = {
      select: (...args: unknown[]) => {
        select(...args);
        return q;
      },
      abortSignal: () => q,
      in: () => q,
      lt: () => q,
      eq: () => q,
      gte: () => q,
      contains: () => q,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          count: counts[i],
          error: error ? { message: "secret database error" } : null,
        }).then(resolve),
    };
    return q;
  });
  const db = { from };
  return { db: db as unknown as ReturnType<typeof f.admin>, from, select };
}
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it("queries only bounded aggregate counts, never private rows or signed transactions", async () => {
  const { db, from, select } = database([1, 0, 0, 0, 0, 0, 0]);
  const result = await operationalHealth(db);
  expect(result.status).toBe("ok");
  expect(from).toHaveBeenCalledTimes(7);
  for (const args of select.mock.calls)
    expect(args).toEqual(["project_id", { head: true, count: "exact" }]);
  expect(JSON.stringify(result)).not.toMatch(/raw|evidence|signature|secret/);
});
it("flags stale snapshots or stuck and failed claims", async () => {
  expect(
    (await operationalHealth(database([2, 1, 0, 1, 1, 1, 0]).db)).status,
  ).toBe("attention");
});
it("reports unavailable metrics as null rather than healthy zero", async () => {
  expect(
    await operationalHealth(database([0, null, 0, 0, 0, 0, 0]).db),
  ).toMatchObject({ status: "unavailable", counts: null });
  expect(
    await operationalHealth(database([0, 0, 0, 0, 0, 0, 0], true).db),
  ).toMatchObject({ status: "unavailable", counts: null });
});
it("rejects a wrong bearer before privileged reads", async () => {
  expect(
    (
      await monitor(
        new Request("http://localhost/api/monitor", {
          headers: { authorization: "Bearer wrong" },
        }),
      )
    ).status,
  ).toBe(401);
  expect(f.admin).not.toHaveBeenCalled();
});
it("serves authorized monitoring without cache and fails closed on errors", async () => {
  f.admin.mockReturnValue(database([0, 0, 0, 0, 0, 0, 0]).db);
  const r = await monitor(request());
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  f.admin.mockReturnValue(database([0, 0, 0, 0, 0, 0, 0], true).db);
  expect((await monitor(request())).status).toBe(503);
});
it("returns 503 on partial worker failure while recording numeric safe diagnostics", async () => {
  f.run.mockResolvedValue([
    { projectId: "private-project", error: "reconciliation_or_claim_failed" },
  ]);
  const r = await worker(request());
  expect(r.status).toBe(503);
  expect((await r.json()).summary).toEqual({ processed: 1, failed: 1 });
  const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
  expect(logs).toContain("worker_cycle");
  expect(logs).not.toContain("private-project");
});
it("never logs raw unexpected errors, private RPC URLs or evidence in development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const r = failure(
    new Error("secret evidence https://rpc.example/?api-key=private"),
  );
  expect(r.status).toBe(500);
  expect((await r.json()).requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(
    /secret evidence|api-key=private/,
  );
});
