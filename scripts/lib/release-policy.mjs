import { z } from "zod";
import bs58 from "bs58";
export const gateIds = Array.from({ length: 11 }, (_, i) => `G${i + 1}`);
const digest = z.string().regex(/^[a-f0-9]{64}$/),
  sha = z.string().regex(/^[a-f0-9]{40}$/),
  owner = z.string().trim().min(1).max(120);
export const publicOrigin = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return (
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === "/" &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(u.hostname)))
    );
  }, "Use a plain HTTPS origin (HTTP only on localhost).");
const gate = z
  .object({
    status: z.enum(["NOT_RUN", "BLOCKED", "FAIL", "PASS"]),
    observedAt: z.string().datetime().nullable(),
    reviewer: owner.nullable(),
    evidence: z
      .array(
        z
          .object({
            path: z
              .string()
              .regex(/^validation-results\/[a-zA-Z0-9_./-]+\.json$/)
              .refine((v) => !v.split("/").includes("..")),
            sha256: digest,
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export const releaseRecord = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("release-record"),
    source: z
      .object({
        commit: sha,
        tree: sha,
        clean: z.boolean(),
        node: z.string(),
        lockfileSha256: digest,
      })
      .strict(),
    createdAt: z.string().datetime(),
    target: z.enum(["pap-preview", "devnet-pilot", "mainnet"]),
    appURL: publicOrigin,
    network: z.literal("devnet"),
    program: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    mint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    owners: z
      .object({
        deployment: owner.nullable(),
        incident: owner.nullable(),
        upgrades: owner.nullable(),
        reviewers: owner.nullable(),
      })
      .strict(),
    gates: z
      .object(Object.fromEntries(gateIds.map((id) => [id, gate])))
      .strict(),
  })
  .strict();
export const requiredObservations = {
  G3: [
    "migration_history",
    "rls_grants",
    "participant_access",
    "reviewer_handoff",
    "outsider_denied",
    "support_evidence_denied",
    "private_storage",
    "quota_fail_closed",
  ],
  G6: ["B01", "B02", "B03", "B04", "B05", "B06", "B15"],
  G7: ["B07", "B08", "B09", "B10", "B11", "B12", "B13"],
  G8: [
    "B14",
    "rpc_429_timeout",
    "outbox_failure",
    "worker_restart",
    "concurrent_workers",
    "missed_events",
    "stale_snapshot",
    "manual_recovery",
  ],
  G9: [
    "hosted_access",
    "monitor_alert",
    "recovery_drill",
    "backup_restore",
    "compatible_rollback",
    "operator_handoff",
  ],
  G10: [
    "freelancer_1",
    "freelancer_2",
    "freelancer_3",
    "freelancer_4",
    "freelancer_5",
    "client_1",
    "client_2",
  ],
  G11: [
    "independent_security_review",
    "key_governance",
    "legal_payment_review",
    "funded_recovery",
  ],
};
const fresh = (date, now) => {
  const t = Date.parse(date ?? "");
  return Number.isFinite(t) && t <= now && now - t <= 72 * 60 * 60 * 1000;
};
const signatureValid = (value) => {
  try {
    return (
      typeof value === "string" &&
      value.length <= 88 &&
      bs58.decode(value).length === 64
    );
  } catch {
    return false;
  }
};
export function assessRelease(
  recordInput,
  automated,
  artifacts,
  now = Date.now(),
) {
  const r = releaseRecord.parse(recordInput);
  const sourceMatches = (s) =>
    s?.clean === true &&
    s.commit === r.source.commit &&
    s.tree === r.source.tree &&
    s.lockfileSha256 === r.source.lockfileSha256;
  const automatedPass = ["web", "native", "runtime"].every((suite) => {
    const a = automated.find((v) => v.suite === suite);
    return (
      a?.kind === "local-release-checks" &&
      a.schemaVersion === 1 &&
      sourceMatches(a.source) &&
      a.status === "passed" &&
      fresh(a.completedAt, now) &&
      a.checks?.length === (suite === "web" ? 1 : 2) &&
      a.checks.every((v) => v.status === "passed" && v.exitCode === 0) &&
      a.checks.some(
        (v) => Number.isSafeInteger(v.testsPassed) && v.testsPassed > 0,
      ) &&
      (suite !== "runtime" || digest.safeParse(a.artifactSha256).success)
    );
  });
  const results = gateIds.map((id) => {
    const g = r.gates[id];
    if (id === "G1")
      return {
        id,
        status: r.source.clean && automatedPass ? "PASS" : "BLOCKED",
        reason:
          "Requires fresh, clean, same-source web/native/runtime checks. Manual status cannot override this gate.",
      };
    let valid =
      g.status === "PASS" &&
      !!g.reviewer &&
      fresh(g.observedAt, now) &&
      g.evidence.length > 0;
    valid &&= g.evidence.every((ref) => {
      const a = artifacts[ref.path];
      if (
        !a ||
        a.digest !== ref.sha256 ||
        !sourceMatches(a.report.source) ||
        !fresh(a.report.checkedAt, now)
      )
        return false;
      const e = a.report;
      if (
        e.network !== "devnet" ||
        e.program !== r.program ||
        e.mint !== r.mint ||
        e.status !== "passed"
      )
        return false;
      if (
        ["G3", "G6", "G7", "G8", "G9", "G10"].includes(id) &&
        e.appURL !== r.appURL
      )
        return false;
      if (id === "G2")
        return (
          e.kind === "read-only-devnet-preflight" &&
          e.genesis === "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" &&
          e.decimals === 6 &&
          e.papCapability?.version === 1 &&
          e.artifactComparison?.bytesMatch === true &&
          e.artifactComparison?.trailingPaddingZero === true &&
          e.artifactComparison.sha256 ===
            automated.find((v) => v.suite === "runtime")?.artifactSha256
        );
      if (id === "G4")
        return (
          e.kind === "pap-upgrade-verification" &&
          e.capabilityVersion === 1 &&
          e.binaryHash ===
            automated.find((v) => v.suite === "runtime")?.artifactSha256
        );
      if (id === "G5")
        return (
          e.kind === "scripted-pap-devnet-program-test" &&
          e.transactions?.length >= 10 &&
          e.transactions.every(
            (tx) =>
              signatureValid(tx.signature) &&
              tx.commitment === "finalized" &&
              Number.isSafeInteger(tx.finalizedSlot) &&
              tx.finalizedSlot > 0,
          ) &&
          new Set(e.transactions.map((tx) => tx.signature)).size ===
            e.transactions.length &&
          e.balancesVerified === true
        );
      return (
        e.kind === "reviewed-release-observations" &&
        e.gate === id &&
        Array.isArray(e.observations) &&
        requiredObservations[id]?.every((key) =>
          e.observations.some(
            (v) =>
              v.id === key &&
              v.status === "PASS" &&
              typeof v.reference === "string" &&
              v.reference.length > 0,
          ),
        )
      );
    });
    if (id === "G9") valid &&= Object.values(r.owners).every(Boolean);
    return {
      id,
      status: valid ? "PASS" : g.status === "FAIL" ? "FAIL" : "BLOCKED",
      reason: valid
        ? "Reviewed evidence references validated; observation truth requires human review."
        : "Missing, stale, incomplete, wrong-source or wrong-environment evidence/reviewer.",
    };
  });
  const required =
      r.target === "pap-preview" ? gateIds.slice(0, 5) : gateIds.slice(0, 9),
    blocked = results
      .filter((v) => required.includes(v.id) && v.status !== "PASS")
      .map((v) => v.id);
  return {
    schemaVersion: 1,
    kind: "release-decision",
    checkedAt: new Date(now).toISOString(),
    source: r.source,
    target: r.target,
    appURL: r.appURL,
    gates: results,
    decision:
      r.target === "mainnet" || blocked.length
        ? "NO_GO"
        : r.target === "pap-preview"
          ? "READY_FOR_CONTROLLED_BROWSER_VALIDATION"
          : "REVIEWED_DEVNET_PILOT_ONLY",
    blocked,
    realMoneyPaymentsEnabled: false,
    limitation:
      "Evidence metadata/digests are checked locally. Human observations and approvals are not independently authenticated by this tool. Mainnet is unsupported regardless of gate selections.",
  };
}
