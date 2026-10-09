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
  createFreezeAccountInstruction,
  createThawAccountInstruction,
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
  verifyMilestoneAccount,
  claimAfterReviewInstruction,
  refundNonDeliveryInstruction,
  openDisputeInstruction,
  proposeSettlementInstruction,
  acceptSettlementInstruction,
  executeSettlementInstruction,
  resolveDisputeInstruction,
  cancelRemainingInstruction,
  reviseProjectInstruction,
  encodeProjectTerms,
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
  a: BoundAgreement,
  reviewer: Keypair,
  backup: Keypair;
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
  reviewer = Keypair.generate();
  backup = Keypair.generate();
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
      reviewerWallet: reviewer.publicKey.toBase58(),
      backupReviewerWallet: backup.publicKey.toBase58(),
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
        client.publicKey,
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
        20_000_000_000n,
      ),
    ],
    [],
  );
  send([await initialize(client.publicKey)], []);
}, 120_000);
let projectCounter = 10;
const amount = 250_000_000n;
function setTime(time: bigint) {
  const c = svm.getClock();
  c.unixTimestamp = time;
  svm.setClock(c);
}
async function fresh(fund = true) {
  const next = structuredClone(a),
    now = Number(svm.getClock().unixTimestamp);
  const id =
    (projectCounter++).toString(16).padStart(8, "0") +
    "-0202-0202-0202-020202020202";
  next.terms.projectId = id;
  next.terms.milestones = next.terms.milestones.map((m, i) => ({
    ...m,
    id: `${id}:${i + 1}`,
    fundingDeadline: new Date((now + 100 + i * 100) * 1000).toISOString(),
    deliveryDeadline: new Date((now + 200 + i * 100) * 1000).toISOString(),
  }));
  next.commitment = await agreementCommitment(next.terms, next.salt);
  const d = addresses(next);
  send([await createProjectInstruction(next, client.publicKey)], []);
  send(
    [await acceptProjectInstruction(next, client.publicKey, info(d.project))],
    [],
  );
  send(
    [
      await acceptProjectInstruction(
        next,
        freelancer.publicKey,
        info(d.project),
      ),
    ],
    [freelancer],
  );
  if (fund)
    send(
      [await fundInstruction(next, 0, source.publicKey, info(d.project))],
      [],
    );
  return next;
}
async function state(p: BoundAgreement, index = 0) {
  return verifyMilestoneAccount(p, index, info(addresses(p, index).milestone));
}
async function project(p: BoundAgreement) {
  return verifyProjectAccount(p, info(addresses(p).project));
}
async function claim(p: BoundAgreement) {
  return claimAfterReviewInstruction(
    p,
    0,
    stranger.publicKey,
    source.publicKey,
    recipient.publicKey,
  );
}
async function refund(p: BoundAgreement) {
  return refundNonDeliveryInstruction(
    p,
    0,
    source.publicKey,
    recipient.publicKey,
  );
}
async function split(
  p: BoundAgreement,
  actor = reviewer,
  clientAmount = 100_000_000n,
  freelancerAmount = 150_000_000n,
) {
  return resolveDisputeInstruction(
    p,
    0,
    actor.publicKey,
    source.publicKey,
    recipient.publicKey,
    clientAmount,
    freelancerAmount,
  );
}
async function dispute(p: BoundAgreement, actor = client) {
  return openDisputeInstruction(p, 0, actor.publicKey, "da".repeat(32));
}
async function revision(p: BoundAgreement) {
  const next = structuredClone(p),
    now = Number(svm.getClock().unixTimestamp);
  next.terms.version++;
  next.terms.milestones = next.terms.milestones.map((m, i) =>
    i < 1
      ? m
      : {
          ...m,
          fundingDeadline: new Date((now + 200) * 1000).toISOString(),
          deliveryDeadline: new Date((now + 300) * 1000).toISOString(),
        },
  );
  next.commitment = await agreementCommitment(next.terms, next.salt);
  return next;
}
describe("Phase 5 settlement rules", () => {
  it("allows permissionless review claims exactly at expiry and rejects early/replayed claims", async () => {
    const p = await fresh();
    send([await submitInstruction(p, 0, "aa".repeat(32))], [freelancer]);
    const s = await state(p),
      ix = await claim(p);
    const paid = balance(recipient.publicKey);
    setTime(s.reviewDeadline - 1n);
    send([ix], [stranger], false);
    send([await refund(p)], [], false);
    setTime(s.reviewDeadline);
    send([await dispute(p)], [], false);
    send([mutate(ix, 6, other.publicKey)], [stranger], false);
    send([mutate(ix, 7, SystemProgram.programId)], [stranger], false);
    send([ix], [stranger]);
    expect(balance(recipient.publicKey) - paid).toBe(amount);
    send([ix], [stranger], false);
    const settled = await state(p);
    expect(settled.freelancerPaid).toBe(amount);
    expect(settled.clientRefunded).toBe(0n);
    expect((await project(p)).next).toBe(1);
  });
  it("refunds non-delivery only to the client at the exact delivery deadline", async () => {
    const p = await fresh(),
      s = await state(p),
      ix = await refund(p),
      before = balance(source.publicKey);
    setTime(s.deliveryDeadline - 1n);
    send([ix], [], false);
    send([mutate(ix, 0, stranger.publicKey)], [stranger], false);
    setTime(s.deliveryDeadline);
    send([await dispute(p)], [], false);
    send([await submitInstruction(p, 0, "aa".repeat(32))], [freelancer], false);
    send([await claim(p)], [stranger], false);
    send([mutate(ix, 5, other.publicKey)], [], false);
    send([ix], []);
    expect(balance(source.publicKey) - before).toBe(amount);
    send([ix], [], false);
    expect((await state(p)).clientRefunded).toBe(amount);
    expect((await project(p)).active).toBe(false);
  });
  it("freezes ordinary settlement during disputes and permits a bounded primary decision", async () => {
    const p = await fresh();
    send([await submitInstruction(p, 0, "aa".repeat(32))], [freelancer]);
    const s = await state(p);
    setTime(s.reviewDeadline - 1n);
    const open = await dispute(p, freelancer);
    send([mutate(open, 0, stranger.publicKey)], [stranger], false);
    send([open], [freelancer]);
    send([open], [freelancer], false);
    send([await approveInstruction(p, 0, recipient.publicKey)], [], false);
    send([await refund(p)], [], false);
    setTime(s.reviewDeadline);
    send([await claim(p)], [stranger], false);
    const ix = await split(p);
    send([mutate(ix, 0, stranger.publicKey)], [stranger], false);
    send([await split(p, backup)], [backup], false);
    send([mutate(ix, 6, other.publicKey)], [reviewer], false);
    const inflated = new TransactionInstruction({
      ...ix,
      data: Buffer.from(ix.data),
    });
    inflated.data.writeBigUInt64LE(amount + 1n, 8);
    send([inflated], [reviewer], false);
    const cb = balance(source.publicKey),
      fb = balance(recipient.publicKey);
    send([ix], [reviewer]);
    expect(balance(source.publicKey) - cb).toBe(100_000_000n);
    expect(balance(recipient.publicKey) - fb).toBe(150_000_000n);
    send([ix], [reviewer], false);
    expect((await project(p)).next).toBe(1);
    send(
      [
        await fundInstruction(
          p,
          1,
          source.publicKey,
          info(addresses(p).project),
        ),
      ],
      [],
      false,
    ); // future funding expired during review
  });
  it("switches exclusively to backup reviewer at the exact escalation timestamp", async () => {
    const p = await fresh();
    send([await dispute(p)], []);
    const s = await state(p);
    setTime(s.backupAt - 1n);
    send([await split(p, backup)], [backup], false);
    setTime(s.backupAt);
    send([await split(p)], [reviewer], false);
    const ix = await split(p, backup, amount, 0n),
      before = balance(source.publicKey);
    send([ix], [backup]);
    expect(balance(source.publicKey) - before).toBe(amount);
    send([ix], [backup], false);
  });
  it("invalidates old allocation approvals and settles only the jointly accepted nonce", async () => {
    const p = await fresh();
    const propose = await proposeSettlementInstruction(
      p,
      0,
      client.publicKey,
      0n,
      100_000_000n,
      150_000_000n,
    );
    send([mutate(propose, 0, stranger.publicKey)], [stranger], false);
    send([propose], []);
    send([propose], [], false);
    const s = await state(p),
      accept = await acceptSettlementInstruction(
        p,
        0,
        freelancer.publicKey,
        s.proposalNonce,
        100_000_000n,
        150_000_000n,
      );
    const execute = await executeSettlementInstruction(
      p,
      0,
      stranger.publicKey,
      source.publicKey,
      recipient.publicKey,
      s.proposalNonce,
    );
    send([execute], [stranger], false);
    send([mutate(accept, 0, stranger.publicKey)], [stranger], false);
    send([accept], [freelancer]);
    send(
      [
        await proposeSettlementInstruction(
          p,
          0,
          freelancer.publicKey,
          s.proposalNonce,
          50_000_000n,
          200_000_000n,
        ),
      ],
      [freelancer],
    );
    send([accept], [freelancer], false);
    send([execute], [stranger], false);
    const current = await state(p);
    send(
      [
        await acceptSettlementInstruction(
          p,
          0,
          client.publicKey,
          current.proposalNonce,
          50_000_000n,
          200_000_000n,
        ),
      ],
      [],
    );
    const cb = balance(source.publicKey),
      fb = balance(recipient.publicKey),
      ix = await executeSettlementInstruction(
        p,
        0,
        stranger.publicKey,
        source.publicKey,
        recipient.publicKey,
        current.proposalNonce,
      );
    send([ix], [stranger]);
    expect(
      balance(source.publicKey) - cb + balance(recipient.publicKey) - fb,
    ).toBe(amount);
    send([ix], [stranger], false);
  });
  it("invalidates an accepted proposal when delivery or dispute changes its state", async () => {
    const p = await fresh();
    send(
      [
        await proposeSettlementInstruction(
          p,
          0,
          client.publicKey,
          0n,
          0n,
          amount,
        ),
      ],
      [],
    );
    let s = await state(p);
    send(
      [
        await acceptSettlementInstruction(
          p,
          0,
          freelancer.publicKey,
          s.proposalNonce,
          0n,
          amount,
        ),
      ],
      [freelancer],
    );
    const old = await executeSettlementInstruction(
      p,
      0,
      stranger.publicKey,
      source.publicKey,
      recipient.publicKey,
      s.proposalNonce,
    );
    send([await submitInstruction(p, 0, "aa".repeat(32))], [freelancer]);
    send([old], [stranger], false);
    s = await state(p);
    send(
      [
        await proposeSettlementInstruction(
          p,
          0,
          client.publicKey,
          s.proposalNonce,
          0n,
          amount,
        ),
      ],
      [],
    );
    s = await state(p);
    send(
      [
        await acceptSettlementInstruction(
          p,
          0,
          freelancer.publicKey,
          s.proposalNonce,
          0n,
          amount,
        ),
      ],
      [freelancer],
    );
    const submitted = await executeSettlementInstruction(
      p,
      0,
      stranger.publicKey,
      source.publicKey,
      recipient.publicKey,
      s.proposalNonce,
    );
    send([await dispute(p)], []);
    send([submitted], [stranger], false);
  });
  it("allows mutual cancellation while disputed without enabling future funding", async () => {
    const p = await fresh();
    send([await dispute(p)], []);
    let s = await state(p);
    send(
      [
        await proposeSettlementInstruction(
          p,
          0,
          client.publicKey,
          s.proposalNonce,
          amount,
          0n,
          true,
        ),
      ],
      [],
    );
    s = await state(p);
    send(
      [
        await acceptSettlementInstruction(
          p,
          0,
          freelancer.publicKey,
          s.proposalNonce,
          amount,
          0n,
          false,
        ),
      ],
      [freelancer],
      false,
    );
    send(
      [
        await acceptSettlementInstruction(
          p,
          0,
          freelancer.publicKey,
          s.proposalNonce,
          amount,
          0n,
          true,
        ),
      ],
      [freelancer],
    );
    const before = balance(source.publicKey);
    send(
      [
        await executeSettlementInstruction(
          p,
          0,
          stranger.publicKey,
          source.publicKey,
          recipient.publicKey,
          s.proposalNonce,
        ),
      ],
      [stranger],
    );
    expect(balance(source.publicKey) - before).toBe(amount);
    expect((await project(p)).cancelled).toBe(true);
    await expect(
      fundInstruction(p, 1, source.publicKey, info(addresses(p).project)),
    ).rejects.toThrow();
  });
  it("requires both exact-version signatures to cancel inactive future work", async () => {
    const p = await fresh(false),
      ix = await cancelRemainingInstruction(p, info(addresses(p).project));
    send([mutate(ix, 1, stranger.publicKey)], [stranger], false);
    const stale = new TransactionInstruction({
      ...ix,
      data: Buffer.from(ix.data),
    });
    stale.data[12] ^= 1;
    send([stale], [freelancer], false);
    send([ix], [freelancer]);
    expect((await project(p)).cancelled).toBe(true);
    send([ix], [freelancer], false);
    const raw = new TransactionInstruction({
      programId: program,
      keys: [
        meta(client.publicKey, true, true),
        meta(addresses(p).project, false, true),
        meta(mint.publicKey),
        meta(addresses(p).milestone, false, true),
        meta(addresses(p).vault, false, true),
        meta(source.publicKey, false, true),
        meta(TOKEN_PROGRAM_ID),
        meta(SystemProgram.programId),
      ],
      data: Buffer.concat([
        await discriminator("global", "fund_milestone"),
        Buffer.from([0, 0]),
      ]),
    });
    send([raw], [], false);
    const funded = await fresh();
    const illegal = await cancelRemainingInstruction(
      p,
      info(addresses(p).project),
    ).catch(() => ix);
    send([mutate(illegal, 2, addresses(funded).project)], [freelancer], false);
  });
  it("revises expired future work jointly while preserving settled history", async () => {
    const p = await fresh();
    send([await submitInstruction(p, 0, "aa".repeat(32))], [freelancer]);
    send([await approveInstruction(p, 0, recipient.publicKey)], []);
    const oldMilestone = Buffer.from(info(addresses(p).milestone).data);
    setTime(BigInt(Date.parse(p.terms.milestones[1].fundingDeadline) / 1000));
    const next = await revision(p),
      ix = await reviseProjectInstruction(p, next, info(addresses(p).project));
    send([mutate(ix, 1, stranger.publicKey)], [stranger], false);
    const changed = structuredClone(next);
    changed.terms.milestones[0].amountUnits = "1";
    changed.commitment = await agreementCommitment(changed.terms, changed.salt);
    const bad = new TransactionInstruction({
      ...ix,
      data: Buffer.concat([
        await discriminator("global", "revise_project"),
        Buffer.from(p.commitment, "hex"),
        encodeProjectTerms(changed),
      ]),
    });
    send([bad], [freelancer], false);
    send([ix], [freelancer]);
    send([ix], [freelancer], false);
    expect((await project(next)).next).toBe(1);
    expect(info(addresses(p).milestone).data.equals(oldMilestone)).toBe(true);
    send(
      [
        await fundInstruction(
          next,
          1,
          source.publicKey,
          info(addresses(next).project),
        ),
      ],
      [],
    );
    expect((await state(next, 1)).amount).toBe(amount);
    await expect(
      reviseProjectInstruction(
        next,
        await revision(next),
        info(addresses(next).project),
      ),
    ).rejects.toThrow();
    const active = new TransactionInstruction({
      ...ix,
      data: Buffer.concat([
        await discriminator("global", "revise_project"),
        Buffer.from(next.commitment, "hex"),
        encodeProjectTerms(await revision(next)),
      ]),
    });
    send([active], [freelancer], false);
  });
  it("rolls back the first transfer if the second transfer cannot execute", async () => {
    const p = await fresh();
    send([await dispute(p)], []);
    const cb = balance(source.publicKey),
      fb = balance(recipient.publicKey),
      snapshot = Buffer.from(info(addresses(p).milestone).data);
    send(
      [
        createFreezeAccountInstruction(
          recipient.publicKey,
          mint.publicKey,
          client.publicKey,
        ),
      ],
      [],
    );
    const ix = await split(p);
    send([ix], [reviewer], false);
    expect(balance(source.publicKey)).toBe(cb);
    expect(balance(recipient.publicKey)).toBe(fb);
    expect(info(addresses(p).milestone).data.equals(snapshot)).toBe(true);
    expect((await project(p)).active).toBe(true);
    send(
      [
        createThawAccountInstruction(
          recipient.publicKey,
          mint.publicKey,
          client.publicKey,
        ),
      ],
      [],
    );
    send([ix], [reviewer]);
    expect(
      balance(source.publicKey) - cb + balance(recipient.publicKey) - fb,
    ).toBe(amount);
  });
  it("supports submitted mutual payout and primary full payout without paying donated excess", async () => {
    const p = await fresh();
    send([await submitInstruction(p, 0, "ab".repeat(32))], [freelancer]);
    let s = await state(p);
    send(
      [
        await proposeSettlementInstruction(
          p,
          0,
          freelancer.publicKey,
          s.proposalNonce,
          0n,
          amount,
        ),
      ],
      [freelancer],
    );
    s = await state(p);
    send(
      [
        await acceptSettlementInstruction(
          p,
          0,
          client.publicKey,
          s.proposalNonce,
          0n,
          amount,
        ),
      ],
      [],
    );
    const fb = balance(recipient.publicKey);
    send(
      [
        createTransferInstruction(
          source.publicKey,
          addresses(p).vault,
          client.publicKey,
          7n,
        ),
      ],
      [],
    );
    send(
      [
        await executeSettlementInstruction(
          p,
          0,
          stranger.publicKey,
          source.publicKey,
          recipient.publicKey,
          s.proposalNonce,
        ),
      ],
      [stranger],
    );
    expect(balance(recipient.publicKey) - fb).toBe(amount);
    expect(balance(addresses(p).vault)).toBe(7n);
    const q = await fresh();
    send([await dispute(q)], []);
    const qb = balance(recipient.publicKey);
    send([await split(q, reviewer, 0n, amount)], [reviewer]);
    expect(balance(recipient.publicKey) - qb).toBe(amount);
  });
});
