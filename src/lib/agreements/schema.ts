import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { parseTokenAmount } from "../domain";
export const walletAddress = z.string().refine((value) => {
  try {
    const key = new PublicKey(value);
    return key.toBase58() === value && PublicKey.isOnCurve(key.toBytes());
  } catch {
    return false;
  }
}, "Enter a valid Solana wallet address");
const milestone = z
  .object({
    title: z.string().trim().min(3).max(120),
    scope: z.string().trim().min(10).max(4000),
    acceptanceCriteria: z.string().trim().min(10).max(4000),
    amount: z
      .string()
      .max(30)
      .refine((v) => {
        try {
          parseTokenAmount(v, 6);
          return true;
        } catch {
          return false;
        }
      }, "Use a positive amount with at most 6 decimal places"),
    fundingDeadline: z.string().datetime(),
    deliveryDeadline: z.string().datetime(),
  })
  .strict()
  .refine(
    (m) => Date.parse(m.fundingDeadline) < Date.parse(m.deliveryDeadline),
    {
      message: "Funding must close before delivery",
      path: ["fundingDeadline"],
    },
  );
export const agreementInput = z
  .object({
    title: z.string().trim().min(3).max(120),
    scope: z.string().trim().min(10).max(8000),
    clientWallet: walletAddress,
    freelancerWallet: walletAddress,
    reviewerWallet: walletAddress,
    backupReviewerWallet: walletAddress,
    reviewHours: z.number().int().min(1).max(720),
    backupDelayHours: z.number().int().min(1).max(2160),
    milestones: z.array(milestone).min(1).max(20),
  })
  .strict()
  .superRefine((a, ctx) => {
    const keys = [
      a.clientWallet,
      a.freelancerWallet,
      a.reviewerWallet,
      a.backupReviewerWallet,
    ];
    if (new Set(keys).size !== 4)
      ctx.addIssue({
        code: "custom",
        message: "Participants and reviewers must use four distinct wallets",
        path: ["reviewerWallet"],
      });
    for (let i = 1; i < a.milestones.length; i++)
      if (
        Date.parse(a.milestones[i].deliveryDeadline) <=
        Date.parse(a.milestones[i - 1].deliveryDeadline)
      )
        ctx.addIssue({
          code: "custom",
          message: "Delivery dates must follow milestone order",
          path: ["milestones", i, "deliveryDeadline"],
        });
  });
export type AgreementInput = z.infer<typeof agreementInput>;
export type AgreementTerms = Omit<AgreementInput, "milestones"> & {
  schemaVersion: 1;
  projectId: string;
  version: number;
  network: "devnet";
  token: { symbol: "TEST"; decimals: 6; mint: null };
  escrowProgram: null;
  platformFeeUnits: "0";
  networkFeePayer: "transaction_submitter";
  revisionPolicy: "single_submission_no_clock_reset";
  backupPolicy: "exclusive_after_deadline";
  milestones: (Omit<AgreementInput["milestones"][number], "amount"> & {
    id: string;
    sequence: number;
    amountUnits: string;
  })[];
};
export function makeTerms(
  input: AgreementInput,
  projectId: string,
  version: number,
): AgreementTerms {
  return {
    ...input,
    schemaVersion: 1,
    projectId,
    version,
    network: "devnet",
    token: { symbol: "TEST", decimals: 6, mint: null },
    escrowProgram: null,
    platformFeeUnits: "0",
    networkFeePayer: "transaction_submitter",
    revisionPolicy: "single_submission_no_clock_reset",
    backupPolicy: "exclusive_after_deadline",
    milestones: input.milestones.map((m, i) => {
      const { amount, ...rest } = m;
      return {
        ...rest,
        id: `${projectId}:${i + 1}`,
        sequence: i + 1,
        amountUnits: parseTokenAmount(amount, 6).toString(),
      };
    }),
  };
}
export function validateFutureDeadlines(
  input: AgreementInput,
  now = Date.now(),
) {
  if (input.milestones.some((m) => Date.parse(m.fundingDeadline) <= now))
    throw new Error("Every funding deadline must be in the future");
}
export function acceptanceMessage(
  origin: string,
  projectId: string,
  version: number,
  hash: string,
) {
  return [
    `Pactlance agreement acceptance`,
    `Origin: ${origin}`,
    `Network: Solana devnet`,
    `Project: ${projectId}`,
    `Version: ${version}`,
    `SHA-256: ${hash}`,
    `I accept the exact agreement version displayed by Pactlance.`,
    `This is an off-chain test agreement. It does not fund escrow or authorize token transfers.`,
    `The token mint and escrow program must be specified and accepted again before funding.`,
  ].join("\n");
}
export interface AgreementRecord {
  project_id: string;
  version: number;
  terms: AgreementTerms;
  salt: string;
  commitment: string;
  created_at: string;
}
export interface ProjectRecord {
  id: string;
  title: string;
  client_wallet: string;
  freelancer_wallet: string;
  current_version: number;
  created_at: string;
  locked: boolean;
}
export interface AcceptanceRecord {
  wallet: string;
  version: number;
  commitment: string;
  signed_message: string;
  signature: string;
  accepted_at: string;
}
export interface ProjectDetail {
  project: ProjectRecord;
  agreement: AgreementRecord;
  history: AgreementRecord[];
  acceptances: AcceptanceRecord[];
}
