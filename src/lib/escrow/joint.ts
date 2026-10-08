import {
  Transaction,
  type Connection,
  type AccountInfo,
} from "@solana/web3.js";
import bs58 from "bs58";
import { cancelRemainingInstruction, reviseProjectInstruction } from "./client";
import type { BoundAgreement } from "./terms";
export interface JointEnvelope {
  version: 1;
  action: "cancel" | "revise";
  raw: string;
  lastValidBlockHeight: number;
}
export async function verifyJointEnvelope(
  envelope: JointEnvelope,
  a: BoundAgreement,
  next: BoundAgreement | null,
  account: AccountInfo<Buffer>,
  connection: Pick<Connection, "isBlockhashValid" | "getBlockHeight">,
) {
  if (
    envelope.version !== 1 ||
    !["cancel", "revise"].includes(envelope.action) ||
    typeof envelope.raw !== "string" ||
    envelope.raw.length > 1800 ||
    !Number.isSafeInteger(envelope.lastValidBlockHeight)
  )
    throw new Error("Invalid joint transaction package.");
  const tx = Transaction.from(bs58.decode(envelope.raw));
  if (
    !tx.feePayer ||
    ![a.terms.clientWallet, a.terms.freelancerWallet].includes(
      tx.feePayer.toBase58(),
    ) ||
    !tx.recentBlockhash
  )
    throw new Error("Joint fee payer must be a participant.");
  const height = await connection.getBlockHeight("confirmed");
  if (envelope.lastValidBlockHeight > height + 153)
    throw new Error("Invalid joint transaction expiry.");
  if (
    !(
      await connection.isBlockhashValid(tx.recentBlockhash, {
        commitment: "confirmed",
      })
    ).value ||
    height > envelope.lastValidBlockHeight
  )
    throw new Error("Joint transaction expired. Request a new package.");
  const expected = new Transaction({
    feePayer: tx.feePayer,
    recentBlockhash: tx.recentBlockhash,
  }).add(
    envelope.action === "cancel"
      ? await cancelRemainingInstruction(a, account)
      : next
        ? await reviseProjectInstruction(a, next, account)
        : (() => {
            throw new Error("No reviewed revision available.");
          })(),
  );
  if (!expected.serializeMessage().equals(tx.serializeMessage()))
    throw new Error(
      "Joint transaction differs from the reviewed cancellation/revision.",
    );
  tx.serialize({ requireAllSignatures: false, verifySignatures: true });
  if (
    !tx.signatures.some(
      (s) =>
        [a.terms.clientWallet, a.terms.freelancerWallet].includes(
          s.publicKey.toBase58(),
        ) && s.signature,
    )
  )
    throw new Error("First participant signature is missing.");
  return tx;
}
