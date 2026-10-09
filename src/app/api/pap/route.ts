import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ApiError,
  failure,
  json,
  readJSON,
  requireSameOrigin,
  requireWallet,
} from "@/lib/api";
import { adminSupabase } from "@/lib/supabase/server";
import { papCommand } from "@/lib/pap/schema";
import { transition, type Execution, type Facts } from "@/lib/pap/engine";
import { agreementCommitment, canonicalJSON } from "@/lib/agreements/crypto";
import type { AgreementRecord } from "@/lib/agreements/schema";
import {
  evidenceCommitment,
  evidenceManifest,
  type EvidenceRecord,
} from "@/lib/evidence/schema";
async function context(id: string, wallet: string, version?: number) {
  const db = adminSupabase(),
    runtime = await db
      .from("agreement_execution")
      .select("*")
      .eq("project_id", id)
      .maybeSingle();
  if (runtime.error)
    throw new ApiError(
      503,
      "PAP migration is not installed or execution is unavailable.",
    );
  const project = await db
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (project.error || !project.data)
    throw new ApiError(404, "Project not found.");
  const v =
      version ?? runtime.data?.active_version ?? project.data.current_version,
    record = await db
      .from("agreements")
      .select("*")
      .eq("project_id", id)
      .eq("version", v)
      .maybeSingle();
  if (record.error || !record.data?.terms.protocol)
    throw new ApiError(404, "PAP agreement not found.");
  const agreement = record.data as AgreementRecord,
    participant = [
      project.data.client_wallet,
      project.data.freelancer_wallet,
    ].includes(wallet),
    state = runtime.data?.state as Execution | undefined;
  const reviewerIndices =
    state && state.version === v
      ? state.milestones.flatMap((m, i) =>
          m.state === "DISPUTED" &&
          m.disputedAt &&
          wallet ===
            (Date.now() >=
            Date.parse(m.disputedAt) +
              agreement.terms.backupDelayHours * 3600000
              ? agreement.terms.backupReviewerWallet
              : agreement.terms.reviewerWallet)
            ? [i]
            : [],
        )
      : [];
  if (!participant && !reviewerIndices.length)
    throw new ApiError(404, "Project not found.");
  if (
    (await agreementCommitment(agreement.terms, agreement.salt)) !==
    agreement.commitment
  )
    throw new ApiError(409, "Agreement integrity check failed.");
  return {
    db,
    agreement,
    runtime: runtime.data,
    participant,
    reviewerIndices,
    project: project.data,
  };
}
export async function GET(request: Request) {
  try {
    const auth = await requireWallet(),
      id = new URL(request.url).searchParams.get("project");
    if (!id) {
      const assigned = await auth.db
        .from("agreements")
        .select("project_id,version,terms")
        .order("created_at", { ascending: false })
        .limit(100);
      if (assigned.error)
        throw new ApiError(503, "PAP assignments unavailable.");
      const assignments = [];
      for (const a of assigned.data.filter(
        (a) =>
          a.terms.protocol &&
          ![a.terms.clientWallet, a.terms.freelancerWallet].includes(
            auth.wallet,
          ),
      )) {
        try {
          const c = await context(a.project_id, auth.wallet, a.version);
          assignments.push({
            projectId: a.project_id,
            version: a.version,
            terms: a.terms,
            revision: c.runtime?.revision,
            indices: c.reviewerIndices,
          });
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e;
        }
      }
      return json({ assignments });
    }
    if (!z.string().uuid().safeParse(id).success)
      throw new ApiError(404, "Project not found.");
    const c = await context(id, auth.wallet),
      timeline = await c.db
        .from("agreement_transitions")
        .select("*")
        .eq("project_id", id)
        .order("execution_revision", { ascending: false })
        .limit(100);
    if (timeline.error)
      throw new ApiError(503, "Agreement timeline unavailable.");
    return json({
      execution: c.participant
        ? c.runtime
        : {
            ...c.runtime,
            state: {
              ...c.runtime?.state,
              milestones: c.runtime?.state.milestones.map(
                (m: unknown, i: number) =>
                  c.reviewerIndices.includes(i) ? m : null,
              ),
            },
          },
      timeline: c.participant ? timeline.data : [],
      reviewerIndices: c.reviewerIndices,
      version: c.agreement.version,
      paymentExecution: false,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const auth = await requireWallet("write"),
      parsed = papCommand.safeParse(await readJSON(request));
    if (!parsed.success)
      throw new ApiError(
        400,
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
    const cmd = parsed.data,
      c = await context(cmd.projectId, auth.wallet, cmd.version);
    if (
      !c.participant &&
      (cmd.action !== "resolve" ||
        !c.reviewerIndices.includes(cmd.milestoneIndex ?? -1))
    )
      throw new ApiError(403, "This action is not permitted for your role.");
    const requestHash = createHash("sha256")
      .update(canonicalJSON(cmd))
      .digest("hex");
    const duplicate = async () => {
      const r = await c.db
        .from("agreement_transitions")
        .select("actor,request_hash,new_state,execution_revision")
        .eq("project_id", cmd.projectId)
        .eq("idempotency_key", cmd.idempotencyKey)
        .maybeSingle();
      if (r.error) throw new ApiError(503, "Execution history unavailable.");
      if (!r.data) return null;
      if (r.data.actor !== auth.wallet || r.data.request_hash !== requestHash)
        throw new ApiError(
          409,
          "Idempotency key was used for a different request.",
        );
      return {
        state: r.data.new_state,
        revision: r.data.execution_revision,
        duplicate: true,
      };
    };
    const prior = await duplicate();
    if (prior) return json(prior);
    if ((c.runtime?.revision ?? 0) !== cmd.expectedRevision)
      throw new ApiError(
        409,
        "Agreement execution changed. Refresh before retrying.",
      );
    const approvals = await c.db
      .from("agreement_acceptances")
      .select("wallet,commitment")
      .eq("project_id", cmd.projectId)
      .eq("version", cmd.version);
    if (approvals.error)
      throw new ApiError(503, "Consent records unavailable.");
    const facts: Facts = {
      now: new Date().toISOString(),
      actor: auth.wallet,
      bothAccepted: [
        c.agreement.terms.clientWallet,
        c.agreement.terms.freelancerWallet,
      ].every((w) =>
        approvals.data.some(
          (a) => a.wallet === w && a.commitment === c.agreement.commitment,
        ),
      ),
      evidence: {},
    };
    if (cmd.action === "submit")
      for (const delivery of cmd.deliveries ?? []) {
        const rows = await c.db
          .from("evidence")
          .select("*")
          .in("id", delivery.evidenceIds)
          .eq("project_id", cmd.projectId)
          .eq("agreement_version", cmd.version)
          .eq("milestone_index", cmd.milestoneIndex!)
          .eq("uploader_wallet", c.agreement.terms.freelancerWallet)
          .eq("purpose", "delivery")
          .eq("status", "ready");
        if (rows.error)
          throw new ApiError(503, "Evidence verification unavailable.");
        for (const raw of rows.data) {
          const e = raw as EvidenceRecord;
          if (
            !e.salt ||
            !e.commitment ||
            (await evidenceCommitment(evidenceManifest(e), e.salt)) !==
              e.commitment
          )
            throw new ApiError(409, "Evidence integrity check failed.");
          facts.evidence[e.id] = {
            type: e.kind === "link" ? "link" : e.mime_type!,
            deliverableId: delivery.deliverableId,
          };
        }
      }
    let next;
    try {
      next = transition(
        c.agreement.terms,
        c.runtime?.state ?? null,
        cmd,
        facts,
      );
    } catch (e) {
      const retry = await duplicate();
      if (retry) return json(retry);
      throw new ApiError(409, (e as Error).message);
    }
    const saved = await c.db.rpc("commit_pap_transition", {
      p_project: cmd.projectId,
      p_actor: auth.wallet,
      p_version: cmd.version,
      p_expected_revision: cmd.expectedRevision,
      p_idempotency_key: cmd.idempotencyKey,
      p_request_hash: requestHash,
      p_action: cmd.action,
      p_state: next.state,
      p_reason: next.reason,
      p_rule_ids: next.ruleIds,
    });
    if (saved.error) {
      const retry = await duplicate();
      if (retry) return json(retry);
      throw new ApiError(
        409,
        "Execution changed or consent is stale. Refresh before retrying.",
      );
    }
    return json(saved.data);
  } catch (e) {
    return failure(e);
  }
}
