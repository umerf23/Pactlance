import type { AgreementRecord } from "@/lib/agreements/schema";
import { canonicalJSON } from "@/lib/agreements/crypto";
import { formatTokenAmount } from "@/lib/domain";
export function PapPreview({
  record,
  previous,
}: {
  record: AgreementRecord;
  previous?: AgreementRecord;
}) {
  const p = record.terms.protocol;
  if (!p) return null;
  const changed = previous
    ? Object.keys(record.terms).filter(
        (key) =>
          canonicalJSON(
            (record.terms as unknown as Record<string, unknown>)[key],
          ) !==
          canonicalJSON(
            (previous.terms as unknown as Record<string, unknown>)[key] ?? null,
          ),
      )
    : [];
  return (
    <section>
      <h2>Programmable terms · protocol v{p.version}</h2>
      <p>
        Total agreed amount:{" "}
        {formatTokenAmount(
          record.terms.milestones.reduce(
            (sum, m) => sum + BigInt(m.amountUnits),
            0n,
          ),
        )}{" "}
        TEST (no monetary value)
      </p>
      <p className="notice">
        Authenticated off-chain execution. No token transfers are enabled for
        these configurable policies. A canonical hash identifies exact terms; it
        does not prove legal enforceability.
      </p>
      <dl className="term-list">
        {record.terms.creatorWallet ? (
          <div>
            <dt>Version proposer</dt>
            <dd>
              <code>{record.terms.creatorWallet}</code>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Work / time zone</dt>
          <dd>
            {p.workType} · {p.timeZone}
          </dd>
        </div>
        <div>
          <dt>Review expiry</dt>
          <dd>
            {p.reviewTimeout === "human_review"
              ? "Human review required"
              : "Agreed automatic acceptance, payment eligibility only"}
            ;{" "}
            {p.requireReviewNotice
              ? "client acknowledgement required"
              : "no acknowledgement requirement"}
          </dd>
        </div>
        <div>
          <dt>Cancellation</dt>
          <dd>{p.cancellation}</dd>
        </div>
        <div>
          <dt>Rejection</dt>
          <dd>{p.rejection}</dd>
        </div>
        <div>
          <dt>Dispute</dt>
          <dd>
            Primary reviewer; backup after {record.terms.backupDelayHours}{" "}
            hours. Allocations only to original participants.
          </dd>
        </div>
      </dl>
      {p.milestones.map((m, i) => (
        <article className="editor-milestone" key={i}>
          <h3>{record.terms.milestones[i].title}</h3>
          <p>
            Due{" "}
            {new Intl.DateTimeFormat("en", {
              timeZone: p.timeZone,
              dateStyle: "medium",
              timeStyle: "short",
            }).format(
              new Date(record.terms.milestones[i].deliveryDeadline),
            )}{" "}
            · {m.reviewHours} review hours · {m.revisionLimit} revisions
          </p>
          {m.deliverables.map((d) => (
            <section key={d.id}>
              <h4>{d.title}</h4>
              <ul>
                {d.acceptanceCriteria.map((c, j) => (
                  <li key={j}>{c}</li>
                ))}
              </ul>
              <p>Required evidence: {d.requiredEvidenceTypes.join(", ")}</p>
            </section>
          ))}
        </article>
      ))}
      <p>
        Revisions preserve the original delivery and review deadlines. Disputed
        work never becomes payable from a timer.
      </p>
      {p.rules.length ? (
        <>
          <h3>Bounded review rules</h3>
          <ul>
            {p.rules.map((r) => (
              <li key={r.id}>
                {r.id}: when {r.when.fact} is {String(r.when.value)}, {r.action}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {previous ? (
        <details>
          <summary>Compare with version {previous.version}</summary>
          <p>Changed fields: {changed.join(", ") || "None"}</p>
          {changed
            .filter((k) => !["version", "protocol", "milestones"].includes(k))
            .map((k) => (
              <div key={k}>
                <strong>{k}</strong>
                <pre>
                  {canonicalJSON(
                    (previous.terms as unknown as Record<string, unknown>)[k] ??
                      null,
                  )}
                </pre>
                <p>Changes to</p>
                <pre>
                  {canonicalJSON(
                    (record.terms as unknown as Record<string, unknown>)[k],
                  )}
                </pre>
              </div>
            ))}
          {["milestones", "protocol"]
            .filter((k) => changed.includes(k))
            .map((k) => (
              <details key={k}>
                <summary>{k}: previous / proposed structured terms</summary>
                <pre>
                  {JSON.stringify(
                    (previous.terms as unknown as Record<string, unknown>)[k] ??
                      null,
                    null,
                    2,
                  )}
                </pre>
                <pre>
                  {JSON.stringify(
                    (record.terms as unknown as Record<string, unknown>)[k],
                    null,
                    2,
                  )}
                </pre>
              </details>
            ))}
        </details>
      ) : null}
    </section>
  );
}
