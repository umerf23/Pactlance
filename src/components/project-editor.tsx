"use client";
import { useState } from "react";
import { PapBuilder } from "./pap-builder";
import { templateProtocol } from "@/lib/pap/templates";
import { agreementInput, type AgreementInput } from "@/lib/agreements/schema";
type Props = {
  wallet: string;
  initial?: AgreementInput;
  onSave: (agreement: AgreementInput) => Promise<void>;
  onCancel: () => void;
};
function blankMilestone() {
  return {
    title: "",
    scope: "",
    acceptanceCriteria: "",
    amount: "250",
    fundingDeadline: "",
    deliveryDeadline: "",
  };
}
function localDate(iso: string) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function isoDate(value: string) {
  return value ? new Date(value).toISOString() : "";
}
export function ProjectEditor({ wallet, initial, onSave, onCancel }: Props) {
  const [form, setForm] = useState<AgreementInput>(
    () =>
      initial ?? {
        title: "",
        scope: "",
        clientWallet: "",
        freelancerWallet: wallet,
        reviewerWallet: "",
        backupReviewerWallet: "",
        reviewHours: 72,
        backupDelayHours: 168,
        milestones: [blankMilestone(), blankMilestone()],
      },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState<"freelancer" | "client">("freelancer");
  const [reviewersAgreed, setReviewersAgreed] = useState(false);
  function chooseRole(next: "freelancer" | "client") {
    setRole(next);
    setForm((old) => ({
      ...old,
      clientWallet:
        next === "client"
          ? wallet
          : old.clientWallet === wallet
            ? ""
            : old.clientWallet,
      freelancerWallet:
        next === "freelancer"
          ? wallet
          : old.freelancerWallet === wallet
            ? ""
            : old.freelancerWallet,
    }));
  }
  function useEditingTemplate() {
    setForm((old) => ({
      ...old,
      protocol: undefined,
      title: "Video editing agreement",
      scope:
        "Edit a batch of client-supplied videos using the agreed brand assets and reference style. Review and customize these terms together before accepting.",
      milestones: [
        {
          ...blankMilestone(),
          title: "First video batch",
          scope:
            "Deliver five edited videos from the supplied footage, including captions and the agreed end card.",
          acceptanceCriteria:
            "Five MP4 files, 1080p, with readable captions, balanced audio and the agreed brand assets. Confirm exact lengths and any permitted revisions before signing.",
        },
      ],
    }));
  }
  function field<K extends keyof AgreementInput>(
    key: K,
    value: AgreementInput[K],
  ) {
    setForm((old) => {
      const next = { ...old, [key]: value };
      if (key === "milestones" && old.protocol) {
        const milestones = value as AgreementInput["milestones"];
        next.protocol = {
          ...old.protocol,
          milestones: milestones.map((m) => {
            const index = old.milestones.indexOf(m);
            return index >= 0
              ? old.protocol!.milestones[index]
              : templateProtocol(old.protocol!.workType).milestones[0];
          }),
        };
      }
      return next;
    });
  }
  function milestoneField(
    index: number,
    key: keyof AgreementInput["milestones"][number],
    value: string,
  ) {
    setForm((old) => ({
      ...old,
      milestones: old.milestones.map((m, i) =>
        i === index ? { ...m, [key]: value } : m,
      ),
    }));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!reviewersAgreed) {
      setError(
        "Confirm that both reviewers have agreed to serve before saving.",
      );
      return;
    }
    const parsed = agreementInput.safeParse(form);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
      return;
    }
    setBusy(true);
    try {
      await onSave(parsed.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="workspace-card editor" onSubmit={submit}>
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">SHARED TERMS</p>
          <h2>{initial ? "Propose a new version" : "Create a project"}</h2>
        </div>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="muted">
        Define each batch before work begins. Saving creates a new immutable
        version; both wallets must sign it separately.
      </p>
      <fieldset disabled={busy}>
        {!initial ? (
          <>
            <label>
              Your role in this project
              <select
                value={role}
                onChange={(event) =>
                  chooseRole(event.target.value as "client" | "freelancer")
                }
              >
                <option value="freelancer">
                  Freelancer — I deliver the work
                </option>
                <option value="client">Client — I fund the work</option>
              </select>
            </label>
            <details>
              <summary>Start with an editable video-editing template</summary>
              <p>
                This replaces your current scope and milestones. Amounts and
                terms are examples; agree on your own scope and deadlines.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={useEditingTemplate}
              >
                Use video-editing template
              </button>
            </details>
          </>
        ) : null}
        <label>
          Project title
          <input
            required
            maxLength={120}
            value={form.title}
            onChange={(e) => field("title", e.target.value)}
          />
        </label>
        <label>
          Overall scope
          <textarea
            required
            minLength={10}
            maxLength={8000}
            value={form.scope}
            onChange={(e) => field("scope", e.target.value)}
          />
        </label>
        <div className="form-grid">
          {(
            [
              ["clientWallet", "Client wallet"],
              ["freelancerWallet", "Freelancer wallet"],
              ["reviewerWallet", "Primary reviewer wallet"],
              ["backupReviewerWallet", "Backup reviewer wallet"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                required
                spellCheck={false}
                autoComplete="off"
                readOnly={
                  (!!initial &&
                    (key === "clientWallet" || key === "freelancerWallet")) ||
                  (!initial &&
                    key ===
                      (role === "client" ? "clientWallet" : "freelancerWallet"))
                }
                value={form[key]}
                onChange={(e) => field(key, e.target.value)}
              />
            </label>
          ))}
          {!form.protocol ? (
            <label>
              Review window (hours)
              <input
                type="number"
                min={1}
                max={720}
                required
                value={form.reviewHours}
                onChange={(e) => field("reviewHours", Number(e.target.value))}
              />
            </label>
          ) : null}
          <label>
            Backup activates after dispute (hours)
            <input
              type="number"
              min={1}
              max={2160}
              required
              value={form.backupDelayHours}
              onChange={(e) =>
                field("backupDelayHours", Number(e.target.value))
              }
            />
          </label>
        </div>
        <p className="muted">
          Use four distinct Solana wallets. Contact both reviewers before naming
          them; agree on availability, response time and any fee. Naming a
          wallet does not prove its owner has agreed to review.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            checked={reviewersAgreed}
            onChange={(event) => setReviewersAgreed(event.target.checked)}
          />
          {form.protocol
            ? "Both reviewers have agreed to serve. PAP decisions are recorded off-chain and cannot transfer funds."
            : "Both reviewers have agreed to serve, and I understand disputed funds may stay locked if nobody resolves the dispute."}
        </label>
        <PapBuilder
          value={form.protocol}
          count={form.milestones.length}
          allowEnable={!initial}
          onChange={(p) => field("protocol", p)}
        />
        <h3>Sequential milestones</h3>
        <p className="muted">
          Milestones execute in order. Dates use your browser’s local timezone
          and are stored in UTC.
        </p>
        {form.milestones.map((m, i) => (
          <section className="editor-milestone" key={i}>
            <div className="workspace-heading">
              <h4>Milestone {i + 1}</h4>
              <button
                className="text-button"
                type="button"
                disabled={form.milestones.length === 1}
                onClick={() =>
                  field(
                    "milestones",
                    form.milestones.filter((_, j) => i !== j),
                  )
                }
              >
                Remove
              </button>
            </div>
            <div className="form-grid">
              <label>
                Milestone title
                <input
                  required
                  value={m.title}
                  onChange={(e) => milestoneField(i, "title", e.target.value)}
                />
              </label>
              <label>
                Amount (TEST, no real value)
                <input
                  required
                  inputMode="decimal"
                  value={m.amount}
                  onChange={(e) => milestoneField(i, "amount", e.target.value)}
                />
              </label>
            </div>
            <label>
              Deliverables
              <textarea
                required
                minLength={10}
                value={m.scope}
                onChange={(e) => milestoneField(i, "scope", e.target.value)}
              />
            </label>
            <label>
              {form.protocol
                ? "Additional milestone-wide acceptance criteria (all apply)"
                : "Acceptance criteria"}
              <textarea
                required
                minLength={10}
                value={m.acceptanceCriteria}
                onChange={(e) =>
                  milestoneField(i, "acceptanceCriteria", e.target.value)
                }
              />
            </label>
            <div className="form-grid">
              <label>
                Funding closes
                <input
                  type="datetime-local"
                  required
                  value={localDate(m.fundingDeadline)}
                  onChange={(e) =>
                    milestoneField(
                      i,
                      "fundingDeadline",
                      isoDate(e.target.value),
                    )
                  }
                />
              </label>
              <label>
                Delivery due
                <input
                  type="datetime-local"
                  required
                  value={localDate(m.deliveryDeadline)}
                  onChange={(e) =>
                    milestoneField(
                      i,
                      "deliveryDeadline",
                      isoDate(e.target.value),
                    )
                  }
                />
              </label>
            </div>
          </section>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={form.milestones.length >= 20}
          onClick={() =>
            field("milestones", [...form.milestones, blankMilestone()])
          }
        >
          + Add milestone
        </button>
        <p className="notice">
          {form.protocol ? (
            "PAP saves shared terms and makes no deposit. Rule execution and payment eligibility are off-chain; token transfers are unavailable for this policy profile."
          ) : (
            <>
              Saving creates shared terms and makes no deposit. In Payment
              actions, create the escrow and have both participants accept the
              deployed program-bound terms before funding. TEST tokens have no
              monetary value.
            </>
          )}
        </p>
        {error ? (
          <p role="alert" className="error-message">
            {error}
          </p>
        ) : null}
        <button className="primary" type="submit" disabled={busy}>
          {busy
            ? "Saving…"
            : initial
              ? "Save new version"
              : "Save project agreement"}
        </button>
      </fieldset>
    </form>
  );
}
