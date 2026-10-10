"use client";
import { useEffect, useState } from "react";
import { EscrowPanel } from "./escrow-panel";
import { PapReviewer } from "./pap-reviewer";
import { operationalAPI, EvidencePanel } from "./evidence-panel";
import {
  explorerURL,
  freshCache,
  reviewerEligible,
  type MilestoneCache,
  type Notice,
  type TransactionEvent,
} from "@/lib/operations/model";
import type { OperationalHealth } from "@/lib/operations/server/health";
import type { AgreementTerms } from "@/lib/agreements/schema";
interface Operations {
  milestones: MilestoneCache[];
  transactions: TransactionEvent[];
  notices: Notice[];
  assignments: MilestoneCache[];
  agreements: { project_id: string; version: number; terms: AgreementTerms }[];
  support: boolean;
  chainConfigured: boolean;
}
interface Support {
  health: OperationalHealth;
  milestones: Pick<
    MilestoneCache,
    "project_id" | "milestone_index" | "state" | "verified_at" | "chain_address"
  >[];
  notes: { id: string; project_id: string; note: string; created_at: string }[];
  transactions: TransactionEvent[];
}
export function OperationsDashboard({
  wallet,
  projectId,
}: {
  wallet: string;
  projectId?: string;
}) {
  const [data, setData] = useState<Operations | null>(null),
    [error, setError] = useState(""),
    [selection, setSelected] = useState<MilestoneCache | null>(null),
    [support, setSupport] = useState<Support | null>(null),
    [note, setNote] = useState(""),
    [noteProject, setNoteProject] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const selected =
    data?.assignments.find(
      (m) =>
        m.project_id === selection?.project_id &&
        m.milestone_index === selection?.milestone_index &&
        m.agreement_version === selection?.agreement_version,
    ) ?? null;
  async function refresh() {
    setError("");
    try {
      setData(
        await operationalAPI(
          `/api/operations${projectId ? `?project=${projectId}` : ""}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let active = true;
    const load = () =>
      operationalAPI(
        `/api/operations${projectId ? `?project=${projectId}` : ""}`,
      )
        .then((d) => {
          if (active) setData(d);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [wallet, projectId]);
  async function dismiss(key: string) {
    try {
      await operationalAPI("/api/operations", { noticeKey: key });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function loadSupport() {
    try {
      setSupport(await operationalAPI("/api/support"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveNote(e: React.FormEvent) {
    e.preventDefault();
    try {
      await operationalAPI("/api/support", { projectId: noteProject, note });
      setNote("");
      await loadSupport();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const agreement =
    selected &&
    data?.agreements.find(
      (a) =>
        a.project_id === selected.project_id &&
        a.version === selected.agreement_version,
    );
  return (
    <section className="workspace-card">
      {!projectId ? <PapReviewer wallet={wallet} /> : null}
      <div className="workspace-heading">
        <h2>Activity and reminders</h2>
        <button className="secondary" onClick={refresh}>
          Refresh
        </button>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading activity…</p>}
      {data && (
        <>
          <p className="muted">
            {data.chainConfigured
              ? "Chain activity appears after verified reconciliation."
              : "Escrow is not connected on this deployment. Funding and settlement history will appear after chain integration."}
          </p>
          {data.notices.map((n) => (
            <article className="notice-row" key={n.key}>
              <div>
                <strong>Milestone {n.index + 1}</strong>
                <p>{n.message}</p>
              </div>
              <button className="text-button" onClick={() => dismiss(n.key)}>
                Dismiss
              </button>
            </article>
          ))}
          {data.milestones.map((m) => (
            <div
              className="status-row"
              key={`${m.project_id}:${m.milestone_index}`}
            >
              <strong>
                Milestone {m.milestone_index + 1} · {m.state}
              </strong>
              <small>
                {freshCache(m, now)
                  ? "Recently verified"
                  : "Status needs refresh"}{" "}
                · {new Date(m.verified_at).toLocaleString()}
              </small>
            </div>
          ))}
          <h3>Transaction history</h3>
          {data.transactions.length === 0 ? (
            <p>No recorded transactions yet.</p>
          ) : (
            data.transactions.map((t) => (
              <div
                className="status-row"
                key={`${t.signature}:${t.event_kind}`}
              >
                <span>
                  {t.event_kind} · {t.status} · {t.network ?? "devnet"}
                </span>
                <small>
                  Obligation: {t.amount_units ?? "—"} TEST base units. Client:{" "}
                  {t.client_recipient ?? "—"}; freelancer:{" "}
                  {t.freelancer_recipient ?? "—"}.{" "}
                  {t.client_amount_units != null &&
                    `Actual split: ${t.client_amount_units} / ${t.freelancer_amount_units}.`}
                </small>
                {explorerURL(t.signature) && (
                  <a
                    href={explorerURL(t.signature)!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View on Solana Explorer ↗
                  </a>
                )}
              </div>
            ))
          )}
          {!projectId && (
            <>
              <h3>Review assignments</h3>
              {data.assignments.length === 0 ? (
                <p>
                  No currently eligible verified disputes assigned to this
                  wallet.
                </p>
              ) : (
                data.assignments.map((m) => (
                  <button
                    className="project-row"
                    key={`${m.project_id}:${m.milestone_index}`}
                    onClick={() => setSelected(m)}
                  >
                    <span>
                      <strong>Milestone {m.milestone_index + 1}</strong>
                      <small>Project {m.project_id}</small>
                    </span>
                    <span>Review evidence ↗</span>
                  </button>
                ))
              )}
            </>
          )}
          {selected && agreement && (
            <section className="reviewer-panel">
              <h3>Dispute review · {agreement.terms.title}</h3>
              <p className="preserve-lines">{agreement.terms.scope}</p>
              <p>
                <strong>Agreed acceptance criteria:</strong>{" "}
                {
                  agreement.terms.milestones[selected.milestone_index]
                    ?.acceptanceCriteria
                }
              </p>
              <p>
                {reviewerEligible(selected, wallet, now)
                  ? "Your reviewer role is currently eligible."
                  : "Reviewer eligibility needs a fresh status check."}{" "}
                Primary authority switches to backup at{" "}
                {selected.backup_at
                  ? new Date(selected.backup_at).toLocaleString()
                  : "the agreed escalation time"}
                .
              </p>
              <EscrowPanel
                key={`${selected.project_id}:${wallet}`}
                projectId={selected.project_id}
              />
              <EvidencePanel
                key={`${selected.project_id}:${selected.agreement_version}:${selected.milestone_index}`}
                projectId={selected.project_id}
                version={selected.agreement_version}
                index={selected.milestone_index}
                canUpload={false}
                freelancer={false}
              />
              <button className="text-button" onClick={() => setSelected(null)}>
                Close review
              </button>
            </section>
          )}
          {data.support && !projectId && (
            <>
              <button className="secondary" onClick={loadSupport}>
                Open support view
              </button>
              {support && (
                <section className="support-panel">
                  <h3>Support operations</h3>
                  <p className="muted">
                    Operational metadata only. Support access does not permit
                    evidence downloads or movement of funds.
                  </p>
                  <div role="status" aria-live="polite">
                    <p>
                      Monitoring: {support.health.status} ·{" "}
                      {new Date(support.health.checkedAt).toLocaleString()}
                    </p>
                    {support.health.counts ? (
                      <dl className="operations-metrics">
                        {Object.entries(support.health.counts).map(
                          ([key, value]) => (
                            <div key={key}>
                              <dt>
                                {
                                  (
                                    {
                                      activeMilestones: "Active milestones",
                                      staleActiveSnapshots: "Stale snapshots",
                                      openDisputes: "Open disputes",
                                      pendingClaims: "Pending claims",
                                      stuckClaims: "Stuck claims",
                                      failedClaimsLastDay:
                                        "Failed claims (24h)",
                                      papPaymentPendingAgreements:
                                        "PAP payment pending",
                                    } as Record<string, string>
                                  )[key]
                                }
                              </dt>
                              <dd>{value}</dd>
                            </div>
                          ),
                        )}
                      </dl>
                    ) : (
                      <p>
                        Metrics are unavailable. Check the service before
                        assuming operations are healthy.
                      </p>
                    )}
                  </div>
                  <button className="secondary" onClick={loadSupport}>
                    Refresh diagnostics
                  </button>
                  {support.milestones.map((m) => (
                    <p key={`${m.project_id}:${m.milestone_index}`}>
                      Project {m.project_id} · milestone {m.milestone_index + 1}{" "}
                      · {m.state}
                    </p>
                  ))}
                  {support.transactions.map((t) => (
                    <p key={`${t.project_id}:${t.signature}:${t.event_kind}`}>
                      Project {t.project_id} · {t.event_kind} · {t.status} ·{" "}
                      {t.network ?? "devnet"}
                    </p>
                  ))}
                  {support.notes.map((n) => (
                    <article key={n.id}>
                      <small>Project {n.project_id}</small>
                      <p className="preserve-lines">{n.note}</p>
                    </article>
                  ))}
                  <form onSubmit={saveNote}>
                    <label>
                      Project ID
                      <input
                        required
                        value={noteProject}
                        onChange={(e) => setNoteProject(e.target.value)}
                      />
                    </label>
                    <label>
                      Internal support note
                      <textarea
                        required
                        maxLength={2000}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
                    <button className="secondary">Save support note</button>
                  </form>
                </section>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
