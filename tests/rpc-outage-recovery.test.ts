import { it, expect } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { boundedRpcConfig } from "../src/lib/escrow/connection";
import { DEVNET_GENESIS } from "../src/lib/escrow/network";
import {
  captureSignedTransaction,
  recoverTransaction,
  validatePending,
} from "../src/lib/escrow/recovery";
import { fixture } from "./helpers/phase7-fixture";

it("recovers from HTTP RPC outages using persisted bytes without hidden retries or duplicate broadcasts", async () => {
  const f = await fixture();
  f.tx.partialSign(f.keys[1]);
  const pending = captureSignedTransaction(
    f.tx,
    f.a.terms.projectId,
    f.keys[0].publicKey,
    "cancel",
    100,
  );
  const dir = mkdtempSync(join(tmpdir(), "rpc-recovery-")),
    file = join(dir, "pending.json");
  writeFileSync(file, JSON.stringify(pending), { mode: 0o600 });
  let mode = "normal";
  const methods: string[] = [],
    broadcasts: Buffer[] = [],
    broadcastOptions: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const q = JSON.parse(body);
    methods.push(q.method);
    if (q.method === "getSignatureStatuses" && mode === "429") {
      res.writeHead(429);
      res.end("synthetic rate limit");
      return;
    }
    if (q.method === "getSignatureStatuses" && mode === "timeout") return;
    let result: unknown;
    if (q.method === "getGenesisHash") result = DEVNET_GENESIS;
    else if (q.method === "getSignatureStatuses")
      result = {
        context: { slot: 100 },
        value: [
          mode === "finalized"
            ? {
                slot: 100,
                confirmations: null,
                err: null,
                confirmationStatus: "finalized",
              }
            : null,
        ],
      };
    else if (q.method === "getBlockHeight")
      result = mode === "expired" ? 101 : 90;
    else if (q.method === "sendTransaction") {
      broadcasts.push(Buffer.from(q.params[0], "base64"));
      broadcastOptions.push(q.params[1]);
      result = pending.signature;
    } else {
      res.writeHead(500);
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: q.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("RPC fixture missing.");
  const connection = () =>
    new Connection(`http://127.0.0.1:${address.port}`, boundedRpcConfig(200));
  const saved = () => validatePending(JSON.parse(readFileSync(file, "utf8")));
  try {
    for (const outage of ["429", "timeout"]) {
      mode = outage;
      methods.length = 0;
      await expect(
        recoverTransaction(connection(), saved(), true),
      ).rejects.toThrow();
      expect(methods.filter((m) => m === "getSignatureStatuses")).toHaveLength(
        1,
      );
      expect(broadcasts).toHaveLength(0);
      expect(saved()).toEqual(pending);
    }
    mode = "normal";
    expect(await recoverTransaction(connection(), saved(), true)).toBe(
      "pending",
    );
    // A fresh Connection plus a disk reload simulates the recovery caller restarting.
    expect(await recoverTransaction(connection(), saved(), true)).toBe(
      "pending",
    );
    expect(broadcasts).toHaveLength(2);
    for (const bytes of broadcasts)
      expect(bytes).toEqual(Buffer.from(bs58.decode(pending.raw)));
    for (const options of broadcastOptions) {
      // web3 omits skipPreflight=false; the RPC default still checks preflight.
      expect(options.skipPreflight).not.toBe(true);
      expect(options).toMatchObject({
        maxRetries: 0,
        preflightCommitment: "confirmed",
      });
    }
    mode = "finalized";
    expect(await recoverTransaction(connection(), saved(), true)).toBe(
      "finalized",
    );
    expect(broadcasts).toHaveLength(2);
    mode = "expired";
    expect(await recoverTransaction(connection(), saved(), true)).toBe(
      "expired_requires_reconciliation",
    );
    expect(broadcasts).toHaveLength(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}, 10000);

it("preserves caller cancellation while bounding RPC fetches", async () => {
  const controller = new AbortController();
  controller.abort();
  const config = boundedRpcConfig();
  await expect(
    config.fetch!("http://127.0.0.1:1", { signal: controller.signal }),
  ).rejects.toThrow();
  expect(() => boundedRpcConfig(0)).toThrow();
});
