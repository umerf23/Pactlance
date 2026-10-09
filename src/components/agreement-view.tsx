"use client";
import { useState } from "react";
import { PapPreview } from "./pap-preview";
import type { AgreementRecord, ProjectDetail } from "@/lib/agreements/schema";
import { formatTokenAmount } from "@/lib/domain";
export function AgreementView({
  detail,
  wallet,
  onAccept,
  onEdit,
  onBack,
}: {
  detail: ProjectDetail;
  wallet: string;
  onAccept: () => Promise<void>;
  onEdit: () => void;
  onBack: () => void;
}) {
  const [version, setVersion] = useState(detail.agreement.version);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const record: AgreementRecord =
    detail.history.find((a) => a.version === version) ?? detail.agreement;
  const terms = record.terms;
  const signatures = detail.acceptances.filter(
    (a) => a.version === version && a.commitment === record.commitment,
  );
  const mine = signatures.some((a) => a.wallet === wallet);
  const current = version === detail.project.current_version;
  async function accept() {
    setBusy(true);
    setError("");
    try {
      await onAccept();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-card agreement-document">
      <div className="workspace-heading">
        <button className="text-button" onClick={onBack}>
          ← All projects
        </button>
        <span className="outline-pill">
          {signatures.length}/2 off-chain signatures · v{version}
        </span>
      </div>
      <p className="eyebrow">AGREEMENT REVIEW</p>
      <h1>{terms.title}</h1>
      <p className="scope-text">{terms.scope}</p>
      <label>
        Agreement version
        <select
          value={version}
          onChange={(e) => {
            setVersion(Number(e.target.value));
            setAck(false);
          }}
        >
          {detail.history.map((a) => (
            <option key={a.version} value={a.version}>
              Version {a.version}
              {a.version === detail.project.current_version
                ? " (current)"
                : " (earlier version)"}
            </option>
          ))}
        </select>
      </label>
      <div className="form-grid">
        {(
          [
            ["Client", terms.clientWallet],
            ["Freelancer", terms.freelancerWallet],
            ["Primary reviewer", terms.reviewerWallet],
            ["Backup reviewer", terms.backupReviewerWallet],
          ] as const
        ).map(([role, key]) => (
          <div className="identity-card" key={role}>
            <strong>{role}</strong>
            <code>{key}</code>
            {role === "Client" || role === "Freelancer" ? (
              <small>
                {signatures.some((s) => s.wallet === key)
                  ? "Signed this version"
                  : "Awaiting signature"}
              </small>
            ) : null}
          </div>
        ))}
      </div>
      <h2>Milestones</h2>
      {terms.milestones.map((m) => (
        <article className="editor-milestone" key={m.id}>
          <div className="workspace-heading">
            <h3>
              {m.sequence}. {m.title}
            </h3>
            <strong>{formatTokenAmount(BigInt(m.amountUnits))} TEST</strong>
          </div>
          <p className="scope-text">{m.scope}</p>
          <h4>Acceptance criteria</h4>
          <p className="scope-text">{m.acceptanceCriteria}</p>
          <dl className="term-list">
            <div>
              <dt>Funding closes</dt>
              <dd>{m.fundingDeadline}</dd>
            </div>
            <div>
              <dt>Delivery due</dt>
              <dd>{m.deliveryDeadline}</dd>
            </div>
            <div>
              <dt>Sequence</dt>
              <dd>
                {m.sequence === 1
                  ? "First milestone"
                  : "Requires previous milestone settlement or mutual cancellation"}
              </dd>
            </div>
          </dl>
        </article>
      ))}
      {terms.protocol ? (
        <PapPreview
          record={record}
          previous={detail.history.find((a) => a.version === version - 1)}
        />
      ) : (
        <>
          <h2>Payment and review rules</h2>
          <ul className="rules-list">
            <li>
              Solana devnet. TEST tokens have no monetary value. Token
              precision: 6 decimals.
            </li>
            <li>
              Each milestone has its own vault; only one funded milestone may be
              active at a time.
            </li>
            <li>
              Submit once before delivery expiry. The client has{" "}
              {terms.reviewHours} hours from recorded submission to review.
            </li>
            <li>
              Client approval releases payment. Without a dispute, anyone may
              execute a claim at review expiry to the fixed freelancer wallet.
            </li>
            <li>
              No delivery: the client may claim a refund at delivery expiry if
              no dispute exists.
            </li>
            <li>
              Either party may dispute strictly before the applicable
              delivery/review deadline; ordinary payment and refund stop.
            </li>
            <li>
              Primary reviewer decides before escalation; backup takes over{" "}
              {terms.backupDelayHours} hours after the dispute opens.
              Allocations can only go to the original participants.
            </li>
            <li>
              Both parties may agree a settlement or cancellation. Disputed
              funds can remain locked if nobody authorized acts.
            </li>
            <li>
              One submission; no silent deadline resets. Additional work needs
              newly accepted terms.
            </li>
            <li>
              No platform fee. The transaction submitter pays network fees.
              Future milestones are not guaranteed funding.
            </li>
          </ul>
        </>
      )}
      <div className="commitment">
        <strong>Agreement fingerprint · SHA-256</strong>
        <code>{record.commitment}</code>
        <small>
          Generated from the complete versioned terms and a private salt.
          Verified again before signing.
        </small>
      </div>
      <p className="notice">
        {terms.protocol ? (
          "Both wallet signatures record consent to this version. Activation is separate; off-chain rule execution does not authorize token transfers."
        ) : (
          <>
            This document signature records off-chain acceptance and makes no
            deposit. In Payment actions, both participants must also accept the
            terms bound to the deployed program and TEST mint before funding.
          </>
        )}
      </p>
      {current && !mine && !detail.project.locked ? (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            I have reviewed this exact version, its milestones, reviewers,
            deadlines and test-only limitations.
          </label>
          <button className="primary" disabled={!ack || busy} onClick={accept}>
            {busy
              ? "Waiting for wallet signature…"
              : "Sign and accept this version"}
          </button>
        </>
      ) : (
        <p role="status">
          {!current
            ? "Select the latest proposal to sign. Earlier PAP terms remain active until a jointly signed amendment is activated."
            : mine
              ? "Your signed acceptance is recorded for this version."
              : "This project is locked against changes."}
        </p>
      )}
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="secondary"
        disabled={busy || !current || detail.project.locked}
        onClick={onEdit}
      >
        Propose revised terms
      </button>
      <p className="muted">
        A new version preserves this history and requires two new signatures.
      </p>
    </section>
  );
}
