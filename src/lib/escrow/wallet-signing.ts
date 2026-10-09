import { Transaction, type PublicKey, type Connection } from "@solana/web3.js";
import type {
  WalletAdapter,
  StandardWalletAdapter,
} from "@solana/wallet-adapter-base";
import { requireDevnet } from "./network";

// The generic adapter signTransaction API has no chain argument. Call the
// discovered Wallet Standard feature directly so the prompt receives devnet.
export async function signDevnetTransaction(
  adapter: WalletAdapter | null,
  publicKey: PublicKey,
  connection: Pick<Connection, "getGenesisHash">,
  transaction: Transaction,
) {
  await requireDevnet(connection);
  if (!adapter || !("standard" in adapter) || adapter.standard !== true)
    throw new Error(
      "Use a Solana Wallet Standard wallet with devnet transaction signing.",
    );
  const standard = adapter as StandardWalletAdapter;
  const account = standard.wallet.accounts.find(
    (a) => a.address === publicKey.toBase58(),
  );
  const feature = (
    "solana:signTransaction" in standard.wallet.features
      ? standard.wallet.features["solana:signTransaction"]
      : undefined
  ) as
    | {
        supportedTransactionVersions: readonly (string | number)[];
        signTransaction: (input: {
          account: StandardWalletAdapter["wallet"]["accounts"][number];
          transaction: Uint8Array;
          chain: "solana:devnet";
        }) => Promise<readonly { signedTransaction: Uint8Array }[]>;
      }
    | undefined;
  if (
    !account ||
    !standard.wallet.chains.includes("solana:devnet") ||
    !account.chains.includes("solana:devnet") ||
    !account.features.includes("solana:signTransaction") ||
    !feature?.supportedTransactionVersions.includes("legacy") ||
    typeof feature.signTransaction !== "function"
  )
    throw new Error(
      "This wallet account does not support Solana devnet signing. Enable devnet and reconnect.",
    );
  const message = transaction.serializeMessage();
  const outputs = await feature.signTransaction({
    account,
    transaction: new Uint8Array(
      transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: true,
      }),
    ),
    chain: "solana:devnet",
  });
  if (outputs.length !== 1)
    throw new Error("Wallet returned an invalid signing response.");
  const signed = Transaction.from(outputs[0].signedTransaction);
  if (!message.equals(signed.serializeMessage()))
    throw new Error("Wallet changed the reviewed transaction message.");
  signed.serialize({ requireAllSignatures: false, verifySignatures: true });
  if (
    !signed.signatures.some((s) => s.publicKey.equals(publicKey) && s.signature)
  )
    throw new Error("The connected wallet did not sign this transaction.");
  // A multisig package may arrive partially signed. Preserve every prior signature.
  for (const old of transaction.signatures)
    if (
      old.signature &&
      !signed.signatures.some(
        (s) =>
          s.publicKey.equals(old.publicKey) &&
          s.signature?.equals(old.signature!),
      )
    )
      throw new Error("Wallet changed an existing participant signature.");
  return signed;
}
