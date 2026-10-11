import type { MilestoneExecution } from "./pap/engine";
export const workStatusLabels: Record<string, string> = {
  PENDING: "Ready to start",
  IN_PROGRESS: "Work in progress",
  UNDER_REVIEW: "Ready for client review",
  CHANGES_REQUESTED: "Changes requested",
  ACCEPTED: "Work accepted",
  PAYMENT_PENDING: "Awaiting payment",
  PAID: "Payment confirmed",
  REFUNDED: "Refund confirmed",
  CANCELLED: "Cancelled",
  DISPUTED: "Needs dispute resolution",
  ACTIVE: "Project in progress",
  COMPLETED: "Work completed",
};
export function workStatus(value: string) {
  return workStatusLabels[value] ?? value.replaceAll("_", " ").toLowerCase();
}
export function deliveryGuidance(
  m: MilestoneExecution | undefined,
  client: boolean,
  active: boolean,
) {
  if (!active)
    return {
      title: "Get the agreement ready",
      body: "Both people review and sign the same terms. Then activate the agreed version to enable the work checklist.",
      step: 0,
    };
  if (m?.state === "PAYMENT_PENDING" && (m.allocation || m.humanReviewRequired))
    return {
      title: "Review the required payment resolution",
      body: "This milestone requires an authorized allocation or human review. Open Resolve a problem in Payments to check the permitted settlement. No payment is confirmed yet.",
      step: 3,
    };
  switch (m?.state) {
    case "PENDING":
      return {
        title: client
          ? "Waiting for the freelancer to start"
          : "Ready to start work",
        body: "Check Payments to confirm funding before work begins. The freelancer can then start this milestone.",
        step: 1,
      };
    case "IN_PROGRESS":
    case "CHANGES_REQUESTED":
      return {
        title: client
          ? "The freelancer is preparing your delivery"
          : m.state === "CHANGES_REQUESTED"
            ? "Update your work and submit it again"
            : "Upload your work for review",
        body: client
          ? "You can read the saved files and notes below. Review begins when the freelancer submits the required deliverables."
          : "Save your files or links below, attach them to each required deliverable, then choose Submit work for review.",
        step: 1,
      };
    case "UNDER_REVIEW":
      return {
        title: client
          ? "Review the freelancer’s work"
          : "Your work is waiting for client review",
        body: client
          ? "Open the delivery files, check the requirements, and accept the work or request an available revision. Accepting work is followed by a separate wallet payment."
          : "The client can accept your work or request a permitted revision. Check the review notes and deadline below.",
        step: 2,
      };
    case "PAYMENT_PENDING":
    case "ACCEPTED":
      return {
        title: "Work accepted — payment still needs confirmation",
        body: "Open Payments below. The freelancer records the validated delivery in escrow, then the client authorizes payment. A completed review does not mean tokens have been sent.",
        step: 3,
      };
    case "PAID":
    case "REFUNDED":
      return m.paymentReference
        ? {
            title:
              m.state === "PAID" ? "Payment confirmed" : "Refund confirmed",
            body: "This milestone has a verified settlement. Check the payment split and transaction history below.",
            step: 4,
          }
        : {
            title: "Check payment confirmation",
            body: "Refresh Payments to verify the finalized transaction before considering this milestone paid or refunded.",
            step: 3,
          };
    case "DISPUTED":
      return {
        title: "This milestone needs a resolution",
        body: "Review the evidence and use Resolve a problem. Payment stays paused until an authorized resolution or a payment split agreed by both people.",
        step: 2,
      };
    case "CANCELLED":
      return {
        title: "This milestone was cancelled",
        body: "Check Payments for any funded amount and confirmed refund. Cancellation alone does not confirm a transfer.",
        step: 0,
      };
    default:
      return {
        title: "Check this milestone",
        body: "Refresh work status to see the next available action.",
        step: 0,
      };
  }
}
export function paymentActionLabel(action: string) {
  return (
    (
      {
        create: "Set up secure payment",
        accept: "Confirm payment terms",
        fund: "Add payment to escrow",
        submit: "Record delivery in escrow",
        approve: "Approve and pay freelancer",
        refund: "Request non-delivery refund",
        claim: "Release payment after review deadline",
        dispute: "Pause payment for a dispute",
        propose: "Propose payment split",
        accept_proposal: "Accept proposed payment split",
        execute: "Send the agreed payment split",
        resolve: "Resolve dispute and send payment",
      } as Record<string, string>
    )[action] ?? action.replaceAll("_", " ")
  );
}
export function validPaymentProposal(m: {
  amount: string;
  clientAmount: string;
  freelancerAmount: string;
  proposalNonce: string;
}) {
  return (
    BigInt(m.proposalNonce) > 0n &&
    BigInt(m.clientAmount) >= 0n &&
    BigInt(m.freelancerAmount) >= 0n &&
    BigInt(m.clientAmount) + BigInt(m.freelancerAmount) === BigInt(m.amount)
  );
}
interface PaymentGuideInput {
  pending: boolean;
  pap: boolean;
  versionMatches: boolean;
  role: "client" | "freelancer" | "reviewer";
  total: number;
  canPublish: boolean;
  canApprove: boolean;
  chainTime: number;
  state:
    | {
        clientAccepted: boolean;
        freelancerAccepted: boolean;
        next: number;
        active: boolean;
        cancelled: boolean;
      }
    | null
    | undefined;
  milestone:
    | { status: number; deliveryDeadline: string; reviewDeadline: string }
    | null
    | undefined;
  workflow: MilestoneExecution | null | undefined;
}
export function paymentGuidance(i: PaymentGuideInput) {
  const s = i.state,
    m = i.milestone,
    client = i.role === "client";
  const step = !s
    ? 0
    : s.next >= i.total
      ? 4
      : !s.clientAccepted || !s.freelancerAccepted
        ? 1
        : !s.active
          ? 2
          : 3;
  const result = (title: string, body: string) => ({
    title,
    body,
    step,
    complete: !!s && !s.cancelled && s.next >= i.total,
  });
  if (i.pending)
    return result(
      "Check your pending transaction",
      "A saved transaction is still being checked. Use Check pending transaction below before signing another transaction.",
    );
  if (i.pap && !i.versionMatches)
    return result(
      "Synchronize the updated agreement",
      "Use Update or cancel future work below to synchronize the jointly signed amendment before new funding.",
    );
  if (!s)
    return result(
      "Set up secure payment for this project",
      "Create the payment accounts using the agreed terms. Both people then confirm payment terms in their own wallets before the client adds funds.",
    );
  if (s.cancelled)
    return result(
      "Future work is cancelled",
      "Check confirmed payment history for earlier milestones. No additional milestone can be funded under these cancelled terms.",
    );
  if (s.next >= i.total)
    return result(
      "All milestones are settled",
      "Check the finalized transaction history and recipient balances. You do not need to send another payment.",
    );
  if (!s.clientAccepted || !s.freelancerAccepted)
    return result(
      (client && s.clientAccepted) ||
        (i.role === "freelancer" && s.freelancerAccepted)
        ? "Waiting for the other person to confirm payment terms"
        : "Confirm your payment terms",
      "This wallet confirmation is separate from signing the agreement document. Both people must confirm payment terms before funding becomes available.",
    );
  if (!s.active)
    return result(
      client
        ? `Add payment for milestone ${s.next + 1}`
        : "Waiting for the client to add payment",
      client
        ? "Check your TEST balance, then add the milestone amount to escrow. It holds payment for the agreed work; it does not pay the freelancer yet."
        : "Wait until this section confirms funding before starting work. The client must add the agreed TEST amount.",
    );
  if (m?.status === 4)
    return result(
      "Payment is paused for a dispute",
      i.role === "reviewer"
        ? "Inspect the evidence and authorized allocation, then use Resolve a problem below."
        : "Normal payment is paused. An eligible reviewer can resolve the dispute, or both people can agree on a payment split under Resolve a problem.",
    );
  if (i.canPublish && i.pap)
    return result(
      "Record your delivery in escrow",
      "Your work is saved in the review workflow. Record its validated delivery in escrow so the client can authorize payment. This does not transfer tokens.",
    );
  if (m?.status === 2 && client && i.canApprove)
    return result(
      "Review the work, then pay the freelancer",
      "Open the submitted work above and check the requirements. Approve and pay sends the funded amount to the agreed freelancer wallet.",
    );
  if (i.pap) {
    if (i.workflow?.state === "UNDER_REVIEW")
      return result(
        client
          ? "Review the submitted work above"
          : "Waiting for client review",
        "The client accepts the work in Work & delivery above. Then the separate wallet payment becomes available here.",
      );
    if (i.workflow?.allocation || i.workflow?.humanReviewRequired)
      return result(
        "Payment needs an authorized resolution",
        "Check Work & delivery and Resolve a problem for the required allocation or human review. Timers never transfer PAP funds.",
      );
    if (m?.status === 2)
      return result(
        "Delivery recorded — waiting for review or payment",
        "The client must explicitly authorize payment once the work is accepted. Check Work & delivery above.",
      );
    return result(
      client
        ? "Waiting for the freelancer’s delivery"
        : "Payment is funded — prepare your delivery",
      "Save and submit the required work in Work & delivery above. The freelancer then records its validated delivery here.",
    );
  }
  if (m?.status === 1)
    return result(
      client
        ? "Waiting for the freelancer’s delivery"
        : "Prepare and submit your delivery",
      client
        ? "Wait for recorded delivery, then review the saved work. If the delivery deadline passes without a submission, check Resolve a problem for an eligible refund."
        : "Save a delivery file or link, load saved attachments here, and record delivery before the deadline.",
    );
  if (m?.status === 2 && i.chainTime >= Number(m.reviewDeadline))
    return result(
      "The review deadline has passed",
      "Use the available deadline action under Resolve a problem to release payment to the fixed freelancer wallet if no dispute is open.",
    );
  return result(
    "Waiting for client review",
    "Review the submitted evidence. The client can approve payment or open an eligible dispute before the review deadline.",
  );
}
