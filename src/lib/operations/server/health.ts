import "server-only";
import { adminSupabase } from "@/lib/supabase/server";
import { operationalEvent } from "../telemetry";
export interface OperationalHealth {
  checkedAt: string;
  status: "ok" | "attention" | "unavailable";
  thresholds: { staleSnapshotSeconds: number; stuckClaimSeconds: number };
  counts: Record<
    | "activeMilestones"
    | "staleActiveSnapshots"
    | "openDisputes"
    | "pendingClaims"
    | "stuckClaims"
    | "failedClaimsLastDay"
    | "papPaymentPendingAgreements",
    number
  > | null;
}
export async function operationalHealth(
  db = adminSupabase(),
  now = Date.now(),
): Promise<OperationalHealth> {
  const report: OperationalHealth = {
    checkedAt: new Date(now).toISOString(),
    status: "unavailable",
    thresholds: { staleSnapshotSeconds: 300, stuckClaimSeconds: 180 },
    counts: null,
  };
  const cutoff = (seconds: number) =>
    new Date(now - seconds * 1000).toISOString();
  const count = (table: string) =>
    db
      .from(table)
      .select("project_id", { head: true, count: "exact" })
      .abortSignal(AbortSignal.timeout(15000));
  try {
    const results = await Promise.all([
      count("milestone_cache").in("state", ["funded", "submitted", "disputed"]),
      count("milestone_cache")
        .in("state", ["funded", "submitted", "disputed"])
        .lt("verified_at", cutoff(300)),
      count("milestone_cache").eq("state", "disputed"),
      count("claim_outbox").in("status", ["pending", "confirmed"]),
      count("claim_outbox")
        .in("status", ["pending", "confirmed"])
        .lt("created_at", cutoff(180)),
      count("claim_outbox")
        .eq("status", "failed")
        .gte("created_at", cutoff(86400)),
      count("agreement_execution").contains("state", {
        milestones: [{ state: "PAYMENT_PENDING" }],
      }),
    ]);
    if (
      results.some(
        (r) => r.error || !Number.isSafeInteger(r.count) || r.count! < 0,
      )
    )
      throw new Error("Metrics unavailable.");
    const keys = [
      "activeMilestones",
      "staleActiveSnapshots",
      "openDisputes",
      "pendingClaims",
      "stuckClaims",
      "failedClaimsLastDay",
      "papPaymentPendingAgreements",
    ] as const;
    report.counts = Object.fromEntries(
      keys.map((key, i) => [key, results[i].count!]),
    ) as NonNullable<OperationalHealth["counts"]>;
    report.status =
      report.counts.staleActiveSnapshots ||
      report.counts.stuckClaims ||
      report.counts.failedClaimsLastDay
        ? "attention"
        : "ok";
  } catch {
    operationalEvent("monitor_unavailable", { status: 503 });
  }
  return report;
}
