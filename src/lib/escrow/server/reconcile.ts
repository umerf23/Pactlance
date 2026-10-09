import "server-only";
import { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { settlementEvents } from "../events";
import { adminSupabase } from "@/lib/supabase/server";
import { readEscrow, jsonSafe } from "../snapshot";
import { addresses, discriminator } from "../client";
import type { AgreementRecord } from "@/lib/agreements/schema";
export function serverConnection() {
  return new Connection(
    process.env.SOLANA_RPC_URL ||
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
      "https://api.devnet.solana.com",
    "finalized",
  );
}
export async function reconcileProject(id: string) {
  const program = process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID,
    mint = process.env.NEXT_PUBLIC_TEST_TOKEN_MINT;
  if (!program || !mint) throw new Error("ESCROW_NOT_CONFIGURED");
  const admin = adminSupabase(),
    connection = serverConnection();
  const { data: records, error } = await admin
    .from("agreements")
    .select("*")
    .eq("project_id", id)
    .order("version", { ascending: false });
  if (error) throw new Error("Agreement history unavailable.");
  let selected = records as AgreementRecord[];
  if (selected[0]?.terms.protocol) {
    const { data: runtime, error } = await admin
      .from("agreement_execution")
      .select("active_version")
      .eq("project_id", id)
      .maybeSingle();
    if (error || !runtime)
      throw new Error(
        "Activate the jointly signed PAP agreement before creating escrow.",
      );
    selected = selected.filter((r) => r.version <= runtime.active_version);
  }
  const snapshot = await readEscrow(
    connection,
    selected,
    program,
    mint,
    process.env.PAP_PAYMENTS_ENABLED === "true",
  );
  const serialized = jsonSafe({
    ...snapshot,
    milestones: snapshot.milestones.map((m) =>
      m
        ? {
            ...m,
            chainAddress: addresses(
              snapshot.agreement,
              m.index,
            ).milestone.toBase58(),
          }
        : null,
    ),
  });
  const { error: writeError } = await admin.rpc("reconcile_escrow", {
    p_project: id,
    p_snapshot: serialized,
  });
  if (writeError) throw new Error("Chain reconciliation persistence failed.");
  return { snapshot, connection, admin };
}
const names = [
  "create_pap_project",
  "submit_pap_delivery",
  "approve_pap_milestone",
  "revise_pap_project",
  "create_project",
  "accept_project",
  "fund_milestone",
  "submit_delivery",
  "approve_milestone",
  "claim_after_review",
  "refund_non_delivery",
  "open_dispute",
  "resolve_dispute",
  "propose_settlement",
  "accept_settlement",
  "execute_settlement",
  "cancel_remaining",
  "revise_project",
];
export async function reconcileHistory(
  id: string,
  context: Awaited<ReturnType<typeof reconcileProject>>,
) {
  const { snapshot, connection, admin } = context,
    d = addresses(snapshot.agreement);
  const { data: cursor, error: ce } = await admin
    .from("reconciliation_cursors")
    .select("last_signature,scan_before,pending_head")
    .eq("project_id", id)
    .maybeSingle();
  if (ce) throw new Error("History cursor unavailable.");
  const signatures = await connection.getSignaturesForAddress(
    d.project,
    {
      limit: 100,
      before: cursor?.scan_before ?? undefined,
      until: cursor?.last_signature ?? undefined,
    },
    "finalized",
  );
  const tags = await Promise.all(names.map((n) => discriminator("global", n)));
  for (const s of [...signatures].reverse()) {
    const transaction = await connection.getTransaction(s.signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    if (!transaction?.meta)
      throw new Error(
        "Finalized transaction unavailable; history cursor retained.",
      );
    const message = transaction.transaction.message,
      keys = message.getAccountKeys({
        accountKeysFromLookups: transaction.meta.loadedAddresses,
      });
    const settlements = transaction.meta.err
      ? []
      : await settlementEvents(
          transaction.meta.logMessages ?? [],
          d.program,
          d.project,
        );
    const instructions = [
      ...message.compiledInstructions,
      ...(transaction.meta.innerInstructions ?? []).flatMap((group) =>
        group.instructions.map((ix) => ({
          programIdIndex: ix.programIdIndex,
          accountKeyIndexes: ix.accounts,
          data: bs58.decode(ix.data),
        })),
      ),
    ];
    for (const instruction of instructions) {
      if (!keys.get(instruction.programIdIndex)?.equals(d.program)) continue;
      const bytes =
          typeof instruction.data === "string"
            ? bs58.decode(instruction.data)
            : instruction.data,
        at = tags.findIndex((v) => v.equals(Buffer.from(bytes).subarray(0, 8)));
      if (at < 0) continue;
      const accounts = instruction.accountKeyIndexes.map((i) => keys.get(i));
      if (!accounts.some((k) => k?.equals(d.project))) continue;
      const milestone = snapshot.milestones.find(
        (m) =>
          m &&
          accounts.some((k) =>
            k?.equals(addresses(snapshot.agreement, m.index).milestone),
          ),
      );
      const allocation = settlements.find((e) => e.index === milestone?.index);
      const { error } = await admin.from("transaction_events").upsert(
        {
          project_id: id,
          signature: s.signature,
          event_kind: names[at],
          milestone_index: milestone?.index ?? null,
          status: transaction.meta.err ? "failed" : "finalized",
          slot: s.slot,
          created_at: new Date(
            (s.blockTime ?? snapshot.chainTime) * 1000,
          ).toISOString(),
          amount_units: milestone?.amount.toString() ?? null,
          client_amount_units: allocation?.client ?? null,
          freelancer_amount_units: allocation?.freelancer ?? null,
          client_recipient: snapshot.agreement.terms.clientWallet,
          freelancer_recipient: snapshot.agreement.terms.freelancerWallet,
          network: "devnet",
        },
        { onConflict: "project_id,signature,event_kind" },
      );
      if (error) throw new Error("History persistence failed.");
    }
  }
  if (signatures.length || cursor?.scan_before) {
    const head =
        cursor?.pending_head ??
        signatures[0]?.signature ??
        cursor?.last_signature,
      more = signatures.length === 100;
    const { error } = await admin.rpc("advance_history_cursor", {
      p_project: id,
      p_expected: cursor?.last_signature ?? null,
      p_expected_before: cursor?.scan_before ?? null,
      p_next: more ? (cursor?.last_signature ?? null) : head,
      p_before: more ? signatures.at(-1)!.signature : null,
      p_head: more ? head : null,
    });
    if (error) throw new Error("History cursor persistence failed.");
  }
}
