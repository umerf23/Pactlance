import { walletAddress } from "./agreements/schema";
type Identity = { provider: string; id: string };
// `id` is the provider-issued subject returned by verified Auth.getUser(),
// not client-editable user_metadata or identity_data.custom_claims.
export function verifiedSolanaWallet(
  identities: Identity[] | undefined,
): string | null {
  const wallets = (identities ?? [])
    .filter((i) => i.provider === "web3" && i.id.startsWith("web3:solana:"))
    .map((i) => i.id.slice("web3:solana:".length))
    .filter((w) => walletAddress.safeParse(w).success);
  return wallets.length === 1 ? wallets[0] : null;
}
