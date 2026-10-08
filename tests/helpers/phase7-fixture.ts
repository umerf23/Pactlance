import { vi } from "vitest";
import { Keypair, Transaction, type AccountInfo } from "@solana/web3.js";
import bs58 from "bs58";
import { makeTerms } from "../../src/lib/agreements/schema";
import { agreementCommitment } from "../../src/lib/agreements/crypto";
import { bindAgreement } from "../../src/lib/escrow/terms";
import {
  cancelRemainingInstruction,
  discriminator,
  encodeProjectTerms,
} from "../../src/lib/escrow/client";
export async function fixture() {
  const keys = Array.from({ length: 6 }, () => Keypair.generate()),
    terms = makeTerms(
      {
        title: "Joint review",
        scope: "Scope jointly accepted",
        clientWallet: keys[0].publicKey.toBase58(),
        freelancerWallet: keys[1].publicKey.toBase58(),
        reviewerWallet: keys[2].publicKey.toBase58(),
        backupReviewerWallet: keys[3].publicKey.toBase58(),
        reviewHours: 72,
        backupDelayHours: 168,
        milestones: [0, 1].map((i) => ({
          title: `Delivery ${i + 1}`,
          scope: "Joint milestone scope",
          acceptanceCriteria: "Accepted delivery files",
          amount: "100",
          fundingDeadline: `2030-01-0${i + 1}T00:00:00.000Z`,
          deliveryDeadline: `2030-02-0${i + 1}T00:00:00.000Z`,
        })),
      },
      "10000000-0000-4000-8000-000000000001",
      1,
    ),
    salt = "a".repeat(64),
    record = {
      project_id: terms.projectId,
      version: 1,
      terms,
      salt,
      commitment: await agreementCommitment(terms, salt),
      created_at: "2030-01-01",
    },
    a = await bindAgreement(
      record,
      keys[4].publicKey.toBase58(),
      keys[5].publicKey.toBase58(),
    );
  const account = {
    owner: keys[4].publicKey,
    executable: false,
    lamports: 1,
    data: Buffer.concat([
      await discriminator("account", "Project"),
      encodeProjectTerms(a),
      Buffer.from([1, 1, 0, 0, 0, 0]),
    ]),
  } as AccountInfo<Buffer>;
  const tx = new Transaction({
    feePayer: keys[0].publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(await cancelRemainingInstruction(a, account));
  tx.partialSign(keys[0]);
  return {
    keys,
    a,
    account,
    tx,
    record,
    envelope: {
      version: 1 as const,
      action: "cancel" as const,
      raw: bs58.encode(
        tx.serialize({ requireAllSignatures: false, verifySignatures: true }),
      ),
      lastValidBlockHeight: 100,
    },
    connection: {
      isBlockhashValid: vi.fn().mockResolvedValue({ value: true }),
      getBlockHeight: vi.fn().mockResolvedValue(90),
    },
  };
}
