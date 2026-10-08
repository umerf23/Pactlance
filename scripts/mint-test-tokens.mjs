import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintToChecked,
} from "@solana/spl-token";
try {
  const path = process.env.MINT_AUTHORITY_KEYPAIR;
  if (!path)
    throw new Error(
      "Configure MINT_AUTHORITY_KEYPAIR with a local keypair path.",
    );
  const authority = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
    ),
    recipient = new PublicKey(process.argv[2]),
    amount = process.argv[3];
  if (
    !PublicKey.isOnCurve(recipient.toBytes()) ||
    !/^\d{1,9}(?:\.\d{1,6})?$/.test(amount ?? "")
  )
    throw new Error(
      "Use a participant wallet and a positive TEST amount with up to six decimals.",
    );
  const [whole, fraction = ""] = amount.split("."),
    units = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  if (units <= 0n) throw new Error("Amount must be positive.");
  const c = new Connection(
    process.env.SOLANA_RPC_URL ||
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
      "https://api.devnet.solana.com",
    "finalized",
  );
  if (
    (await c.getGenesisHash()) !==
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
  )
    throw new Error("Solana devnet is required.");
  const mint = new PublicKey(process.env.NEXT_PUBLIC_TEST_TOKEN_MINT),
    info = await getMint(c, mint, "finalized");
  if (info.decimals !== 6 || !info.mintAuthority?.equals(authority.publicKey))
    throw new Error("Signer does not control the six-decimal TEST mint.");
  const ata = await getOrCreateAssociatedTokenAccount(
      c,
      authority,
      mint,
      recipient,
      false,
      "finalized",
    ),
    signature = await mintToChecked(
      c,
      authority,
      mint,
      ata.address,
      authority,
      units,
      6,
      [],
      { commitment: "finalized" },
    );
  console.log(`Minted ${amount} TEST on devnet: ${signature}`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
