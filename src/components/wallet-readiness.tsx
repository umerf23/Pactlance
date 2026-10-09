"use client";
import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { formatTokenAmount } from "@/lib/domain";
import { readWalletBalances } from "@/lib/escrow/wallet-readiness";

export function WalletReadiness({ wallet }: { wallet: string }) {
  const { connection } = useConnection();
  const { signTransaction } = useWallet();
  const [result, setResult] = useState<{
    wallet: string;
    lamports: number;
    tokenUnits: bigint;
  } | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mint = process.env.NEXT_PUBLIC_TEST_TOKEN_MINT;
  useEffect(() => {
    if (!mint) return;
    let active = true;
    // Start async work before setting state, keeping setup outside render.
    const read = async () => {
      await Promise.resolve();
      if (!active) return;
      setChecking(true);
      setError("");
      try {
        const balances = await readWalletBalances(
          connection,
          new PublicKey(wallet),
          new PublicKey(mint),
        );
        if (active) setResult({ wallet, ...balances });
      } catch {
        if (active)
          setError(
            "Could not verify devnet balances. Check the network connection and retry before funding.",
          );
      } finally {
        if (active) setChecking(false);
      }
    };
    void read();
    return () => {
      active = false;
    };
  }, [wallet, connection, mint, refresh]);
  const balances = result?.wallet === wallet ? result : null;
  return (
    <details className="workspace-card wallet-readiness">
      <summary>Wallet and funding checklist</summary>
      {!signTransaction ? (
        <p role="alert">
          This wallet cannot sign Solana transactions. Connect a compatible
          Solana wallet before using escrow.
        </p>
      ) : null}
      {!mint ? (
        <p role="alert">
          TEST mint configuration is missing on this deployment.
        </p>
      ) : null}
      {checking ? (
        <p role="status">Checking the devnet network and balances…</p>
      ) : null}
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      {balances ? (
        <>
          <dl className="term-list">
            <div>
              <dt>Devnet SOL</dt>
              <dd>
                {(balances.lamports / 1e9).toLocaleString(undefined, {
                  maximumFractionDigits: 9,
                })}
              </dd>
            </div>
            <div>
              <dt>Configured TEST token</dt>
              <dd>{formatTokenAmount(balances.tokenUnits)} TEST</dd>
            </div>
          </dl>
          {balances.lamports === 0 ? (
            <p role="status">
              Your wallet needs devnet SOL to pay transaction fees and create
              accounts.
            </p>
          ) : null}
          {balances.tokenUnits === 0n ? (
            <p>
              Clients need the configured TEST token before funding. Ask the
              project operator to provision devnet TEST assets; ordinary SOL
              faucets do not mint this token.
            </p>
          ) : null}
        </>
      ) : null}
      <p>
        These are read-only confirmed balances, not a guarantee that all
        transaction fees and account-creation costs are covered. Recheck before
        paying. Never send mainnet assets or share a private key to obtain test
        assets.
      </p>
      <button
        className="secondary"
        type="button"
        disabled={checking || !mint}
        onClick={() => setRefresh((n) => n + 1)}
      >
        Recheck balances
      </button>
    </details>
  );
}
