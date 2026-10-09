import { it, expect } from "vitest";
import { transition, type Facts } from "../src/lib/pap/engine";
import {
  papProtocol,
  papCommand,
  type PapCommand,
} from "../src/lib/pap/schema";
import { agreementInput } from "../src/lib/agreements/schema";
import { agreementCommitment } from "../src/lib/agreements/crypto";
import { bindAgreement } from "../src/lib/escrow/terms";
import { templates, templateProtocol } from "../src/lib/pap/templates";
import { input, project, terms, wallets } from "./pap-fixture";
const evidence = "20000000-0000-4000-8000-000000000001";
const command = (
  action: PapCommand["action"],
  extra: Partial<PapCommand> = {},
): PapCommand => ({
  projectId: project,
  version: 1,
  expectedRevision: 0,
  idempotencyKey: evidence,
  action,
  milestoneIndex: 0,
  reason: "Explicitly reviewed transition",
  ...extra,
});
const facts = (
  actor = wallets[0],
  now = "2030-01-02T00:00:00.000Z",
): Facts => ({
  actor,
  now,
  bothAccepted: true,
  evidence: {
    [evidence]: { type: "text/plain", deliverableId: "deliverable-1" },
  },
});
function active() {
  return transition(terms(), null, command("activate"), facts()).state;
}
function submitted() {
  let s = active();
  s = transition(terms(), s, command("start"), facts(wallets[1])).state;
  return transition(
    terms(),
    s,
    command("submit", {
      deliveries: [{ deliverableId: "deliverable-1", evidenceIds: [evidence] }],
    }),
    facts(wallets[1]),
  ).state;
}
it("validates all editable templates and rejects arbitrary rules", () => {
  for (const t of templates)
    expect(papProtocol.safeParse(templateProtocol(t.id)).success).toBe(true);
  for (const change of [
    { timeZone: "Bad/Zone" },
    {
      rules: [
        {
          id: "injection",
          when: { fact: "review_elapsed", operator: "eval", value: true },
          action: "transfer",
        },
      ],
    },
    { milestones: [] },
    {
      rules: Array.from({ length: 13 }, (_, i) => ({
        id: `r${i}`,
        when: { fact: "review_elapsed", operator: "is", value: true },
        action: "open_dispute",
      })),
    },
  ])
    expect(
      papProtocol.safeParse({ ...input.protocol, ...change }).success,
    ).toBe(false);
  expect(
    papCommand.safeParse({ ...command("accept"), clientRefundUnits: "1.2" })
      .success,
  ).toBe(false);
});
it("keeps exact amounts and normalizes new PAP strings before hashing", async () => {
  const a = agreementInput.parse({ ...input, title: "Cafe\u0301 agreement" }),
    b = agreementInput.parse({ ...input, title: "Caf\u00e9 agreement" });
  expect(await agreementCommitment(a, "salt")).toBe(
    await agreementCommitment(b, "salt"),
  );
  expect(terms().milestones[0].amountUnits).toBe("100123456");
});
it("requires both exact-version signatures and participant authorization", () => {
  expect(() =>
    transition(terms(), null, command("activate"), {
      ...facts(),
      bothAccepted: false,
    }),
  ).toThrow(/Both/);
  expect(() =>
    transition(terms(), null, command("activate"), facts(wallets[4])),
  ).toThrow(/Both/);
  expect(() =>
    transition(terms(), null, command("activate", { version: 2 }), facts()),
  ).toThrow(/Stale/);
  expect(() =>
    transition(terms(), active(), command("start"), facts()),
  ).toThrow(/freelancer/);
});
it("verifies evidence and rejects missing, wrong-type and late submissions", () => {
  const s = transition(
    terms(),
    active(),
    command("start"),
    facts(wallets[1]),
  ).state;
  expect(() =>
    transition(terms(), s, command("submit"), facts(wallets[1])),
  ).toThrow(/every deliverable/);
  const c = command("submit", {
    deliveries: [{ deliverableId: "deliverable-1", evidenceIds: [evidence] }],
  });
  expect(() =>
    transition(terms(), s, c, { ...facts(wallets[1]), evidence: {} }),
  ).toThrow(/unavailable/);
  expect(() =>
    transition(terms(), s, c, {
      ...facts(wallets[1]),
      evidence: {
        [evidence]: { type: "link", deliverableId: "deliverable-1" },
      },
    }),
  ).toThrow(/Missing required/);
  expect(() =>
    transition(terms(), s, c, facts(wallets[1], "2030-02-02T00:00:00.000Z")),
  ).toThrow(/deadline/);
});
it("enforces revision limits and preserves the original clock", () => {
  const t = terms();
  t.protocol!.milestones[0].revisionLimit = 1;
  let s = transition(t, submitted(), command("request_changes"), facts()).state;
  expect(s.milestones[0].revisions).toBe(1);
  const before = s.milestones[0].reviewDueAt;
  s = transition(
    t,
    s,
    command("submit", {
      deliveries: [{ deliverableId: "deliverable-1", evidenceIds: [evidence] }],
    }),
    facts(wallets[1], "2030-01-03T00:00:00.000Z"),
  ).state;
  expect(s.milestones[0].reviewDueAt).toBe(before);
  expect(() => transition(t, s, command("request_changes"), facts())).toThrow(
    /exhausted/,
  );
});
it("defaults review expiry to human intervention without payment", () => {
  const r = transition(
    terms(),
    submitted(),
    command("evaluate"),
    facts(wallets[0], "2030-01-06T00:00:00.000Z"),
  );
  expect(r.state.milestones[0].state).toBe("UNDER_REVIEW");
  expect(r.state.milestones[0].humanReviewRequired).toBe(true);
  expect(r.state.milestones[0].acceptedAt).toBeUndefined();
});
it("automatic eligibility requires explicit policy and client acknowledgement", () => {
  const t = terms();
  t.protocol!.reviewTimeout = "payment_eligibility";
  let s = submitted();
  let r = transition(
    t,
    s,
    command("evaluate"),
    facts(wallets[0], "2030-01-06T00:00:00.000Z"),
  );
  expect(r.state.milestones[0].state).toBe("UNDER_REVIEW");
  expect(() =>
    transition(t, s, command("acknowledge_review"), facts(wallets[1])),
  ).toThrow(/client/);
  s = transition(t, s, command("acknowledge_review"), facts()).state;
  r = transition(
    t,
    s,
    command("evaluate"),
    facts(wallets[1], "2030-01-06T00:00:00.000Z"),
  );
  expect(r.state.milestones[0].state).toBe("PAYMENT_PENDING");
  expect(r.state.status).toBe("COMPLETED");
});
it("records rule IDs and prevents eligibility after a dispute", () => {
  const t = terms();
  t.protocol!.reviewTimeout = "payment_eligibility";
  t.protocol!.requireReviewNotice = false;
  t.protocol!.rules = [
    {
      id: "human-dispute",
      when: { fact: "review_elapsed", operator: "is", value: true },
      action: "open_dispute",
    },
  ];
  const r = transition(
    t,
    submitted(),
    command("evaluate"),
    facts(wallets[0], "2030-01-06T00:00:00.000Z"),
  );
  expect(r.ruleIds).toEqual(["human-dispute"]);
  expect(r.state.status).toBe("DISPUTED");
  expect(r.state.milestones[0].acceptedAt).toBeUndefined();
  expect(() => transition(t, r.state, command("evaluate"), facts())).toThrow(
    /submitted/,
  );
});
it("enforces exclusive reviewer handoff and exact original-party allocations", () => {
  const s = transition(terms(), submitted(), command("dispute"), facts()).state,
    c = command("resolve", { clientRefundUnits: "123456" });
  expect(() => transition(terms(), s, c, facts(wallets[3]))).toThrow(
    /authorized/,
  );
  expect(() =>
    transition(terms(), s, c, facts(wallets[2], "2030-01-04T00:00:00.000Z")),
  ).toThrow(/authorized/);
  expect(() =>
    transition(
      terms(),
      s,
      command("resolve", { clientRefundUnits: "100123457" }),
      facts(wallets[2]),
    ),
  ).toThrow(/exceeds/);
  const r = transition(
    terms(),
    s,
    c,
    facts(wallets[3], "2030-01-04T00:00:00.000Z"),
  );
  expect(r.state.milestones[0].allocation).toEqual({
    clientUnits: "123456",
    freelancerUnits: "100000000",
  });
  expect(r.state.milestones[0].state).toBe("PAYMENT_PENDING");
});
it("requires independent cancellation consent", () => {
  let s = transition(
    terms(),
    active(),
    command("request_cancel"),
    facts(),
  ).state;
  expect(() =>
    transition(terms(), s, command("approve_cancel"), facts()),
  ).toThrow(/other/);
  s = transition(
    terms(),
    s,
    command("approve_cancel"),
    facts(wallets[1]),
  ).state;
  expect(s.status).toBe("CANCELLED");
  expect(() =>
    transition(terms(), s, command("start"), facts(wallets[1])),
  ).toThrow(/cancelled/);
});
it("cannot activate amendments over ongoing work or mutate earlier state", () => {
  const t = terms();
  t.version = 2;
  expect(() =>
    transition(t, submitted(), command("activate", { version: 2 }), facts()),
  ).toThrow(/ongoing/);
  const previous = active(),
    before = structuredClone(previous);
  transition(terms(), previous, command("start"), facts(wallets[1]));
  expect(previous).toEqual(before);
});
it("blocks PAP policies from the incompatible existing escrow", async () => {
  const t = terms(),
    salt = "a".repeat(64);
  await expect(
    bindAgreement(
      {
        project_id: project,
        version: 1,
        terms: t,
        salt,
        commitment: await agreementCommitment(t, salt),
        created_at: facts().now,
      },
      wallets[2],
      wallets[3],
    ),
  ).rejects.toThrow(/compatible escrow/);
});
it("cancellation preserves accepted milestones and cannot undo completed work", () => {
  const completed = transition(
    terms(),
    submitted(),
    command("accept"),
    facts(),
  ).state;
  expect(() =>
    transition(terms(), completed, command("request_cancel"), facts()),
  ).toThrow(/Completed/);
  const t = terms();
  t.milestones.push({
    ...t.milestones[0],
    id: `${project}:2`,
    sequence: 2,
    title: "Future guide",
    deliveryDeadline: "2030-03-01T00:00:00.000Z",
  });
  t.protocol!.milestones.push(structuredClone(t.protocol!.milestones[0]));
  const s = {
      ...completed,
      status: "ACTIVE" as const,
      milestones: [
        completed.milestones[0],
        { state: "PENDING" as const, revisions: 0 },
      ],
    },
    proposed = transition(t, s, command("request_cancel"), facts()).state,
    cancelled = transition(
      t,
      proposed,
      command("approve_cancel"),
      facts(wallets[1]),
    ).state;
  expect(cancelled.milestones[0]).toEqual(completed.milestones[0]);
  expect(cancelled.milestones[1].state).toBe("CANCELLED");
});
