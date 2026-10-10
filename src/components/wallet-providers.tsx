"use client";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { boundedRpcConfig } from "@/lib/escrow/connection";
const wallets: never[] = []; // Wallet Standard discovers installed compatible wallets.
const connectionConfig = boundedRpcConfig();
export function WalletProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider
      config={connectionConfig}
      endpoint={
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
        "https://api.devnet.solana.com"
      }
    >
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
