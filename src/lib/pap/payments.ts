import "server-only";
import { createHash } from "node:crypto";
import { canonicalJSON } from "../agreements/crypto";
import {
  evidenceCommitment,
  evidenceManifest,
  type EvidenceRecord,
} from "../evidence/schema";
import { addresses } from "../escrow/client";
import { settlementEvents } from "../escrow/events";
import type { reconcileProject } from "../escrow/server/reconcile";
import { reconcilePayment, type Execution } from "./engine";

export async function paymentSnapshot(
  id: string,
  wallet: string,
  context: Awaited<ReturnType<typeof reconcileProject>>,
) {
  const { admin: db, snapshot, connection } = context;
  const { data: runtime, error } = await db
    .from("agreement_execution")
    .select("*")
    .eq("project_id", id)
    .maybeSingle();
  if (error || !runtime) throw new Error("PAP execution unavailable.");
  let state = runtime.state as Execution,
    revision = runtime.revision as number;
  const { data: record, error: recordError } = await db
    .from("agreements")
    .select("terms")
    .eq("project_id", id)
    .eq("version", state.version)
    .single();
  if (recordError || !record)
    throw new Error("Active PAP agreement unavailable.");
  const participant = [
    record.terms.clientWallet,
    record.terms.freelancerWallet,
  ].includes(wallet);
  // Persist only after both the finalized account and the successful program event agree.
  // Reviewing a wallet prompt or broadcasting bytes can never enter this path.
  if (participant)
    for (const milestone of snapshot.milestones) {
      if (
        !milestone ||
        milestone.status !== 3 ||
        state.milestones[milestone.index]?.paymentReference
      )
        continue;
      const { data: events, error: eventsError } = await db
        .from("transaction_events")
        .select("signature,slot")
        .eq("project_id", id)
        .eq("milestone_index", milestone.index)
        .eq("status", "finalized")
        .order("slot", { ascending: false })
        .limit(20);
      if (eventsError)
        throw new Error("Finalized payment history unavailable.");
      let reconciled = false;
      for (const event of events) {
        const tx = await connection.getTransaction(event.signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        });
        if (
          !tx?.meta ||
          tx.meta.err ||
          !tx.blockTime ||
          tx.slot !== event.slot ||
          tx.slot > snapshot.slot
        )
          continue;
        const settled = (
          await settlementEvents(
            tx.meta.logMessages ?? [],
            addresses(snapshot.agreement).program,
            addresses(snapshot.agreement).project,
          )
        ).find(
          (e) =>
            e.index === milestone.index &&
            e.client === milestone.clientRefunded.toString() &&
            e.freelancer === milestone.freelancerPaid.toString(),
        );
        if (!settled) continue;
        const proof = {
          signature: event.signature,
          slot: tx.slot,
          confirmedAt: new Date(tx.blockTime * 1000).toISOString(),
          network: "devnet" as const,
          clientUnits: settled.client,
          freelancerUnits: settled.freelancer,
        };
        const next = reconcilePayment(
          record.terms,
          state,
          milestone.index,
          proof,
          !!snapshot.state?.cancelled,
        );
        const hash = createHash("sha256")
          .update(
            canonicalJSON({
              id,
              actor: wallet,
              version: state.version,
              index: milestone.index,
              proof,
            }),
          )
          .digest("hex");
        const key = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        const saved = await db.rpc("commit_pap_transition", {
          p_project: id,
          p_actor: wallet,
          p_version: state.version,
          p_expected_revision: revision,
          p_idempotency_key: key,
          p_request_hash: hash,
          p_action: "confirm_payment",
          p_state: next.state,
          p_reason: next.reason,
          p_rule_ids: next.ruleIds,
        });
        if (saved.error)
          throw new Error(
            "Execution changed during payment reconciliation. Refresh chain status.",
          );
        state = saved.data.state;
        revision = saved.data.revision;
        reconciled = true;
        break;
      }
      if (!reconciled)
        throw new Error(
          "Settlement is finalized; waiting for verifiable transaction history before marking payment complete.",
        );
    }
  const deliveryCommitments: Record<number, string> = {};
  const disputeCommitments: Record<number, string> = {};
  state.milestones.forEach((m, index) => {
    if (m.disputedAt && (m.state === "DISPUTED" || m.allocation))
      disputeCommitments[index] = createHash("sha256")
        .update(
          "pactlance:pap-dispute:v1\n" +
            canonicalJSON({
              agreement: snapshot.agreement.commitment,
              index,
              disputedAt: m.disputedAt,
            }),
        )
        .digest("hex");
  });
  if (state.version === snapshot.agreement.terms.version)
    for (let index = 0; index < state.milestones.length; index++) {
      const milestone = state.milestones[index];
      if (
        !participant ||
        !milestone.deliveries?.length ||
        !["UNDER_REVIEW", "PAYMENT_PENDING"].includes(milestone.state)
      )
        continue;
      const manifests = [];
      for (const delivery of milestone.deliveries) {
        const { data: rows, error } = await db
          .from("evidence")
          .select("*")
          .in("id", delivery.evidenceIds)
          .eq("project_id", id)
          .eq("agreement_version", state.version)
          .eq("milestone_index", index)
          .eq("uploader_wallet", record.terms.freelancerWallet)
          .eq("purpose", "delivery")
          .eq("status", "ready");
        if (error || rows.length !== delivery.evidenceIds.length)
          throw new Error("Submitted delivery evidence unavailable.");
        const items = [];
        for (const raw of rows) {
          const e = raw as EvidenceRecord;
          if (
            !e.salt ||
            !e.commitment ||
            (await evidenceCommitment(evidenceManifest(e), e.salt)) !==
              e.commitment
          )
            throw new Error("Evidence integrity check failed.");
          items.push({ id: e.id, commitment: e.commitment });
        }
        manifests.push({
          deliverableId: delivery.deliverableId,
          evidence: items.sort((a, b) => a.id.localeCompare(b.id)),
        });
      }
      deliveryCommitments[index] = createHash("sha256")
        .update(
          "pactlance:pap-delivery:v1\n" +
            canonicalJSON({
              agreement: snapshot.agreement.commitment,
              index,
              revisions: milestone.revisions,
              submittedAt: milestone.submittedAt,
              deliveries: manifests,
            }),
        )
        .digest("hex");
    }
  return {
    version: state.version,
    status: state.status,
    revision,
    milestones: state.milestones,
    deliveryCommitments,
    disputeCommitments,
  };
}
