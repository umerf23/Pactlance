// Explicit opt-in: creates synthetic devnet wallets/projects and spends SOL/TEST tokens.
import { beforeAll, it, expect } from "vitest";
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
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { templateProtocol } from "../src/lib/pap/templates";
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
// Reset prior evidence before configuration/network checks, so an early failure
// cannot leave an older successful run looking like the current result.
beforeAll(() => {
  mkdirSync("validation-results", { recursive: true });
  writeFileSync(
    "validation-results/pap-devnet-workflow.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "scripted-pap-devnet-program-test",
        status: "in_progress",
        checkedAt: new Date().toISOString(),
        transactions: [],
        limitation:
          "This run has not completed. No passing result is established.",
      },
      null,
      2,
    ) + "\n",
  );
});
it("executes PAP explicit funding, approval, dispute allocation and finalized recovery on devnet", async () => {
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
        protocol: templateProtocol("video", 2),
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
    a = await bindAgreement(record, program, mintAddress, true),
    d = addresses(a);
  await readEscrow(c, [record], program, mintAddress, true);
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
  const evidence = {
    schemaVersion: 1,
    kind: "scripted-pap-devnet-program-test",
    status: "in_progress",
    checkedAt: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    network: "devnet",
    boundCommitment: a.commitment,
    program,
    mint: mintAddress,
    project: id,
    participants: {
      client: client.publicKey.toBase58(),
      freelancer: freelancer.publicKey.toBase58(),
    },
    transactions: [] as {
      action: string;
      signature: string;
      explorer: string;
      commitment: string;
    }[],
    limitations:
      "Generated independent test signers. Does not test Supabase sign-in, browser wallet prompts, off-chain PAP rule evaluation, private uploads or human usability.",
  };
  function saveEvidence() {
    mkdirSync("validation-results", { recursive: true });
    writeFileSync(
      "validation-results/pap-devnet-workflow.json",
      JSON.stringify(evidence, null, 2) + "\n",
    );
  }
  saveEvidence();
  async function send(
    ix: Awaited<ReturnType<typeof createProjectInstruction>>,
    signers: Keypair[],
    action: string,
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
    evidence.transactions.push({
      action,
      signature,
      explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      commitment: "finalized",
    });
    saveEvidence();
    return saved;
  }
  await send(
    await createProjectInstruction(a, client.publicKey),
    [client],
    "create_project",
  );
  await send(
    await acceptProjectInstruction(a, client.publicKey, await project()),
    [client],
    "accept_client",
  );
  await send(
    await acceptProjectInstruction(a, freelancer.publicKey, await project()),
    [freelancer],
    "accept_freelancer",
  );
  const funded = await send(
    await fundInstruction(a, 0, ca.address, await project()),
    [client],
    "fund_first",
  );
  await expect(
    fundInstruction(a, 1, ca.address, await project()),
  ).rejects.toThrow(/not ready/);
  expect(await recoverTransaction(c, funded, true)).toBe("finalized");
  await send(
    await submitInstruction(a, 0, "b".repeat(64)),
    [freelancer],
    "deliver_first",
  );
  await send(
    await approveInstruction(a, 0, fa.address, "b".repeat(64)),
    [client],
    "approve_first",
  );
  await send(
    await fundInstruction(a, 1, ca.address, await project()),
    [client],
    "fund_second",
  );
  await send(
    await submitInstruction(a, 1, "c".repeat(64)),
    [freelancer],
    "deliver_second",
  );
  await send(
    await openDisputeInstruction(a, 1, client.publicKey, "d".repeat(64)),
    [client],
    "open_dispute",
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
    "resolve_dispute",
  );
  const state = await readEscrow(c, [record], program, mintAddress, true);
  expect(state.state?.next).toBe(2);
  expect(state.state?.active).toBe(false);
  expect(state.milestones.filter((m) => m?.status === 3)).toHaveLength(2);
  expect((await getAccount(c, ca.address, "finalized")).amount).toBe(40000000n);
  expect((await getAccount(c, fa.address, "finalized")).amount).toBe(
    160000000n,
  );
  evidence.status = "passed";
  saveEvidence();
}, 300000);
