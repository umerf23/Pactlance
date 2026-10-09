import type { BoundAgreement } from "../escrow/terms";
import type { MilestoneExecution } from "./engine";
export interface PapPaymentState {
  version: number;
  status: string;
  milestones: (MilestoneExecution | null)[];
  deliveryCommitments: Record<number, string>;
  disputeCommitments: Record<number, string>;
}
export function papPaymentAllowed(
  action: string,
  pap: PapPaymentState | undefined,
  agreement: BoundAgreement,
  index: number,
  chain:
    | { status: number; submissionCommitment: string; amount: string }
    | null
    | undefined,
  actor: string,
  refund = "0",
  cancelFuture = false,
) {
  if (!agreement.terms.protocol) return true;
  if (!pap || pap.version !== agreement.terms.version) return false;
  const client = actor === agreement.terms.clientWallet,
    freelancer = actor === agreement.terms.freelancerWallet,
    participant = client || freelancer;
  const milestone = pap.milestones[index];
  if (action === "create" || action === "accept")
    return participant && pap.status !== "CANCELLED";
  if (action === "fund")
    return (
      client &&
      ["ACTIVE", "COMPLETED"].includes(pap.status) &&
      !!milestone &&
      milestone.state !== "CANCELLED"
    );
  if (action === "claim" || action === "refund") return false;
  if (!milestone || !chain || chain.status === 3) return false;
  if (action === "submit")
    return (
      freelancer &&
      [1, 2].includes(chain.status) &&
      ["UNDER_REVIEW", "PAYMENT_PENDING"].includes(milestone.state) &&
      !!pap.deliveryCommitments[index] &&
      chain.submissionCommitment !== pap.deliveryCommitments[index]
    );
  if (action === "approve")
    return (
      client &&
      chain.status === 2 &&
      milestone.state === "PAYMENT_PENDING" &&
      !milestone.humanReviewRequired &&
      !milestone.allocation &&
      !!pap.deliveryCommitments[index] &&
      chain.submissionCommitment === pap.deliveryCommitments[index]
    );
  if (action === "dispute")
    return (
      participant &&
      [1, 2].includes(chain.status) &&
      !!milestone.disputedAt &&
      (milestone.state === "DISPUTED" || !!milestone.allocation) &&
      !!pap.disputeCommitments[index]
    );
  if (action === "resolve")
    return (
      [
        agreement.terms.reviewerWallet,
        agreement.terms.backupReviewerWallet,
      ].includes(actor) &&
      chain.status === 4 &&
      milestone.state === "PAYMENT_PENDING" &&
      !!milestone.allocation &&
      refund === milestone.allocation.clientUnits
    );
  if (["propose", "accept_proposal", "execute"].includes(action))
    return (
      participant &&
      (!cancelFuture ||
        agreement.terms.protocol.cancellation === "mutual" ||
        pap.milestones.every(
          (m) => m?.state === "PENDING" || m?.state === "CANCELLED",
        ))
    );
  return false;
}
