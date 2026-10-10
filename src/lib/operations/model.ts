import bs58 from "bs58";
import { sha256 } from "../evidence/schema";
export interface MilestoneCache {
  payment_profile?: "legacy" | "pap_explicit_v1" | "unknown";
  project_id: string;
  agreement_version: number;
  milestone_index: number;
  chain_address: string;
  state: "funded" | "submitted" | "disputed" | "settled";
  amount_units: string;
  client_refunded: string;
  freelancer_paid: string;
  delivery_deadline: string;
  review_deadline: string | null;
  backup_at: string | null;
  reviewer_wallet: string;
  backup_reviewer_wallet: string;
  verified_at: string;
  finalized_slot: number;
}
export interface TransactionEvent {
  amount_units?: string | null;
  client_recipient?: string | null;
  freelancer_recipient?: string | null;
  network?: "devnet";
  client_amount_units?: string | null;
  freelancer_amount_units?: string | null;
  project_id: string;
  signature: string;
  milestone_index: number | null;
  event_kind: string;
  status: "pending" | "confirmed" | "finalized" | "failed";
  slot: number | null;
  created_at: string;
}
export interface Notice {
  key: string;
  projectId: string;
  index: number;
  message: string;
  stale: boolean;
}
export function freshCache(m: MilestoneCache, now = Date.now()) {
  const t = Date.parse(m.verified_at);
  return Number.isFinite(t) && t <= now && now - t <= 120000;
}
export function reviewerEligible(
  m: MilestoneCache,
  wallet: string,
  now = Date.now(),
) {
  return (
    m.state === "disputed" &&
    freshCache(m, now) &&
    !!m.backup_at &&
    Number.isFinite(Date.parse(m.backup_at)) &&
    wallet ===
      (now < Date.parse(m.backup_at)
        ? m.reviewer_wallet
        : m.backup_reviewer_wallet)
  );
}
export function explorerURL(signature: string) {
  try {
    if (bs58.decode(signature).length !== 64) return null;
  } catch {
    return null;
  }
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}
export async function reminders(
  milestones: MilestoneCache[],
  wallet: string,
  now = Date.now(),
): Promise<Notice[]> {
  const result: Notice[] = [];
  for (const m of milestones) {
    if (m.state === "settled") continue;
    const stale = !freshCache(m, now);
    let message = "";
    let boundary = "";
    if (stale) message = "Refresh chain status before deciding what to do.";
    else if (!m.payment_profile || m.payment_profile === "unknown") {
      message =
        "Payment profile is unverified. Refresh chain status before acting.";
    } else if (m.payment_profile === "pap_explicit_v1") {
      boundary = m.state;
      message =
        m.state === "funded"
          ? "This PAP milestone is funded. Deadline rules may propose a refund or human review; an authorized wallet must execute any allocation."
          : m.state === "submitted"
            ? "Delivery is awaiting explicit review. A timer cannot execute PAP payment; acceptance and wallet authorization are required."
            : "A dispute is open. Ordinary payout and refund are paused pending authorized resolution.";
    } else if (m.state === "funded") {
      const late = now >= Date.parse(m.delivery_deadline);
      boundary = late ? "expired" : "delivery";
      message = late
        ? "Delivery deadline reached. A non-delivery refund may be eligible."
        : "This milestone is funded. Delivery is due before the recorded deadline.";
    } else if (m.state === "submitted") {
      const late = !!m.review_deadline && now >= Date.parse(m.review_deadline);
      boundary = late ? "claim" : "review";
      message = late
        ? "Review period ended. A payment claim may be eligible if no dispute is open."
        : "Delivery is awaiting review. Disputes must be recorded before review expiry.";
    } else {
      boundary = now < Date.parse(m.backup_at ?? "") ? "primary" : "backup";
      message = reviewerEligible(m, wallet, now)
        ? "You are the eligible reviewer for this dispute."
        : "A dispute is open. Ordinary payout and refund are paused.";
    }
    const key = await sha256(
      new TextEncoder().encode(
        `${wallet}:${m.project_id}:${m.agreement_version}:${m.milestone_index}:${m.state}:${m.payment_profile ?? "unknown"}:${boundary}:${stale}`,
      ),
    );
    result.push({
      key,
      projectId: m.project_id,
      index: m.milestone_index,
      message,
      stale,
    });
  }
  return result;
}
