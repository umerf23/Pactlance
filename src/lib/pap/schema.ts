import { z } from "zod";
const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .transform((v) => v.normalize("NFC"));
export const workTypes = [
  "website",
  "ui_ux",
  "graphic_design",
  "video",
  "ai_agent",
  "writing",
  "software",
  "custom",
] as const;
export const evidenceTypes = [
  "link",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "video/mp4",
  "application/zip",
  "text/plain",
] as const;
export const papRule = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    when: z
      .object({
        fact: z.enum([
          "review_elapsed",
          "evidence_missing",
          "revision_exhausted",
          "submission_late",
        ]),
        operator: z.literal("is"),
        value: z.boolean(),
      })
      .strict(),
    action: z.enum([
      "require_human_review",
      "request_information",
      "open_dispute",
      "mark_payment_eligible",
    ]),
  })
  .strict();
export const papProtocol = z
  .object({
    version: z.literal(1),
    serialization: z.literal("pactlance-pap-json-v1"),
    execution: z.literal("offchain_workflow"),
    workType: z.enum(workTypes),
    timeZone: z
      .string()
      .max(80)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Use an IANA time zone"),
    reviewTimeout: z.enum(["human_review", "payment_eligibility"]),
    requireReviewNotice: z.boolean(),
    cancellation: z.enum(["mutual", "mutual_before_start"]),
    rejection: z.enum(["dispute", "revision_then_dispute"]),
    dispute: z.literal("exclusive_primary_then_backup"),
    allocation: z.literal("original_participants_only"),
    milestones: z
      .array(
        z
          .object({
            deliverables: z
              .array(
                z
                  .object({
                    id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
                    title: text(3, 120),
                    acceptanceCriteria: z.array(text(10, 1000)).min(1).max(12),
                    requiredEvidenceTypes: z
                      .array(z.enum(evidenceTypes))
                      .min(1)
                      .max(7),
                  })
                  .strict(),
              )
              .min(1)
              .max(12),
            reviewHours: z.number().int().min(1).max(720),
            revisionLimit: z.number().int().min(0).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    rules: z.array(papRule).max(12),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (new Set(p.rules.map((r) => r.id)).size !== p.rules.length)
      ctx.addIssue({
        code: "custom",
        message: "Rule IDs must be unique",
        path: ["rules"],
      });
    p.milestones.forEach((m, i) => {
      if (
        new Set(m.deliverables.map((d) => d.id)).size !== m.deliverables.length
      )
        ctx.addIssue({
          code: "custom",
          message: "Deliverable IDs must be unique",
          path: ["milestones", i],
        });
      m.deliverables.forEach((d, j) => {
        if (
          new Set(d.requiredEvidenceTypes).size !==
          d.requiredEvidenceTypes.length
        )
          ctx.addIssue({
            code: "custom",
            message: "Evidence types must be unique",
            path: ["milestones", i, "deliverables", j],
          });
      });
    });
    p.rules.forEach((r, i) => {
      if (
        r.action === "mark_payment_eligible" &&
        (p.reviewTimeout !== "payment_eligibility" ||
          r.when.fact !== "review_elapsed" ||
          !r.when.value)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Payment eligibility requires an explicit elapsed-review policy",
          path: ["rules", i],
        });
    });
  });
export type PapProtocol = z.infer<typeof papProtocol>;
export type PapRule = z.infer<typeof papRule>;
export type WorkType = (typeof workTypes)[number];
export const papCommand = z
  .object({
    projectId: z.string().uuid(),
    version: z.number().int().positive(),
    expectedRevision: z.number().int().min(0),
    idempotencyKey: z.string().uuid(),
    action: z.enum([
      "activate",
      "start",
      "submit",
      "acknowledge_review",
      "request_changes",
      "accept",
      "reject",
      "evaluate",
      "dispute",
      "propose_refund",
      "request_cancel",
      "approve_cancel",
      "resolve",
    ]),
    milestoneIndex: z.number().int().min(0).max(19).optional(),
    reason: text(10, 2000),
    deliveries: z
      .array(
        z
          .object({
            deliverableId: z.string().regex(/^[a-z0-9_-]{1,40}$/),
            evidenceIds: z.array(z.string().uuid()).min(1).max(7),
          })
          .strict(),
      )
      .max(12)
      .optional(),
    clientRefundUnits: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,19})$/)
      .optional(),
  })
  .strict();
export type PapCommand = z.infer<typeof papCommand>;
export function normalizePapTerms<T>(value: T): T {
  if (typeof value === "string") return value.normalize("NFC") as T;
  if (Array.isArray(value)) return value.map(normalizePapTerms) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalizePapTerms(v)]),
    ) as T;
  return value;
}
