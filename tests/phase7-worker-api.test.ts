import { it, expect, vi, afterEach } from "vitest";
const f = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/escrow/server/worker", () => ({ runWorker: f.run }));
import { GET } from "../src/app/api/worker/route";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("refuses an unconfigured scheduler", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(new Request("http://localhost/api/worker"))).status).toBe(
    503,
  );
  expect(f.run).not.toHaveBeenCalled();
});
it("rejects an incorrect bearer before privileged work", async () => {
  vi.stubEnv("CRON_SECRET", "s".repeat(32));
  expect(
    (
      await GET(
        new Request("http://localhost/api/worker", {
          headers: { authorization: "Bearer wrong" },
        }),
      )
    ).status,
  ).toBe(401);
  expect(f.run).not.toHaveBeenCalled();
});
it("accepts the scheduler token with no-store responses", async () => {
  vi.stubEnv("CRON_SECRET", "s".repeat(32));
  f.run.mockResolvedValue([]);
  const r = await GET(
    new Request("http://localhost/api/worker", {
      headers: { authorization: `Bearer ${"s".repeat(32)}` },
    }),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(f.run).toHaveBeenCalledOnce();
});
