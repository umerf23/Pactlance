import { readFileSync } from "node:fs";
import { Buffer } from "buffer";
import { beforeAll, describe, expect, it } from "vitest";
import {
  Account,
  FailedTransactionMetadata,
  LiteSvm,
} from "litesvm/dist/internal";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountInfo,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  ACCOUNT_SIZE,
  createInitializeMint2Instruction,
  createInitializeAccount3Instruction,
  createMintToInstruction,
  createTransferInstruction,
  unpackAccount,
} from "@solana/spl-token";
import { makeTerms } from "../src/lib/agreements/schema";
import { agreementCommitment } from "../src/lib/agreements/crypto";
import { bindAgreement, type BoundAgreement } from "../src/lib/escrow/terms";
import {
  addresses,
  discriminator,
  createProjectInstruction,
  acceptProjectInstruction,
  fundInstruction,
  submitInstruction,
  approveInstruction,
  verifyProjectAccount,
} from "../src/lib/escrow/client";
const program = new PublicKey(
  readFileSync("contracts/programs/pactlance/src/lib.rs", "utf8").match(
    /declare_id!\("([^"]+)"\)/,
  )![1],
);
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const meta = (pubkey: PublicKey, isSigner = false, isWritable = false) => ({
  pubkey,
  isSigner,
  isWritable,
});
let svm: LiteSvm,
  client: Keypair,
  freelancer: Keypair,
  stranger: Keypair,
  mint: Keypair,
  source: Keypair,
  recipient: Keypair,
  other: Keypair,
  a: BoundAgreement;
function send(ixs: TransactionInstruction[], signers: Keypair[], ok = true) {
  svm.expireBlockhash();
  const tx = new Transaction({
    feePayer: client.publicKey,
    recentBlockhash: svm.latestBlockhash(),
  }).add(...ixs);
  tx.sign(
    ...[client, ...signers].filter(
      (k, i, arr) =>
        arr.findIndex((v) => v.publicKey.equals(k.publicKey)) === i,
    ),
  );
  const result = svm.sendLegacyTransaction(tx.serialize());
  if (ok && result instanceof FailedTransactionMetadata)
    throw new Error(`${result.err()}\n${result.meta().logs().join("\n")}`);
  if (!ok) expect(result).toBeInstanceOf(FailedTransactionMetadata);
  return result;
}
function info(key: PublicKey): AccountInfo<Buffer> {
  const v = svm.getAccount(key.toBytes());
  if (!v) throw new Error("Missing VM account");
  return {
    owner: new PublicKey(v.owner()),
    data: Buffer.from(v.data()),
    executable: v.executable(),
    lamports: Number(v.lamports()),
    rentEpoch: 0,
  };
}
function balance(key: PublicKey) {
  return unpackAccount(key, info(key)).amount;
}
function mutate(ix: TransactionInstruction, index: number, key: PublicKey) {
  const copy = new TransactionInstruction({
    programId: ix.programId,
    keys: ix.keys.map((k) => ({ ...k })),
    data: Buffer.from(ix.data),
  });
  copy.keys[index].pubkey = key;
  return copy;
}
async function initialize(authority: PublicKey) {
  const [pd] = PublicKey.findProgramAddressSync([program.toBuffer()], loader);
  return new TransactionInstruction({
    programId: program,
    keys: [
      meta(authority, true, true),
      meta(program),
      meta(pd),
      meta(mint.publicKey),
      meta(addresses(a).config, false, true),
      meta(SystemProgram.programId),
    ],
    data: await discriminator("global", "initialize_config"),
  });
}
beforeAll(async () => {
  svm = new LiteSvm();
  client = Keypair.generate();
  freelancer = Keypair.generate();
  stranger = Keypair.generate();
  mint = Keypair.generate();
  source = Keypair.generate();
  recipient = Keypair.generate();
  other = Keypair.generate();
  svm.airdrop(client.publicKey.toBytes(), 10_000_000_000n);
  svm.airdrop(stranger.publicKey.toBytes(), 1_000_000_000n);
  svm.addProgramWithLoader(
    program.toBytes(),
    readFileSync("contracts/target/deploy/pactlance.so"),
    loader.toBytes(),
  );
  // Model deployment authority only. All escrow/token state is created through instructions.
  const [pd] = PublicKey.findProgramAddressSync([program.toBuffer()], loader);
  const existing = svm.getAccount(pd.toBytes());
  if (!existing) throw new Error("Missing upgradeable ProgramData");
  const data = Buffer.from(existing.data());
  data[12] = 1;
  data.set(client.publicKey.toBytes(), 13);
  svm.setAccount(
    pd.toBytes(),
    new Account(existing.lamports(), data, loader.toBytes(), false, 0n),
  );
  const now = Number(svm.getClock().unixTimestamp);
  const terms = makeTerms(
    {
      title: "VM transfer test",
      scope: "Two sequential batches of editing",
      clientWallet: client.publicKey.toBase58(),
      freelancerWallet: freelancer.publicKey.toBase58(),
      reviewerWallet: Keypair.generate().publicKey.toBase58(),
      backupReviewerWallet: Keypair.generate().publicKey.toBase58(),
      reviewHours: 1,
      backupDelayHours: 24,
      milestones: [0, 1].map((i) => ({
        title: `Batch ${i}`,
        scope: "Five edited videos delivered",
        acceptanceCriteria: "All five video files play",
        amount: "250",
        fundingDeadline: new Date((now + 1000 + i * 1000) * 1000).toISOString(),
        deliveryDeadline: new Date(
          (now + 2000 + i * 1000) * 1000,
        ).toISOString(),
      })),
    },
    "01010101-0101-0101-0101-010101010101",
    1,
  );
  const salt = "42".repeat(32),
    commitment = await agreementCommitment(terms, salt);
  a = await bindAgreement(
    {
      project_id: terms.projectId,
      version: 1,
      terms,
      salt,
      commitment,
      created_at: new Date().toISOString(),
    },
    program.toBase58(),
    mint.publicKey.toBase58(),
  );
  send(
    [
      SystemProgram.createAccount({
        fromPubkey: client.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: 10_000_000,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        mint.publicKey,
        6,
        client.publicKey,
        null,
      ),
    ],
    [mint],
  );
  for (const [key, owner] of [
    [source, client.publicKey],
    [recipient, freelancer.publicKey],
    [other, stranger.publicKey],
  ] as const) {
    send(
      [
        SystemProgram.createAccount({
          fromPubkey: client.publicKey,
          newAccountPubkey: key.publicKey,
          lamports: 10_000_000,
          space: ACCOUNT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(
          key.publicKey,
          mint.publicKey,
          owner,
        ),
      ],
      [key],
    );
  }
  send(
    [
      createMintToInstruction(
        mint.publicKey,
        source.publicKey,
        client.publicKey,
        1_000_000_000n,
      ),
    ],
    [],
  );
}, 120_000);
describe("real escrow instructions", () => {
  it("restricts configuration and creates a project", async () => {
    send([await initialize(stranger.publicKey)], [stranger], false);
    send([await initialize(client.publicKey)], []);
    send([await initialize(client.publicKey)], [], false);
    send([await createProjectInstruction(a, client.publicKey)], []);
    expect(
      (await verifyProjectAccount(a, info(addresses(a).project))).next,
    ).toBe(0);
  });
  it("rejects outsider and stale acceptance and funding without both acceptances", async () => {
    const d = addresses(a),
      accept = await acceptProjectInstruction(
        a,
        client.publicKey,
        info(d.project),
      );
    send([mutate(accept, 0, stranger.publicKey)], [stranger], false);
    const stale = new TransactionInstruction({
      ...accept,
      data: Buffer.from(accept.data),
    });
    stale.data[8] ^= 1;
    send([stale], [], false);
    send([accept], []);
    const fund = new TransactionInstruction({
      programId: program,
      keys: [
        meta(client.publicKey, true, true),
        meta(d.project, false, true),
        meta(mint.publicKey),
        meta(d.milestone, false, true),
        meta(d.vault, false, true),
        meta(source.publicKey, false, true),
        meta(TOKEN_PROGRAM_ID),
        meta(SystemProgram.programId),
      ],
      data: Buffer.concat([
        await discriminator("global", "fund_milestone"),
        Buffer.from([0, 0]),
      ]),
    });
    send([fund], [], false);
    expect(balance(source.publicKey)).toBe(1_000_000_000n);
    send(
      [
        await acceptProjectInstruction(
          a,
          freelancer.publicKey,
          info(d.project),
        ),
      ],
      [freelancer],
    );
  });
  it("funds exactly one vault and rejects incorrect accounts and duplicate or parallel funding", async () => {
    const d = addresses(a),
      fund = await fundInstruction(a, 0, source.publicKey, info(d.project));
    send([mutate(fund, 0, stranger.publicKey)], [stranger], false);
    send([mutate(fund, 6, SystemProgram.programId)], [], false);
    send([mutate(fund, 2, source.publicKey)], [], false);
    send([mutate(fund, 4, other.publicKey)], [], false);
    send([fund], []);
    send([await approveInstruction(a, 0, recipient.publicKey)], [], false);
    expect(balance(d.vault)).toBe(250_000_000n);
    expect(balance(source.publicKey)).toBe(750_000_000n);
    send([fund], [], false);
    const next = addresses(a, 1),
      nextIx = new TransactionInstruction({
        programId: program,
        keys: fund.keys.map((k) => ({ ...k })),
        data: Buffer.concat([
          await discriminator("global", "fund_milestone"),
          Buffer.from([1, 0]),
        ]),
      });
    nextIx.keys[3].pubkey = next.milestone;
    nextIx.keys[4].pubkey = next.vault;
    send([nextIx], [], false);
    expect(svm.getAccount(next.vault.toBytes())).toBeNull();
  });
  it("requires freelancer delivery and prevents duplicate submissions", async () => {
    const ix = await submitInstruction(a, 0, "ab".repeat(32));
    send([mutate(ix, 0, stranger.publicKey)], [stranger], false);
    send([ix], [freelancer]);
    send([ix], [freelancer], false);
  });
  it("pays only the freelancer and conserves the obligation despite donations and replay", async () => {
    const d = addresses(a),
      approve = await approveInstruction(a, 0, recipient.publicKey);
    send([mutate(approve, 0, stranger.publicKey)], [stranger], false);
    send([mutate(approve, 5, other.publicKey)], [], false);
    send(
      [
        createTransferInstruction(
          source.publicKey,
          d.vault,
          client.publicKey,
          7n,
        ),
      ],
      [],
    );
    send([approve], []);
    expect(balance(recipient.publicKey)).toBe(250_000_000n);
    expect(balance(d.vault)).toBe(7n);
    send([approve], [], false);
    expect(balance(recipient.publicKey)).toBe(250_000_000n);
    const state = await verifyProjectAccount(a, info(d.project));
    expect(state.next).toBe(1);
    expect(state.active).toBe(false);
  });
  it("funds and settles milestone two in its own vault", async () => {
    const d = addresses(a, 1);
    send([await fundInstruction(a, 1, source.publicKey, info(d.project))], []);
    expect(balance(d.vault)).toBe(250_000_000n);
    send([await submitInstruction(a, 1, "cd".repeat(32))], [freelancer]);
    send([await approveInstruction(a, 1, recipient.publicKey)], []);
    expect(balance(recipient.publicKey)).toBe(500_000_000n);
    expect((await verifyProjectAccount(a, info(d.project))).next).toBe(2);
  });
  it("enforces exact funding and delivery boundaries", async () => {
    const now = Number(svm.getClock().unixTimestamp),
      fresh = structuredClone(a);
    fresh.terms.projectId = "02020202-0202-0202-0202-020202020202";
    fresh.terms.milestones = fresh.terms.milestones.slice(0, 1).map((m) => ({
      ...m,
      fundingDeadline: new Date((now + 100) * 1000).toISOString(),
      deliveryDeadline: new Date((now + 200) * 1000).toISOString(),
    }));
    fresh.commitment = await agreementCommitment(fresh.terms, fresh.salt);
    const d = addresses(fresh);
    send([await createProjectInstruction(fresh, client.publicKey)], []);
    send(
      [
        await acceptProjectInstruction(
          fresh,
          client.publicKey,
          info(d.project),
        ),
      ],
      [],
    );
    send(
      [
        await acceptProjectInstruction(
          fresh,
          freelancer.publicKey,
          info(d.project),
        ),
      ],
      [freelancer],
    );
    const funding = await fundInstruction(
        fresh,
        0,
        source.publicKey,
        info(d.project),
      ),
      clock = svm.getClock();
    clock.unixTimestamp = BigInt(now + 100);
    svm.setClock(clock);
    send([funding], [], false);
    expect(svm.getAccount(d.vault.toBytes())).toBeNull();
    clock.unixTimestamp = BigInt(now + 99);
    svm.setClock(clock);
    send([funding], []);
    clock.unixTimestamp = BigInt(now + 200);
    svm.setClock(clock);
    send(
      [await submitInstruction(fresh, 0, "ef".repeat(32))],
      [freelancer],
      false,
    );
    expect(balance(d.vault)).toBe(250_000_000n);
  });
});
