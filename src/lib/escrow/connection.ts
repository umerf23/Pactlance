import { Connection, type ConnectionConfig } from "@solana/web3.js";

export const RPC_REQUEST_TIMEOUT_MS = 15_000;

export function boundedRpcConfig(
  requestTimeoutMs = RPC_REQUEST_TIMEOUT_MS,
): ConnectionConfig {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0)
    throw new Error("Invalid RPC request timeout.");
  return {
    commitment: "finalized",
    // An outage must reach the caller rather than cause hidden retry loops.
    // Transaction recovery decides whether the same saved bytes can be retried.
    disableRetryOnRateLimit: true,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: AbortSignal.any([
          AbortSignal.timeout(requestTimeoutMs),
          ...(init?.signal ? [init.signal] : []),
        ]),
      }),
  };
}

export function devnetConnection(endpoint: string) {
  return new Connection(endpoint, boundedRpcConfig());
}
