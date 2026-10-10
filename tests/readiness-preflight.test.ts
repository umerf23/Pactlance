import { it, expect } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
it("replaces stale success when read-only preflight sees a wrong network, missing capability or wrong binary", async () => {
  const manifest = JSON.parse(
      readFileSync("contracts/devnet-deployment.json", "utf8"),
    ),
    program = new PublicKey(manifest.program),
    mint = new PublicKey(manifest.mint),
    loader = "BPFLoaderUpgradeab1e11111111111111111111111",
    pd = new PublicKey(new Uint8Array(32).fill(42)),
    authority = new PublicKey(manifest.upgradeAuthority);
  const tag = (s: string) =>
      createHash("sha256").update(s).digest().subarray(0, 8),
    [config] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program,
    ),
    [cap] = PublicKey.findProgramAddressSync(
      [Buffer.from("pap-capability")],
      program,
    ),
    binary = Buffer.from([1, 2, 3]);
  const pa = Buffer.alloc(36);
  pa.writeUInt32LE(2);
  pd.toBuffer().copy(pa, 4);
  const data = Buffer.alloc(50);
  data.writeUInt32LE(3);
  data.writeBigUInt64LE(1n, 4);
  data[12] = 1;
  authority.toBuffer().copy(data, 13);
  binary.copy(data, 45);
  const mi = Buffer.alloc(82);
  mi.writeUInt32LE(1);
  authority.toBuffer().copy(mi, 4);
  mi[44] = 6;
  mi[45] = 1;
  const account = (buffer: Buffer, owner: string, executable = false) => ({
    data: [buffer.toString("base64"), "base64"],
    owner,
    executable,
    lamports: 10000000,
    rentEpoch: 0,
  });
  let missing = false,
    genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  const methods: string[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const q = JSON.parse(raw);
    methods.push(q.method);
    const map: Record<string, unknown> = {
      [program.toBase58()]: account(pa, loader, true),
      [pd.toBase58()]: account(data, loader),
      [mint.toBase58()]: account(
        mi,
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      ),
      [config.toBase58()]: account(
        Buffer.concat([tag("account:EscrowConfig"), mint.toBuffer()]),
        program.toBase58(),
      ),
      [cap.toBase58()]: missing
        ? null
        : account(
            Buffer.concat([tag("account:PapCapability"), Buffer.from([1])]),
            program.toBase58(),
          ),
    };
    let result: unknown;
    if (q.method === "getGenesisHash") result = genesis;
    else if (q.method === "getMultipleAccounts")
      result = {
        context: { slot: 100 },
        value: q.params[0].map((key: string) => map[key] ?? null),
      };
    else if (q.method === "getAccountInfo")
      result = { context: { slot: 100 }, value: map[q.params[0]] ?? null };
    else {
      res.writeHead(500);
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: q.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string")
    throw new Error("RPC fixture missing.");
  const dir = mkdtempSync(join(tmpdir(), "pap-preflight-")),
    artifact = join(dir, "pactlance.so"),
    report = join(dir, "report.json");
  writeFileSync(artifact, binary);
  const run = () =>
    new Promise<number | null>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "scripts/devnet-preflight.mjs",
          "--pap",
          "--artifact",
          artifact,
          "--report",
          report,
        ],
        {
          env: {
            ...process.env,
            SOLANA_RPC_URL: `http://127.0.0.1:${addr.port}`,
            NEXT_PUBLIC_ESCROW_PROGRAM_ID: manifest.program,
            NEXT_PUBLIC_TEST_TOKEN_MINT: manifest.mint,
          },
          stdio: "ignore",
        },
      );
      child.on("error", reject);
      child.on("exit", resolve);
    });
  try {
    expect(await run()).toBe(0);
    expect(JSON.parse(readFileSync(report, "utf8")).status).toBe("passed");
    missing = true;
    expect(await run()).toBe(1);
    expect(JSON.parse(readFileSync(report, "utf8")).status).toBe("failed");
    missing = false;
    writeFileSync(artifact, Buffer.from([9]));
    expect(await run()).toBe(1);
    writeFileSync(artifact, binary);
    genesis = "mainnet";
    expect(await run()).toBe(1);
    expect(JSON.parse(readFileSync(report, "utf8")).status).toBe("failed");
    expect(
      methods.every((m) =>
        ["getGenesisHash", "getMultipleAccounts", "getAccountInfo"].includes(m),
      ),
    ).toBe(true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
