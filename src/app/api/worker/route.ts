import { createHash, timingSafeEqual } from "node:crypto";
import { json } from "@/lib/api";
import { runWorker } from "@/lib/escrow/server/worker";
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET,
    header = request.headers.get("authorization");
  if (!secret || secret.length < 32)
    return json({ error: "Worker scheduling is not configured." }, 503);
  const digest = (s: string) => createHash("sha256").update(s).digest();
  if (!header || !timingSafeEqual(digest(header), digest(`Bearer ${secret}`)))
    return json({ error: "Unauthorized." }, 401);
  try {
    return json({ results: await runWorker() });
  } catch {
    return json(
      { error: "Worker unavailable. Manual claims remain available." },
      503,
    );
  }
}
