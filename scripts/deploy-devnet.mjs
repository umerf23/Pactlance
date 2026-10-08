import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createMint, getMint } from "@solana/spl-token";
const root = process.cwd(),
  rpc =
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.devnet.solana.com",
  cliRpc = process.env.DEPLOY_CLI_RPC_URL || rpc,
  genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
function keyFile(path) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
  );
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error)
    throw new Error(
      `${command} unavailable: install the pinned deployment toolchain.`,
    );
  if (result.status !== 0)
    throw new Error(
      `${command} failed. Existing deployment keys were retained for retry.`,
    );
}
const tag = (name) => createHash("sha256").update(name).digest().subarray(0, 8);
try {
  const deployerPath = process.env.DEPLOYER_KEYPAIR;
  if (!deployerPath)
    throw new Error(
      "Configure DEPLOYER_KEYPAIR with a funded local devnet keypair path.",
    );
  const payer = keyFile(deployerPath),
    c = new Connection(rpc, "finalized");
  if (
    (await c.getGenesisHash()) !== genesis ||
    (await new Connection(cliRpc, "finalized").getGenesisHash()) !== genesis
  )
    throw new Error("Both SDK and CLI endpoints must point to Solana devnet.");
  const balance = await c.getBalance(payer.publicKey, "finalized");
  if (balance < 1000000000)
    throw new Error(
      `Fund devnet signer ${payer.publicKey}: at least 1 SOL is required for initial deployment checks.`,
    );
  const dir = resolve(root, "contracts/deploy-keys"),
    manifestPath = resolve(root, "contracts/devnet-deployment.json");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (
    existsSync(manifestPath) &&
    ["program", "mint"].some(
      (n) => !existsSync(resolve(dir, `${n}-keypair.json`)),
    )
  )
    throw new Error(
      "Deployment identity key is missing. Restore its backup; do not generate replacement identities.",
    );
  function identity(name) {
    const path = resolve(dir, `${name}-keypair.json`);
    if (!existsSync(path)) {
      const k = Keypair.generate();
      writeFileSync(path, JSON.stringify(Array.from(k.secretKey)), {
        mode: 0o600,
        flag: "wx",
      });
    }
    return { path, key: keyFile(path) };
  }
  const program = identity("program"),
    mint = identity("mint"),
    buffer = identity("buffer"),
    id = program.key.publicKey.toBase58(),
    manifest = {
      network: "devnet",
      program: id,
      mint: mint.key.publicKey.toBase58(),
      upgradeAuthority: payer.publicKey.toBase58(),
    };
  if (existsSync(manifestPath)) {
    const prior = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const name of ["program", "mint", "upgradeAuthority"])
      if (prior[name] !== manifest[name])
        throw new Error(
          "Existing deployment manifest does not match local identities.",
        );
  } else
    writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, status: "prepared" }, null, 2) + "\n",
    );
  const rustPath = resolve(root, "contracts/programs/pactlance/src/lib.rs"),
    rust = readFileSync(rustPath, "utf8");
  if (!/declare_id!\("[^"]+"\)/.test(rust))
    throw new Error("Cannot locate the Rust program identity.");
  writeFileSync(
    rustPath,
    rust.replace(/declare_id!\("[^"]+"\)/, `declare_id!("${id}")`),
  );
  const anchorPath = resolve(root, "contracts/Anchor.toml");
  let anchor = readFileSync(anchorPath, "utf8").replace(
    /pactlance = "[^"]+"/g,
    `pactlance = "${id}"`,
  );
  if (!anchor.includes("[programs.devnet]"))
    anchor += `\n[programs.devnet]\npactlance = "${id}"\n`;
  writeFileSync(anchorPath, anchor);
  const idlPath = resolve(root, "contracts/idl/pactlance.json");
  const idl = JSON.parse(readFileSync(idlPath, "utf8"));
  idl.address = id;
  writeFileSync(idlPath, JSON.stringify(idl, null, 2) + "\n");
  run("cargo-build-sbf", [
    "--tools-version",
    "v1.56",
    "--manifest-path",
    "contracts/programs/pactlance/Cargo.toml",
    "--",
    "--locked",
  ]);
  const binaryPath = resolve(root, "contracts/target/deploy/pactlance.so"),
    binary = readFileSync(binaryPath);
  const rent =
    (await c.getMinimumBalanceForRentExemption(binary.length + 45)) +
    (await c.getMinimumBalanceForRentExemption(binary.length + 37)) +
    100000000;
  const existing = await c.getAccountInfo(program.key.publicKey, "finalized");
  if (!existing) {
    if ((await c.getBalance(payer.publicKey, "finalized")) < rent)
      throw new Error(
        `Insufficient devnet SOL for program rent and fees. Estimated ${(rent / 1e9).toFixed(3)} SOL.`,
      );
    run("solana", [
      "program",
      "deploy",
      binaryPath,
      "--program-id",
      program.path,
      "--buffer",
      buffer.path,
      "--upgrade-authority",
      deployerPath,
      "--keypair",
      deployerPath,
      "--url",
      cliRpc,
      "--use-rpc",
    ]);
  }
  const deployed = await c.getAccountInfo(program.key.publicKey, "finalized");
  if (
    !deployed?.executable ||
    !deployed.owner.equals(loader) ||
    deployed.data.readUInt32LE(0) !== 2
  )
    throw new Error("Upgradeable program verification failed.");
  const programDataKey = new PublicKey(deployed.data.subarray(4, 36)),
    programData = await c.getAccountInfo(programDataKey, "finalized");
  if (
    !programData?.owner.equals(loader) ||
    programData.data.readUInt32LE(0) !== 3 ||
    programData.data[12] !== 1 ||
    !programData.data.subarray(13, 45).equals(payer.publicKey.toBuffer()) ||
    !programData.data.subarray(45, 45 + binary.length).equals(binary)
  )
    throw new Error(
      "Deployed binary/upgrade authority mismatch. Review deployment before any upgrade.",
    );
  if (!(await c.getAccountInfo(mint.key.publicKey, "finalized")))
    await createMint(c, payer, payer.publicKey, null, 6, mint.key, {
      commitment: "finalized",
    });
  const mintInfo = await getMint(c, mint.key.publicKey, "finalized");
  if (
    mintInfo.decimals !== 6 ||
    mintInfo.freezeAuthority ||
    !mintInfo.mintAuthority?.equals(payer.publicKey)
  )
    throw new Error("TEST mint authority/decimals mismatch.");
  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.key.publicKey,
  );
  if (!(await c.getAccountInfo(config, "finalized"))) {
    const ix = new TransactionInstruction({
      programId: program.key.publicKey,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: program.key.publicKey, isSigner: false, isWritable: false },
        { pubkey: programDataKey, isSigner: false, isWritable: false },
        { pubkey: mint.key.publicKey, isSigner: false, isWritable: false },
        { pubkey: config, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: tag("global:initialize_config"),
    });
    await sendAndConfirmTransaction(c, new Transaction().add(ix), [payer], {
      commitment: "finalized",
    });
  }
  const cfg = await c.getAccountInfo(config, "finalized");
  if (
    !cfg?.owner.equals(program.key.publicKey) ||
    cfg.data.length !== 40 ||
    !cfg.data.subarray(0, 8).equals(tag("account:EscrowConfig")) ||
    !cfg.data.subarray(8, 40).equals(mint.key.publicKey.toBuffer())
  )
    throw new Error("Initialized config does not match TEST mint.");
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        ...manifest,
        status: "deployed",
        verifiedSlot: await c.getSlot("finalized"),
      },
      null,
      2,
    ) + "\n",
  );
  const envPath = resolve(root, ".env.local");
  let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SOLANA_NETWORK: "devnet",
    NEXT_PUBLIC_ESCROW_PROGRAM_ID: id,
    NEXT_PUBLIC_TEST_TOKEN_MINT: mint.key.publicKey.toBase58(),
  })) {
    const line = new RegExp(`^${name}=.*$`, "m");
    env = line.test(env)
      ? env.replace(line, `${name}=${value}`)
      : `${env.trimEnd()}\n${name}=${value}\n`;
  }
  writeFileSync(envPath, env, { mode: 0o600 });
  console.log(`Verified devnet program: ${id}`);
  console.log(`TEST mint: ${mint.key.publicKey}`);
  console.log(
    "Public values saved to .env.local. Preserve key backups, review public identity changes, then rebuild the app.",
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
