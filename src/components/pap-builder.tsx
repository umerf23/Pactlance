"use client";
import {
  evidenceTypes,
  type PapProtocol,
  type WorkType,
} from "@/lib/pap/schema";
import { templateProtocol, templates } from "@/lib/pap/templates";
export function PapBuilder({
  value,
  count,
  onChange,
  allowEnable = true,
}: {
  value?: PapProtocol;
  count: number;
  onChange: (p: PapProtocol | undefined) => void;
  allowEnable?: boolean;
}) {
  const update = (patch: Partial<PapProtocol>) =>
    onChange({ ...value!, ...patch });
  return (
    <section className="editor-milestone">
      <h3>Programmable agreement protocol</h3>
      {allowEnable ? (
        <label className="check-label">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? templateProtocol("custom", count)
                  : undefined,
              )
            }
          />
          Use structured PAP terms
        </label>
      ) : null}
      {!value ? (
        <p className="muted">
          The existing escrow agreement uses one submission and its fixed
          on-chain timeout rules.
        </p>
      ) : (
        <>
          <p className="notice">
            PAP executes authenticated rules off-chain. This workflow does not
            transfer tokens. Payment eligibility requires a compatible escrow
            adapter. Templates are editable starting points and do not establish
            legal enforceability.
          </p>
          <label>
            Editable work template
            <select
              value={value.workType}
              onChange={(e) =>
                onChange(templateProtocol(e.target.value as WorkType, count))
              }
            >
              {templates.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label>
              Agreement time zone
              <input
                value={value.timeZone}
                onChange={(e) => update({ timeZone: e.target.value })}
              />
              <small>
                Use an IANA name, such as Asia/Karachi. Date inputs use your
                browser’s local zone; the preview shows the agreement zone.
              </small>
            </label>
            <label>
              Review timeout
              <select
                value={value.reviewTimeout}
                onChange={(e) =>
                  update({
                    reviewTimeout: e.target
                      .value as PapProtocol["reviewTimeout"],
                  })
                }
              >
                <option value="human_review">Require human review</option>
                <option value="payment_eligibility">
                  Agreed automatic acceptance / payment eligibility
                </option>
              </select>
            </label>
            <label>
              Cancellation
              <select
                value={value.cancellation}
                onChange={(e) =>
                  update({
                    cancellation: e.target.value as PapProtocol["cancellation"],
                  })
                }
              >
                <option value="mutual">Both participants must consent</option>
                <option value="mutual_before_start">
                  Both consent, before any work starts
                </option>
              </select>
            </label>
            <label>
              Rejection
              <select
                value={value.rejection}
                onChange={(e) =>
                  update({
                    rejection: e.target.value as PapProtocol["rejection"],
                  })
                }
              >
                <option value="revision_then_dispute">
                  Use available revisions, then dispute
                </option>
                <option value="dispute">Escalate directly to dispute</option>
              </select>
            </label>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={value.requireReviewNotice}
              onChange={(e) =>
                update({ requireReviewNotice: e.target.checked })
              }
            />
            Automatic acceptance requires the client’s authenticated review
            acknowledgement
          </label>
          <p className="muted">
            Revisions never extend delivery or the original review deadline. A
            dispute requires the named reviewer, then the backup after the
            agreed delay. Allocations are restricted to the original
            participants.
          </p>
          {value.milestones.map((m, i) => {
            const setMilestone = (patch: Partial<typeof m>) =>
              update({
                milestones: value.milestones.map((old, j) =>
                  j === i ? { ...old, ...patch } : old,
                ),
              });
            return (
              <section className="editor-milestone" key={i}>
                <h4>Milestone {i + 1} protocol</h4>
                <div className="form-grid">
                  <label>
                    Review hours
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={m.reviewHours}
                      onChange={(e) =>
                        setMilestone({ reviewHours: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Permitted revisions
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={m.revisionLimit}
                      onChange={(e) =>
                        setMilestone({ revisionLimit: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
                {m.deliverables.map((d, j) => {
                  const setDeliverable = (patch: Partial<typeof d>) =>
                    setMilestone({
                      deliverables: m.deliverables.map((old, k) =>
                        k === j ? { ...old, ...patch } : old,
                      ),
                    });
                  return (
                    <div className="editor-milestone" key={d.id}>
                      <label>
                        Deliverable title
                        <input
                          value={d.title}
                          onChange={(e) =>
                            setDeliverable({ title: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Measurable acceptance criteria (one per line)
                        <textarea
                          value={d.acceptanceCriteria.join("\n")}
                          onChange={(e) =>
                            setDeliverable({
                              acceptanceCriteria: e.target.value.split("\n"),
                            })
                          }
                        />
                      </label>
                      <fieldset>
                        <legend>Required evidence</legend>
                        {evidenceTypes.map((type) => (
                          <label key={type} className="check-label">
                            <input
                              type="checkbox"
                              checked={d.requiredEvidenceTypes.includes(type)}
                              onChange={(e) =>
                                setDeliverable({
                                  requiredEvidenceTypes: e.target.checked
                                    ? [...d.requiredEvidenceTypes, type]
                                    : d.requiredEvidenceTypes.filter(
                                        (t) => t !== type,
                                      ),
                                })
                              }
                            />
                            {type}
                          </label>
                        ))}
                      </fieldset>
                      <button
                        type="button"
                        className="text-button"
                        disabled={m.deliverables.length === 1}
                        onClick={() =>
                          setMilestone({
                            deliverables: m.deliverables.filter(
                              (_, k) => k !== j,
                            ),
                          })
                        }
                      >
                        Remove deliverable
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="secondary"
                  disabled={m.deliverables.length >= 12}
                  onClick={() =>
                    setMilestone({
                      deliverables: [
                        ...m.deliverables,
                        {
                          id: crypto.randomUUID().replaceAll("-", ""),
                          title: "New deliverable",
                          acceptanceCriteria: [
                            "Define an objectively testable acceptance criterion.",
                          ],
                          requiredEvidenceTypes: ["link"],
                        },
                      ],
                    })
                  }
                >
                  Add deliverable
                </button>
              </section>
            );
          })}
          <details>
            <summary>Advanced bounded rules</summary>
            <p>
              Rules can require human review, request information or open a
              dispute when the review expires. They cannot execute code or
              transfer funds.
            </p>
            {value.rules.map((r, i) => (
              <div className="form-grid" key={r.id}>
                <label>
                  When
                  <select
                    value={r.when.fact}
                    onChange={(e) =>
                      update({
                        rules: value.rules.map((old, j) =>
                          i === j
                            ? {
                                ...old,
                                when: {
                                  ...old.when,
                                  fact: e.target.value as typeof r.when.fact,
                                },
                              }
                            : old,
                        ),
                      })
                    }
                  >
                    {[
                      "review_elapsed",
                      "evidence_missing",
                      "revision_exhausted",
                      "submission_late",
                    ].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Action
                  <select
                    value={r.action}
                    onChange={(e) =>
                      update({
                        rules: value.rules.map((old, j) =>
                          i === j
                            ? {
                                ...old,
                                action: e.target.value as typeof r.action,
                              }
                            : old,
                        ),
                      })
                    }
                  >
                    {[
                      "require_human_review",
                      "request_information",
                      "open_dispute",
                    ].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    update({ rules: value.rules.filter((_, j) => i !== j) })
                  }
                >
                  Remove rule
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={value.rules.length >= 12}
              onClick={() =>
                update({
                  rules: [
                    ...value.rules,
                    {
                      id: crypto.randomUUID().replaceAll("-", ""),
                      when: {
                        fact: "review_elapsed",
                        operator: "is",
                        value: true,
                      },
                      action: "require_human_review",
                    },
                  ],
                })
              }
            >
              Add rule
            </button>
          </details>
        </>
      )}
    </section>
  );
}
