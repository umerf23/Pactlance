import { beforeEach, it, expect, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
const fixtures = vi.hoisted(() => ({
  visible: null as unknown,
  user: null as unknown,
  signed: vi.fn(),
  download: vi.fn(),
  rpc: vi.fn(),
  admin: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/rate-limit", () => ({
  consumeRateLimit: async () => true,
}));
vi.mock("../src/lib/supabase/server", () => ({
  serverSupabase: async () => ({
    auth: {
      getUser: async () => ({ data: { user: fixtures.user }, error: null }),
    },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: fixtures.visible, error: null }),
      };
      return query;
    },
    storage: { from: () => ({ createSignedUrl: fixtures.signed }) },
  }),
  adminSupabase: () => {
    fixtures.admin();
    return {
      storage: { from: () => ({ download: fixtures.download }) },
      rpc: fixtures.rpc,
    };
  },
}));
import { GET, POST } from "../src/app/api/evidence/[[...path]]/route";
const wallet = Keypair.fromSeed(
  new Uint8Array(32).fill(1),
).publicKey.toBase58();
const id = "20000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.visible = null;
  fixtures.user = {
    id: "user",
    identities: [{ provider: "web3", id: `web3:solana:${wallet}` }],
  };
});
it("does not issue privileged download URLs for guessed invisible evidence", async () => {
  const r = await GET(
    new Request(`http://localhost/api/evidence/${id}/download`),
    { params: Promise.resolve({ path: [id, "download"] }) },
  );
  expect(r.status).toBe(404);
  expect(fixtures.signed).not.toHaveBeenCalled();
  expect(fixtures.admin).not.toHaveBeenCalled();
});
it("creates a short-lived link through the authenticated storage client", async () => {
  fixtures.visible = {
    id,
    status: "ready",
    kind: "file",
    storage_path: "project/evidence",
    filename: "proof.txt",
  };
  fixtures.signed.mockResolvedValue({
    data: { signedUrl: "https://storage.example/private" },
    error: null,
  });
  const r = await GET(
    new Request(`http://localhost/api/evidence/${id}/download`),
    { params: Promise.resolve({ path: [id, "download"] }) },
  );
  expect(r.status).toBe(200);
  expect(fixtures.signed).toHaveBeenCalledWith("project/evidence", 60, {
    download: "proof.txt",
  });
  expect(fixtures.admin).not.toHaveBeenCalled();
  expect(r.headers.get("cache-control")).toBe("private, no-store");
});
it("rejects uploaded content tampering before immutable completion", async () => {
  fixtures.visible = {
    id,
    status: "pending",
    kind: "file",
    uploader_wallet: wallet,
    storage_path: "project/evidence",
    byte_size: 4,
    file_hash: "a".repeat(64),
  };
  fixtures.download.mockResolvedValue({
    data: new Blob(["evil"]),
    error: null,
  });
  const r = await POST(
    new Request(`http://localhost/api/evidence/${id}/complete`, {
      method: "POST",
      headers: { origin: "http://localhost" },
    }),
    { params: Promise.resolve({ path: [id, "complete"] }) },
  );
  expect(r.status).toBe(409);
  expect(fixtures.rpc).not.toHaveBeenCalled();
});
it("rejects unsigned access and foreign-origin mutations", async () => {
  fixtures.user = null;
  const r = await GET(
    new Request(`http://localhost/api/evidence/${id}/download`),
    { params: Promise.resolve({ path: [id, "download"] }) },
  );
  expect(r.status).toBe(401);
  const mutation = await POST(
    new Request("http://localhost/api/evidence", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    }),
    { params: Promise.resolve({}) },
  );
  expect(mutation.status).toBe(403);
  expect(fixtures.admin).not.toHaveBeenCalled();
});

it("rejects a correctly hashed file whose bytes contradict its declared MIME type", async () => {
  const { sha256 } = await import("../src/lib/evidence/schema");
  const bytes = new TextEncoder().encode("not a PDF");
  fixtures.visible = {
    id,
    status: "pending",
    kind: "file",
    uploader_wallet: wallet,
    storage_path: "project/evidence",
    byte_size: bytes.length,
    file_hash: await sha256(bytes),
    mime_type: "application/pdf",
  };
  fixtures.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
  const r = await POST(
    new Request(`http://localhost/api/evidence/${id}/complete`, {
      method: "POST",
      headers: { origin: "http://localhost" },
    }),
    { params: Promise.resolve({ path: [id, "complete"] }) },
  );
  expect(r.status).toBe(409);
  expect((await r.json()).error).toMatch(/declared type/);
  expect(fixtures.rpc).not.toHaveBeenCalled();
});
