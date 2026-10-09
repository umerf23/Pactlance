import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { terms, project, wallets } from "./pap-fixture";
import { bindAgreement, type BoundAgreement } from "../src/lib/escrow/terms";
import { agreementCommitment } from "../src/lib/agreements/crypto";
import { addresses } from "../src/lib/escrow/client";
import type { Execution } from "../src/lib/pap/engine";
vi.mock("server-only", () => ({}));
import { paymentSnapshot } from "../src/lib/pap/payments";
let state: Execution, a: BoundAgreement;
const signature = "3".repeat(88),
  rpc = vi.fn(),
  transaction = vi.fn();
function context(status = 3, paid = "100123456") {
  const db = {
    rpc,
    from: (table: string) => {
      const result = () => ({
        data:
          table === "agreement_execution"
            ? { state, revision: 2 }
            : table === "agreements"
              ? { terms: terms() }
              : table === "transaction_events"
                ? [{ signature, slot: 10 }]
                : [],
        error: null,
      });
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        single: async () => result(),
        maybeSingle: async () => result(),
        then: (resolve: (v: unknown) => void) =>
          Promise.resolve(result()).then(resolve),
      };
      return q;
    },
  };
  return {
    admin: db,
    connection: { getTransaction: transaction },
    snapshot: {
      agreement: a,
      milestones: [
        { index: 0, status, clientRefunded: 0n, freelancerPaid: BigInt(paid) },
      ],
      state: { cancelled: false },
      slot: 11,
    },
  } as unknown as Parameters<typeof paymentSnapshot>[2];
}
beforeEach(async () => {
  vi.clearAllMocks();
  state = {
    version: 1,
    status: "COMPLETED",
    activatedAt: "2026-10-09T10:00:00Z",
    milestones: [
      {
        state: "PAYMENT_PENDING",
        revisions: 0,
        acceptedAt: "2026-10-09T11:00:00Z",
      },
    ],
  };
  const t = terms(),
    salt = "ab".repeat(32);
  a = await bindAgreement(
    {
      project_id: project,
      version: 1,
      terms: t,
      salt,
      commitment: await agreementCommitment(t, salt),
      created_at: state.activatedAt,
    },
    "9T95KC5YSQ7LV2KwUcY7SyBu6cYF6Urv8fXd7kYaWNpL",
    wallets[4],
    true,
  );
  const event = Buffer.alloc(59);
  createHash("sha256")
    .update("event:MilestoneSettled")
    .digest()
    .subarray(0, 8)
    .copy(event);
  addresses(a).project.toBuffer().copy(event, 8);
  event.writeBigUInt64LE(100123456n, 50);
  transaction.mockResolvedValue({
    slot: 10,
    blockTime: 1791547200,
    meta: {
      err: null,
      logMessages: [
        `Program ${a.terms.escrowProgram} invoke [1]`,
        `Program data: ${event.toString("base64")}`,
        `Program ${a.terms.escrowProgram} success`,
      ],
    },
  });
  rpc.mockImplementation(async (_name, params) => ({
    data: { state: params.p_state, revision: 3 },
    error: null,
  }));
});
it("requires both a settled finalized account and its successful program event before recording payment", async () => {
  const result = await paymentSnapshot(project, wallets[0], context());
  expect(transaction).toHaveBeenCalledWith(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  expect(rpc).toHaveBeenCalledWith(
    "commit_pap_transition",
    expect.objectContaining({
      p_action: "confirm_payment",
      p_actor: wallets[0],
      p_expected_revision: 2,
      p_state: expect.objectContaining({
        milestones: [
          expect.objectContaining({
            state: "PAID",
            paymentReference: expect.objectContaining({
              signature,
              slot: 10,
              network: "devnet",
            }),
          }),
        ],
      }),
    }),
  );
  expect(result.milestones[0].state).toBe("PAID");
});
it("does not record requested or unverified, failed or mismatched settlements", async () => {
  await paymentSnapshot(project, wallets[0], context(2));
  expect(rpc).not.toHaveBeenCalled();
  transaction.mockResolvedValue(null);
  await expect(paymentSnapshot(project, wallets[0], context())).rejects.toThrow(
    "verifiable transaction history",
  );
  expect(rpc).not.toHaveBeenCalled();
  transaction.mockResolvedValue({
    slot: 10,
    blockTime: 1791547200,
    meta: { err: { InstructionError: [0, "Custom"] }, logMessages: [] },
  });
  await expect(paymentSnapshot(project, wallets[0], context())).rejects.toThrow(
    "verifiable transaction history",
  );
  expect(rpc).not.toHaveBeenCalled();
});
it("does not manufacture a second payment record or let reviewer reads write execution", async () => {
  state.milestones[0].paymentReference = {
    signature,
    slot: 10,
    confirmedAt: "2026-10-09T12:00:00Z",
    network: "devnet",
    clientUnits: "0",
    freelancerUnits: "100123456",
  };
  state.milestones[0].state = "PAID";
  await paymentSnapshot(project, wallets[0], context());
  expect(rpc).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
  delete state.milestones[0].paymentReference;
  await paymentSnapshot(project, wallets[2], context());
  expect(rpc).not.toHaveBeenCalled();
});
it("leaves execution unchanged when another transition wins the database race", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
  await expect(paymentSnapshot(project, wallets[0], context())).rejects.toThrow(
    "Execution changed",
  );
  expect(state.milestones[0].state).toBe("PAYMENT_PENDING");
});
