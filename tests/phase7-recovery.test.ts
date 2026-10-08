import { it, expect, vi } from "vitest";
import {
  captureSignedTransaction,
  recoverTransaction,
  validatePending,
} from "../src/lib/escrow/recovery";
import { DEVNET_GENESIS } from "../src/lib/escrow/network";
import { fixture } from "./helpers/phase7-fixture";
async function setup() {
  const f = await fixture();
  f.tx.partialSign(f.keys[1]);
  const saved = captureSignedTransaction(
    f.tx,
    f.a.terms.projectId,
    f.keys[0].publicKey,
    "cancel",
    100,
  );
  return {
    saved,
    rpc: {
      getGenesisHash: vi.fn().mockResolvedValue(DEVNET_GENESIS),
      getSignatureStatuses: vi.fn().mockResolvedValue({ value: [null] }),
      getBlockHeight: vi.fn().mockResolvedValue(90),
      sendRawTransaction: vi.fn().mockResolvedValue(saved.signature),
    },
  };
}
it("refuses another network before broadcasting", async () => {
  const { saved, rpc } = await setup();
  rpc.getGenesisHash.mockResolvedValue("mainnet");
  await expect(recoverTransaction(rpc, saved, true)).rejects.toThrow(/devnet/);
  expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
});
it("retries the exact saved bytes and signature", async () => {
  const { saved, rpc } = await setup();
  expect(await recoverTransaction(rpc, saved, true)).toBe("pending");
  expect(await recoverTransaction(rpc, saved, true)).toBe("pending");
  expect(rpc.sendRawTransaction.mock.calls[0][0]).toEqual(
    rpc.sendRawTransaction.mock.calls[1][0],
  );
});
it("requires reconciliation for expired absent history", async () => {
  const { saved, rpc } = await setup();
  rpc.getBlockHeight.mockResolvedValue(101);
  expect(await recoverTransaction(rpc, saved, true)).toBe(
    "expired_requires_reconciliation",
  );
  expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
});
it("distinguishes confirmed, finalized and failed outcomes", async () => {
  const { saved, rpc } = await setup();
  for (const status of ["confirmed", "finalized"]) {
    rpc.getSignatureStatuses.mockResolvedValue({
      value: [{ confirmationStatus: status, err: null }],
    });
    expect(await recoverTransaction(rpc, saved, true)).toBe(status);
  }
  rpc.getSignatureStatuses.mockResolvedValue({
    value: [{ err: { InstructionError: [0, "fail"] } }],
  });
  expect(await recoverTransaction(rpc, saved, true)).toBe("failed");
  expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
});
it("rejects changed saved signatures", async () => {
  const { saved } = await setup();
  expect(() => validatePending({ ...saved, signature: "changed" })).toThrow(
    /changed/,
  );
});
it("keeps unknown RPC outcomes unresolved", async () => {
  const { saved, rpc } = await setup();
  rpc.getSignatureStatuses.mockRejectedValue(new Error("RPC outage"));
  await expect(recoverTransaction(rpc, saved, true)).rejects.toThrow(/outage/);
  expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
});
