import type { Connection } from "@solana/web3.js";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export async function requireDevnet(
  connection: Pick<Connection, "getGenesisHash">,
) {
  if ((await connection.getGenesisHash()) !== DEVNET_GENESIS)
    throw new Error("Solana devnet is required.");
}
