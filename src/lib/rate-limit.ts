import "server-only";
import { adminSupabase } from "./supabase/server";

export type RateScope = "read" | "write" | "escrow" | "evidence";
const limits: Record<RateScope, number> = {
  read: 120,
  write: 30,
  escrow: 12,
  evidence: 10,
};

// Database serialization makes this limit shared across serverless instances.
// No IP addresses, request bodies, keys or private evidence enter the counter.
export async function consumeRateLimit(userId: string, scope: RateScope) {
  const { data, error } = await adminSupabase().rpc("consume_api_limit", {
    p_user: userId,
    p_scope: scope,
    p_limit: limits[scope],
  });
  if (error || typeof data !== "boolean")
    throw new Error("RATE_LIMIT_UNAVAILABLE");
  return data;
}
