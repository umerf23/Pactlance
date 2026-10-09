import { it, expect } from "vitest";
import { terms, wallets, project } from "./pap-fixture";
import { agreementCommitment } from "../src/lib/agreements/crypto";
import { bindAgreement } from "../src/lib/escrow/terms";
import {
  encodeProjectTerms,
  approveInstruction,
  claimAfterReviewInstruction,
  refundNonDeliveryInstruction,
  discriminator,
} from "../src/lib/escrow/client";
import { PublicKey } from "@solana/web3.js";
import { reconcilePayment, type Execution } from "../src/lib/pap/engine";
import { papCommand } from "../src/lib/pap/schema";
import { papPaymentAllowed } from "../src/lib/pap/payment-actions";
const program = "9T95KC5YSQ7LV2KwUcY7SyBu6cYF6Urv8fXd7kYaWNpL";
const proof = {
  signature: "3".repeat(88),
  slot: 10,
  confirmedAt: "2026-10-09T12:00:00Z",
  network: "devnet" as const,
  clientUnits: "0",
  freelancerUnits: "100123456",
};
const state = (): Execution => ({
  version: 1,
  status: "COMPLETED",
  activatedAt: "2026-10-09T11:00:00Z",
  milestones: [
    {
      state: "PAYMENT_PENDING",
      revisions: 0,
      acceptedAt: "2026-10-09T11:59:00Z",
    },
  ],
});
async function binding() {
  const t = terms(),
    salt = "ab".repeat(32),
    record = {
      project_id: project,
      version: 1,
      terms: t,
      salt,
      commitment: await agreementCommitment(t, salt),
      created_at: proof.confirmedAt,
    };
  return { record, a: await bindAgreement(record, program, wallets[4], true) };
}
it("keeps PAP opt-in, uses a separate canonical payment profile and encodes no timer release", async () => {
  const { record, a } = await binding();
  await expect(bindAgreement(record, program, wallets[4])).rejects.toThrow(
    "compatible escrow",
  );
  expect(a.terms.schemaVersion).toBe(3);
  expect(a.terms.paymentProfile).toBe("pap_explicit_v1");
  expect(a.commitment).not.toBe(record.commitment);
  expect(encodeProjectTerms(a).readBigInt64LE(212)).toBe(0n);
  const recipient = new PublicKey(wallets[1]);
  await expect(approveInstruction(a, 0, recipient)).rejects.toThrow(
    "delivery commitment",
  );
  const ix = await approveInstruction(a, 0, recipient, "ab".repeat(32));
  expect(ix.data.subarray(0, 8)).toEqual(
    await discriminator("global", "approve_pap_milestone"),
  );
  await expect(
    claimAfterReviewInstruction(a, 0, recipient, recipient, recipient),
  ).rejects.toThrow("timer payouts");
  await expect(
    refundNonDeliveryInstruction(a, 0, recipient, recipient),
  ).rejects.toThrow("mutual settlement");
});
it("cannot mark payments paid through a public workflow command", () => {
  expect(
    papCommand.safeParse({
      projectId: project,
      version: 1,
      expectedRevision: 1,
      idempotencyKey: project,
      action: "confirm_payment",
      reason: "Pretend the payment completed",
    }).success,
  ).toBe(false);
});
it("reconciles exact finalized allocations without mutating prior history", () => {
  const before = state(),
    next = reconcilePayment(terms(), before, 0, proof, false);
  expect(next.state.milestones[0].state).toBe("PAID");
  expect(next.state.milestones[0].paymentReference).toEqual(proof);
  expect(before.milestones[0].state).toBe("PAYMENT_PENDING");
  expect(() => reconcilePayment(terms(), next.state, 0, proof, false)).toThrow(
    "already reconciled",
  );
  for (const changed of [
    { ...proof, clientUnits: "1" },
    { ...proof, slot: 0 },
    { ...proof, signature: "requested" },
    { ...proof, network: "mainnet" as "devnet" },
  ])
    expect(() =>
      reconcilePayment(terms(), before, 0, changed, false),
    ).toThrow();
  const refund = reconcilePayment(
    terms(),
    before,
    0,
    { ...proof, clientUnits: proof.freelancerUnits, freelancerUnits: "0" },
    true,
  );
  expect(refund.state.milestones[0].state).toBe("REFUNDED");
  expect(refund.state.status).toBe("CANCELLED");
});
it("blocks unreviewed, disputed, stale and mismatched PAP payment actions", async () => {
  const { a } = await binding(),
    hash = "ab".repeat(32),
    chain = { status: 2, submissionCommitment: hash, amount: "100123456" };
  const pap = {
    version: 1,
    status: "ACTIVE",
    milestones: state().milestones,
    deliveryCommitments: { 0: hash },
    disputeCommitments: {},
  };
  expect(papPaymentAllowed("approve", pap, a, 0, chain, wallets[0])).toBe(true);
  expect(papPaymentAllowed("approve", pap, a, 0, chain, wallets[1])).toBe(
    false,
  );
  expect(
    papPaymentAllowed(
      "approve",
      { ...pap, version: 2 },
      a,
      0,
      chain,
      wallets[0],
    ),
  ).toBe(false);
  expect(
    papPaymentAllowed(
      "approve",
      pap,
      a,
      0,
      { ...chain, submissionCommitment: "cd".repeat(32) },
      wallets[0],
    ),
  ).toBe(false);
  pap.milestones[0].state = "DISPUTED";
  expect(papPaymentAllowed("approve", pap, a, 0, chain, wallets[0])).toBe(
    false,
  );
  expect(papPaymentAllowed("claim", pap, a, 0, chain, wallets[1])).toBe(false);
});
