import { failure, json } from "@/lib/api";
import { runWorker } from "@/lib/escrow/server/worker";
import { requireOperator } from "@/lib/operations/server/authorization";
import { operationalEvent } from "@/lib/operations/telemetry";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    requireOperator(request);
  } catch (error) {
    return failure(error);
  }
  const start = Date.now();
  try {
    const results = await runWorker();
    const failed = results.filter((r) => "error" in r).length;
    operationalEvent("worker_cycle", {
      processed: results.length,
      failed,
      elapsedMs: Date.now() - start,
      status: failed ? 503 : 200,
    });
    return json(
      { results, summary: { processed: results.length, failed } },
      failed ? 503 : 200,
    );
  } catch {
    operationalEvent("worker_cycle", {
      failed: 1,
      status: 503,
      elapsedMs: Date.now() - start,
    });
    return json(
      {
        error:
          "Worker unavailable. Retry or use recovery controls for your payment profile.",
      },
      503,
    );
  }
}
