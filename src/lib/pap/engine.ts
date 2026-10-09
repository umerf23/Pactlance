import type { AgreementTerms } from "../agreements/schema";
import type { PapCommand } from "./schema";
export type MilestoneState =
  | "PENDING"
  | "IN_PROGRESS"
  | "UNDER_REVIEW"
  | "CHANGES_REQUESTED"
  | "ACCEPTED"
  | "DISPUTED"
  | "PAYMENT_PENDING"
  | "CANCELLED";
export interface MilestoneExecution {
  state: MilestoneState;
  revisions: number;
  submittedAt?: string;
  reviewDueAt?: string;
  reviewAcknowledgedAt?: string;
  acceptedAt?: string;
  disputedAt?: string;
  humanReviewRequired?: boolean;
  deliveries?: PapCommand["deliveries"];
  allocation?: { clientUnits: string; freelancerUnits: string };
}
export interface Execution {
  version: number;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED" | "DISPUTED";
  milestones: MilestoneExecution[];
  cancelRequestedBy?: string;
  activatedAt: string;
}
export interface Facts {
  now: string;
  actor: string;
  bothAccepted: boolean;
  evidence: Record<string, { type: string; deliverableId: string }>;
}
export interface Transition {
  state: Execution;
  reason: string;
  ruleIds: string[];
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function transition(
  terms: AgreementTerms,
  previous: Execution | null,
  command: PapCommand,
  facts: Facts,
): Transition {
  assert(terms.protocol, "This agreement does not use PAP");
  const p = terms.protocol,
    now = Date.parse(facts.now);
  assert(Number.isFinite(now), "Invalid execution timestamp");
  const client = facts.actor === terms.clientWallet,
    freelancer = facts.actor === terms.freelancerWallet,
    participant = client || freelancer,
    state = previous ? structuredClone(previous) : null;
  const result = (
    next: Execution,
    reason: string,
    ruleIds: string[] = [],
  ): Transition => ({ state: next, reason, ruleIds });
  if (command.action === "activate") {
    assert(
      participant && facts.bothAccepted,
      "Both participants must sign the exact version before activation",
    );
    assert(command.version === terms.version, "Stale agreement version");
    assert(
      !state || state.version < terms.version,
      "Agreement is already active",
    );
    assert(
      !state || state.status !== "CANCELLED",
      "Cancelled agreements cannot be reactivated",
    );
    assert(
      !state ||
        state.milestones.every((m) =>
          ["PENDING", "ACCEPTED", "PAYMENT_PENDING"].includes(m.state),
        ),
      "Resolve ongoing work before activating an amendment",
    );
    assert(
      terms.milestones.every(
        (m, i) =>
          state?.milestones[i]?.acceptedAt ||
          Date.parse(m.deliveryDeadline) > now,
      ),
      "Unfinished delivery deadlines must be in the future",
    );
    return result(
      {
        version: terms.version,
        status: terms.milestones.every(
          (_, i) => !!state?.milestones[i]?.acceptedAt,
        )
          ? "COMPLETED"
          : "ACTIVE",
        activatedAt: facts.now,
        milestones: terms.milestones.map((_, i) =>
          state?.milestones[i]?.acceptedAt
            ? state.milestones[i]
            : { state: "PENDING", revisions: 0 },
        ),
      },
      "Both wallet signatures verified; version activated",
    );
  }
  assert(
    state &&
      state.version === command.version &&
      terms.version === command.version,
    "Use the active agreement version",
  );
  assert(state.status !== "CANCELLED", "Agreement is cancelled");
  if (
    command.action === "request_cancel" ||
    command.action === "approve_cancel"
  ) {
    assert(participant, "Only participants may agree cancellation");
    assert(state.status !== "COMPLETED", "Completed work cannot be cancelled");
    assert(
      !state.milestones.some((m) => m.state === "DISPUTED"),
      "Resolve disputes before cancellation",
    );
    assert(
      p.cancellation !== "mutual_before_start" ||
        state.milestones.every((m) => m.state === "PENDING"),
      "Cancellation is permitted only before work starts",
    );
    if (command.action === "request_cancel") {
      assert(!state.cancelRequestedBy, "Cancellation already proposed");
      state.cancelRequestedBy = facts.actor;
      return result(
        state,
        "Authenticated cancellation proposal; no token transfer",
      );
    }
    assert(
      state.cancelRequestedBy && state.cancelRequestedBy !== facts.actor,
      "The other participant must approve cancellation",
    );
    state.status = "CANCELLED";
    state.milestones.forEach((m) => {
      if (!m.acceptedAt) m.state = "CANCELLED";
    });
    return result(
      state,
      "Both participants consented to cancellation; settled allocations preserved",
    );
  }
  assert(command.milestoneIndex !== undefined, "Select a milestone");
  const index = command.milestoneIndex,
    m = state.milestones[index],
    mt = terms.milestones[index],
    policy = p.milestones[index];
  assert(m && mt && policy, "Milestone not found");
  assert(
    state.milestones
      .slice(0, index)
      .every((m) => m.acceptedAt || m.state === "CANCELLED"),
    "Complete preceding milestones first",
  );
  const open = ["IN_PROGRESS", "UNDER_REVIEW", "CHANGES_REQUESTED"].includes(
    m.state,
  );
  switch (command.action) {
    case "start":
      assert(
        freelancer && m.state === "PENDING",
        "Only the freelancer may start a pending milestone",
      );
      assert(
        now < Date.parse(mt.deliveryDeadline),
        "Delivery deadline elapsed",
      );
      m.state = "IN_PROGRESS";
      break;
    case "submit": {
      assert(
        freelancer && ["IN_PROGRESS", "CHANGES_REQUESTED"].includes(m.state),
        "Submission requires work in progress or an authorized revision",
      );
      assert(
        now <= Date.parse(mt.deliveryDeadline),
        "Submission deadline elapsed; request human resolution",
      );
      assert(
        command.deliveries?.length === policy.deliverables.length,
        "Provide evidence for every deliverable",
      );
      assert(
        new Set(command.deliveries.map((d) => d.deliverableId)).size ===
          command.deliveries.length,
        "Duplicate deliverable submissions",
      );
      for (const d of policy.deliverables) {
        const supplied = command.deliveries.find(
          (v) => v.deliverableId === d.id,
        );
        assert(supplied, "Missing deliverable evidence");
        const types = supplied.evidenceIds.map((id) => {
          const e = facts.evidence[id];
          assert(
            e && e.deliverableId === d.id,
            "Evidence is unavailable or does not belong to this delivery",
          );
          return e.type;
        });
        assert(
          d.requiredEvidenceTypes.every((t) => types.includes(t)),
          `Missing required evidence for ${d.title}`,
        );
      }
      m.deliveries = command.deliveries;
      m.state = "UNDER_REVIEW";
      if (!m.submittedAt) {
        m.submittedAt = facts.now;
        m.reviewDueAt = new Date(
          now + policy.reviewHours * 3600000,
        ).toISOString();
      }
      delete m.reviewAcknowledgedAt;
      delete m.humanReviewRequired;
      break;
    }
    case "acknowledge_review":
      assert(
        client && m.state === "UNDER_REVIEW",
        "Only the client may acknowledge a pending review",
      );
      m.reviewAcknowledgedAt = facts.now;
      break;
    case "request_changes":
      assert(
        client &&
          m.state === "UNDER_REVIEW" &&
          now < Date.parse(m.reviewDueAt!),
        "Changes require a client review within the agreed window",
      );
      assert(
        m.revisions < policy.revisionLimit,
        "Revision allowance exhausted; use dispute resolution",
      );
      m.revisions++;
      m.state = "CHANGES_REQUESTED";
      break;
    case "accept":
      assert(
        client && m.state === "UNDER_REVIEW",
        "Only the client may accept submitted work",
      );
      m.state = "PAYMENT_PENDING";
      m.acceptedAt = facts.now;
      delete m.humanReviewRequired;
      break;
    case "reject":
      assert(
        client && m.state === "UNDER_REVIEW",
        "Only the client may reject submitted work",
      );
      if (
        p.rejection === "revision_then_dispute" &&
        m.revisions < policy.revisionLimit &&
        now < Date.parse(m.reviewDueAt!)
      ) {
        m.revisions++;
        m.state = "CHANGES_REQUESTED";
      } else {
        m.state = "DISPUTED";
        m.disputedAt = facts.now;
      }
      break;
    case "dispute":
      assert(
        participant && (open || m.state === "PENDING"),
        "Only participants may dispute unsettled work",
      );
      m.state = "DISPUTED";
      m.disputedAt = facts.now;
      break;
    case "propose_refund":
      assert(
        client &&
          ["PENDING", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(m.state) &&
          now > Date.parse(mt.deliveryDeadline),
        "Non-delivery refund proposals require an elapsed deadline",
      );
      m.state = "DISPUTED";
      m.disputedAt = facts.now;
      break;
    case "resolve": {
      assert(
        m.state === "DISPUTED" && m.disputedAt,
        "An open dispute is required",
      );
      const backup =
        now >= Date.parse(m.disputedAt) + terms.backupDelayHours * 3600000;
      assert(
        facts.actor ===
          (backup ? terms.backupReviewerWallet : terms.reviewerWallet),
        "Only the currently authorized reviewer may resolve this dispute",
      );
      assert(
        command.clientRefundUnits !== undefined,
        "Specify an exact base-unit allocation",
      );
      const refund = BigInt(command.clientRefundUnits),
        amount = BigInt(mt.amountUnits);
      assert(refund <= amount, "Refund exceeds the milestone amount");
      m.allocation = {
        clientUnits: refund.toString(),
        freelancerUnits: (amount - refund).toString(),
      };
      m.state = "PAYMENT_PENDING";
      m.acceptedAt = facts.now;
      delete m.humanReviewRequired;
      break;
    }
    case "evaluate": {
      assert(
        participant && m.state === "UNDER_REVIEW",
        "Only participants may evaluate submitted work",
      );
      const elapsed = now >= Date.parse(m.reviewDueAt!);
      assert(elapsed, "Review window has not elapsed");
      const eligible =
        p.reviewTimeout === "payment_eligibility" &&
        (!p.requireReviewNotice || !!m.reviewAcknowledgedAt);
      if (eligible) {
        m.state = "PAYMENT_PENDING";
        m.acceptedAt = facts.now;
        delete m.humanReviewRequired;
      } else m.humanReviewRequired = true;
      const ruleIds: string[] = [],
        ruleFacts = {
          review_elapsed: elapsed,
          evidence_missing: !m.deliveries?.length,
          revision_exhausted: m.revisions >= policy.revisionLimit,
          submission_late:
            Date.parse(m.submittedAt!) > Date.parse(mt.deliveryDeadline),
        };
      for (const r of p.rules)
        if (ruleFacts[r.when.fact] === r.when.value) {
          ruleIds.push(r.id);
          if (r.action === "open_dispute") {
            m.state = "DISPUTED";
            m.disputedAt = facts.now;
            delete m.acceptedAt;
          }
          if (
            r.action === "require_human_review" ||
            r.action === "request_information"
          ) {
            m.humanReviewRequired = true;
            if (m.state !== "DISPUTED") {
              m.state = "UNDER_REVIEW";
              delete m.acceptedAt;
            }
          }
        }
      state.status = state.milestones.some((m) => m.state === "DISPUTED")
        ? "DISPUTED"
        : state.milestones.every((m) => !!m.acceptedAt)
          ? "COMPLETED"
          : "ACTIVE";
      return result(
        state,
        m.state === "PAYMENT_PENDING"
          ? "Agreed timeout prerequisites satisfied; payment eligible, no funds transferred"
          : "Human review required; no automatic payment",
        ruleIds,
      );
    }
    default:
      throw new Error("Unsupported action");
  }
  state.status = state.milestones.some((m) => m.state === "DISPUTED")
    ? "DISPUTED"
    : state.milestones.every((m) => !!m.acceptedAt)
      ? "COMPLETED"
      : "ACTIVE";
  return result(state, command.reason);
}
