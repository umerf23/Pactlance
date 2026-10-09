import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountInfo,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { agreementCommitment, canonicalJSON } from "../agreements/crypto";
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
    !!t.protocol !==
    (t.schemaVersion === 3 && t.paymentProfile === "pap_explicit_v1")
  )
    throw new Error("Invalid payment profile.");
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
    integer(t.protocol ? 0n : BigInt(t.reviewHours * 3600), 8, true),
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
    account.data.length < expected.length + 6 ||
    !account.data.subarray(0, expected.length).equals(expected)
  )
    throw new Error("Stored escrow differs from the reviewed agreement.");
  const state = account.data.subarray(expected.length);
  if (
    state[0] > 1 ||
    state[1] > 1 ||
    state[4] > 1 ||
    state[5] > 1 ||
    state.readUInt16LE(2) > a.terms.milestones.length
  )
    throw new Error("Invalid project state.");
  return {
    clientAccepted: state[0] === 1,
    freelancerAccepted: state[1] === 1,
    next: state.readUInt16LE(2),
    active: state[4] === 1,
    cancelled: state[5] === 1,
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
    a.terms.protocol ? "create_pap_project" : "create_project",
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
    state.cancelled ||
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
    a.terms.protocol ? "submit_pap_delivery" : "submit_delivery",
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
  submission?: string,
) {
  const d = addresses(a, index);
  if (a.terms.protocol && !submission)
    throw new Error("Review the PAP delivery commitment before payment.");
  return ix(
    a,
    a.terms.protocol ? "approve_pap_milestone" : "approve_milestone",
    [
      meta(new PublicKey(a.terms.clientWallet), true),
      meta(d.project, false, true),
      meta(d.milestone, false, true),
      meta(new PublicKey(a.terms.token.mint)),
      meta(d.vault, false, true),
      meta(recipient, false, true),
      meta(TOKEN_PROGRAM_ID),
    ],
    a.terms.protocol ? bytes(submission!, 32) : Buffer.alloc(0),
  );
}

export async function verifyMilestoneAccount(
  a: BoundAgreement,
  index: number,
  account: AccountInfo<Buffer>,
) {
  const d = addresses(a, index),
    data = account.data,
    t = a.terms.milestones[index];
  if (
    !account.owner.equals(d.program) ||
    account.executable ||
    data.length < 227 ||
    !data.subarray(0, 8).equals(await discriminator("account", "Milestone")) ||
    !data.subarray(8, 40).equals(d.project.toBuffer()) ||
    data.readUInt16LE(40) !== index ||
    data.readBigUInt64LE(42) !== BigInt(t.amountUnits) ||
    data.readBigInt64LE(50) !== timestamp(t.deliveryDeadline) ||
    !data.subarray(100, 132).equals(bytes(a.commitment, 32)) ||
    data.readUInt32LE(132) !== a.terms.version
  )
    throw new Error("Stored milestone differs from the reviewed agreement.");
  if (
    ![1, 2, 3, 4].includes(data[98]) ||
    data[224] > 1 ||
    data[225] > 1 ||
    data[226] > 1
  )
    throw new Error("Invalid milestone state.");
  return {
    amount: data.readBigUInt64LE(42),
    deliveryDeadline: data.readBigInt64LE(50),
    reviewDeadline: data.readBigInt64LE(58),
    status: data[98],
    disputedAt: data.readBigInt64LE(136),
    backupAt: data.readBigInt64LE(144),
    clientRefunded: data.readBigUInt64LE(184),
    freelancerPaid: data.readBigUInt64LE(192),
    proposalNonce: data.readBigUInt64LE(200),
    clientAmount: data.readBigUInt64LE(208),
    freelancerAmount: data.readBigUInt64LE(216),
    cancelRemaining: data[224] === 1,
    clientApproved: data[225] === 1,
    freelancerApproved: data[226] === 1,
  };
}
function allocation(
  a: BoundAgreement,
  index: number,
  client: bigint,
  freelancer: bigint,
) {
  addresses(a, index);
  if (
    client < 0n ||
    freelancer < 0n ||
    client + freelancer !== BigInt(a.terms.milestones[index].amountUnits)
  )
    throw new Error("Allocation must equal the funded amount.");
  return Buffer.concat([integer(client, 8), integer(freelancer, 8)]);
}
function participant(a: BoundAgreement, actor: PublicKey) {
  if (
    ![a.terms.clientWallet, a.terms.freelancerWallet].includes(actor.toBase58())
  )
    throw new Error("Only a participant can authorize this action.");
}
function actionKeys(a: BoundAgreement, index: number, actor: PublicKey) {
  const d = addresses(a, index);
  return [meta(actor, true), meta(d.project), meta(d.milestone, false, true)];
}
function settlementKeys(
  a: BoundAgreement,
  index: number,
  actor: PublicKey,
  clientRecipient: PublicKey,
  freelancerRecipient: PublicKey,
) {
  const d = addresses(a, index);
  return [
    meta(actor, true),
    meta(d.project, false, true),
    meta(d.milestone, false, true),
    meta(new PublicKey(a.terms.token.mint)),
    meta(d.vault, false, true),
    meta(clientRecipient, false, true),
    meta(freelancerRecipient, false, true),
    meta(TOKEN_PROGRAM_ID),
  ];
}
export async function claimAfterReviewInstruction(
  a: BoundAgreement,
  index: number,
  actor: PublicKey,
  clientRecipient: PublicKey,
  freelancerRecipient: PublicKey,
) {
  if (a.terms.protocol)
    throw new Error(
      "PAP requires explicit payment authorization; timer payouts are disabled.",
    );
  return ix(
    a,
    "claim_after_review",
    settlementKeys(a, index, actor, clientRecipient, freelancerRecipient),
  );
}
export async function refundNonDeliveryInstruction(
  a: BoundAgreement,
  index: number,
  clientRecipient: PublicKey,
  freelancerRecipient: PublicKey,
) {
  if (a.terms.protocol)
    throw new Error(
      "PAP refunds require mutual settlement or dispute resolution.",
    );
  return ix(
    a,
    "refund_non_delivery",
    settlementKeys(
      a,
      index,
      new PublicKey(a.terms.clientWallet),
      clientRecipient,
      freelancerRecipient,
    ),
  );
}
export async function openDisputeInstruction(
  a: BoundAgreement,
  index: number,
  actor: PublicKey,
  commitment: string,
) {
  participant(a, actor);
  const evidence = bytes(commitment, 32);
  if (evidence.every((b) => b === 0))
    throw new Error("Empty dispute commitment.");
  return ix(a, "open_dispute", actionKeys(a, index, actor), evidence);
}
export async function proposeSettlementInstruction(
  a: BoundAgreement,
  index: number,
  actor: PublicKey,
  expectedNonce: bigint,
  clientAmount: bigint,
  freelancerAmount: bigint,
  cancelRemaining = false,
) {
  participant(a, actor);
  return ix(
    a,
    "propose_settlement",
    actionKeys(a, index, actor),
    Buffer.concat([
      integer(expectedNonce, 8),
      allocation(a, index, clientAmount, freelancerAmount),
      Buffer.from([Number(cancelRemaining)]),
    ]),
  );
}
export async function acceptSettlementInstruction(
  a: BoundAgreement,
  index: number,
  actor: PublicKey,
  nonce: bigint,
  clientAmount: bigint,
  freelancerAmount: bigint,
  cancelRemaining = false,
) {
  participant(a, actor);
  return ix(
    a,
    "accept_settlement",
    actionKeys(a, index, actor),
    Buffer.concat([
      integer(nonce, 8),
      allocation(a, index, clientAmount, freelancerAmount),
      Buffer.from([Number(cancelRemaining)]),
    ]),
  );
}
export async function executeSettlementInstruction(
  a: BoundAgreement,
  index: number,
  actor: PublicKey,
  clientRecipient: PublicKey,
  freelancerRecipient: PublicKey,
  nonce: bigint,
) {
  return ix(
    a,
    "execute_settlement",
    settlementKeys(a, index, actor, clientRecipient, freelancerRecipient),
    integer(nonce, 8),
  );
}
export async function resolveDisputeInstruction(
  a: BoundAgreement,
  index: number,
  actor: PublicKey,
  clientRecipient: PublicKey,
  freelancerRecipient: PublicKey,
  clientAmount: bigint,
  freelancerAmount: bigint,
) {
  if (
    ![a.terms.reviewerWallet, a.terms.backupReviewerWallet].includes(
      actor.toBase58(),
    )
  )
    throw new Error("Only an agreed reviewer can resolve a dispute.");
  return ix(
    a,
    "resolve_dispute",
    settlementKeys(a, index, actor, clientRecipient, freelancerRecipient),
    allocation(a, index, clientAmount, freelancerAmount),
  );
}
function bothKeys(a: BoundAgreement) {
  return [
    meta(new PublicKey(a.terms.clientWallet), true),
    meta(new PublicKey(a.terms.freelancerWallet), true),
    meta(addresses(a).project, false, true),
  ];
}
export async function cancelRemainingInstruction(
  a: BoundAgreement,
  account: AccountInfo<Buffer>,
) {
  const state = await verifyProjectAccount(a, account);
  if (
    state.active ||
    state.cancelled ||
    state.next >= a.terms.milestones.length
  )
    throw new Error("No inactive future work to cancel.");
  return ix(
    a,
    "cancel_remaining",
    bothKeys(a),
    Buffer.concat([
      integer(BigInt(a.terms.version), 4),
      bytes(a.commitment, 32),
    ]),
  );
}
export async function reviseProjectInstruction(
  previous: BoundAgreement,
  next: BoundAgreement,
  account: AccountInfo<Buffer>,
) {
  const state = await verifyProjectAccount(previous, account);
  if (
    state.active ||
    state.cancelled ||
    next.terms.version <= previous.terms.version ||
    next.terms.milestones.length <= state.next ||
    ["projectId", "clientWallet", "freelancerWallet", "escrowProgram"].some(
      (k) =>
        previous.terms[k as keyof typeof previous.terms] !==
        next.terms[k as keyof typeof next.terms],
    ) ||
    previous.terms.token.mint !== next.terms.token.mint
  )
    throw new Error("Invalid revision.");
  for (let i = 0; i < state.next; i++) {
    const before = previous.terms.milestones[i],
      after = next.terms.milestones[i];
    if (canonicalJSON(before) !== canonicalJSON(after))
      throw new Error("Settled milestone terms cannot change.");
    if (
      previous.terms.protocol &&
      canonicalJSON(previous.terms.protocol.milestones[i]) !==
        canonicalJSON(next.terms.protocol?.milestones[i])
    )
      throw new Error("Settled PAP policies cannot change.");
  }
  if (!!previous.terms.protocol !== !!next.terms.protocol)
    throw new Error("Escrow profiles cannot change.");
  return ix(
    next,
    next.terms.protocol ? "revise_pap_project" : "revise_project",
    bothKeys(previous),
    Buffer.concat([bytes(previous.commitment, 32), encodeProjectTerms(next)]),
  );
}
