import "server-only";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import { reconcileProject, reconcileHistory } from "./reconcile";
import {
  captureSignedTransaction,
  recoverTransaction,
  type PendingTransaction,
} from "../recovery";
import { claimAfterReviewInstruction } from "../client";
import { adminSupabase } from "@/lib/supabase/server";
function workerSigner() {
  const key = process.env.CLAIM_WORKER_SECRET_KEY;
  if (!key) return null;
  return Keypair.fromSecretKey(
    key.startsWith("[") ? Uint8Array.from(JSON.parse(key)) : bs58.decode(key),
  );
}
export async function runProjectWorker(projectId: string) {
  const context = await reconcileProject(projectId);
  await reconcileHistory(projectId, context);
  const { snapshot, connection, admin } = context;
  if (snapshot.agreement.terms.protocol)
    return { reconciled: true, claims: "pap_explicit_authorization" };
  const unresolved = await admin
    .from("claim_outbox")
    .select("*")
    .eq("project_id", projectId)
    .in("status", ["pending", "confirmed"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (unresolved.error) throw new Error("Claim outbox unavailable.");
  const target = unresolved.data
    ? unresolved
    : await admin
        .from("claim_outbox")
        .select("*")
        .eq("project_id", projectId)
        .eq("milestone_index", snapshot.state?.next ?? 0)
        .maybeSingle();
  if (target.error) throw new Error("Claim outbox unavailable.");
  const old = target.data;
  if (old && ["pending", "confirmed"].includes(old.status)) {
    const saved: PendingTransaction = {
      schemaVersion: 1,
      projectId,
      wallet: Transaction.from(bs58.decode(old.raw)).feePayer!.toBase58(),
      action: "claim",
      signature: old.signature,
      raw: old.raw,
      blockhash: old.blockhash,
      lastValidBlockHeight: Number(old.last_valid_block_height),
      createdAt: old.created_at,
    };
    const status = await recoverTransaction(connection, saved, true);
    if (status === "expired_requires_reconciliation") {
      if (
        (await connection.getBlockHeight("finalized")) <=
        saved.lastValidBlockHeight
      )
        return { reconciled: true, claims: "awaiting_finality" };
      const floor = await connection.getSlot("finalized"),
        fresh = await reconcileProject(projectId);
      if (fresh.snapshot.slot < floor)
        return { reconciled: true, claims: "awaiting_reconciliation" };
      const { error } = await admin
        .from("claim_outbox")
        .update({ status: "expired" })
        .eq("project_id", projectId)
        .eq("milestone_index", old.milestone_index)
        .eq("signature", old.signature)
        .in("status", ["pending", "confirmed"]);
      if (error) throw new Error("Expired outbox persistence failed.");
      return { reconciled: true, claims: "expired_reconciled" };
    }
    // A confirmed record must never regress to pending on an inconsistent RPC response.
    const { error } = await admin
      .from("claim_outbox")
      .update({
        status:
          status === "pending" && old.status === "confirmed"
            ? "confirmed"
            : status,
      })
      .eq("project_id", projectId)
      .eq("milestone_index", old.milestone_index)
      .eq("signature", old.signature)
      .in("status", ["pending", "confirmed"]);
    if (error) throw new Error("Outbox status persistence failed.");
    return { reconciled: true, claims: status };
  }
  const signer = workerSigner();
  if (!signer) return { reconciled: true, claims: "manual_only" };
  const m = snapshot.milestones.find((m) => m?.index === snapshot.state?.next);
  if (
    !snapshot.state?.active ||
    !m ||
    m.status !== 2 ||
    BigInt(snapshot.chainTime) < m.reviewDeadline
  )
    return { reconciled: true, claims: "not_eligible" };
  const a = snapshot.agreement,
    mint = new PublicKey(a.terms.token.mint),
    client = new PublicKey(a.terms.clientWallet),
    freelancer = new PublicKey(a.terms.freelancerWallet),
    cr = getAssociatedTokenAddressSync(mint, client),
    fr = getAssociatedTokenAddressSync(mint, freelancer),
    block = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: signer.publicKey,
    recentBlockhash: block.blockhash,
  }).add(
    createAssociatedTokenAccountIdempotentInstruction(
      signer.publicKey,
      cr,
      client,
      mint,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      signer.publicKey,
      fr,
      freelancer,
      mint,
    ),
    await claimAfterReviewInstruction(a, m.index, signer.publicKey, cr, fr),
  );
  transaction.sign(signer);
  const saved = captureSignedTransaction(
      transaction,
      projectId,
      signer.publicKey,
      "claim",
      block.lastValidBlockHeight,
    ),
    row = {
      project_id: projectId,
      milestone_index: m.index,
      signature: saved.signature,
      raw: saved.raw,
      blockhash: saved.blockhash,
      last_valid_block_height: saved.lastValidBlockHeight,
      created_at: saved.createdAt,
      status: "pending",
    };
  const write = old
    ? await admin
        .from("claim_outbox")
        .update(row)
        .eq("project_id", projectId)
        .eq("milestone_index", m.index)
        .eq("signature", old.signature)
        .in("status", ["failed", "expired"])
        .select("signature")
        .maybeSingle()
    : await admin
        .from("claim_outbox")
        .insert(row)
        .select("signature")
        .maybeSingle();
  if (write.error && write.error.code !== "23505")
    throw new Error(
      "Claim outbox persistence unavailable. No transaction broadcast.",
    );
  if (write.error || !write.data)
    return { reconciled: true, claims: "another_worker_owns_claim" };
  return {
    reconciled: true,
    claims: await recoverTransaction(connection, saved, true),
  };
}
export async function runWorker() {
  const admin = adminSupabase(),
    results = [];
  for (let page = 0; ; page++) {
    const { data: projects, error } = await admin
      .from("projects")
      .select("id,current_version")
      .order("id", { ascending: true })
      .range(page * 100, page * 100 + 99);
    if (error) throw new Error("Projects unavailable.");
    for (let offset = 0; offset < (projects ?? []).length; offset += 4) {
      results.push(
        ...(await Promise.all(
          (projects ?? []).slice(offset, offset + 4).map(async (p) => {
            try {
              const terms = await admin
                .from("agreements")
                .select("terms")
                .eq("project_id", p.id)
                .eq("version", p.current_version)
                .maybeSingle();
              if (terms.error || !terms.data)
                throw new Error("Current agreement unavailable.");
              if (terms.data.terms.protocol)
                return {
                  projectId: p.id,
                  reconciled: false,
                  claims: "pap_offchain_workflow",
                };
              return { projectId: p.id, ...(await runProjectWorker(p.id)) };
            } catch {
              return {
                projectId: p.id,
                error: "reconciliation_or_claim_failed",
              };
            }
          }),
        )),
      );
    }
    if ((projects ?? []).length < 100) break;
  }
  return results;
}
