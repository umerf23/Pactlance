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
import { templateProtocol } from "../src/lib/pap/templates";
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
  executeSettlementInstruction,
  openDisputeInstruction,
  resolveDisputeInstruction,
  proposeSettlementInstruction,
  acceptSettlementInstruction,
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
      protocol: templateProtocol("video", 2),
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
    true,
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
function rename(ix: TransactionInstruction, tag: Buffer) {
  return new TransactionInstruction({
    ...ix,
    data: Buffer.concat([tag, ix.data.subarray(8)]),
  });
}
describe("PAP explicit escrow on the actual SBF program", () => {
  it("restricts capability initialization and rejects PAP through legacy creation", async () => {
    send([await initialize(client.publicKey)], []);
    const [pd] = PublicKey.findProgramAddressSync([program.toBuffer()], loader),
      [cap] = PublicKey.findProgramAddressSync(
        [Buffer.from("pap-capability")],
        program,
      );
    const init = new TransactionInstruction({
      programId: program,
      keys: [
        meta(client.publicKey, true, true),
        meta(program),
        meta(pd),
        meta(cap, false, true),
        meta(SystemProgram.programId),
      ],
      data: await discriminator("global", "initialize_pap_capability"),
    });
    send([mutate(init, 0, stranger.publicKey)], [stranger], false);
    send([init], []);
    send([init], [], false);
    expect(info(cap).data[8]).toBe(1);
    const create = await createProjectInstruction(a, client.publicKey);
    send(
      [rename(create, await discriminator("global", "create_project"))],
      [],
      false,
    );
    send([create], []);
    for (const signer of [client, freelancer])
      send(
        [
          await acceptProjectInstruction(
            a,
            signer.publicKey,
            info(addresses(a).project),
          ),
        ],
        [signer],
      );
    send(
      [
        await fundInstruction(
          a,
          0,
          source.publicKey,
          info(addresses(a).project),
        ),
      ],
      [],
    );
  });
  it("allows revised delivery hashes, but rejects legacy submission and approval", async () => {
    const first = await submitInstruction(a, 0, "ab".repeat(32));
    send(
      [rename(first, await discriminator("global", "submit_delivery"))],
      [freelancer],
      false,
    );
    send([mutate(first, 0, stranger.publicKey)], [stranger], false);
    send([first], [freelancer]);
    const latest = await submitInstruction(a, 0, "cd".repeat(32));
    send([latest], [freelancer]);
    const approve = await approveInstruction(
      a,
      0,
      recipient.publicKey,
      "cd".repeat(32),
    );
    send(
      [
        new TransactionInstruction({
          ...approve,
          data: await discriminator("global", "approve_milestone"),
        }),
      ],
      [],
      false,
    );
    send(
      [await approveInstruction(a, 0, recipient.publicKey, "ab".repeat(32))],
      [],
      false,
    );
  });
  it("blocks legacy timeout claims and unilateral refunds at the program boundary", async () => {
    const keys = (
      await executeSettlementInstruction(
        a,
        0,
        client.publicKey,
        source.publicKey,
        recipient.publicKey,
        0n,
      )
    ).keys;
    for (const name of ["claim_after_review", "refund_non_delivery"])
      send(
        [
          new TransactionInstruction({
            programId: program,
            keys,
            data: await discriminator("global", name),
          }),
        ],
        [],
        false,
      );
    expect(balance(addresses(a).vault)).toBe(250_000_000n);
  });
  it("pays the exact obligation to the recorded freelancer and rejects recipient substitution and replay", async () => {
    const approve = await approveInstruction(
      a,
      0,
      recipient.publicKey,
      "cd".repeat(32),
    );
    send([mutate(approve, 0, stranger.publicKey)], [stranger], false);
    send([mutate(approve, 5, other.publicKey)], [], false);
    send(
      [
        createTransferInstruction(
          source.publicKey,
          addresses(a).vault,
          client.publicKey,
          7n,
        ),
      ],
      [],
    );
    send([approve], []);
    expect(balance(recipient.publicKey)).toBe(250_000_000n);
    expect(balance(addresses(a).vault)).toBe(7n);
    send([approve], [], false);
    expect(
      (await verifyProjectAccount(a, info(addresses(a).project))).next,
    ).toBe(1);
  });
  it("locks a PAP dispute after the delivery deadline and enforces reviewer handoff and fixed allocations", async () => {
    send(
      [
        await fundInstruction(
          a,
          1,
          source.publicKey,
          info(addresses(a).project),
        ),
      ],
      [],
    );
    const clock = svm.getClock();
    clock.unixTimestamp =
      BigInt(Date.parse(a.terms.milestones[1].deliveryDeadline) / 1000) + 1n;
    svm.setClock(clock);
    const open = await openDisputeInstruction(
      a,
      1,
      client.publicKey,
      "ef".repeat(32),
    );
    send([open], []);
    const resolve = (actor: PublicKey, c = 100_000_000n, f = 150_000_000n) =>
      resolveDisputeInstruction(
        a,
        1,
        actor,
        source.publicKey,
        recipient.publicKey,
        c,
        f,
      );
    send([await resolve(backup.publicKey)], [backup], false);
    send(
      [mutate(await resolve(reviewer.publicKey), 0, stranger.publicKey)],
      [stranger],
      false,
    );
    const raw = await resolve(reviewer.publicKey);
    raw.data.writeBigUInt64LE(100_000_001n, 8);
    send([raw], [reviewer], false);
    clock.unixTimestamp += BigInt(a.terms.backupDelayHours * 3600);
    svm.setClock(clock);
    send([await resolve(reviewer.publicKey)], [reviewer], false);
    send([await resolve(backup.publicKey)], [backup]);
    expect(balance(recipient.publicKey)).toBe(400_000_000n);
    expect(
      (await verifyProjectAccount(a, info(addresses(a).project))).next,
    ).toBe(2);
    send([await resolve(backup.publicKey)], [backup], false);
  });
  it("supports mutual refund without a timer or reviewer and rejects stale proposals", async () => {
    const next = structuredClone(a),
      now = Number(svm.getClock().unixTimestamp);
    next.terms.projectId = "02020202-0202-0202-0202-020202020202";
    next.terms.milestones = next.terms.milestones.map((m, i) => ({
      ...m,
      fundingDeadline: new Date((now + 1000 + i * 1000) * 1000).toISOString(),
      deliveryDeadline: new Date((now + 2000 + i * 1000) * 1000).toISOString(),
    }));
    next.commitment = await agreementCommitment(next.terms, next.salt);
    send([await createProjectInstruction(next, client.publicKey)], []);
    for (const signer of [client, freelancer])
      send(
        [
          await acceptProjectInstruction(
            next,
            signer.publicKey,
            info(addresses(next).project),
          ),
        ],
        [signer],
      );
    send(
      [
        await fundInstruction(
          next,
          0,
          source.publicKey,
          info(addresses(next).project),
        ),
      ],
      [],
    );
    send(
      [
        await proposeSettlementInstruction(
          next,
          0,
          client.publicKey,
          0n,
          250_000_000n,
          0n,
          true,
        ),
      ],
      [],
    );
    send(
      [
        await acceptSettlementInstruction(
          next,
          0,
          freelancer.publicKey,
          0n,
          250_000_000n,
          0n,
          true,
        ),
      ],
      [freelancer],
      false,
    );
    send(
      [
        await acceptSettlementInstruction(
          next,
          0,
          freelancer.publicKey,
          1n,
          250_000_000n,
          0n,
          true,
        ),
      ],
      [freelancer],
    );
    const execute = await executeSettlementInstruction(
      next,
      0,
      client.publicKey,
      source.publicKey,
      recipient.publicKey,
      1n,
    );
    send([execute], []);
    send([execute], [], false);
    expect(
      (await verifyProjectAccount(next, info(addresses(next).project)))
        .cancelled,
    ).toBe(true);
  });
});
