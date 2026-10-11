import { describe, expect, it } from "vitest";
import {
  deliveryGuidance,
  paymentGuidance,
  validPaymentProposal,
} from "../src/lib/workspace-guide";
import type { MilestoneExecution } from "../src/lib/pap/engine";
const milestone = (
  state: MilestoneExecution["state"],
  extra: Partial<MilestoneExecution> = {},
): MilestoneExecution => ({ state, revisions: 0, ...extra });
describe("guidance preserves the work/payment boundary", () => {
  it("routes accepted work to a separate payment without claiming it was paid", () => {
    const g = deliveryGuidance(milestone("PAYMENT_PENDING"), true, true);
    expect(g.step).toBe(3);
    expect(g.title).toContain("payment still needs confirmation");
    expect(g.body).toContain("does not mean tokens have been sent");
  });
  it("routes allocated and human-review payments to resolution", () => {
    for (const extra of [
      { allocation: { clientUnits: "50", freelancerUnits: "50" } },
      { humanReviewRequired: true },
    ]) {
      const g = deliveryGuidance(
        milestone("PAYMENT_PENDING", extra),
        true,
        true,
      );
      expect(g.body).toContain("Resolve a problem");
      expect(g.body).toContain("No payment is confirmed");
    }
  });
  it("does not report a payment/refund complete without a verified reference", () => {
    for (const state of ["PAID", "REFUNDED"] as const)
      expect(deliveryGuidance(milestone(state), true, true).title).toBe(
        "Check payment confirmation",
      );
  });
  it("reports a verified settlement", () => {
    const m = milestone("PAID", {
      paymentReference: {
        signature: "test-signature",
        slot: 1,
        confirmedAt: "2026-10-11T00:00:00Z",
        network: "devnet",
        clientUnits: "0",
        freelancerUnits: "100",
      },
    });
    expect(deliveryGuidance(m, false, true)).toMatchObject({
      title: "Payment confirmed",
      step: 4,
    });
  });
  it("gives each role the appropriate review instruction", () => {
    expect(deliveryGuidance(milestone("UNDER_REVIEW"), true, true).title).toBe(
      "Review the freelancer’s work",
    );
    expect(
      deliveryGuidance(milestone("UNDER_REVIEW"), false, true).title,
    ).toContain("waiting for client review");
  });
  it("does not confuse cancellation with a refund", () => {
    expect(deliveryGuidance(milestone("CANCELLED"), true, true).body).toContain(
      "does not confirm a transfer",
    );
  });
});
describe("payment guidance follows actual chain and role state", () => {
  const base = {
    pending: false,
    pap: true,
    versionMatches: true,
    role: "client" as const,
    total: 1,
    canPublish: false,
    canApprove: false,
    chainTime: 100,
    state: {
      clientAccepted: true,
      freelancerAccepted: true,
      next: 0,
      active: true,
      cancelled: false,
    },
    milestone: { status: 2, deliveryDeadline: "200", reviewDeadline: "0" },
    workflow: milestone("UNDER_REVIEW"),
  };
  it("does not ask the client to republish finalized delivery", () => {
    expect(paymentGuidance(base).title).toBe("Review the submitted work above");
    expect(
      paymentGuidance({
        ...base,
        workflow: milestone("PAYMENT_PENDING"),
        canApprove: true,
      }).title,
    ).toBe("Review the work, then pay the freelancer");
  });
  it("directs the freelancer to record a validated unpublished delivery", () => {
    expect(
      paymentGuidance({ ...base, role: "freelancer", canPublish: true }).title,
    ).toBe("Record your delivery in escrow");
  });
  it("prioritizes pending recovery and version mismatch before ordinary actions", () => {
    expect(
      paymentGuidance({ ...base, pending: true, canApprove: true }).title,
    ).toBe("Check your pending transaction");
    expect(
      paymentGuidance({ ...base, versionMatches: false, canApprove: true })
        .title,
    ).toBe("Synchronize the updated agreement");
  });
  it("shows settled and cancelled outcomes without another funding instruction", () => {
    expect(
      paymentGuidance({
        ...base,
        state: { ...base.state, next: 1, active: false },
      }),
    ).toMatchObject({ title: "All milestones are settled", complete: true });
    expect(
      paymentGuidance({
        ...base,
        state: { ...base.state, cancelled: true, active: false },
      }),
    ).toMatchObject({ title: "Future work is cancelled", complete: false });
  });
});
describe("recorded payment splits", () => {
  const base = {
    amount: "250000000",
    clientAmount: "0",
    freelancerAmount: "0",
    proposalNonce: "1",
  };
  it("does not treat the delivery nonce with zero/zero allocation as a valid proposal", () => {
    expect(validPaymentProposal(base)).toBe(false);
  });
  it("retains full payment, full refund, and partial splits", () => {
    for (const clientAmount of ["0", "50000000", "250000000"])
      expect(
        validPaymentProposal({
          ...base,
          clientAmount,
          freelancerAmount: (250000000n - BigInt(clientAmount)).toString(),
        }),
      ).toBe(true);
  });
  it("rejects missing or nonconserving proposals", () => {
    expect(
      validPaymentProposal({
        ...base,
        clientAmount: "-1",
        freelancerAmount: "250000001",
      }),
    ).toBe(false);
    expect(
      validPaymentProposal({ ...base, freelancerAmount: "250000001" }),
    ).toBe(false);
    expect(
      validPaymentProposal({
        ...base,
        freelancerAmount: "250000000",
        proposalNonce: "0",
      }),
    ).toBe(false);
  });
});
