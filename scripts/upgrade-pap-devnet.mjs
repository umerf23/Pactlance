import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  releaseContext,
  requireCleanSource,
  compareArtifact,
} from "./lib/release-context.mjs";
import { spawnSync } from "node:child_process";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

// Operator-only upgrade. An explicit flag is required; this is never imported by the app.
if (!process.argv.includes("--upgrade")) {
  console.log(
    "Usage: npm run upgrade:pap:devnet -- --upgrade\nReview source/IDL, run all program tests, preserve key backups, and approve this devnet upgrade first. This upgrades the existing program and initializes its PAP capability; it never replaces the TEST mint.",
  );
  process.exit(0);
}
mkdirSync("validation-results", { recursive: true });
const report = {
  schemaVersion: 2,
  kind: "pap-upgrade-verification",
  status: "in_progress",
  source: releaseContext(),
  network: "devnet",
  checkedAt: new Date().toISOString(),
  liveWalletJourneyVerified: false,
};
const save = () =>
  writeFileSync(
    "validation-results/pap-upgrade.json",
    JSON.stringify(report, null, 2) + "\n",
  );
save();
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const tag = (value) =>
  createHash("sha256").update(value).digest().subarray(0, 8);
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} failed. Existing deployment identities were preserved.`,
    );
}
try {
  requireCleanSource();
  const path = process.env.DEPLOYER_KEYPAIR;
  if (!path)
    throw new Error(
      "Set DEPLOYER_KEYPAIR to the existing local devnet upgrade-authority keypair path.",
    );
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
  );
  const manifest = JSON.parse(
    readFileSync("contracts/devnet-deployment.json", "utf8"),
  );
  const program = new PublicKey(manifest.program),
    mint = new PublicKey(manifest.mint);
  if (
    manifest.network !== "devnet" ||
    manifest.upgradeAuthority !== signer.publicKey.toBase58()
  )
    throw new Error("Manifest and local upgrade authority do not match.");
  if (
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID !== program.toBase58() ||
    process.env.NEXT_PUBLIC_TEST_TOKEN_MINT !== mint.toBase58()
  )
    throw new Error(
      "Environment and preserved deployment identities do not match.",
    );
  const source = readFileSync(
      "contracts/programs/pactlance/src/lib.rs",
      "utf8",
    ),
    idl = JSON.parse(readFileSync("contracts/idl/pactlance.json", "utf8"));
  if (
    !source.includes(`declare_id!("${program}")`) ||
    idl.address !== program.toBase58() ||
    !idl.instructions.some((i) => i.name === "approve_pap_milestone")
  )
    throw new Error("Review the PAP source/IDL before upgrading.");
  const rpc =
      process.env.SOLANA_RPC_URL ||
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
      "https://api.devnet.solana.com",
    cliRpc = process.env.DEPLOY_CLI_RPC_URL || rpc;
  const connection = new Connection(rpc, "finalized");
  for (const endpoint of [rpc, cliRpc])
    if (
      (await new Connection(endpoint, "finalized").getGenesisHash()) !==
      "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
    )
      throw new Error("Both RPC endpoints must be Solana devnet.");
  const account = await connection.getAccountInfo(program, "finalized");
  if (
    !account?.executable ||
    !account.owner.equals(loader) ||
    account.data.readUInt32LE(0) !== 2
  )
    throw new Error("Existing upgradeable devnet program unavailable.");
  const pd = new PublicKey(account.data.subarray(4, 36));
  const original = await connection.getAccountInfo(pd, "finalized");
  if (
    !original?.owner.equals(loader) ||
    original.data.readUInt32LE(0) !== 3 ||
    original.data[12] !== 1 ||
    !original.data.subarray(13, 45).equals(signer.publicKey.toBuffer())
  )
    throw new Error("Local signer does not control this deployed program.");
  run("cargo-build-sbf", [
    "--tools-version",
    "v1.56",
    "--manifest-path",
    "contracts/programs/pactlance/Cargo.toml",
    "--",
    "--locked",
  ]);
  const binary = readFileSync("contracts/target/deploy/pactlance.so"),
    binaryHash = createHash("sha256").update(binary).digest("hex");
  if (
    !compareArtifact(original.data.subarray(45), binary).bytesMatch ||
    !compareArtifact(original.data.subarray(45), binary).trailingPaddingZero
  )
    run("solana", [
      "program",
      "deploy",
      "contracts/target/deploy/pactlance.so",
      "--program-id",
      program.toBase58(),
      "--buffer",
      "contracts/deploy-keys/buffer-keypair.json",
      "--upgrade-authority",
      path,
      "--keypair",
      path,
      "--url",
      cliRpc,
      "--use-rpc",
      "--max-sign-attempts",
      "20",
      "--with-compute-unit-price",
      "10000",
    ]);
  const deployed = await connection.getAccountInfo(pd, "finalized");
  if (
    !deployed?.owner.equals(loader) ||
    deployed.data[12] !== 1 ||
    !deployed.data.subarray(13, 45).equals(signer.publicKey.toBuffer()) ||
    !compareArtifact(deployed.data.subarray(45), binary).bytesMatch ||
    !compareArtifact(deployed.data.subarray(45), binary).trailingPaddingZero
  )
    throw new Error(
      "Finalized binary/authority verification failed; keep PAP_PAYMENTS_ENABLED=false.",
    );
  const [capability] = PublicKey.findProgramAddressSync(
    [Buffer.from("pap-capability")],
    program,
  );
  let cap = await connection.getAccountInfo(capability, "finalized"),
    signature = null;
  if (!cap) {
    const meta = (pubkey, isSigner = false, isWritable = false) => ({
      pubkey,
      isSigner,
      isWritable,
    });
    signature = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        new TransactionInstruction({
          programId: program,
          keys: [
            meta(signer.publicKey, true, true),
            meta(program),
            meta(pd),
            meta(capability, false, true),
            meta(SystemProgram.programId),
          ],
          data: tag("global:initialize_pap_capability"),
        }),
      ),
      [signer],
      { commitment: "finalized" },
    );
    cap = await connection.getAccountInfo(capability, "finalized");
  }
  if (
    !cap?.owner.equals(program) ||
    cap.executable ||
    cap.data.length !== 9 ||
    cap.data[8] !== 1 ||
    !cap.data.subarray(0, 8).equals(tag("account:PapCapability"))
  )
    throw new Error(
      "PAP capability verification failed; keep payment execution disabled.",
    );
  Object.assign(report, {
    status: "passed",
    checkedAt: new Date().toISOString(),
    program: program.toBase58(),
    mint: mint.toBase58(),
    binaryHash,
    capability: capability.toBase58(),
    capabilityVersion: 1,
    capabilitySignature: signature,
    upgradeAuthority: signer.publicKey.toBase58(),
    programData: pd.toBase58(),
  });
  save();
  console.log(
    "Existing devnet program upgraded and PAP capability verified. Apply the reviewer-access migration, set server-only PAP_PAYMENTS_ENABLED=true, rebuild the app, and complete the live wallet runbook. No participant payments were performed.",
  );
} catch {
  report.status = "failed";
  report.checkedAt = new Date().toISOString();
  save();
  console.error(
    "PAP upgrade failed. Keep payments disabled; deployment identities were preserved. Review local tool output privately.",
  );
  process.exitCode = 1;
}
