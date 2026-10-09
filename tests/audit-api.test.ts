import { beforeEach, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
const f = vi.hoisted(() => ({ rpc: vi.fn(), user: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/supabase/server", () => ({
  serverSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: f.user }, error: null }) },
  }),
  adminSupabase: () => ({ rpc: f.rpc }),
}));
import {
  requireWallet,
  requireSameOrigin,
  readJSON,
  failure,
} from "../src/lib/api";
import { GET as health } from "../src/app/api/health/route";
beforeEach(() => {
  vi.clearAllMocks();
  f.user = {
    id: "00000000-0000-4000-8000-000000000001",
    identities: [
      {
        provider: "web3",
        id: `web3:solana:${Keypair.generate().publicKey.toBase58()}`,
      },
    ],
  };
  f.rpc.mockResolvedValue({ data: true, error: null });
});
it("uses a durable wallet-bound allowance for expensive escrow reads", async () => {
  await requireWallet("escrow");
  expect(f.rpc).toHaveBeenCalledWith("consume_api_limit", {
    p_user: "00000000-0000-4000-8000-000000000001",
    p_scope: "escrow",
    p_limit: 12,
  });
});
it("returns 429 when exhausted and fails closed when the counter is unavailable", async () => {
  f.rpc.mockResolvedValue({ data: false, error: null });
  try {
    await requireWallet();
    throw new Error("expected rejection");
  } catch (e) {
    expect(failure(e).status).toBe(429);
  }
  f.rpc.mockResolvedValue({
    data: null,
    error: { message: "database failure" },
  });
  try {
    await requireWallet();
    throw new Error("expected rejection");
  } catch (e) {
    expect(failure(e).status).toBe(503);
  }
});
it("does not spend privileged quotas for unsigned or unbound sessions", async () => {
  f.user = null;
  await expect(requireWallet()).rejects.toMatchObject({ status: 401 });
  f.user = { id: "user", identities: [{ provider: "email", id: "other" }] };
  await expect(requireWallet()).rejects.toMatchObject({ status: 403 });
  expect(f.rpc).not.toHaveBeenCalled();
});
it("requires the exact origin and bounds streamed JSON without trusting content-length", async () => {
  for (const origin of [
    undefined,
    "https://app.example.evil",
    "http://app.example",
  ]) {
    expect(() =>
      requireSameOrigin(
        new Request("https://app.example/api/projects", {
          headers: origin ? { origin } : {},
        }),
      ),
    ).toThrow();
  }
  const req = new Request("https://app.example/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: "a".repeat(128000) }),
  });
  await expect(readJSON(req)).rejects.toMatchObject({ status: 413 });
});
it("health exposes configuration rather than stale phase or payment-readiness claims", async () => {
  const r = health();
  const data = await r.json();
  expect(data.mode).toBe("devnet-prototype");
  expect(data.realMoneyPaymentsEnabled).toBe(false);
  expect(data).not.toHaveProperty("phase");
  expect(r.headers.get("cache-control")).toBe("no-store");
});
