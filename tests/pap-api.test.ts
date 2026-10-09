import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { terms, project, wallets } from "./pap-fixture";
import { agreementCommitment } from "../src/lib/agreements/crypto";
const f = vi.hoisted(() => ({
  user: null as unknown,
  record: null as unknown,
  runtime: null as unknown,
  approvals: [] as unknown[],
  prior: null as unknown,
  rpc: vi.fn(),
  admin: vi.fn(),
  reconcile: vi.fn(),
  queries: [] as { table: string; filters: Record<string, unknown> }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/escrow/server/reconcile", () => ({
  reconcileProject: f.reconcile,
}));
vi.mock("../src/lib/rate-limit", () => ({
  consumeRateLimit: async () => true,
}));
vi.mock("../src/lib/supabase/server", () => ({
  serverSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: f.user }, error: null }) },
  }),
  adminSupabase: () => {
    f.admin();
    return {
      rpc: f.rpc,
      from: (table: string) => {
        const filters: Record<string, unknown> = {};
        f.queries.push({ table, filters });
        const result = () => ({
          data:
            table === "agreement_execution"
              ? f.runtime
              : table === "projects"
                ? {
                    id: project,
                    current_version: 1,
                    client_wallet: wallets[0],
                    freelancer_wallet: wallets[1],
                  }
                : table === "agreements"
                  ? f.record
                  : table === "agreement_acceptances"
                    ? f.approvals
                    : table === "agreement_transitions"
                      ? f.prior
                      : [],
          error: null,
        });
        const q = {
          select: () => q,
          eq: (k: string, v: unknown) => {
            filters[k] = v;
            return q;
          },
          in: (k: string, v: unknown) => {
            filters[k] = v;
            return q;
          },
          maybeSingle: async () => result(),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve(result()).then(resolve),
        };
        return q;
      },
    };
  },
}));
import { POST, GET } from "../src/app/api/pap/route";
const key = "20000000-0000-4000-8000-000000000001",
  command = {
    projectId: project,
    version: 1,
    expectedRevision: 0,
    idempotencyKey: key,
    action: "activate",
    reason: "Both parties reviewed these terms",
  };
const request = (body: unknown = command, origin = "http://localhost") =>
  new Request("http://localhost/api/pap", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(async () => {
  vi.clearAllMocks();
  f.queries = [];
  f.runtime = null;
  f.prior = null;
  f.user = {
    id: "user",
    identities: [{ provider: "web3", id: `web3:solana:${wallets[0]}` }],
  };
  const t = terms(),
    salt = "a".repeat(64),
    commitment = await agreementCommitment(t, salt);
  f.record = { project_id: project, version: 1, terms: t, salt, commitment };
  f.approvals = wallets.slice(0, 2).map((wallet) => ({ wallet, commitment }));
  f.rpc.mockResolvedValue({
    data: { state: { status: "ACTIVE" }, revision: 1 },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
it("rejects unsigned and foreign-origin writes before privileged reads", async () => {
  f.user = null;
  expect((await POST(request())).status).toBe(401);
  expect(f.admin).not.toHaveBeenCalled();
  expect(
    (await POST(request(command, "https://attacker.example"))).status,
  ).toBe(403);
  expect(f.admin).not.toHaveBeenCalled();
});
it("validates wallet consent and persists activation through the atomic RPC", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(f.rpc).toHaveBeenCalledWith(
    "commit_pap_transition",
    expect.objectContaining({
      p_actor: wallets[0],
      p_version: 1,
      p_action: "activate",
      p_expected_revision: 0,
      p_idempotency_key: key,
    }),
  );
  f.rpc.mockClear();
  f.approvals = [];
  expect((await POST(request())).status).toBe(409);
  expect(f.rpc).not.toHaveBeenCalled();
});
it("does not disclose protocol state to unrelated authenticated wallets", async () => {
  f.user = {
    id: "outsider",
    identities: [{ provider: "web3", id: `web3:solana:${wallets[4]}` }],
  };
  expect(
    (await GET(new Request(`http://localhost/api/pap?project=${project}`)))
      .status,
  ).toBe(404);
  expect(f.rpc).not.toHaveBeenCalled();
});
it("refuses tampered terms and client-injected facts", async () => {
  (f.record as { commitment: string }).commitment = "0".repeat(64);
  expect((await POST(request())).status).toBe(409);
  expect(
    (await POST(request({ ...command, evidence: { all: true } }))).status,
  ).toBe(400);
  expect(f.rpc).not.toHaveBeenCalled();
});
it("returns an identical retry without processing the transition again", async () => {
  const { createHash } = await import("node:crypto"),
    { canonicalJSON } = await import("../src/lib/agreements/crypto");
  f.prior = {
    actor: wallets[0],
    request_hash: createHash("sha256")
      .update(canonicalJSON(command))
      .digest("hex"),
    new_state: { status: "ACTIVE" },
    execution_revision: 1,
  };
  vi.stubEnv("PAP_PAYMENTS_ENABLED", "true");
  f.runtime = { revision: 1, active_version: 1, state: { milestones: [] } };
  const r = await POST(request());
  expect(r.status).toBe(200);
  expect((await r.json()).duplicate).toBe(true);
  expect(f.rpc).not.toHaveBeenCalled();
  expect(f.reconcile).not.toHaveBeenCalled();
});
it("refuses amendment activation while a milestone is still funded on chain", async () => {
  vi.stubEnv("PAP_PAYMENTS_ENABLED", "true");
  f.runtime = { revision: 1, active_version: 1, state: { milestones: [] } };
  f.reconcile.mockResolvedValue({ snapshot: { state: { active: true } } });
  const r = await POST(request({ ...command, expectedRevision: 1 }));
  expect(r.status).toBe(409);
  expect((await r.json()).error).toContain("Settle the funded escrow");
  expect(f.reconcile).toHaveBeenCalledWith(project);
  expect(f.rpc).not.toHaveBeenCalled();
});
it("binds evidence lookup to project, version, milestone, purpose and uploader", async () => {
  f.user = {
    id: "freelancer",
    identities: [{ provider: "web3", id: `web3:solana:${wallets[1]}` }],
  };
  f.runtime = {
    revision: 1,
    active_version: 1,
    state: {
      version: 1,
      status: "ACTIVE",
      activatedAt: new Date().toISOString(),
      milestones: [{ state: "IN_PROGRESS", revisions: 0 }],
    },
  };
  const r = await POST(
    request({
      ...command,
      expectedRevision: 1,
      action: "submit",
      milestoneIndex: 0,
      deliveries: [{ deliverableId: "deliverable-1", evidenceIds: [key] }],
    }),
  );
  expect(r.status).toBe(409);
  expect(f.rpc).not.toHaveBeenCalled();
  expect(f.queries.find((q) => q.table === "evidence")?.filters).toEqual(
    expect.objectContaining({
      project_id: project,
      agreement_version: 1,
      milestone_index: 0,
      purpose: "delivery",
      uploader_wallet: wallets[1],
      status: "ready",
      id: [key],
    }),
  );
});
