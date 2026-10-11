"use client";
import { useEffect, useId, useRef } from "react";
export function WalletActionReview({
  title,
  description,
  amount,
  recipient,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  amount?: string;
  recipient?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="wallet-review-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={onCancel}
    >
      <p className="eyebrow">REVIEW BEFORE SIGNING</p>
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-description`}>{description}</p>
      {amount ? <div className="payment-review-amount">{amount}</div> : null}
      {recipient ? (
        <div className="payment-review-recipient">
          <strong>Recipient wallet</strong>
          <code>{recipient}</code>
        </div>
      ) : null}
      <p className="notice">
        Solana devnet · TEST tokens have no monetary value. This opens a wallet
        transaction. Check the network, amount, and action in your wallet.
        Network fees may apply.
      </p>
      <div className="button-row">
        <button className="secondary" type="button" onClick={onCancel}>
          Go back
        </button>
        <button className="primary" type="button" onClick={onConfirm}>
          Continue to wallet
        </button>
      </div>
    </dialog>
  );
}
