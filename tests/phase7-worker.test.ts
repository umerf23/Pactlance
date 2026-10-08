import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { fixture } from "./helpers/phase7-fixture";
import { DEVNET_GENESIS } from "../src/lib/escrow/network";
const f = vi.hoisted(() => ({ context: vi.fn(), history: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/escrow/server/reconcile", () => ({
  reconcileProject: f.context,
  reconcileHistory: f.history,
}));
vi.mock("../src/lib/supabase/server", () => ({ adminSupabase: vi.fn() }));
import { runProjectWorker } from "../src/lib/escrow/server/worker";
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const p = await fixture(),
    signer = Keypair.generate();
  vi.stubEnv("CLAIM_WORKER_SECRET_KEY", bs58.encode(signer.secretKey));
  let old: Record<string, unknown> | null = null,
    win = true;
  const order: string[] = [];
  const admin = {
    from: () => {
      let write = false,
        row: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        insert: (r: Record<string, unknown>) => {
          write = true;
          row = r;
          order.push("persist");
          return q;
        },
        update: (r: Record<string, unknown>) => {
          write = true;
          row = r;
          return q;
        },
        maybeSingle: async () => {
          if (write) {
            if (!win) return { data: null, error: { code: "23505" } };
            old = { ...old, ...row, created_at: new Date().toISOString() };
            return { data: old, error: null };
          }
          return { data: old, error: null };
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(resolve({ data: null, error: null })),
      };
      return q;
    },
  };
  const connection = {
    getGenesisHash: vi.fn().mockResolvedValue(DEVNET_GENESIS),
    getSignatureStatuses: vi.fn().mockResolvedValue({ value: [null] }),
    getBlockHeight: vi.fn().mockResolvedValue(90),
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 100,
    }),
    sendRawTransaction: vi.fn(async (raw: Uint8Array) => {
      expect(raw).toBeInstanceOf(Uint8Array);
      order.push("broadcast");
      return old!.signature;
    }),
    getSlot: vi.fn().mockResolvedValue(100),
  };
  f.context.mockResolvedValue({
    admin,
    connection,
    snapshot: {
      agreement: p.a,
      state: { active: true, next: 0 },
      chainTime: 10,
      slot: 100,
      milestones: [
        { index: 0, status: 2, amount: 100000000n, reviewDeadline: 1n },
      ],
    },
  });
  return {
    p,
    connection,
    order,
    lose: () => {
      win = false;
    },
    saved: () => old,
  };
}
it("persists a signed claim before broadcasting", async () => {
  const f = await setup();
  expect((await runProjectWorker(f.p.a.terms.projectId)).claims).toBe(
    "pending",
  );
  expect(f.order).toEqual(["persist", "broadcast"]);
  expect(f.saved()?.raw).toBeTruthy();
});
it("does not broadcast a concurrent losing worker's claim", async () => {
  const f = await setup();
  f.lose();
  expect((await runProjectWorker(f.p.a.terms.projectId)).claims).toBe(
    "another_worker_owns_claim",
  );
  expect(f.connection.sendRawTransaction).not.toHaveBeenCalled();
});
it("recovers exact signed bytes after an RPC failure even without the original signer", async () => {
  const f = await setup();
  f.connection.sendRawTransaction.mockRejectedValueOnce(
    new Error("RPC outage"),
  );
  await expect(runProjectWorker(f.p.a.terms.projectId)).rejects.toThrow(
    /outage/,
  );
  expect(f.saved()?.status).toBe("pending");
  vi.stubEnv("CLAIM_WORKER_SECRET_KEY", "");
  expect((await runProjectWorker(f.p.a.terms.projectId)).claims).toBe(
    "pending",
  );
  expect(f.connection.sendRawTransaction.mock.calls[0][0]).toEqual(
    f.connection.sendRawTransaction.mock.calls[1][0],
  );
});
