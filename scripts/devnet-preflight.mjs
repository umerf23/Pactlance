import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { createHash } from "node:crypto";
const c = new Connection(
  process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.devnet.solana.com",
  "finalized",
);
try {
  if (
    (await c.getGenesisHash()) !==
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
  )
    throw new Error("Solana devnet is required.");
  console.log("Verified Solana devnet.");
  const p = process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID,
    m = process.env.NEXT_PUBLIC_TEST_TOKEN_MINT;
  if (!p || !m) {
    console.log("Program/mint not configured. Deployment remains pending.");
    process.exitCode = 1;
  } else {
    const program = new PublicKey(p),
      mint = new PublicKey(m),
      [config] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        program,
      ),
      [pa, ca] = await c.getMultipleAccountsInfo(
        [program, config],
        "finalized",
      ),
      mi = await getMint(c, mint, "finalized"),
      tag = createHash("sha256")
        .update("account:EscrowConfig")
        .digest()
        .subarray(0, 8);
    if (
      !pa?.executable ||
      !ca?.owner.equals(program) ||
      ca.data.length !== 40 ||
      !ca.data.subarray(0, 8).equals(tag) ||
      !ca.data.subarray(8, 40).equals(mint.toBuffer()) ||
      !mi.isInitialized ||
      mi.decimals !== 6
    )
      throw new Error("Deployment/config/TEST mint verification failed.");
    console.log(`Verified program ${p} and six-decimal TEST mint ${m}.`);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
