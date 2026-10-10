import "server-only";
import { randomUUID } from "node:crypto";
type Event =
  | "api_unavailable"
  | "api_failure"
  | "quota_unavailable"
  | "worker_cycle"
  | "monitor_unavailable";
export function operationalEvent(
  event: Event,
  fields: {
    status?: number;
    processed?: number;
    failed?: number;
    elapsedMs?: number;
  } = {},
) {
  const requestId = randomUUID();
  const safe: Record<string, string | number> = {
    event,
    requestId,
    timestamp: new Date().toISOString(),
  };
  for (const key of ["status", "processed", "failed", "elapsedMs"] as const) {
    const value = fields[key];
    if (Number.isSafeInteger(value) && value! >= 0) safe[key] = value!;
  }
  console.error(JSON.stringify(safe));
  return requestId;
}
