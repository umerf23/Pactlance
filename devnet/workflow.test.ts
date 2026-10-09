// Explicit opt-in: creates synthetic devnet wallets/projects and spends SOL/TEST tokens.
import { it, expect } from "vitest";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintToChecked,
  getAccount,
} from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { makeTerms } from "../src/lib/agreements/schema";
import { agreementCommitment } from "../src/lib/agreements/crypto";
import { bindAgreement } from "../src/lib/escrow/terms";
import { requireDevnet } from "../src/lib/escrow/network";
import { readEscrow } from "../src/lib/escrow/snapshot";
import {
  captureSignedTransaction,
  recoverTransaction,
} from "../src/lib/escrow/recovery";
import {
  addresses,
  createProjectInstruction,
  acceptProjectInstruction,
  fundInstruction,
  submitInstruction,
  approveInstruction,
  openDisputeInstruction,
  resolveDisputeInstruction,
} from "../src/lib/escrow/client";
it("executes sequential funding, approval, dispute allocation and finalized recovery on devnet", async () => {
  const path = process.env.DEPLOYER_KEYPAIR,
    program = process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID,
    mintAddress = process.env.NEXT_PUBLIC_TEST_TOKEN_MINT;
  if (!path || !program || !mintAddress)
    throw new Error(
      "Configure DEPLOYER_KEYPAIR and a deployed program/TEST mint before running live tests.",
    );
  const payer = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
    ),
    c = new Connection(
      process.env.SOLANA_RPC_URL ||
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
        "https://api.devnet.solana.com",
      "finalized",
    );
  await requireDevnet(c);
  const mint = new PublicKey(mintAddress),
    info = await getMint(c, mint, "finalized");
  if (info.decimals !== 6 || !info.mintAuthority?.equals(payer.publicKey))
    throw new Error(
      "The supplied signer must control the six-decimal TEST mint.",
    );
  const [client, freelancer, reviewer, backup] = Array.from({ length: 4 }, () =>
      Keypair.generate(),
    ),
    base = Math.floor(Date.now() / 1000),
    id = randomUUID(),
    terms = makeTerms(
      {
        title: "Isolated devnet workflow",
        scope: "Synthetic milestone delivery and escrow test",
        clientWallet: client.publicKey.toBase58(),
        freelancerWallet: freelancer.publicKey.toBase58(),
        reviewerWallet: reviewer.publicKey.toBase58(),
        backupReviewerWallet: backup.publicKey.toBase58(),
        reviewHours: 1,
        backupDelayHours: 1,
        milestones: [0, 1].map((i) => ({
          title: `Milestone ${i + 1}`,
          scope: "Synthetic deliverable for integration testing",
          acceptanceCriteria: "Synthetic delivery commitment accepted",
          amount: "100",
          fundingDeadline: new Date(
            (base + 3600 * (i + 1)) * 1000,
          ).toISOString(),
          deliveryDeadline: new Date(
            (base + 7200 * (i + 1)) * 1000,
          ).toISOString(),
        })),
      },
      id,
      1,
    ),
    salt = "a".repeat(64),
    record = {
      project_id: id,
      version: 1,
      terms,
      salt,
      commitment: await agreementCommitment(terms, salt),
      created_at: new Date().toISOString(),
    },
    a = await bindAgreement(record, program, mintAddress),
    d = addresses(a);
  await readEscrow(c, [record], program, mintAddress);
  await sendAndConfirmTransaction(
    c,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: client.publicKey,
        lamports: 50000000,
      }),
    ),
    [payer],
    { commitment: "finalized" },
  );
  const ca = await getOrCreateAssociatedTokenAccount(
      c,
      payer,
      mint,
      client.publicKey,
      false,
      "finalized",
    ),
    fa = await getOrCreateAssociatedTokenAccount(
      c,
      payer,
      mint,
      freelancer.publicKey,
      false,
      "finalized",
    );
  await mintToChecked(c, payer, mint, ca.address, payer, 200000000n, 6, [], {
    commitment: "finalized",
  });
  async function project() {
    const account = await c.getAccountInfo(d.project, "finalized");
    if (!account) throw new Error("Project account missing.");
    return account;
  }
  async function send(
    ix: Awaited<ReturnType<typeof createProjectInstruction>>,
    signers: Keypair[],
  ) {
    const block = await c.getLatestBlockhash("confirmed"),
      tx = new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: block.blockhash,
      }).add(ix);
    tx.sign(payer, ...signers);
    const saved = captureSignedTransaction(
        tx,
        id,
        payer.publicKey,
        "devnet_test",
        block.lastValidBlockHeight,
      ),
      signature = await c.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      }),
      result = await c.confirmTransaction({ ...block, signature }, "finalized");
    expect(result.value.err).toBeNull();
    return saved;
  }
  await send(await createProjectInstruction(a, client.publicKey), [client]);
  await send(
    await acceptProjectInstruction(a, client.publicKey, await project()),
    [client],
  );
  await send(
    await acceptProjectInstruction(a, freelancer.publicKey, await project()),
    [freelancer],
  );
  const funded = await send(
    await fundInstruction(a, 0, ca.address, await project()),
    [client],
  );
  await expect(
    fundInstruction(a, 1, ca.address, await project()),
  ).rejects.toThrow(/not ready/);
  expect(await recoverTransaction(c, funded, true)).toBe("finalized");
  await send(await submitInstruction(a, 0, "b".repeat(64)), [freelancer]);
  await send(await approveInstruction(a, 0, fa.address), [client]);
  await send(await fundInstruction(a, 1, ca.address, await project()), [
    client,
  ]);
  await send(await submitInstruction(a, 1, "c".repeat(64)), [freelancer]);
  await send(
    await openDisputeInstruction(a, 1, client.publicKey, "d".repeat(64)),
    [client],
  );
  await send(
    await resolveDisputeInstruction(
      a,
      1,
      reviewer.publicKey,
      ca.address,
      fa.address,
      40000000n,
      60000000n,
    ),
    [reviewer],
  );
  const state = await readEscrow(c, [record], program, mintAddress);
  expect(state.state?.next).toBe(2);
  expect(state.state?.active).toBe(false);
  expect(state.milestones.filter((m) => m?.status === 3)).toHaveLength(2);
  expect((await getAccount(c, ca.address, "finalized")).amount).toBe(40000000n);
  expect((await getAccount(c, fa.address, "finalized")).amount).toBe(
    160000000n,
  );
}, 300000);
