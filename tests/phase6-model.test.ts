import { it, expect } from "vitest";
import bs58 from "bs58";
import {
  evidenceCommitment,
  evidenceInput,
  evidencePath,
  MAX_FILE_BYTES,
} from "../src/lib/evidence/schema";
import {
  reviewerEligible,
  reminders,
  explorerURL,
  type MilestoneCache,
} from "../src/lib/operations/model";
const now = Date.parse("2026-10-08T12:00:00Z");
const m: MilestoneCache = {
  payment_profile: "legacy",
  project_id: "10000000-0000-4000-8000-000000000001",
  agreement_version: 1,
  milestone_index: 0,
  chain_address: "chain",
  state: "disputed",
  amount_units: "18446744073709551615",
  client_refunded: "0",
  freelancer_paid: "0",
  delivery_deadline: new Date(now).toISOString(),
  review_deadline: null,
  backup_at: new Date(now + 1).toISOString(),
  reviewer_wallet: "primary",
  backup_reviewer_wallet: "backup",
  verified_at: new Date(now).toISOString(),
  finalized_slot: 1,
};
it("binds evidence content and salt in a canonical commitment", async () => {
  const salt = "a".repeat(64);
  expect(await evidenceCommitment({ a: 1, b: 2 }, salt)).toBe(
    await evidenceCommitment({ b: 2, a: 1 }, salt),
  );
  expect(await evidenceCommitment({ a: 2 }, salt)).not.toBe(
    await evidenceCommitment({ a: 1 }, salt),
  );
  expect(await evidenceCommitment({ a: 1 }, "b".repeat(64))).not.toBe(
    await evidenceCommitment({ a: 1 }, salt),
  );
  await expect(evidenceCommitment({}, "bad")).rejects.toThrow();
});
it("rejects unsafe links, path traversal, oversize files and unexpected input", () => {
  const base = {
    projectId: m.project_id,
    version: 1,
    index: 0,
    purpose: "delivery",
    title: "Proof",
    note: "",
  };
  for (const url of [
    "http://example.com",
    "javascript:alert(1)",
    "https://user:pass@example.com",
  ])
    expect(
      evidenceInput.safeParse({ ...base, attachment: { kind: "link", url } })
        .success,
    ).toBe(false);
  expect(
    evidenceInput.safeParse({
      ...base,
      attachment: { kind: "link", url: "https://example.com/proof" },
    }).success,
  ).toBe(true);
  const file = {
    kind: "file",
    filename: "proof.txt",
    mimeType: "text/plain",
    byteSize: 4,
    fileHash: "a".repeat(64),
  };
  for (const attachment of [
    { ...file, filename: "../secret" },
    { ...file, byteSize: MAX_FILE_BYTES + 1 },
    { ...file, fileHash: "bad" },
  ])
    expect(evidenceInput.safeParse({ ...base, attachment }).success).toBe(
      false,
    );
  expect(() => evidencePath(m.project_id, "../path")).toThrow();
});
it("matches exclusive handoff boundaries and fails closed on stale or malformed cache", () => {
  expect(reviewerEligible(m, "primary", now)).toBe(true);
  expect(reviewerEligible(m, "backup", now)).toBe(false);
  expect(reviewerEligible(m, "primary", now + 1)).toBe(false);
  expect(reviewerEligible(m, "backup", now + 1)).toBe(true);
  expect(
    reviewerEligible(
      { ...m, verified_at: new Date(now - 120001).toISOString() },
      "primary",
      now,
    ),
  ).toBe(false);
  expect(reviewerEligible({ ...m, backup_at: "invalid" }, "backup", now)).toBe(
    false,
  );
});
it("changes notice receipts when deadline state changes and omits settled milestones", async () => {
  const funded = {
    ...m,
    state: "funded" as const,
    delivery_deadline: new Date(now + 1).toISOString(),
  };
  const before = await reminders([funded], "client", now),
    after = await reminders([funded], "client", now + 1);
  expect(before[0].key).not.toBe(after[0].key);
  expect(await reminders([{ ...m, state: "settled" }], "client", now)).toEqual(
    [],
  );
  expect(
    (await reminders([{ ...m, verified_at: "invalid" }], "client", now))[0]
      .stale,
  ).toBe(true);
});
it("creates only valid fixed-cluster explorer links", () => {
  expect(explorerURL("javascript:alert(1)")).toBeNull();
  expect(explorerURL(bs58.encode(new Uint8Array(64).fill(2)))).toContain(
    "?cluster=devnet",
  );
  expect(explorerURL(bs58.encode(new Uint8Array(32)))).toBeNull();
});

it("never suggests timed claims or automatic refunds for PAP or unknown profiles", async () => {
  for (const state of ["funded", "submitted"] as const) {
    const row = {
      ...m,
      state,
      review_deadline: new Date(now - 1).toISOString(),
      payment_profile: "pap_explicit_v1" as const,
    };
    const notice = (await reminders([row], "client", now))[0];
    expect(notice.message).not.toMatch(
      /payment claim may be eligible|non-delivery refund may be eligible/i,
    );
    expect(
      (
        await reminders([{ ...row, payment_profile: "unknown" }], "client", now)
      )[0].message,
    ).toContain("unverified");
  }
});
