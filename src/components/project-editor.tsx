"use client";
import { useState } from "react";
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
  function field<K extends keyof AgreementInput>(
    key: K,
    value: AgreementInput[K],
  ) {
    setForm((old) => ({ ...old, [key]: value }));
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
                  !!initial &&
                  (key === "clientWallet" || key === "freelancerWallet")
                }
                value={form[key]}
                onChange={(e) => field(key, e.target.value)}
              />
            </label>
          ))}
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
        <h3>Sequential milestones</h3>
        <p className="muted">
          Only one milestone can be funded at a time. Dates use your browser’s
          local timezone and are stored in UTC.
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
              Acceptance criteria
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
          No deposits in Phase 3. Before funding, a later version must specify
          the deployed program and test-token mint and be accepted again.
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
