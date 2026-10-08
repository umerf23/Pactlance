import { it, expect } from "vitest";
import { SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import { verifyJointEnvelope } from "../src/lib/escrow/joint";
import {
  captureSignedTransaction,
  validatePending,
} from "../src/lib/escrow/recovery";
import { fixture } from "./helpers/phase7-fixture";
it("preserves both signatures and supports a participant different from the fee payer", async () => {
  const f = await fixture(),
    tx = await verifyJointEnvelope(
      f.envelope,
      f.a,
      null,
      f.account,
      f.connection,
    );
  tx.partialSign(f.keys[1]);
  const p = captureSignedTransaction(
    tx,
    f.a.terms.projectId,
    f.keys[1].publicKey,
    "cancel",
    100,
  );
  expect(p.feePayer).toBe(f.keys[0].publicKey.toBase58());
  expect(validatePending(p).wallet).toBe(f.keys[1].publicKey.toBase58());
});
it("rejects extra transfers even when the first signature is valid", async () => {
  const f = await fixture();
  f.tx.add(
    SystemProgram.transfer({
      fromPubkey: f.keys[0].publicKey,
      toPubkey: f.keys[2].publicKey,
      lamports: 1,
    }),
  );
  f.tx.partialSign(f.keys[0]);
  await expect(
    verifyJointEnvelope(
      {
        ...f.envelope,
        raw: bs58.encode(
          f.tx.serialize({
            requireAllSignatures: false,
            verifySignatures: true,
          }),
        ),
      },
      f.a,
      null,
      f.account,
      f.connection,
    ),
  ).rejects.toThrow(/differs/);
});
it("rejects expired partial packages", async () => {
  const f = await fixture();
  f.connection.getBlockHeight.mockResolvedValue(101);
  await expect(
    verifyJointEnvelope(f.envelope, f.a, null, f.account, f.connection),
  ).rejects.toThrow(/expired/);
});
it("rejects inflated expiry metadata", async () => {
  const f = await fixture();
  await expect(
    verifyJointEnvelope(
      { ...f.envelope, lastValidBlockHeight: 999999 },
      f.a,
      null,
      f.account,
      f.connection,
    ),
  ).rejects.toThrow(/expiry/);
});
