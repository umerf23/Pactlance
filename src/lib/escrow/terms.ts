import { PublicKey } from "@solana/web3.js";
import type { AgreementRecord, AgreementTerms } from "../agreements/schema";
import { agreementCommitment } from "../agreements/crypto";
export type EscrowTerms = Omit<
  AgreementTerms,
  "schemaVersion" | "token" | "escrowProgram"
> & {
  schemaVersion: 2 | 3;
  paymentProfile?: "pap_explicit_v1";
  token: { symbol: "TEST"; decimals: 6; mint: string };
  escrowProgram: string;
};
export interface BoundAgreement {
  terms: EscrowTerms;
  salt: string;
  commitment: string;
}
export function deploymentKey(value: string) {
  const key = new PublicKey(value);
  if (
    key.toBase58() !== value ||
    key.equals(PublicKey.default) ||
    value === "Fg6PaFpoGXkYsidMpWxTWqkZq7FEfcYkgMQhgqJM6dS9"
  )
    throw new Error("A real deployment address is required.");
  return key;
}
export async function bindAgreement(
  record: AgreementRecord,
  program: string,
  mint: string,
  papEnabled = false,
): Promise<BoundAgreement> {
  if (record.terms.protocol && !papEnabled)
    throw new Error(
      "PAP workflow policies require a compatible escrow adapter; this contract cannot execute them.",
    );
  deploymentKey(program);
  deploymentKey(mint);
  if (
    (await agreementCommitment(record.terms, record.salt)) !== record.commitment
  )
    throw new Error("Original agreement commitment does not match.");
  const terms: EscrowTerms = {
    ...structuredClone(record.terms),
    schemaVersion: record.terms.protocol ? 3 : 2,
    ...(record.terms.protocol
      ? { paymentProfile: "pap_explicit_v1" as const }
      : {}),
    escrowProgram: program,
    token: { symbol: "TEST", decimals: 6, mint },
  };
  return {
    terms,
    salt: record.salt,
    commitment: await agreementCommitment(terms, record.salt),
  };
}
