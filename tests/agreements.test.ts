import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  agreementInput,
  makeTerms,
  acceptanceMessage,
  validateFutureDeadlines,
} from "../src/lib/agreements/schema";
import {
  canonicalJSON,
  agreementCommitment,
} from "../src/lib/agreements/crypto";
import { verifyWalletSignature } from "../src/lib/agreements/signatures";
import { verifiedSolanaWallet } from "../src/lib/identity";
const keys = [1, 2, 3, 4].map((n) =>
  nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(n)),
);
export const wallets = keys.map((k) => bs58.encode(k.publicKey));
export const input = {
  title: "Website project",
  scope: "Build the agreed website",
  clientWallet: wallets[0],
  freelancerWallet: wallets[1],
  reviewerWallet: wallets[2],
  backupReviewerWallet: wallets[3],
  reviewHours: 72,
  backupDelayHours: 168,
  milestones: [1, 2].map((i) => ({
    title: `Milestone ${i}`,
    scope: "Deliver the agreed scope",
    acceptanceCriteria: "All specified checks pass",
    amount: "100.123456",
    fundingDeadline: `2030-01-0${i}T12:00:00.000Z`,
    deliveryDeadline: `2030-02-0${i}T12:00:00.000Z`,
  })),
};
describe("agreement integrity", () => {
  it("keeps every ordered milestone and exact token units", () => {
    const terms = makeTerms(agreementInput.parse(input), "project", 1);
    expect(terms.milestones).toHaveLength(2);
    expect(terms.milestones[1].amountUnits).toBe("100123456");
    expect(terms.milestones[1].sequence).toBe(2);
  });
  it("canonicalizes keys and changes hash for modified terms or salt", async () => {
    expect(canonicalJSON({ b: 1, a: 2 })).toBe(canonicalJSON({ a: 2, b: 1 }));
    const hash = await agreementCommitment(input, "a");
    expect(
      await agreementCommitment({ ...input, title: "Changed title" }, "a"),
    ).not.toBe(hash);
    expect(await agreementCommitment(input, "b")).not.toBe(hash);
  });
  it("rejects invalid precision, wallets, deadlines, order and injected terms", () => {
    for (const change of [
      { clientWallet: wallets[1] },
      { reviewerWallet: "bad" },
      { platformFeeUnits: "999" },
      { milestones: [{ ...input.milestones[0], amount: "1.0000001" }] },
      { milestones: [{ ...input.milestones[0], amount: "0" }] },
      {
        milestones: [
          {
            ...input.milestones[0],
            deliveryDeadline: input.milestones[0].fundingDeadline,
          },
        ],
      },
      { milestones: [...input.milestones].reverse() },
    ])
      expect(agreementInput.safeParse({ ...input, ...change }).success).toBe(
        false,
      );
    expect(() =>
      validateFutureDeadlines(input, Date.parse("2031-01-01")),
    ).toThrow();
  });
  it("binds signature to signer, origin, project, version and commitment", () => {
    const message = acceptanceMessage(
      "https://pactlance.test",
      "p1",
      1,
      "a".repeat(64),
    );
    const signature = bs58.encode(
      nacl.sign.detached(new TextEncoder().encode(message), keys[0].secretKey),
    );
    expect(verifyWalletSignature(wallets[0], message, signature)).toBe(true);
    expect(verifyWalletSignature(wallets[1], message, signature)).toBe(false);
    for (const changed of [
      message.replace("pactlance.test", "evil.test"),
      message.replace("p1", "p2"),
      message.replace("Version: 1", "Version: 2"),
      message.replace("a".repeat(64), "b".repeat(64)),
    ])
      expect(verifyWalletSignature(wallets[0], changed, signature)).toBe(false);
    expect(verifyWalletSignature(wallets[0], message, "garbage")).toBe(false);
  });
  it("trusts only a unique verified provider identity", () => {
    expect(
      verifiedSolanaWallet([
        { provider: "web3", id: `web3:solana:${wallets[0]}` },
      ]),
    ).toBe(wallets[0]);
    expect(verifiedSolanaWallet([{ provider: "email", id: wallets[0] }])).toBe(
      null,
    );
    expect(
      verifiedSolanaWallet(
        wallets.map((w) => ({ provider: "web3", id: `web3:solana:${w}` })),
      ),
    ).toBe(null);
    expect(verifiedSolanaWallet(undefined)).toBe(null);
  });
});
