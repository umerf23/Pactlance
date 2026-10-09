"use client";
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";
import * as client from "@/lib/escrow/client";
import type { BoundAgreement } from "@/lib/escrow/terms";
import { requireDevnet } from "@/lib/escrow/network";
import {
  captureSignedTransaction,
  recoverTransaction,
  validatePending,
  type PendingTransaction,
} from "@/lib/escrow/recovery";
import { verifyJointEnvelope, type JointEnvelope } from "@/lib/escrow/joint";
import { evidenceCommitment, type EvidenceRecord } from "@/lib/evidence/schema";
import { explorerURL } from "@/lib/operations/model";
import { operationalAPI } from "./evidence-panel";
interface Milestone {
  index: number;
  status: number;
  amount: string;
  reviewDeadline: string;
  deliveryDeadline: string;
  backupAt: string;
  proposalNonce: string;
  clientAmount: string;
  freelancerAmount: string;
  cancelRemaining: boolean;
  clientApproved: boolean;
  freelancerApproved: boolean;
  agreementVersion: number;
}
interface Snapshot {
  configured: boolean;
  agreement?: BoundAgreement;
  draft?: BoundAgreement | null;
  state: {
    clientAccepted: boolean;
    freelancerAccepted: boolean;
    next: number;
    active: boolean;
    cancelled: boolean;
  } | null;
  milestones: (Milestone | null)[];
  slot: number;
  chainTime: number;
  wallet: string;
}
export function EscrowPanel({ projectId }: { projectId: string }) {
  const { connection } = useConnection(),
    { publicKey, signTransaction } = useWallet(),
    wallet = publicKey?.toBase58();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [pending, setPending] = useState<PendingTransaction | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]),
    [evidenceId, setEvidenceId] = useState(""),
    [clientUnits, setClientUnits] = useState("0"),
    [cancelFuture, setCancelFuture] = useState(false),
    [jointPackage, setJointPackage] = useState("");
  const storageKey = wallet ? `pactlance:pending:${wallet}:${projectId}` : null;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setReady(false);
      setPending(null);
      setSnapshot(null);
      setEvidence([]);
      setEvidenceId("");
      setJointPackage("");
      if (!storageKey) return;
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const p = validatePending(JSON.parse(raw));
          if (p.wallet !== wallet || p.projectId !== projectId)
            throw new Error(
              "Saved transaction belongs to another wallet/project.",
            );
          setPending(p);
        }
        setReady(true);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 0);
    operationalAPI(`/api/escrow?project=${projectId}`)
      .then((s) => {
        if (active) setSnapshot(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [storageKey, wallet, projectId]);
  async function refresh() {
    const s = (await operationalAPI(
      `/api/escrow?project=${projectId}`,
    )) as Snapshot;
    setSnapshot(s);
    return s;
  }
  async function refreshStatus() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await refresh();
      setNotice(
        "Finalized chain status refreshed. Refresh does not request a wallet signature.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function actor(s: Snapshot) {
    if (!publicKey || !signTransaction || s.wallet !== wallet)
      throw new Error("Connect and sign in with the same Solana wallet.");
    if (!ready || pending)
      throw new Error(
        "Resolve the saved transaction before another signature.",
      );
    return publicKey;
  }
  async function signed(tx: Transaction, height: number, action: string) {
    if (!signTransaction || !publicKey || !storageKey)
      throw new Error("Connect your wallet.");
    const message = tx.serializeMessage(),
      result = await signTransaction(tx);
    if (!message.equals(result.serializeMessage()))
      throw new Error("Wallet changed the reviewed transaction message.");
    result.serialize({ requireAllSignatures: false, verifySignatures: true });
    if (
      !result.signatures.some(
        (s) => s.publicKey.equals(publicKey) && s.signature,
      )
    )
      throw new Error("The connected wallet did not sign this transaction.");
    if (!result.signatures.every((s) => s.signature)) return result;
    const saved = captureSignedTransaction(
      result,
      projectId,
      publicKey,
      action,
      height,
    );
    localStorage.setItem(storageKey, JSON.stringify(saved));
    setPending(saved);
    const status = await recoverTransaction(connection, saved, true);
    setNotice(`Transaction ${status}.`);
    if (status === "finalized" || status === "failed") {
      localStorage.removeItem(storageKey);
      setPending(null);
      await refresh();
    }
    return result;
  }
  async function recover() {
    if (!pending || !storageKey) return;
    setBusy(true);
    setError("");
    try {
      const status = await recoverTransaction(connection, pending, true);
      setNotice(`Transaction ${status}.`);
      if (status === "expired_requires_reconciliation") {
        if (
          (await connection.getBlockHeight("finalized")) <=
          pending.lastValidBlockHeight
        ) {
          setNotice("Waiting for finalized blockhash expiry.");
          return;
        }
        const floor = await connection.getSlot("finalized"),
          fresh = await refresh();
        if (
          !fresh.configured ||
          !Number.isSafeInteger(fresh.slot) ||
          fresh.slot < floor
        )
          throw new Error("Waiting for a fresh finalized snapshot.");
        localStorage.removeItem(storageKey);
        setPending(null);
        setNotice(
          "Expired transaction reconciled. Review current escrow state and history before signing again.",
        );
      } else if (status === "finalized" || status === "failed") {
        localStorage.removeItem(storageKey);
        setPending(null);
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadEvidence() {
    if (!snapshot?.agreement) return;
    try {
      const i = snapshot.state?.next ?? 0,
        d = await operationalAPI(
          `/api/evidence?project=${projectId}&version=${snapshot.agreement.terms.version}&index=${i}`,
        );
      setEvidence(d.evidence);
      setEvidenceId("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function evidenceHash(
    a: BoundAgreement,
    index: number,
    purpose: "delivery" | "dispute",
  ) {
    const data = await operationalAPI(
        `/api/evidence?project=${projectId}&version=${a.terms.version}&index=${index}`,
      ),
      e = (data.evidence as EvidenceRecord[]).find((e) => e.id === evidenceId);
    if (
      !e ||
      e.status !== "ready" ||
      e.purpose !== purpose ||
      e.uploader_wallet !== wallet ||
      !e.salt ||
      !e.commitment ||
      (await evidenceCommitment(e.manifest, e.salt)) !== e.commitment
    )
      throw new Error(
        "Choose completed evidence from this wallet with a verified commitment.",
      );
    return e.commitment;
  }
  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      await requireDevnet(connection);
      const fresh = await refresh(),
        who = actor(fresh),
        a = fresh.agreement;
      if (!a) throw new Error("Escrow is not configured.");
      if (snapshot?.agreement?.commitment !== a.commitment)
        throw new Error(
          "Agreement changed. Review the refreshed terms before signing.",
        );
      const participant = [
          a.terms.clientWallet,
          a.terms.freelancerWallet,
        ].includes(who.toBase58()),
        state = fresh.state,
        index = state?.next ?? 0,
        m = fresh.milestones.find((m) => m?.index === index),
        d = client.addresses(a, index < a.terms.milestones.length ? index : 0);
      const account = await connection.getAccountInfo(d.project, "finalized"),
        ixs: TransactionInstruction[] = [];
      const mint = new PublicKey(a.terms.token.mint),
        crOwner = new PublicKey(a.terms.clientWallet),
        frOwner = new PublicKey(a.terms.freelancerWallet),
        cr = getAssociatedTokenAddressSync(mint, crOwner),
        fr = getAssociatedTokenAddressSync(mint, frOwner);
      const recipients = () => {
        ixs.push(
          createAssociatedTokenAccountIdempotentInstruction(
            who,
            cr,
            crOwner,
            mint,
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            who,
            fr,
            frOwner,
            mint,
          ),
        );
      };
      if (
        [
          "create",
          "accept",
          "fund",
          "submit",
          "dispute",
          "propose",
          "accept_proposal",
          "cancel",
          "revise",
        ].includes(action) &&
        !participant
      )
        throw new Error("Participant authorization required.");
      switch (action) {
        case "create":
          ixs.push(await client.createProjectInstruction(a, who));
          break;
        case "accept":
          if (!account) throw new Error("Create escrow first.");
          ixs.push(await client.acceptProjectInstruction(a, who, account));
          break;
        case "fund":
          if (!account || who.toBase58() !== a.terms.clientWallet)
            throw new Error("Only the client funds milestones.");
          ixs.push(await client.fundInstruction(a, index, cr, account));
          break;
        case "submit":
          if (who.toBase58() !== a.terms.freelancerWallet)
            throw new Error("Only the freelancer submits delivery.");
          ixs.push(
            await client.submitInstruction(
              a,
              index,
              await evidenceHash(a, index, "delivery"),
            ),
          );
          break;
        case "dispute":
          ixs.push(
            await client.openDisputeInstruction(
              a,
              index,
              who,
              await evidenceHash(a, index, "dispute"),
            ),
          );
          break;
        case "approve":
          if (who.toBase58() !== a.terms.clientWallet)
            throw new Error("Only the client approves delivery.");
          recipients();
          ixs.push(await client.approveInstruction(a, index, fr));
          break;
        case "claim":
          recipients();
          ixs.push(
            await client.claimAfterReviewInstruction(a, index, who, cr, fr),
          );
          break;
        case "refund":
          if (who.toBase58() !== a.terms.clientWallet)
            throw new Error("Only the client requests non-delivery refunds.");
          recipients();
          ixs.push(await client.refundNonDeliveryInstruction(a, index, cr, fr));
          break;
        case "propose":
        case "resolve": {
          if (!m || !/^(0|[1-9][0-9]{0,19})$/.test(clientUnits))
            throw new Error("Enter an exact integer allocation.");
          const c = BigInt(clientUnits),
            f = BigInt(m.amount) - c;
          if (f < 0n) throw new Error("Refund exceeds funded obligation.");
          if (action === "propose")
            ixs.push(
              await client.proposeSettlementInstruction(
                a,
                index,
                who,
                BigInt(m.proposalNonce),
                c,
                f,
                cancelFuture,
              ),
            );
          else {
            const eligible =
              BigInt(fresh.chainTime) < BigInt(m.backupAt)
                ? a.terms.reviewerWallet
                : a.terms.backupReviewerWallet;
            if (m.status !== 4 || who.toBase58() !== eligible)
              throw new Error("Reviewer is not currently eligible.");
            recipients();
            ixs.push(
              await client.resolveDisputeInstruction(
                a,
                index,
                who,
                cr,
                fr,
                c,
                f,
              ),
            );
          }
          break;
        }
        case "accept_proposal":
        case "execute": {
          const shown = snapshot?.milestones.find((m) => m?.index === index);
          if (
            !m ||
            !shown ||
            [
              "proposalNonce",
              "clientAmount",
              "freelancerAmount",
              "cancelRemaining",
            ].some(
              (k) => m[k as keyof Milestone] !== shown[k as keyof Milestone],
            )
          )
            throw new Error(
              "Settlement proposal changed. Review refreshed allocation.",
            );
          if (action === "accept_proposal")
            ixs.push(
              await client.acceptSettlementInstruction(
                a,
                index,
                who,
                BigInt(m.proposalNonce),
                BigInt(m.clientAmount),
                BigInt(m.freelancerAmount),
                m.cancelRemaining,
              ),
            );
          else {
            if (!m.clientApproved || !m.freelancerApproved)
              throw new Error("Both participants must accept this proposal.");
            recipients();
            ixs.push(
              await client.executeSettlementInstruction(
                a,
                index,
                who,
                cr,
                fr,
                BigInt(m.proposalNonce),
              ),
            );
          }
          break;
        }
        default:
          throw new Error("Unknown action.");
      }
      const block = await connection.getLatestBlockhash("confirmed"),
        tx = new Transaction({
          feePayer: who,
          recentBlockhash: block.blockhash,
        }).add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
          ...ixs,
        );
      await signed(tx, block.lastValidBlockHeight, action);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function joint(action: "cancel" | "revise", incoming = false) {
    setBusy(true);
    setError("");
    try {
      await requireDevnet(connection);
      const fresh = await refresh(),
        who = actor(fresh),
        a = fresh.agreement;
      if (
        !a ||
        ![a.terms.clientWallet, a.terms.freelancerWallet].includes(
          who.toBase58(),
        )
      )
        throw new Error("Participant authorization required.");
      if (
        snapshot?.agreement?.commitment !== a.commitment ||
        snapshot?.draft?.commitment !== fresh.draft?.commitment
      )
        throw new Error("Agreement changed. Review the refreshed terms.");
      const account = await connection.getAccountInfo(
        client.addresses(a).project,
        "finalized",
      );
      if (!account) throw new Error("Create escrow first.");
      let tx: Transaction, height: number;
      if (incoming) {
        const envelope = JSON.parse(jointPackage) as JointEnvelope;
        tx = await verifyJointEnvelope(
          envelope,
          a,
          fresh.draft ?? null,
          account,
          connection,
        );
        height = envelope.lastValidBlockHeight;
        action = envelope.action;
      } else {
        const block = await connection.getLatestBlockhash("confirmed");
        height = block.lastValidBlockHeight;
        tx = new Transaction({
          feePayer: who,
          recentBlockhash: block.blockhash,
        }).add(
          action === "cancel"
            ? await client.cancelRemainingInstruction(a, account)
            : fresh.draft
              ? await client.reviseProjectInstruction(a, fresh.draft, account)
              : (() => {
                  throw new Error(
                    "Save and review a future-work revision first.",
                  );
                })(),
        );
      }
      const result = await signed(tx, height, action);
      if (!result.signatures.every((s) => s.signature)) {
        setJointPackage(
          JSON.stringify({
            version: 1,
            action,
            raw: bs58.encode(
              result.serialize({
                requireAllSignatures: false,
                verifySignatures: true,
              }),
            ),
            lastValidBlockHeight: height,
          }),
        );
        setNotice(
          "First signature ready. Share this package with the other participant promptly.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const a = snapshot?.agreement,
    s = snapshot?.state,
    m = snapshot?.milestones?.find((m) => m?.index === s?.next),
    participant =
      !!a &&
      [a.terms.clientWallet, a.terms.freelancerWallet].includes(wallet ?? ""),
    isClient = wallet === a?.terms.clientWallet,
    isFreelancer = wallet === a?.terms.freelancerWallet;
  const reviewer =
      m?.status === 4 &&
      wallet ===
        (BigInt(snapshot?.chainTime ?? 0) < BigInt(m.backupAt)
          ? a?.terms.reviewerWallet
          : a?.terms.backupReviewerWallet),
    disabled = busy || !!pending || !ready || snapshot?.wallet !== wallet;
  const allocationValid =
    !!m &&
    /^(0|[1-9][0-9]{0,19})$/.test(clientUnits) &&
    BigInt(clientUnits) <= BigInt(m.amount);
  return (
    <section className="workspace-card escrow-panel" aria-busy={busy}>
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">PAYMENT WORKSPACE</p>
          <h2>Milestone escrow</h2>
        </div>
        <button className="secondary" disabled={busy} onClick={refreshStatus}>
          Refresh chain status
        </button>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!snapshot && !error && (
        <p role="status">Loading finalized escrow state…</p>
      )}
      {!snapshot && error && (
        <p>
          Chain status could not be loaded. Use Refresh chain status to retry.
        </p>
      )}
      {snapshot && !snapshot.configured && (
        <p>Escrow deployment settings are pending.</p>
      )}
      {a && (
        <>
          <p>
            Solana devnet · TEST tokens have no monetary value. Wallet
            signatures authorize on-chain actions.
          </p>
          <p className="escrow-next-step">
            <strong>Next step: </strong>
            {pending
              ? "Recover the saved transaction before requesting another signature."
              : !s
                ? "Review these terms, then create the escrow with a participant wallet."
                : s.cancelled
                  ? "Remaining work is cancelled. Review the transaction history."
                  : s.next >= a.terms.milestones.length
                    ? "All milestones are settled. Review the transaction history."
                    : !s.clientAccepted || !s.freelancerAccepted
                      ? "Both participants must accept these terms on chain before funding."
                      : !s.active
                        ? "The client can fund the next milestone using the configured TEST token."
                        : "Review the active milestone and its available delivery or settlement actions."}
          </p>
          {snapshot?.wallet !== wallet && (
            <p role="status">
              Connect and sign in with the same Solana wallet to enable
              transaction buttons.
            </p>
          )}
          <div className="escrow-agreement-meta">
            <span className="outline-pill">Agreement v{a.terms.version}</span>
            <details>
              <summary>View agreement commitment</summary>
              <code className="wrap-code">{a.commitment}</code>
            </details>
          </div>
          <div className="form-grid escrow-identities">
            <div className="identity-card">
              <strong>CLIENT</strong>
              <code>{a.terms.clientWallet}</code>
              <small>
                {s?.clientAccepted ? "Accepted on chain" : "Acceptance pending"}
              </small>
            </div>
            <div className="identity-card">
              <strong>FREELANCER</strong>
              <code>{a.terms.freelancerWallet}</code>
              <small>
                {s?.freelancerAccepted
                  ? "Accepted on chain"
                  : "Acceptance pending"}
              </small>
            </div>
          </div>
          {participant && !s && (
            <button disabled={disabled} onClick={() => act("create")}>
              Create escrow with these terms
            </button>
          )}
          {participant && s && !s.cancelled && (
            <>
              <div
                className="escrow-acceptance-status"
                aria-label="On-chain acceptance"
              >
                <span
                  className={
                    s.clientAccepted
                      ? "acceptance-badge accepted"
                      : "acceptance-badge"
                  }
                >
                  Client · {s.clientAccepted ? "accepted" : "pending"}
                </span>
                <span
                  className={
                    s.freelancerAccepted
                      ? "acceptance-badge accepted"
                      : "acceptance-badge"
                  }
                >
                  Freelancer · {s.freelancerAccepted ? "accepted" : "pending"}
                </span>
              </div>
              {((isClient && !s.clientAccepted) ||
                (isFreelancer && !s.freelancerAccepted)) && (
                <button disabled={disabled} onClick={() => act("accept")}>
                  Accept deployed terms on chain
                </button>
              )}
              {isClient && (!s.clientAccepted || !s.freelancerAccepted) && (
                <p className="muted">
                  Funding unlocks after both acceptances are finalized. The
                  other participant must connect and sign in with their own
                  wallet.
                </p>
              )}
              {!s.active && s.next < a.terms.milestones.length && isClient && (
                <button
                  disabled={
                    disabled || !s.clientAccepted || !s.freelancerAccepted
                  }
                  onClick={() => act("fund")}
                >
                  Fund milestone {s.next + 1}
                </button>
              )}
            </>
          )}
          {s?.cancelled && <p>Remaining work cancelled.</p>}
          {s && s.next >= a.terms.milestones.length && (
            <p>All milestones settled.</p>
          )}
          {s?.active && m && (
            <>
              <h3>
                Milestone {m.index + 1} ·{" "}
                {
                  (
                    {
                      1: "funded",
                      2: "submitted",
                      3: "settled",
                      4: "disputed",
                    } as Record<number, string>
                  )[m.status]
                }
              </h3>
              <p>
                Funded obligation: {m.amount} TEST base units. Delivery
                deadline:{" "}
                {new Date(Number(m.deliveryDeadline) * 1000).toLocaleString()}.
              </p>
              {participant && (
                <>
                  <button className="secondary" onClick={loadEvidence}>
                    Load completed evidence
                  </button>
                  <label>
                    Evidence commitment
                    <select
                      value={evidenceId}
                      onChange={(e) => setEvidenceId(e.target.value)}
                    >
                      <option value="">Choose saved evidence</option>
                      {evidence
                        .filter(
                          (e) =>
                            e.status === "ready" &&
                            e.uploader_wallet === wallet,
                        )
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.purpose}: {e.title}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              )}
              {m.status === 1 && isFreelancer && (
                <button
                  disabled={disabled || !evidenceId}
                  onClick={() => act("submit")}
                >
                  Submit delivery commitment
                </button>
              )}
              {m.status === 1 &&
                isClient &&
                BigInt(snapshot?.chainTime ?? 0) >=
                  BigInt(m.deliveryDeadline) && (
                  <button disabled={disabled} onClick={() => act("refund")}>
                    Request non-delivery refund
                  </button>
                )}
              {m.status === 2 && (
                <>
                  <p>
                    Review expires:{" "}
                    {new Date(Number(m.reviewDeadline) * 1000).toLocaleString()}
                    .
                  </p>
                  {isClient && (
                    <button disabled={disabled} onClick={() => act("approve")}>
                      Approve and pay freelancer
                    </button>
                  )}
                  {participant &&
                    (BigInt(snapshot?.chainTime ?? 0) <
                    BigInt(m.reviewDeadline) ? (
                      <button
                        disabled={disabled || !evidenceId}
                        onClick={() => act("dispute")}
                      >
                        Open dispute with selected evidence
                      </button>
                    ) : (
                      <button disabled={disabled} onClick={() => act("claim")}>
                        Claim after review expiry
                      </button>
                    ))}
                </>
              )}
              {(participant || reviewer) && (
                <section>
                  <h3>Settlement allocation</h3>
                  <label>
                    Client refund in TEST base units
                    <input
                      inputMode="numeric"
                      value={clientUnits}
                      onChange={(e) => setClientUnits(e.target.value)}
                    />
                  </label>
                  <p>
                    {allocationValid
                      ? `Client: ${clientUnits}; freelancer: ${BigInt(m.amount) - BigInt(clientUnits)} TEST base units.`
                      : "Enter an integer refund between zero and the funded obligation."}
                  </p>
                  {participant && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={cancelFuture}
                          onChange={(e) => setCancelFuture(e.target.checked)}
                        />{" "}
                        Cancel future work with this mutual settlement
                      </label>
                      <button
                        disabled={disabled || !allocationValid}
                        onClick={() => act("propose")}
                      >
                        Propose exact allocation
                      </button>
                      {BigInt(m.proposalNonce) > 0n && (
                        <>
                          <p>
                            Proposal {m.proposalNonce}: client {m.clientAmount};
                            freelancer {m.freelancerAmount}; future work{" "}
                            {m.cancelRemaining ? "cancelled" : "retained"}.
                            Client approval: {String(m.clientApproved)};
                            freelancer approval: {String(m.freelancerApproved)}.
                          </p>
                          <button
                            disabled={disabled}
                            onClick={() => act("accept_proposal")}
                          >
                            Accept this exact proposal
                          </button>
                          <button
                            disabled={
                              disabled ||
                              !m.clientApproved ||
                              !m.freelancerApproved
                            }
                            onClick={() => act("execute")}
                          >
                            Execute accepted settlement
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {reviewer && (
                    <button
                      disabled={disabled || !allocationValid}
                      onClick={() => act("resolve")}
                    >
                      Resolve dispute with this allocation
                    </button>
                  )}
                </section>
              )}
            </>
          )}
          {participant &&
            s &&
            !s.active &&
            !s.cancelled &&
            s.next < a.terms.milestones.length && (
              <details className="escrow-joint">
                <summary>
                  Cancel or revise future work with both signatures
                </summary>
                <p className="muted">
                  Only use this section to cancel or revise unfunded work. Leave
                  the package empty during ordinary acceptance and funding.
                </p>
                <h3>Joint authorization for future work</h3>
                <p>
                  Both participants must sign. Settled milestone terms remain
                  unchanged.
                </p>
                {snapshot?.draft && (
                  <>
                    <p>
                      Revision {snapshot.draft.terms.version} ·{" "}
                      <code>{snapshot.draft.commitment}</code>
                    </p>
                    <pre>{JSON.stringify(snapshot.draft.terms, null, 2)}</pre>
                  </>
                )}
                <button disabled={disabled} onClick={() => joint("cancel")}>
                  Prepare joint cancellation
                </button>
                <button
                  disabled={disabled || !snapshot?.draft}
                  onClick={() => joint("revise")}
                >
                  Prepare reviewed joint revision
                </button>
                <label>
                  Joint signature package
                  <textarea
                    value={jointPackage}
                    maxLength={2400}
                    onChange={(e) => setJointPackage(e.target.value)}
                  />
                </label>
                <button
                  disabled={disabled || !jointPackage}
                  onClick={() => joint("cancel", true)}
                >
                  Verify, co-sign and submit package
                </button>
              </details>
            )}
        </>
      )}
      {pending && (
        <section>
          <p>
            Saved {pending.action} transaction is unresolved. New signatures are
            paused.
          </p>
          <a
            href={explorerURL(pending.signature) ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            View transaction on devnet
          </a>
          <button disabled={busy} onClick={recover}>
            Recover saved transaction
          </button>
        </section>
      )}
    </section>
  );
}
