import { Keypair } from "@solana/web3.js";
import { agreementInput, makeTerms } from "../src/lib/agreements/schema";
import { templateProtocol } from "../src/lib/pap/templates";
export const project = "10000000-0000-4000-8000-000000000001";
export const wallets = [1, 2, 3, 4, 5].map((n) =>
  Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey.toBase58(),
);
export const input = {
  title: "Content project",
  scope: "Write the agreed technical guide",
  clientWallet: wallets[0],
  freelancerWallet: wallets[1],
  reviewerWallet: wallets[2],
  backupReviewerWallet: wallets[3],
  reviewHours: 72,
  backupDelayHours: 24,
  milestones: [
    {
      title: "Technical guide",
      scope: "Write the agreed technical guide",
      acceptanceCriteria: "The guide passes all agreed checks",
      amount: "100.123456",
      fundingDeadline: "2030-01-01T00:00:00.000Z",
      deliveryDeadline: "2030-02-01T00:00:00.000Z",
    },
  ],
  protocol: templateProtocol("writing"),
};
export const terms = () =>
  makeTerms(agreementInput.parse(structuredClone(input)), project, 1);
