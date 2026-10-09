"use client";
import { useEffect, useState } from "react";
import type { AgreementTerms } from "@/lib/agreements/schema";
import { operationalAPI, EvidencePanel } from "./evidence-panel";
import { formatTokenAmount, parseTokenAmount } from "@/lib/domain";
import { EscrowPanel } from "./escrow-panel";
type Assignment = {
  projectId: string;
  version: number;
  terms: AgreementTerms;
  revision: number;
  indices: number[];
  allocationPendingIndices?: number[];
};
export function PapReviewer({ wallet }: { wallet: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]),
    [selected, setSelected] = useState(""),
    [refund, setRefund] = useState("0"),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    operationalAPI("/api/pap")
      .then((d) => {
        if (live) setAssignments(d.assignments);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [wallet]);
  const pair = assignments
    .flatMap((a) =>
      a.indices.map((index) => ({ a, index, key: `${a.projectId}:${index}` })),
    )
    .find((p) => p.key === selected);
  async function resolve() {
    if (!pair) return;
    setBusy(true);
    setError("");
    try {
      const units =
        refund === "0" ? "0" : parseTokenAmount(refund, 6).toString();
      await operationalAPI("/api/pap", {
        projectId: pair.a.projectId,
        version: pair.a.version,
        expectedRevision: pair.a.revision,
        idempotencyKey: crypto.randomUUID(),
        action: "resolve",
        milestoneIndex: pair.index,
        clientRefundUnits: units,
        reason,
      });
      const refreshed = (await operationalAPI("/api/pap"))
        .assignments as Assignment[];
      setAssignments(refreshed);
      if (
        !refreshed.some(
          (a) =>
            a.projectId === pair.a.projectId && a.indices.includes(pair.index),
        )
      )
        setSelected("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="editor-milestone">
      <h3>PAP dispute assignments</h3>
      <p className="muted">
        Only the currently eligible reviewer can propose a binding workflow
        allocation. This records an authenticated decision off-chain and does
        not move funds.
      </p>
      <button
        className="secondary"
        disabled={busy}
        onClick={() =>
          operationalAPI("/api/pap")
            .then((d) => {
              setAssignments(d.assignments);
              setError("");
            })
            .catch((e) => setError(e.message))
        }
      >
        Refresh PAP assignments
      </button>
      {!assignments.length ? (
        <p>No active PAP disputes assigned to this wallet.</p>
      ) : (
        <label>
          Disputed milestone
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select a dispute</option>
            {assignments.flatMap((a) =>
              a.indices.map((i) => (
                <option
                  value={`${a.projectId}:${i}`}
                  key={`${a.projectId}:${i}`}
                >
                  {a.terms.title} · {a.terms.milestones[i].title} · v{a.version}
                </option>
              )),
            )}
          </select>
        </label>
      )}
      {pair ? (
        <>
          <p>
            Total allocation:{" "}
            {formatTokenAmount(
              BigInt(pair.a.terms.milestones[pair.index].amountUnits),
            )}{" "}
            TEST. Client receives the refund; the balance goes to the original
            freelancer.
          </p>
          <EvidencePanel
            key={selected}
            projectId={pair.a.projectId}
            version={pair.a.version}
            index={pair.index}
            canUpload={false}
            freelancer={false}
          />
          <label>
            Client refund (TEST)
            <input
              inputMode="decimal"
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
            />
          </label>
          <label>
            Decision and rationale
            <textarea
              minLength={10}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {!pair.a.allocationPendingIndices?.includes(pair.index) ? (
            <button
              className="primary"
              disabled={busy || reason.trim().length < 10}
              onClick={resolve}
            >
              Record allocation decision
            </button>
          ) : (
            <p role="status">
              Allocation decision recorded. In the payment workspace, enter that
              exact client refund and authorize the on-chain resolution when
              this wallet is eligible.
            </p>
          )}
          <EscrowPanel
            key={`${pair.a.projectId}:${wallet}`}
            projectId={pair.a.projectId}
          />
        </>
      ) : null}
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
