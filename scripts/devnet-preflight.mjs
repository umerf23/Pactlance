import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  releaseContext,
  compareArtifact,
  sha256,
} from "./lib/release-context.mjs";
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const file = process.argv.includes("--report")
  ? arg("--report")
  : "validation-results/devnet-preflight.json";
const report = {
  schemaVersion: 2,
  kind: "read-only-devnet-preflight",
  status: "in_progress",
  source: releaseContext(),
  checkedAt: new Date().toISOString(),
  network: "devnet",
  limitation:
    "Read-only deployment observation. Does not verify browser journeys, hosted privacy, or independently reproduce source.",
};
const save = () => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
};
save();
const tag = (value) =>
  createHash("sha256").update(value).digest().subarray(0, 8);
try {
  const manifest = JSON.parse(
      readFileSync("contracts/devnet-deployment.json", "utf8"),
    ),
    p = process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID,
    m = process.env.NEXT_PUBLIC_TEST_TOKEN_MINT;
  if (
    !p ||
    !m ||
    manifest.network !== "devnet" ||
    p !== manifest.program ||
    m !== manifest.mint
  )
    throw new Error("Identity mismatch.");
  const c = new Connection(
    process.env.SOLANA_RPC_URL ||
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
      "https://api.devnet.solana.com",
    {
      commitment: "finalized",
      disableRetryOnRateLimit: true,
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  );
  const genesis = await c.getGenesisHash();
  if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")
    throw new Error("Wrong network.");
  const program = new PublicKey(p),
    mint = new PublicKey(m),
    [config] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program,
    ),
    [capability] = PublicKey.findProgramAddressSync(
      [Buffer.from("pap-capability")],
      program,
    );
  const accounts = await c.getMultipleAccountsInfoAndContext(
      [program, config, capability],
      "finalized",
    ),
    [pa, ca, cap] = accounts.value,
    mi = await getMint(c, mint, "finalized");
  if (
    !pa?.executable ||
    !ca?.owner.equals(program) ||
    ca.data.length !== 40 ||
    !ca.data.subarray(0, 8).equals(tag("account:EscrowConfig")) ||
    !ca.data.subarray(8, 40).equals(mint.toBuffer()) ||
    !mi.isInitialized ||
    mi.decimals !== 6
  )
    throw new Error("Configuration invalid.");
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  if (
    !pa.owner.equals(loader) ||
    pa.data.length !== 36 ||
    pa.data.readUInt32LE(0) !== 2
  )
    throw new Error("Loader invalid.");
  const programData = new PublicKey(pa.data.subarray(4, 36)),
    pdResult = await c.getAccountInfoAndContext(programData, {
      commitment: "finalized",
      minContextSlot: accounts.context.slot,
    }),
    pd = pdResult.value;
  if (
    !pd?.owner.equals(loader) ||
    pd.data.length < 45 ||
    pd.data.readUInt32LE(0) !== 3 ||
    ![0, 1].includes(pd.data[12])
  )
    throw new Error("ProgramData invalid.");
  const authority =
    pd.data[12] === 1
      ? new PublicKey(pd.data.subarray(13, 45)).toBase58()
      : null;
  if (authority !== manifest.upgradeAuthority)
    throw new Error("Authority mismatch.");
  const papValid =
    cap?.owner.equals(program) &&
    !cap.executable &&
    cap.data.length === 9 &&
    cap.data.subarray(0, 8).equals(tag("account:PapCapability")) &&
    cap.data[8] === 1;
  if (process.argv.includes("--pap") && !papValid)
    throw new Error("PAP capability invalid.");
  const artifactComparison = process.argv.includes("--artifact")
    ? compareArtifact(pd.data.subarray(45), readFileSync(arg("--artifact")))
    : null;
  if (
    artifactComparison &&
    (!artifactComparison.bytesMatch || !artifactComparison.trailingPaddingZero)
  )
    throw new Error("Artifact mismatch.");
  Object.assign(report, {
    status: "passed",
    checkedAt: new Date().toISOString(),
    genesis,
    finalizedSlot: accounts.context.slot,
    programDataFinalizedSlot: pdResult.context.slot,
    program: p,
    mint: m,
    programData: programData.toBase58(),
    upgradeAuthority: authority,
    lastUpgradeSlot: pd.data.readBigUInt64LE(4).toString(),
    executableCodeSha256: sha256(pd.data.subarray(45)),
    decimals: mi.decimals,
    mintAuthority: mi.mintAuthority?.toBase58() ?? null,
    freezeAuthority: mi.freezeAuthority?.toBase58() ?? null,
    papCapability: papValid
      ? { address: capability.toBase58(), version: 1 }
      : null,
    artifactComparison,
  });
  save();
  console.log(
    `Read-only devnet identity/capability observations saved to ${file}. No transaction was sent.`,
  );
} catch {
  report.status = "failed";
  report.checkedAt = new Date().toISOString();
  save();
  console.error(
    "Devnet preflight failed. Check identities, network, capability, artifact and RPC availability. No transaction was sent.",
  );
  process.exitCode = 1;
}
