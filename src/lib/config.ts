export function validatePublicConfig(env: Record<string, string | undefined>) {
  const network = env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";
  if (network !== "devnet")
    throw new Error("This prototype supports devnet only");
  const rpc = new URL(
    env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com",
  );
  if (rpc.protocol !== "https:") throw new Error("Devnet RPC must use HTTPS");
  if (rpc.username || rpc.password)
    throw new Error("Do not put credentials in public RPC URLs");
  return { network, rpcUrl: rpc.toString(), paymentsEnabled: false as const };
}
