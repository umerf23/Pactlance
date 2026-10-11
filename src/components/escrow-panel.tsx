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
import { signDevnetTransaction } from "@/lib/escrow/wallet-signing";
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
import { formatTokenAmount } from "@/lib/domain";
import { refundUnits } from "@/lib/escrow/refund-amount";
import { readWalletBalances } from "@/lib/escrow/wallet-readiness";
import type { MilestoneExecution } from "@/lib/pap/engine";
import { papPaymentAllowed } from "@/lib/pap/payment-actions";
import {
  paymentActionLabel,
  paymentGuidance,
  validPaymentProposal,
} from "@/lib/workspace-guide";
import { NextAction, ProgressSteps } from "./workspace-guidance";
import { WalletActionReview } from "./wallet-action-review";
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
  submissionCommitment: string;
}
interface Snapshot {
  configured: boolean;
  reason?: string;
  pap?: {
    version: number;
    status: string;
    milestones: (MilestoneExecution | null)[];
    deliveryCommitments: Record<number, string>;
    disputeCommitments: Record<number, string>;
  };
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
export function EscrowPanel({
  projectId,
  onReconciled,
}: {
  projectId: string;
  onReconciled?: () => Promise<void>;
}) {
  const { connection } = useConnection(),
    { publicKey, signTransaction, wallet: connectedWallet } = useWallet(),
    wallet = publicKey?.toBase58();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [pending, setPending] = useState<PendingTransaction | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]),
    [evidenceId, setEvidenceId] = useState(""),
    [clientRefund, setClientRefund] = useState("0"),
    [cancelFuture, setCancelFuture] = useState(false),
    [jointPackage, setJointPackage] = useState("");
  const [reviewAction, setReviewAction] = useState<string | null>(null);
  const clientUnits = refundUnits(clientRefund)?.toString() ?? "invalid";
  const storageKey = wallet ? `pactlance:pending:${wallet}:${projectId}` : null;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setReady(false);
      setPending(null);
      setSnapshot(null);
      setReviewAction(null);
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
    if (s.pap) await onReconciled?.();
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
    setNotice(
      `Review “${paymentActionLabel(action)}” on Solana devnet in your wallet. Check the amount and recipient before confirming.`,
    );
    const message = tx.serializeMessage(),
      result = await signDevnetTransaction(
        connectedWallet?.adapter ?? null,
        publicKey,
        connection,
        tx,
      );
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
  async function act(
    action: string,
    expectedIndex = snapshot?.state?.next ?? 0,
    expectedProposal = snapshot?.milestones.find(
      (m) => m?.index === expectedIndex,
    )?.proposalNonce,
  ) {
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
      if (index !== expectedIndex)
        throw new Error(
          "The milestone changed. Review the updated payment details before signing.",
        );
      if (
        ["accept_proposal", "execute"].includes(action) &&
        m?.proposalNonce !== expectedProposal
      )
        throw new Error(
          "The payment split changed. Review the updated proposal before signing.",
        );
      const account = await connection.getAccountInfo(d.project, "finalized"),
        ixs: TransactionInstruction[] = [];
      if (
        a.terms.protocol &&
        !papPaymentAllowed(
          action,
          fresh.pap,
          a,
          index,
          m,
          who.toBase58(),
          clientUnits,
          ["accept_proposal", "execute"].includes(action)
            ? !!m?.cancelRemaining
            : cancelFuture,
        )
      )
        throw new Error(
          "This payment action is not permitted by the current PAP workflow. Refresh protocol and review the required approvals.",
        );
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
        case "fund": {
          if (!account || who.toBase58() !== a.terms.clientWallet)
            throw new Error("Only the client funds milestones.");
          const balances = await readWalletBalances(connection, who, mint);
          const amount = BigInt(a.terms.milestones[index].amountUnits);
          if (balances.lamports === 0)
            throw new Error(
              "Add devnet SOL for transaction fees and account creation before funding.",
            );
          if (balances.tokenUnits < amount)
            throw new Error(
              `Insufficient configured TEST tokens. This milestone needs ${formatTokenAmount(amount)} TEST; your confirmed balance is ${formatTokenAmount(balances.tokenUnits)} TEST.`,
            );
          ixs.push(await client.fundInstruction(a, index, cr, account));
          break;
        }
        case "submit":
          if (who.toBase58() !== a.terms.freelancerWallet)
            throw new Error("Only the freelancer submits delivery.");
          ixs.push(
            await client.submitInstruction(
              a,
              index,
              a.terms.protocol
                ? fresh.pap!.deliveryCommitments[index]
                : await evidenceHash(a, index, "delivery"),
            ),
          );
          break;
        case "dispute":
          ixs.push(
            await client.openDisputeInstruction(
              a,
              index,
              who,
              a.terms.protocol
                ? fresh.pap!.disputeCommitments[index]
                : await evidenceHash(a, index, "dispute"),
            ),
          );
          break;
        case "approve":
          if (who.toBase58() !== a.terms.clientWallet)
            throw new Error("Only the client approves delivery.");
          recipients();
          ixs.push(
            await client.approveInstruction(
              a,
              index,
              fr,
              a.terms.protocol
                ? fresh.pap!.deliveryCommitments[index]
                : undefined,
            ),
          );
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
            throw new Error(
              "Enter a valid TEST refund amount with at most six decimal places.",
            );
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
      if (
        a.terms.protocol &&
        action === "cancel" &&
        fresh.pap?.status !== "CANCELLED"
      )
        throw new Error(
          "Both parties must approve workflow cancellation before cancelling future escrow.",
        );
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
  const pap = !!a?.terms.protocol;
  const papAllowed = (action: string) =>
    !pap ||
    (!!a &&
      papPaymentAllowed(
        action,
        snapshot?.pap,
        a,
        s?.next ?? 0,
        m,
        wallet ?? "",
        clientUnits,
        ["accept_proposal", "execute"].includes(action)
          ? !!m?.cancelRemaining
          : cancelFuture,
      ));
  const guide = paymentGuidance({
    pending: !!pending,
    pap,
    versionMatches: snapshot?.pap?.version === a?.terms.version,
    role: isClient ? "client" : isFreelancer ? "freelancer" : "reviewer",
    total: a?.terms.milestones.length ?? 0,
    canPublish: papAllowed("submit"),
    canApprove: papAllowed("approve"),
    chainTime: snapshot?.chainTime ?? 0,
    state: s,
    milestone: m,
    workflow: snapshot?.pap?.milestones[s?.next ?? 0],
  });
  const proposalValid = !!m && validPaymentProposal(m);
  const requestAction = (action: string) => setReviewAction(action);
  const reviewDescription =
    reviewAction === "approve"
      ? "Authorize release of the funded payment to the freelancer. Review the delivery before continuing."
      : reviewAction === "fund"
        ? "Move the milestone amount from your wallet into escrow. The freelancer is paid only after an authorized settlement."
        : reviewAction === "submit"
          ? "Record the validated delivery in escrow. This confirms the delivery evidence and does not send payment."
          : reviewAction === "create"
            ? "Create payment accounts using the agreed terms. No milestone payment is deposited."
            : reviewAction === "accept"
              ? "Confirm the payment terms for your wallet. This does not deposit or release payment."
              : reviewAction === "dispute"
                ? "Pause ordinary payment and record the dispute. Resolution requires an eligible reviewer or an agreed payment split."
                : reviewAction === "propose"
                  ? "Record a proposed split. Both people must accept the same proposal before payment can be sent."
                  : reviewAction === "accept_proposal"
                    ? "Accept the recorded split below, including its future-work cancellation setting. Editing the refund field does not change the recorded proposal."
                    : reviewAction === "execute"
                      ? "Send the recorded split already accepted by both people to the original participant wallets."
                      : reviewAction === "resolve"
                        ? "As the eligible reviewer, authorize this allocation and transfer payment to the original participant wallets."
                        : "Authorize the available payment or refund action under the current agreement.";
  const reviewAmount =
    reviewAction === "fund" && a
      ? `${formatTokenAmount(BigInt(a.terms.milestones[s?.next ?? 0].amountUnits))} TEST into escrow`
      : ["approve", "claim", "refund"].includes(reviewAction ?? "") && m
        ? `${formatTokenAmount(BigInt(m.amount))} TEST to ${reviewAction === "refund" ? "client" : "freelancer"}`
        : ["accept_proposal", "execute"].includes(reviewAction ?? "") && m
          ? `Client: ${formatTokenAmount(BigInt(m.clientAmount))} TEST · Freelancer: ${formatTokenAmount(BigInt(m.freelancerAmount))} TEST${m.cancelRemaining ? " · Cancel future work" : " · Keep future work"}`
          : ["propose", "resolve"].includes(reviewAction ?? "") &&
              m &&
              allocationValid
            ? `Client: ${formatTokenAmount(BigInt(clientUnits))} TEST · Freelancer: ${formatTokenAmount(BigInt(m.amount) - BigInt(clientUnits))} TEST${cancelFuture && reviewAction === "propose" ? " · Cancel future work" : ""}`
            : undefined;
  return (
    <section
      id="project-payments"
      className="workspace-card escrow-panel"
      aria-busy={busy}
    >
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">PAYMENT WORKSPACE</p>
          <h2>Secure milestone payments</h2>
        </div>
        <button className="secondary" disabled={busy} onClick={refreshStatus}>
          Refresh payment status
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
          Chain status could not be loaded. Use Refresh payment status to retry.
        </p>
      )}
      {snapshot && !snapshot.configured && (
        <p>{snapshot.reason ?? "Escrow deployment settings are pending."}</p>
      )}
      {a && (
        <>
          <p className="section-intro">
            Funds are held in escrow until an authorized payment or refund. TEST
            tokens are for devnet testing and have no monetary value.
          </p>
          <ProgressSteps
            labels={[
              "Set up",
              "Confirm terms",
              "Fund",
              "Review & pay",
              "Settled",
            ]}
            current={guide.step}
            complete={guide.complete}
          />
          <NextAction
            title={guide.title}
            role={
              isClient ? "Client" : isFreelancer ? "Freelancer" : "Reviewer"
            }
          >
            <p>{guide.body}</p>
            {s?.active && m?.status === 1 && pap ? (
              <a className="secondary compact" href="#project-delivery">
                Go to work & delivery ↑
              </a>
            ) : null}
          </NextAction>
          {snapshot?.wallet !== wallet && (
            <p role="status">
              Connect and sign in with the same Solana wallet to enable
              transaction buttons.
            </p>
          )}
          <details className="feature-section technical-details">
            <summary>
              Payment terms & technical details{" "}
              <span>Wallets, agreement fingerprint & security rules</span>
            </summary>
            <div className="escrow-agreement-meta">
              <span className="outline-pill">
                Agreement version {a.terms.version}
              </span>
              <code className="wrap-code">{a.commitment}</code>
            </div>
            <div className="form-grid escrow-identities">
              <div className="identity-card">
                <strong>Client wallet</strong>
                <code>{a.terms.clientWallet}</code>
                <small>
                  {s?.clientAccepted
                    ? "Payment terms confirmed"
                    : "Confirmation pending"}
                </small>
              </div>
              <div className="identity-card">
                <strong>Freelancer wallet</strong>
                <code>{a.terms.freelancerWallet}</code>
                <small>
                  {s?.freelancerAccepted
                    ? "Payment terms confirmed"
                    : "Confirmation pending"}
                </small>
              </div>
            </div>
            <p>
              Wallet signatures authorize on-chain actions. The program is
              upgradeable; its upgrade authority can change the code.
            </p>
            {pap ? (
              <p>
                PAP rules and evidence are evaluated by the trusted application.
                Escrow enforces wallet authorization, fixed recipients and exact
                allocations. Explicit client approval, both-party settlement, or
                an authorized reviewer is required. Timer payouts are disabled.
              </p>
            ) : null}
          </details>
          {participant && !s && papAllowed("create") && (
            <button disabled={disabled} onClick={() => requestAction("create")}>
              Set up secure payment
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
                  Client ·{" "}
                  {s.clientAccepted ? "confirmed" : "confirmation needed"}
                </span>
                <span
                  className={
                    s.freelancerAccepted
                      ? "acceptance-badge accepted"
                      : "acceptance-badge"
                  }
                >
                  Freelancer ·{" "}
                  {s.freelancerAccepted ? "confirmed" : "confirmation needed"}
                </span>
              </div>
              {((isClient && !s.clientAccepted) ||
                (isFreelancer && !s.freelancerAccepted)) && (
                <button
                  disabled={disabled}
                  onClick={() => requestAction("accept")}
                >
                  Confirm payment terms in wallet
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
                    disabled ||
                    !s.clientAccepted ||
                    !s.freelancerAccepted ||
                    !papAllowed("fund")
                  }
                  onClick={() => requestAction("fund")}
                >
                  Add payment for milestone {s.next + 1}
                </button>
              )}
            </>
          )}
          {s?.cancelled && <p>Remaining work cancelled.</p>}
          {s?.active && snapshot?.milestones.some((m) => m?.status === 4) && (
            <p role="status">
              Disputed funds stay locked until an eligible reviewer resolves the
              dispute or both participants agree to a settlement. If neither
              acts, funds can remain locked indefinitely.
            </p>
          )}
          {m?.status === 4 ? (
            <p>
              Eligible reviewer at the refreshed chain time:{" "}
              <code className="wrap-code">
                {BigInt(snapshot?.chainTime ?? 0) < BigInt(m.backupAt)
                  ? a.terms.reviewerWallet
                  : a.terms.backupReviewerWallet}
              </code>
              Exclusive backup activation:{" "}
              {new Date(Number(m.backupAt) * 1000).toLocaleString()}.
            </p>
          ) : null}
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
                      1: "payment funded",
                      2: "delivery recorded",
                      3: "payment settled",
                      4: "dispute open",
                    } as Record<number, string>
                  )[m.status]
                }
              </h3>
              <p>
                Funded amount: {formatTokenAmount(BigInt(m.amount))} TEST.
                Delivery deadline:{" "}
                {new Date(Number(m.deliveryDeadline) * 1000).toLocaleString()}.
              </p>
              {participant && !pap && (
                <>
                  <button className="secondary" onClick={loadEvidence}>
                    Load saved attachments
                  </button>
                  <label>
                    Select a saved attachment
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
              {(m.status === 1 || (pap && m.status === 2)) &&
                isFreelancer &&
                papAllowed("submit") && (
                  <button
                    disabled={disabled || (!pap && !evidenceId)}
                    onClick={() => requestAction("submit")}
                  >
                    {pap
                      ? "Record validated delivery in escrow"
                      : "Submit delivery for review"}
                  </button>
                )}
              {m.status === 2 && (
                <>
                  {!pap && (
                    <p>
                      Client review deadline:{" "}
                      {new Date(
                        Number(m.reviewDeadline) * 1000,
                      ).toLocaleString()}
                      .
                    </p>
                  )}
                  {isClient && papAllowed("approve") && (
                    <button
                      disabled={disabled}
                      onClick={() => requestAction("approve")}
                    >
                      Approve and pay freelancer
                    </button>
                  )}
                </>
              )}
              {(participant || reviewer) && (
                <details
                  className="feature-section problem-section"
                  open={m.status === 4}
                >
                  <summary>
                    Resolve a problem{" "}
                    <span>Payment splits, refunds & reviewer resolution</span>
                  </summary>
                  <p>
                    Use a negotiated split if a full normal payment is not
                    appropriate. Both people must accept the same recorded
                    proposal before authorizing its execution. A reviewer can
                    resolve an eligible dispute.
                  </p>{" "}
                  {m.status === 1 &&
                    !pap &&
                    isClient &&
                    BigInt(snapshot?.chainTime ?? 0) >=
                      BigInt(m.deliveryDeadline) && (
                      <button
                        disabled={disabled}
                        onClick={() => requestAction("refund")}
                      >
                        Request non-delivery refund
                      </button>
                    )}
                  {m.status === 2 ? (
                    <>
                      {" "}
                      {participant &&
                        !pap &&
                        (BigInt(snapshot?.chainTime ?? 0) <
                        BigInt(m.reviewDeadline) ? (
                          <button
                            disabled={disabled || !evidenceId}
                            onClick={() => requestAction("dispute")}
                          >
                            Open dispute with this evidence
                          </button>
                        ) : (
                          <button
                            disabled={disabled}
                            onClick={() => requestAction("claim")}
                          >
                            Release payment after review deadline
                          </button>
                        ))}
                    </>
                  ) : null}{" "}
                  {participant && pap && papAllowed("dispute") && (
                    <button
                      disabled={disabled}
                      onClick={() => requestAction("dispute")}
                    >
                      Record dispute and pause payment
                    </button>
                  )}
                  <h3>Agree on a payment split</h3>
                  <label>
                    Client refund (TEST)
                    <input
                      inputMode="decimal"
                      value={clientRefund}
                      onChange={(e) => setClientRefund(e.target.value)}
                    />
                  </label>
                  <p>
                    {allocationValid
                      ? `Client refund: ${formatTokenAmount(BigInt(clientUnits))} TEST; freelancer payout: ${formatTokenAmount(BigInt(m.amount) - BigInt(clientUnits))} TEST.`
                      : "Enter a refund between zero and the funded amount, with at most six decimal places."}
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
                        disabled={
                          disabled || !allocationValid || !papAllowed("propose")
                        }
                        onClick={() => requestAction("propose")}
                      >
                        Propose this payment split
                      </button>
                      {proposalValid && (
                        <>
                          <p>
                            Recorded proposal {m.proposalNonce}: client{" "}
                            {formatTokenAmount(BigInt(m.clientAmount))} TEST;
                            freelancer{" "}
                            {formatTokenAmount(BigInt(m.freelancerAmount))}{" "}
                            TEST; future work{" "}
                            {m.cancelRemaining ? "cancelled" : "retained"}.
                            Client:{" "}
                            {m.clientApproved
                              ? "accepted"
                              : "waiting for acceptance"}
                            ; freelancer:{" "}
                            {m.freelancerApproved
                              ? "accepted"
                              : "waiting for acceptance"}
                            .
                          </p>
                          <button
                            disabled={
                              disabled ||
                              !proposalValid ||
                              !papAllowed("accept_proposal")
                            }
                            onClick={() => requestAction("accept_proposal")}
                          >
                            Accept recorded payment split
                          </button>
                          <button
                            disabled={
                              disabled ||
                              !proposalValid ||
                              !m.clientApproved ||
                              !m.freelancerApproved ||
                              !papAllowed("execute")
                            }
                            onClick={() => requestAction("execute")}
                          >
                            Send agreed payment split
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {!proposalValid && participant ? (
                    <p>
                      No valid split is recorded yet. Propose a split above if
                      both people want a negotiated settlement.
                    </p>
                  ) : null}
                  {reviewer && papAllowed("resolve") && (
                    <button
                      disabled={disabled || !allocationValid}
                      onClick={() => requestAction("resolve")}
                    >
                      Resolve dispute and send this split
                    </button>
                  )}
                </details>
              )}
            </>
          )}
          {participant &&
            s &&
            !s.active &&
            !s.cancelled &&
            s.next < a.terms.milestones.length && (
              <details className="escrow-joint">
                <summary>Update or cancel future work</summary>
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
                  Prepare cancellation for both people
                </button>
                <button
                  disabled={disabled || !snapshot?.draft}
                  onClick={() => joint("revise")}
                >
                  Prepare updated terms for both people
                </button>
                <label>
                  Shared signature package (advanced)
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
                  Verify, sign and submit shared package
                </button>
              </details>
            )}
        </>
      )}
      {reviewAction ? (
        <WalletActionReview
          title={paymentActionLabel(reviewAction)}
          description={reviewDescription}
          amount={reviewAmount}
          recipient={
            ["approve", "claim"].includes(reviewAction)
              ? a?.terms.freelancerWallet
              : reviewAction === "refund"
                ? a?.terms.clientWallet
                : undefined
          }
          onCancel={() => setReviewAction(null)}
          onConfirm={() => {
            const action = reviewAction;
            setReviewAction(null);
            void act(action);
          }}
        />
      ) : null}
      {pending && (
        <section>
          <p>
            Your “{paymentActionLabel(pending.action)}” transaction is still
            being checked. New signatures are paused to avoid duplicate actions.
          </p>
          <a
            href={explorerURL(pending.signature) ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            View transaction on devnet
          </a>
          <button disabled={busy} onClick={recover}>
            Check pending transaction
          </button>
        </section>
      )}
    </section>
  );
}
