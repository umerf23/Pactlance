"use client";
import { useEffect, useState } from "react";
import type { ProjectDetail } from "@/lib/agreements/schema";
import { transition, type Execution } from "@/lib/pap/engine";
import type { PapCommand } from "@/lib/pap/schema";
import type { EvidenceRecord } from "@/lib/evidence/schema";
import { formatTokenAmount } from "@/lib/domain";
import { EvidencePanel } from "./evidence-panel";
import { EscrowPanel } from "./escrow-panel";
type Timeline = {
  id: string;
  action: string;
  reason: string;
  actor: string;
  created_at: string;
  agreement_version: number;
  rule_ids: string[];
  previous_state: Execution | null;
  new_state: Execution;
};
type Snapshot = {
  execution: { state: Execution; revision: number } | null;
  timeline: Timeline[];
  version: number;
};
const labels: Record<string, string> = {
  start: "Start work",
  acknowledge_review: "Acknowledge review notice",
  request_changes: "Request revision",
  accept: "Accept work / payment eligible",
  reject: "Reject work",
  evaluate: "Evaluate elapsed review",
  dispute: "Open dispute",
  propose_refund: "Propose non-delivery refund",
  request_cancel: "Propose cancellation",
  approve_cancel: "Approve cancellation",
};
async function api(path: string, body?: unknown) {
  const response = await fetch(path, {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
export function PapPanel({
  detail,
  wallet,
}: {
  detail: ProjectDetail;
  wallet: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [deliveries, setDeliveries] = useState<Record<string, string[]>>({}),
    [evidence, setEvidence] = useState<EvidenceRecord[]>([]),
    [selectedIndex, setIndex] = useState(0),
    [now, setNow] = useState(Date.now);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const id = detail.project.id;
  useEffect(() => {
    let live = true;
    api(`/api/pap?project=${id}`)
      .then((d) => {
        if (live) setSnapshot(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, detail.acceptances.length, detail.agreement.version]);
  const record =
      detail.history.find((a) => a.version === snapshot?.version) ??
      detail.agreement,
    index = Math.min(selectedIndex, record.terms.milestones.length - 1);
  useEffect(() => {
    let live = true;
    api(`/api/evidence?project=${id}&version=${record.version}&index=${index}`)
      .then((d) => {
        if (live) {
          setEvidence(d.evidence);
          setDeliveries({});
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, record.version, index, snapshot?.execution?.revision]);
  const execution = snapshot?.execution?.state ?? null,
    terms = record.terms,
    p = terms.protocol!,
    bothAccepted =
      detail.acceptances.filter(
        (a) =>
          a.version === detail.agreement.version &&
          a.commitment === detail.agreement.commitment,
      ).length === 2;
  const base = (
    action: PapCommand["action"],
    version = record.version,
  ): PapCommand => ({
    projectId: id,
    version,
    expectedRevision: snapshot?.execution?.revision ?? 0,
    idempotencyKey: "00000000-0000-4000-8000-000000000000",
    action,
    milestoneIndex: index,
    reason:
      reason.trim() ||
      "User reviewed the agreement and requested this transition.",
  });
  const allowed = (action: PapCommand["action"]) => {
    try {
      transition(terms, execution, base(action), {
        now: new Date(now).toISOString(),
        actor: wallet,
        bothAccepted,
        evidence: {},
      });
      return true;
    } catch {
      return false;
    }
  };
  async function act(action: PapCommand["action"]) {
    setBusy(true);
    setError("");
    try {
      const cmd = base(
        action,
        action === "activate" ? detail.agreement.version : record.version,
      );
      cmd.idempotencyKey = crypto.randomUUID();
      if (action === "submit")
        cmd.deliveries = p.milestones[index].deliverables.map((d) => ({
          deliverableId: d.id,
          evidenceIds: deliveries[d.id] ?? [],
        }));
      await api("/api/pap", cmd);
      setSnapshot(await api(`/api/pap?project=${id}`));
      setReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const milestone = execution?.milestones[index],
    policy = p.milestones[index],
    canSubmit =
      wallet === terms.freelancerWallet &&
      milestone &&
      ["IN_PROGRESS", "CHANGES_REQUESTED"].includes(milestone.state) &&
      now <= Date.parse(terms.milestones[index].deliveryDeadline);
  const evidenceComplete = policy.deliverables.every((d) =>
    d.requiredEvidenceTypes.every((type) =>
      (deliveries[d.id] ?? []).some((id) => {
        const e = evidence.find((item) => item.id === id);
        return (
          e?.status === "ready" &&
          e.purpose === "delivery" &&
          e.uploader_wallet === terms.freelancerWallet &&
          (e.kind === "link" ? "link" : e.mime_type) === type
        );
      }),
    ),
  );
  let canActivate = false;
  if (snapshot)
    try {
      transition(
        detail.agreement.terms,
        execution,
        base("activate", detail.agreement.version),
        {
          now: new Date(now).toISOString(),
          actor: wallet,
          bothAccepted,
          evidence: {},
        },
      );
      canActivate = true;
    } catch {}
  return (
    <>
      <section id="project-escrow" className="workspace-card">
        <div className="workspace-heading">
          <h2>Agreement execution</h2>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setError("");
              setBusy(true);
              setNotice("");
              api(`/api/pap?project=${id}`)
                .then((data) => {
                  setSnapshot(data);
                  setNotice(
                    "Protocol refreshed. The current milestone status is shown below.",
                  );
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Refresh protocol
          </button>
        </div>
        {notice && <p role="status">{notice}</p>}
        <p className="notice">
          Off-chain workflow. Accepted work and payment eligibility do not mean
          funds were transferred. Use the payment workspace below to authorize
          supported devnet payments; only finalized settlements are marked paid.
        </p>
        <p>
          Status:{" "}
          {execution?.status ??
            (bothAccepted
              ? "PROPOSED · ready to activate"
              : "AWAITING_COUNTERPARTY")}{" "}
          · active version {execution?.version ?? "none"}
          {execution && execution.version !== detail.agreement.version
            ? ` · amendment v${detail.agreement.version} awaits activation`
            : ""}
        </p>
        {canActivate ? (
          <button
            className="primary"
            disabled={busy}
            onClick={() => act("activate")}
          >
            Activate jointly signed version {detail.agreement.version}
          </button>
        ) : null}
        {snapshot ? (
          <>
            <label>
              Milestone
              <select
                value={index}
                onChange={(e) => setIndex(Number(e.target.value))}
              >
                {terms.milestones.map((m, i) => (
                  <option key={m.id} value={i}>
                    {i + 1}. {m.title}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {milestone?.state ?? "PENDING"} ·{" "}
              {formatTokenAmount(BigInt(terms.milestones[index].amountUnits))}{" "}
              TEST · {milestone?.revisions ?? 0}/{policy.revisionLimit}{" "}
              revisions
            </p>
            <p role="status">
              {milestone?.state === "PENDING"
                ? "Next: the freelancer starts this milestone."
                : milestone?.state === "IN_PROGRESS" ||
                    milestone?.state === "CHANGES_REQUESTED"
                  ? "Next: the freelancer saves the required delivery evidence, refreshes evidence selections, selects it for each deliverable, and submits it for review."
                  : milestone?.state === "UNDER_REVIEW"
                    ? "Next: the client reviews the evidence and accepts, requests a permitted revision, or opens a dispute."
                    : milestone?.state === "PAYMENT_PENDING"
                      ? "Next: use the payment workspace below to publish the reviewed delivery and authorize the eligible allocation. No payment has been confirmed yet."
                      : milestone?.paymentReference
                        ? `Finalized devnet settlement: ${milestone.paymentReference.signature}`
                        : "Refresh protocol to check the next permitted action."}
            </p>
            <p>
              Delivery due: {terms.milestones[index].deliveryDeadline} · Review:{" "}
              {policy.reviewHours} hours
              {milestone?.reviewDueAt ? ` (ends ${milestone.reviewDueAt})` : ""}
            </p>
            {milestone?.humanReviewRequired ? (
              <p className="notice">
                Human review required. No automatic payment is authorized.
              </p>
            ) : null}
            {policy.deliverables.map((d) => (
              <div key={d.id}>
                <h4>{d.title}</h4>
                <p>Required: {d.requiredEvidenceTypes.join(", ")}</p>
                {canSubmit
                  ? evidence
                      .filter(
                        (e) =>
                          e.uploader_wallet === terms.freelancerWallet &&
                          e.purpose === "delivery",
                      )
                      .map((e) => (
                        <label className="check-label" key={e.id}>
                          <input
                            type="checkbox"
                            checked={deliveries[d.id]?.includes(e.id) ?? false}
                            onChange={(event) =>
                              setDeliveries((old) => ({
                                ...old,
                                [d.id]: event.target.checked
                                  ? [...(old[d.id] ?? []), e.id]
                                  : (old[d.id] ?? []).filter(
                                      (id) => id !== e.id,
                                    ),
                              }))
                            }
                          />
                          {e.title} · {e.kind === "link" ? "link" : e.mime_type}
                        </label>
                      ))
                  : null}
              </div>
            ))}
            <div id="project-evidence">
              <EvidencePanel
                key={`${record.version}:${index}`}
                projectId={id}
                version={record.version}
                index={index}
                canUpload={true}
                freelancer={wallet === terms.freelancerWallet}
              />
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  api(
                    `/api/evidence?project=${id}&version=${record.version}&index=${index}`,
                  )
                    .then((d) => setEvidence(d.evidence))
                    .catch((e) => setError(e.message))
                }
              >
                Refresh evidence selections
              </button>
            </div>
            <label>
              Reason / review notes
              <textarea
                value={reason}
                minLength={10}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="button-row">
              {Object.entries(labels)
                .filter(([a]) => allowed(a as PapCommand["action"]))
                .map(([a, label]) => (
                  <button
                    className="secondary"
                    disabled={busy}
                    key={a}
                    onClick={() => act(a as PapCommand["action"])}
                  >
                    {label}
                  </button>
                ))}
              {canSubmit ? (
                <button
                  className="primary"
                  disabled={busy || !evidenceComplete}
                  onClick={() => act("submit")}
                >
                  Submit verified evidence
                </button>
              ) : null}
            </div>
            {canSubmit && !evidenceComplete && (
              <p role="status">
                Select completed delivery evidence for every required format
                under each deliverable before submitting. Saving a file alone
                does not select it.
              </p>
            )}
            <h3>Transition timeline</h3>
            {snapshot.timeline.length ? (
              <ol>
                {snapshot.timeline.map((e) => (
                  <li key={e.id}>
                    <strong>
                      {e.action} · v{e.agreement_version}
                    </strong>
                    <p>{e.reason}</p>
                    <small>
                      {e.created_at} · {e.actor}
                      {e.rule_ids.length
                        ? ` · rules: ${e.rule_ids.join(", ")}`
                        : ""}
                    </small>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No transitions yet.</p>
            )}
          </>
        ) : null}
        {error ? (
          <p className="error-message" role="alert">
            {error}
          </p>
        ) : null}
      </section>
      <EscrowPanel
        projectId={id}
        onReconciled={async () =>
          setSnapshot(await api(`/api/pap?project=${id}`))
        }
      />
    </>
  );
}
