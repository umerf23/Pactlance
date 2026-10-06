export type MilestoneStatus =
  | "awaiting_acceptance"
  | "ready"
  | "funded"
  | "submitted"
  | "disputed"
  | "settled"
  | "cancelled";
export interface Milestone {
  id: string;
  sequence: number;
  title: string;
  amountUnits: bigint;
  status: MilestoneStatus;
  deliverables: string;
}
export interface Project {
  id: string;
  title: string;
  client: string;
  freelancer: string;
  milestones: readonly Milestone[];
}
const U64_MAX = (1n << 64n) - 1n;
export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9)
    throw new Error("Unsupported decimal precision");
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value))
    throw new Error("Enter a plain positive decimal amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("Too many decimal places");
  const units =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (units <= 0n || units > U64_MAX)
    throw new Error("Amount outside token range");
  return units;
}
export function formatTokenAmount(units: bigint, decimals = 6): string {
  if (units < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 9)
    throw new Error("Invalid amount");
  const scale = 10n ** BigInt(decimals);
  const fraction = (units % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${units / scale}${fraction ? `.${fraction}` : ""}`;
}
// Presentation helper only. The program must independently enforce sequencing.
export function nextFundableMilestone(
  milestones: readonly Milestone[],
): string | null {
  const ordered = [...milestones].sort((a, b) => a.sequence - b.sequence);
  if (
    ordered.some((m) => ["funded", "submitted", "disputed"].includes(m.status))
  )
    return null;
  const next = ordered.find(
    (m) => !["settled", "cancelled"].includes(m.status),
  );
  return next?.status === "ready" ? next.id : null;
}
