import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
    const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    if (
      !pa.owner.equals(loader) ||
      pa.data.length !== 36 ||
      pa.data.readUInt32LE(0) !== 2
    )
      throw new Error("Unexpected program loader or layout.");
    const programData = new PublicKey(pa.data.subarray(4, 36));
    const pd = await c.getAccountInfo(programData, "finalized");
    if (
      !pd?.owner.equals(loader) ||
      pd.data.length < 13 ||
      pd.data.readUInt32LE(0) !== 3
    )
      throw new Error("Invalid ProgramData.");
    if (
      ![0, 1].includes(pd.data[12]) ||
      (pd.data[12] === 1 && pd.data.length < 45)
    )
      throw new Error("Invalid upgrade authority layout.");
    const authority =
      pd.data[12] === 1
        ? new PublicKey(pd.data.subarray(13, 45)).toBase58()
        : null;
    const report = {
      schemaVersion: 1,
      kind: "read-only-devnet-preflight",
      checkedAt: new Date().toISOString(),
      genesis: await c.getGenesisHash(),
      finalizedSlot: await c.getSlot("finalized"),
      program: p,
      programData: programData.toBase58(),
      upgradeAuthority: authority,
      lastUpgradeSlot: pd.data.readBigUInt64LE(4).toString(),
      executableCodeSha256: createHash("sha256")
        .update(pd.data.subarray(45))
        .digest("hex"),
      mint: m,
      decimals: mi.decimals,
      mintAuthority: mi.mintAuthority?.toBase58() ?? null,
      freezeAuthority: mi.freezeAuthority?.toBase58() ?? null,
      limitation:
        "Read-only identities and configuration verified; no lifecycle, browser wallet or source-to-deployed-binary verification.",
    };
    console.log(JSON.stringify(report, null, 2));
    const at = process.argv.indexOf("--report");
    if (at >= 0) {
      const file = process.argv[at + 1];
      if (!file) throw new Error("Missing report path.");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
    }
  }
} catch {
  console.error(
    "Devnet preflight failed. Check network, program, mint and RPC availability. No transaction was sent.",
  );
  process.exitCode = 1;
}
