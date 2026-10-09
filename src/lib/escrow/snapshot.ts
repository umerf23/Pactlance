import { PublicKey, type Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, unpackMint, unpackAccount } from "@solana/spl-token";
import type { AgreementRecord } from "../agreements/schema";
import { bindAgreement } from "./terms";
import {
  addresses,
  discriminator,
  verifyProjectAccount,
  verifyMilestoneAccount,
} from "./client";
import { requireDevnet } from "./network";
type RPC = Pick<
  Connection,
  "getGenesisHash" | "getMultipleAccountsInfoAndContext" | "getBlockTime"
>;
export async function readEscrow(
  connection: RPC,
  records: AgreementRecord[],
  program: string,
  mint: string,
  papEnabled = false,
) {
  await requireDevnet(connection);
  if (!records.length) throw new Error("Agreement history unavailable.");
  const bindings = await Promise.all(
    [...records]
      .sort((a, b) => b.version - a.version)
      .map((r) => bindAgreement(r, program, mint, papEnabled)),
  );
  const latest = bindings[0],
    longest = bindings.reduce((a, b) =>
      a.terms.milestones.length > b.terms.milestones.length ? a : b,
    ),
    d = addresses(latest),
    mintKey = new PublicKey(mint);
  const pdas = longest.terms.milestones.map((_, i) => addresses(longest, i));
  const { context, value } = await connection.getMultipleAccountsInfoAndContext(
    [
      d.program,
      d.config,
      mintKey,
      d.project,
      ...pdas.flatMap((p) => [p.milestone, p.vault]),
      ...(latest.terms.protocol
        ? [
            PublicKey.findProgramAddressSync(
              [Buffer.from("pap-capability")],
              d.program,
            )[0],
          ]
        : []),
    ],
    { commitment: "finalized" },
  );
  const [programAccount, config, mintAccount, project] = value;
  if (latest.terms.protocol) {
    const capability = value[4 + pdas.length * 2];
    if (
      !capability ||
      capability.executable ||
      !capability.owner.equals(d.program) ||
      capability.data.length !== 9 ||
      capability.data[8] !== 1 ||
      !capability.data
        .subarray(0, 8)
        .equals(await discriminator("account", "PapCapability"))
    )
      throw new Error("PAP_CAPABILITY_UNAVAILABLE");
  }
  if (!programAccount?.executable)
    throw new Error("Escrow program is not deployed.");
  if (
    !config ||
    !config.owner.equals(d.program) ||
    config.executable ||
    config.data.length !== 40 ||
    !config.data
      .subarray(0, 8)
      .equals(await discriminator("account", "EscrowConfig")) ||
    !config.data.subarray(8, 40).equals(mintKey.toBuffer())
  )
    throw new Error("Escrow config does not match the TEST mint.");
  if (!mintAccount || !mintAccount.owner.equals(TOKEN_PROGRAM_ID))
    throw new Error("Invalid TEST mint owner.");
  const mintInfo = unpackMint(mintKey, mintAccount, TOKEN_PROGRAM_ID);
  if (!mintInfo.isInitialized || mintInfo.decimals !== 6)
    throw new Error("TEST mint must be initialized with six decimals.");
  const chainTime = await connection.getBlockTime(context.slot);
  if (chainTime === null || Math.abs(Date.now() / 1000 - chainTime) > 120)
    throw new Error("RPC finalized snapshot is stale.");
  let agreement = latest;
  if (project) {
    if (project.data.length < 28) throw new Error("Invalid project account.");
    const version = project.data.readUInt32LE(24);
    const selected = bindings.find((b) => b.terms.version === version);
    if (!selected)
      throw new Error("On-chain agreement version is unavailable.");
    agreement = selected;
  }
  const state = project ? await verifyProjectAccount(agreement, project) : null;
  const milestones = await Promise.all(
    pdas.map(async (p, index) => {
      const account = value[4 + index * 2],
        vault = value[5 + index * 2];
      if (!account) {
        if (vault) throw new Error("Unexpected orphan escrow vault.");
        return null;
      }
      if (!state || account.data.length < 136)
        throw new Error("Unexpected milestone account.");
      const version = account.data.readUInt32LE(132),
        original = bindings.find((b) => b.terms.version === version);
      if (!original || index >= original.terms.milestones.length)
        throw new Error("Historical milestone agreement unavailable.");
      const m = await verifyMilestoneAccount(original, index, account),
        paid = m.clientRefunded + m.freelancerPaid;
      if (paid > m.amount || (m.status === 3 ? paid !== m.amount : paid !== 0n))
        throw new Error("Invalid recorded settlement totals.");
      if (m.status !== 3) {
        if (!vault) throw new Error("Active escrow vault unavailable.");
        const v = unpackAccount(p.vault, vault, TOKEN_PROGRAM_ID);
        if (
          !v.mint.equals(mintKey) ||
          !v.owner.equals(p.milestone) ||
          v.amount < m.amount ||
          v.isFrozen
        )
          throw new Error("Invalid escrow vault.");
      }
      return {
        ...m,
        index,
        agreementVersion: version,
        commitment: original.commitment,
        submissionCommitment: account.data.subarray(66, 98).toString("hex"),
        disputeCommitment: account.data.subarray(152, 184).toString("hex"),
      };
    }),
  );
  if (state) {
    if (state.cancelled && state.active)
      throw new Error("Invalid cancelled escrow state.");
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      if (i < state.next && m?.status !== 3)
        throw new Error("Settled history is incomplete.");
      if (i > state.next && m) throw new Error("Unexpected future milestone.");
      if (i === state.next && (state.active ? !m || m.status === 3 : !!m))
        throw new Error("Active milestone pointer mismatch.");
    }
  }
  return {
    configured: true as const,
    agreement,
    draft: latest.terms.version > agreement.terms.version ? latest : null,
    state,
    milestones,
    slot: context.slot,
    chainTime,
    verifiedAt: new Date().toISOString(),
    bindings,
  };
}
export function jsonSafe<T>(value: T) {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}
