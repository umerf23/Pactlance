import bs58 from "bs58";
import { Transaction, type Connection, type PublicKey } from "@solana/web3.js";
import { requireDevnet } from "./network";
export interface PendingTransaction {
  schemaVersion: 1;
  projectId: string;
  wallet: string;
  feePayer?: string;
  action: string;
  signature: string;
  raw: string;
  blockhash: string;
  lastValidBlockHeight: number;
  createdAt: string;
}
export type RecoveryState =
  | "pending"
  | "confirmed"
  | "finalized"
  | "failed"
  | "expired_requires_reconciliation";
type RPC = Pick<
  Connection,
  | "getGenesisHash"
  | "getSignatureStatuses"
  | "getBlockHeight"
  | "sendRawTransaction"
>;
export function captureSignedTransaction(
  transaction: Transaction,
  projectId: string,
  wallet: PublicKey,
  action: string,
  lastValidBlockHeight: number,
): PendingTransaction {
  if (
    !transaction.feePayer ||
    !transaction.signatures.some(
      (s) => s.publicKey.equals(wallet) && s.signature,
    ) ||
    !transaction.signature ||
    !transaction.recentBlockhash ||
    !Number.isSafeInteger(lastValidBlockHeight) ||
    lastValidBlockHeight < 0
  )
    throw new Error("Invalid signed transaction.");
  const raw = transaction.serialize({
    requireAllSignatures: true,
    verifySignatures: true,
  });
  return {
    schemaVersion: 1,
    projectId,
    wallet: wallet.toBase58(),
    feePayer: transaction.feePayer.toBase58(),
    action,
    signature: bs58.encode(transaction.signature),
    raw: bs58.encode(raw),
    blockhash: transaction.recentBlockhash,
    lastValidBlockHeight,
    createdAt: new Date().toISOString(),
  };
}
export function validatePending(value: unknown): PendingTransaction {
  if (typeof value !== "object" || !value)
    throw new Error("Invalid saved transaction.");
  const p = value as PendingTransaction;
  if (
    p.schemaVersion !== 1 ||
    typeof p.raw !== "string" ||
    p.raw.length > 1800 ||
    !Number.isSafeInteger(p.lastValidBlockHeight) ||
    p.lastValidBlockHeight < 0 ||
    typeof p.projectId !== "string" ||
    !/^[-a-f0-9]{36}$/.test(p.projectId) ||
    typeof p.action !== "string" ||
    p.action.length > 80
  )
    throw new Error("Invalid saved transaction.");
  const tx = Transaction.from(bs58.decode(p.raw));
  tx.serialize({ requireAllSignatures: true, verifySignatures: true });
  if (
    !tx.signature ||
    bs58.encode(tx.signature) !== p.signature ||
    tx.recentBlockhash !== p.blockhash ||
    tx.feePayer?.toBase58() !== (p.feePayer ?? p.wallet) ||
    !tx.signatures.some(
      (s) => s.publicKey.toBase58() === p.wallet && s.signature,
    )
  )
    throw new Error("Saved transaction was changed.");
  return p;
}
export async function recoverTransaction(
  connection: RPC,
  saved: PendingTransaction,
  rebroadcast = false,
): Promise<RecoveryState> {
  const p = validatePending(saved);
  await requireDevnet(connection);
  const status = (
    await connection.getSignatureStatuses([p.signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  if (status?.err) return "failed";
  if (status?.confirmationStatus === "finalized") return "finalized";
  if (status?.confirmationStatus === "confirmed") return "confirmed";
  if ((await connection.getBlockHeight("confirmed")) > p.lastValidBlockHeight)
    return "expired_requires_reconciliation";
  if (rebroadcast) {
    const signature = await connection.sendRawTransaction(bs58.decode(p.raw), {
      skipPreflight: false,
      maxRetries: 0,
      preflightCommitment: "confirmed",
    });
    if (signature !== p.signature)
      throw new Error("RPC returned an unexpected transaction signature.");
  }
  return "pending";
}
