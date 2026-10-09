import { type Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import { requireDevnet } from "./network";

export async function readWalletBalances(
  connection: Pick<
    Connection,
    "getGenesisHash" | "getBalance" | "getAccountInfo"
  >,
  wallet: PublicKey,
  mint: PublicKey,
) {
  await requireDevnet(connection);
  const address = getAssociatedTokenAddressSync(mint, wallet);
  const [lamports, info] = await Promise.all([
    connection.getBalance(wallet, "confirmed"),
    connection.getAccountInfo(address, "confirmed"),
  ]);
  if (!Number.isSafeInteger(lamports) || lamports < 0)
    throw new Error("Invalid SOL balance response.");
  if (!info) return { lamports, tokenUnits: 0n };
  const account = unpackAccount(address, info, TOKEN_PROGRAM_ID);
  if (
    !account.mint.equals(mint) ||
    !account.owner.equals(wallet) ||
    !account.isInitialized ||
    account.isFrozen
  )
    throw new Error("The configured TEST token account is invalid or frozen.");
  return { lamports, tokenUnits: account.amount };
}
