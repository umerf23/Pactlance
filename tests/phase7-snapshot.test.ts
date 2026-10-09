import { it, expect, vi } from "vitest";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, type AccountInfo } from "@solana/web3.js";
import { fixture } from "./helpers/phase7-fixture";
import { readEscrow } from "../src/lib/escrow/snapshot";
import { DEVNET_GENESIS } from "../src/lib/escrow/network";
import {
  addresses,
  discriminator,
  encodeProjectTerms,
} from "../src/lib/escrow/client";
import { bindAgreement } from "../src/lib/escrow/terms";
import { agreementCommitment } from "../src/lib/agreements/crypto";
async function setup() {
  const f = await fixture(),
    d = addresses(f.a),
    account = (data: Buffer, owner = d.program, executable = false) =>
      ({ data, owner, executable, lamports: 1 }) as AccountInfo<Buffer>;
  const mint = Buffer.alloc(82);
  mint[44] = 6;
  mint[45] = 1;
  const m = Buffer.alloc(227);
  (await discriminator("account", "Milestone")).copy(m);
  d.project.toBuffer().copy(m, 8);
  m.writeBigUInt64LE(100000000n, 42);
  m.writeBigInt64LE(
    BigInt(Date.parse(f.a.terms.milestones[0].deliveryDeadline) / 1000),
    50,
  );
  m[98] = 1;
  Buffer.from(f.a.commitment, "hex").copy(m, 100);
  m.writeUInt32LE(1, 132);
  const vault = Buffer.alloc(165);
  f.keys[5].publicKey.toBuffer().copy(vault);
  d.milestone.toBuffer().copy(vault, 32);
  vault.writeBigUInt64LE(100000000n, 64);
  vault[108] = 1;
  const config = Buffer.concat([
    await discriminator("account", "EscrowConfig"),
    f.keys[5].publicKey.toBuffer(),
  ]);
  const project = Buffer.from(f.account.data);
  project[project.length - 2] = 1;
  const values: (AccountInfo<Buffer> | null)[] = [
    account(Buffer.alloc(0), Keypair.generate().publicKey, true),
    account(config),
    account(mint, TOKEN_PROGRAM_ID),
    account(project),
    account(m),
    account(vault, TOKEN_PROGRAM_ID),
    null,
    null,
  ];
  const rpc = {
    getGenesisHash: vi.fn().mockResolvedValue(DEVNET_GENESIS),
    getMultipleAccountsInfoAndContext: vi
      .fn()
      .mockResolvedValue({ context: { slot: 100 }, value: values }),
    getBlockTime: vi.fn().mockResolvedValue(Math.floor(Date.now() / 1000)),
  };
  return { ...f, values, rpc, account };
}
it("verifies active vaults and finalized sequencing", async () => {
  const f = await setup(),
    s = await readEscrow(
      f.rpc,
      [f.record],
      f.keys[4].publicKey.toBase58(),
      f.keys[5].publicKey.toBase58(),
    );
  expect(s.state?.active).toBe(true);
  expect(s.milestones[0]?.amount).toBe(100000000n);
});
it("preserves settled milestone versions after a future-work revision", async () => {
  const f = await setup(),
    r = structuredClone(f.record);
  r.version = 2;
  r.terms.version = 2;
  r.terms.milestones[1].amountUnits = "200000000";
  r.commitment = await agreementCommitment(r.terms, r.salt);
  const a = await bindAgreement(
    r,
    f.keys[4].publicKey.toBase58(),
    f.keys[5].publicKey.toBase58(),
  );
  f.values[3] = f.account(
    Buffer.concat([
      await discriminator("account", "Project"),
      encodeProjectTerms(a),
      Buffer.from([1, 1, 1, 0, 0, 0]),
    ]),
  );
  const m = f.values[4]!.data;
  m[98] = 3;
  m.writeBigUInt64LE(100000000n, 192);
  f.values[5] = null;
  const s = await readEscrow(
    f.rpc,
    [r, f.record],
    f.keys[4].publicKey.toBase58(),
    f.keys[5].publicKey.toBase58(),
  );
  expect(s.agreement.terms.version).toBe(2);
  expect(s.milestones[0]?.agreementVersion).toBe(1);
});
it("rejects changed milestone commitments", async () => {
  const f = await setup();
  f.values[4]!.data[100] ^= 1;
  await expect(
    readEscrow(
      f.rpc,
      [f.record],
      f.keys[4].publicKey.toBase58(),
      f.keys[5].publicKey.toBase58(),
    ),
  ).rejects.toThrow(/differs/);
});
it("rejects missing active vaults", async () => {
  const f = await setup();
  f.values[5] = null;
  await expect(
    readEscrow(
      f.rpc,
      [f.record],
      f.keys[4].publicKey.toBase58(),
      f.keys[5].publicKey.toBase58(),
    ),
  ).rejects.toThrow(/vault/);
});
it("rejects stale RPC snapshots", async () => {
  const f = await setup();
  f.rpc.getBlockTime.mockResolvedValue(Math.floor(Date.now() / 1000) - 121);
  await expect(
    readEscrow(
      f.rpc,
      [f.record],
      f.keys[4].publicKey.toBase58(),
      f.keys[5].publicKey.toBase58(),
    ),
  ).rejects.toThrow(/stale/);
});
