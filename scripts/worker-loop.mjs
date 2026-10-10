import { setTimeout } from "node:timers/promises";
const url = new URL(
    "/api/worker",
    process.env.WORKER_APP_URL || "http://127.0.0.1:3000",
  ),
  secret = process.env.CRON_SECRET;
if (!secret || secret.length < 32)
  throw new Error("Configure CRON_SECRET (at least 32 characters).");
if (
  url.protocol !== "https:" &&
  !(
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  )
)
  throw new Error("Use HTTPS for a hosted worker endpoint.");
const stop = new AbortController();
process.on("SIGINT", () => stop.abort());
process.on("SIGTERM", () => stop.abort());
while (!stop.signal.aborted) {
  try {
    const result = await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.any([stop.signal, AbortSignal.timeout(290000)]),
    });
    const body = await result.json().catch(() => null);
    console.log(
      JSON.stringify({
        event: "worker_http",
        status: result.status,
        ...(Number.isSafeInteger(body?.summary?.failed)
          ? { failed: body.summary.failed }
          : {}),
        ...(Number.isSafeInteger(body?.summary?.processed)
          ? { processed: body.summary.processed }
          : {}),
      }),
    );
  } catch {
    if (!stop.signal.aborted)
      console.log("Worker request failed. Will resume from saved state.");
  }
  if (!stop.signal.aborted)
    try {
      await setTimeout(60000, undefined, { signal: stop.signal });
    } catch {
      break;
    }
}
