import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountInfo,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { agreementCommitment } from "../agreements/crypto";
import { deploymentKey, type BoundAgreement } from "./terms";
function bytes(hex: string, n: number) {
  if (!new RegExp(`^[0-9a-f]{${n * 2}}$`).test(hex))
    throw new Error("Invalid fixed-width hex value.");
  return Buffer.from(hex, "hex");
}
function integer(value: bigint, size: number, signed = false) {
  const min = signed ? -(1n << BigInt(size * 8 - 1)) : 0n;
  const max = (1n << BigInt(size * 8 - (signed ? 1 : 0))) - 1n;
  if (value < min || value > max)
    throw new Error("Integer exceeds on-chain range.");
  const b = Buffer.alloc(size);
  let n = value < 0n ? value + (1n << BigInt(size * 8)) : value;
  for (let i = 0; i < size; i++) {
    b[i] = Number(n & 255n);
    n >>= 8n;
  }
  return b;
}
function timestamp(value: string) {
  const ms = Date.parse(value);
  if (!Number.isSafeInteger(ms) || ms % 1000 !== 0)
    throw new Error("Escrow deadlines must use whole seconds.");
  return BigInt(ms / 1000);
}
function projectId(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw new Error("Invalid project UUID.");
  return bytes(value.replaceAll("-", ""), 16);
}
export async function discriminator(
  namespace: "global" | "account",
  name: string,
) {
  return Buffer.from(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${namespace}:${name}`),
    ),
  ).subarray(0, 8);
}
export function addresses(a: BoundAgreement, index = 0) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= a.terms.milestones.length
  )
    throw new Error("Invalid milestone index.");
  const program = deploymentKey(a.terms.escrowProgram);
  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program,
  );
  const [project] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("project"),
      new PublicKey(a.terms.clientWallet).toBuffer(),
      projectId(a.terms.projectId),
    ],
    program,
  );
  const [milestone] = PublicKey.findProgramAddressSync(
    [Buffer.from("milestone"), project.toBuffer(), integer(BigInt(index), 2)],
    program,
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), milestone.toBuffer()],
    program,
  );
  return { program, config, project, milestone, vault };
}
export function encodeProjectTerms(a: BoundAgreement) {
  const t = a.terms;
  if (
    !Number.isSafeInteger(t.version) ||
    t.version < 1 ||
    t.milestones.length < 1 ||
    t.milestones.length > 20
  )
    throw new Error("Invalid agreement version or schedule.");
  const keys = [
    t.clientWallet,
    t.freelancerWallet,
    t.reviewerWallet,
    t.backupReviewerWallet,
  ];
  if (
    new Set(keys).size !== 4 ||
    keys.some((k) => !PublicKey.isOnCurve(new PublicKey(k).toBytes()))
  )
    throw new Error("Invalid participant wallets.");
  if (
    !Number.isInteger(t.reviewHours) ||
    t.reviewHours < 1 ||
    t.reviewHours > 720 ||
    !Number.isInteger(t.backupDelayHours) ||
    t.backupDelayHours < 1 ||
    t.backupDelayHours > 2160
  )
    throw new Error("Invalid review periods.");
  let previousFunding = 0n,
    previousDelivery = 0n;
  const schedule = t.milestones.map((m, i) => {
    const funding = timestamp(m.fundingDeadline),
      delivery = timestamp(m.deliveryDeadline);
    if (
      m.sequence !== i + 1 ||
      funding <= previousFunding ||
      delivery <= previousDelivery ||
      funding >= delivery ||
      BigInt(m.amountUnits) <= 0n
    )
      throw new Error("Invalid ordered milestone schedule.");
    previousFunding = funding;
    previousDelivery = delivery;
    return Buffer.concat([
      integer(BigInt(m.amountUnits), 8),
      integer(funding, 8, true),
      integer(delivery, 8, true),
    ]);
  });
  return Buffer.concat([
    projectId(t.projectId),
    integer(BigInt(t.version), 4),
    bytes(a.commitment, 32),
    new PublicKey(t.clientWallet).toBuffer(),
    new PublicKey(t.freelancerWallet).toBuffer(),
    deploymentKey(t.token.mint).toBuffer(),
    new PublicKey(t.reviewerWallet).toBuffer(),
    new PublicKey(t.backupReviewerWallet).toBuffer(),
    integer(BigInt(t.reviewHours * 3600), 8, true),
    integer(BigInt(t.backupDelayHours * 3600), 8, true),
    integer(BigInt(schedule.length), 4),
    ...schedule,
  ]);
}
const meta = (pubkey: PublicKey, isSigner = false, isWritable = false) => ({
  pubkey,
  isSigner,
  isWritable,
});
async function ix(
  a: BoundAgreement,
  name: string,
  keys: ReturnType<typeof meta>[],
  args = Buffer.alloc(0),
) {
  if ((await agreementCommitment(a.terms, a.salt)) !== a.commitment)
    throw new Error("Agreement was changed after review.");
  encodeProjectTerms(a);
  return new TransactionInstruction({
    programId: deploymentKey(a.terms.escrowProgram),
    keys,
    data: Buffer.concat([await discriminator("global", name), args]),
  });
}
export async function verifyProjectAccount(
  a: BoundAgreement,
  account: AccountInfo<Buffer>,
) {
  const expected = Buffer.concat([
    await discriminator("account", "Project"),
    encodeProjectTerms(a),
  ]);
  if (
    !account.owner.equals(deploymentKey(a.terms.escrowProgram)) ||
    account.executable ||
    account.data.length < expected.length + 5 ||
    !account.data.subarray(0, expected.length).equals(expected)
  )
    throw new Error("Stored escrow differs from the reviewed agreement.");
  const state = account.data.subarray(expected.length);
  if (
    state[0] > 1 ||
    state[1] > 1 ||
    state[4] > 1 ||
    state.readUInt16LE(2) > a.terms.milestones.length
  )
    throw new Error("Invalid project state.");
  return {
    clientAccepted: state[0] === 1,
    freelancerAccepted: state[1] === 1,
    next: state.readUInt16LE(2),
    active: state[4] === 1,
  };
}
export async function createProjectInstruction(
  a: BoundAgreement,
  creator: PublicKey,
) {
  if (
    ![a.terms.clientWallet, a.terms.freelancerWallet].includes(
      creator.toBase58(),
    )
  )
    throw new Error("Only a participant can create escrow.");
  const d = addresses(a);
  return ix(
    a,
    "create_project",
    [
      meta(d.config),
      meta(creator, true, true),
      meta(d.project, false, true),
      meta(new PublicKey(a.terms.token.mint)),
      meta(SystemProgram.programId),
    ],
    encodeProjectTerms(a),
  );
}
export async function acceptProjectInstruction(
  a: BoundAgreement,
  participant: PublicKey,
  account: AccountInfo<Buffer>,
) {
  await verifyProjectAccount(a, account);
  if (
    ![a.terms.clientWallet, a.terms.freelancerWallet].includes(
      participant.toBase58(),
    )
  )
    throw new Error("Only a participant can accept escrow.");
  return ix(
    a,
    "accept_project",
    [meta(participant, true), meta(addresses(a).project, false, true)],
    bytes(a.commitment, 32),
  );
}
export async function fundInstruction(
  a: BoundAgreement,
  index: number,
  source: PublicKey,
  account: AccountInfo<Buffer>,
) {
  const state = await verifyProjectAccount(a, account);
  if (
    !state.clientAccepted ||
    !state.freelancerAccepted ||
    state.active ||
    state.next !== index
  )
    throw new Error("Milestone is not ready for funding.");
  const d = addresses(a, index);
  return ix(
    a,
    "fund_milestone",
    [
      meta(new PublicKey(a.terms.clientWallet), true, true),
      meta(d.project, false, true),
      meta(new PublicKey(a.terms.token.mint)),
      meta(d.milestone, false, true),
      meta(d.vault, false, true),
      meta(source, false, true),
      meta(TOKEN_PROGRAM_ID),
      meta(SystemProgram.programId),
    ],
    integer(BigInt(index), 2),
  );
}
export async function submitInstruction(
  a: BoundAgreement,
  index: number,
  commitment: string,
) {
  const d = addresses(a, index),
    evidence = bytes(commitment, 32);
  if (evidence.every((b) => b === 0))
    throw new Error("Empty evidence commitment.");
  return ix(
    a,
    "submit_delivery",
    [
      meta(new PublicKey(a.terms.freelancerWallet), true),
      meta(d.project),
      meta(d.milestone, false, true),
    ],
    evidence,
  );
}
export async function approveInstruction(
  a: BoundAgreement,
  index: number,
  recipient: PublicKey,
) {
  const d = addresses(a, index);
  return ix(a, "approve_milestone", [
    meta(new PublicKey(a.terms.clientWallet), true),
    meta(d.project, false, true),
    meta(d.milestone, false, true),
    meta(new PublicKey(a.terms.token.mint)),
    meta(d.vault, false, true),
    meta(recipient, false, true),
    meta(TOKEN_PROGRAM_ID),
  ]);
}
