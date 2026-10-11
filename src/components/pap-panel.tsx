"use client";
import { useEffect, useState } from "react";
import type { ProjectDetail } from "@/lib/agreements/schema";
import { transition, type Execution } from "@/lib/pap/engine";
import type { PapCommand } from "@/lib/pap/schema";
import type { EvidenceRecord } from "@/lib/evidence/schema";
import { formatTokenAmount } from "@/lib/domain";
import { EvidencePanel } from "./evidence-panel";
import { EscrowPanel } from "./escrow-panel";
import { NextAction, ProgressSteps } from "./workspace-guidance";
import { deliveryGuidance, workStatus } from "@/lib/workspace-guide";
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
  acknowledge_review: "Confirm you have seen the delivery",
  request_changes: "Request changes",
  accept: "Accept work (payment follows)",
  reject: "Reject work",
  evaluate: "Check expired review period",
  dispute: "Open dispute",
  propose_refund: "Request a non-delivery refund",
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
      setNotice(
        action === "submit"
          ? "Your work was submitted. The client can review the attached delivery."
          : action === "accept"
            ? "Work accepted. Open Payments below to complete the separate wallet payment."
            : `${labels[action] ?? "Agreement updated"} completed. Your next step is shown below.`,
      );
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
  const guide = deliveryGuidance(
    milestone,
    wallet === terms.clientWallet,
    !!execution,
  );
  const availableActions = Object.entries(labels).filter(([action]) =>
    allowed(action as PapCommand["action"]),
  );
  const problemActions = [
    "reject",
    "evaluate",
    "dispute",
    "propose_refund",
    "request_cancel",
    "approve_cancel",
  ];
  const actionButton = (action: string, label: string) => (
    <button
      className={
        action === "start" || action === "accept" ? "primary" : "secondary"
      }
      disabled={busy}
      key={action}
      onClick={() => act(action as PapCommand["action"])}
    >
      {label}
    </button>
  );
  async function refreshEvidence() {
    const data = await api(
      `/api/evidence?project=${id}&version=${record.version}&index=${index}`,
    );
    setEvidence(data.evidence);
  }
  return (
    <>
      <section
        id="project-delivery"
        className="workspace-card delivery-workspace"
        aria-busy={busy}
      >
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">WORK & DELIVERY</p>
            <h2>Your milestone checklist</h2>
          </div>
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
                  setNotice("Work status updated. Check your next step below.");
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Refresh work status
          </button>
        </div>
        {notice && <p role="status">{notice}</p>}
        <p className="section-intro">
          Manage the work here. Wallet payments happen separately in{" "}
          <a className="inline-link" href="#project-payments">
            Payments ↓
          </a>
          .
        </p>
        {snapshot ? (
          <>
            <ProgressSteps
              labels={[
                "Agree",
                "Prepare work",
                "Review",
                "Confirm payment",
                milestone?.state === "REFUNDED" ? "Refunded" : "Paid",
              ]}
              current={guide.step}
              complete={
                !!milestone?.paymentReference &&
                ["PAID", "REFUNDED"].includes(milestone.state)
              }
            />
            <NextAction
              role={wallet === terms.clientWallet ? "Client" : "Freelancer"}
              title={guide.title}
            >
              <p>{guide.body}</p>
              {guide.step === 3 ? (
                <a className="primary compact" href="#project-payments">
                  Go to payments ↓
                </a>
              ) : null}
            </NextAction>
          </>
        ) : (
          <p role="status">Loading your milestone checklist…</p>
        )}
        <div className="milestone-summary">
          <span className="outline-pill">
            {execution
              ? workStatus(execution.status)
              : bothAccepted
                ? "Ready to activate"
                : "Waiting for agreement signatures"}
          </span>
          <span>
            Active agreement:{" "}
            {execution ? `version ${execution.version}` : "not activated yet"}
          </span>
          {execution && execution.version !== detail.agreement.version ? (
            <span className="notice">
              Updated terms (version {detail.agreement.version}) still need
              activation.
            </span>
          ) : null}
        </div>
        {canActivate ? (
          <button
            className="primary"
            disabled={busy}
            onClick={() => act("activate")}
          >
            Activate agreed terms · version {detail.agreement.version}
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
            <div className="milestone-summary">
              <strong>{workStatus(milestone?.state ?? "PENDING")}</strong>
              <span>
                {formatTokenAmount(BigInt(terms.milestones[index].amountUnits))}{" "}
                TEST
              </span>
              <span>
                {milestone?.revisions ?? 0} of {policy.revisionLimit} revisions
                used
              </span>
            </div>
            <p>
              Delivery due:{" "}
              {new Date(
                terms.milestones[index].deliveryDeadline,
              ).toLocaleString()}{" "}
              · Review: {policy.reviewHours} hours
              {milestone?.reviewDueAt
                ? ` (ends ${new Date(milestone.reviewDueAt).toLocaleString()})`
                : ""}
            </p>
            {milestone?.humanReviewRequired ? (
              <p className="notice">
                Human review required. No automatic payment is authorized.
              </p>
            ) : null}
            <div id="project-evidence">
              <EvidencePanel
                key={`${record.version}:${index}`}
                projectId={id}
                version={record.version}
                index={index}
                canUpload={true}
                freelancer={wallet === terms.freelancerWallet}
                onSaved={refreshEvidence}
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
            <h3>Delivery requirements</h3>
            {canSubmit ? (
              <p className="section-intro">
                Attach a saved file or link to each requirement. Once every
                required format is selected, submit the work for client review.
              </p>
            ) : null}
            {policy.deliverables.map((d) => (
              <div className="deliverable-checklist" key={d.id}>
                <h4>{d.title}</h4>
                <p>Required formats: {d.requiredEvidenceTypes.join(", ")}</p>
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
            <label>
              Message for the other person / review notes
              <textarea
                placeholder="Explain your feedback, requested changes, or reason for this action."
                value={reason}
                minLength={10}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="button-row">
              {availableActions
                .filter(([action]) => !problemActions.includes(action))
                .map(([action, label]) => actionButton(action, label))}
              {canSubmit ? (
                <button
                  className="primary"
                  disabled={busy || !evidenceComplete}
                  onClick={() => act("submit")}
                >
                  Submit work for review
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
            {availableActions.some(([action]) =>
              problemActions.includes(action),
            ) ? (
              <details
                className="feature-section problem-section"
                open={milestone?.state === "DISPUTED"}
              >
                <summary>
                  Resolve a problem{" "}
                  <span>Disputes, cancellation & review deadlines</span>
                </summary>
                <p>
                  Add a clear explanation in the review notes above. A workflow
                  decision does not itself transfer payment.
                </p>
                <div className="button-row">
                  {availableActions
                    .filter(([action]) => problemActions.includes(action))
                    .map(([action, label]) => actionButton(action, label))}
                </div>
              </details>
            ) : null}
            <details className="technical-details">
              <summary>Workflow technical details</summary>
              <p>
                Status: {execution?.status ?? "not activated"} · Milestone:{" "}
                {milestone?.state ?? "PENDING"} · Agreement version:{" "}
                {record.version} · Revision: {snapshot.execution?.revision ?? 0}
              </p>
              <p>
                Rule evaluation runs off-chain. Payment is verified separately.
              </p>
            </details>
            <details className="feature-section">
              <summary>
                Work & review history{" "}
                <span>{snapshot.timeline.length} updates</span>
              </summary>
              {snapshot.timeline.length ? (
                <ol>
                  {snapshot.timeline.map((e) => (
                    <li key={e.id}>
                      <strong>
                        {labels[e.action] ?? e.action.replaceAll("_", " ")} ·
                        version {e.agreement_version}
                      </strong>
                      <p>{e.reason}</p>
                      <small>
                        {new Date(e.created_at).toLocaleString()} · {e.actor} ·
                        action: {e.action}
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
            </details>
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
