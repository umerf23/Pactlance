import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api";
export function requireOperator(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32)
    throw new ApiError(503, "Operator access is not configured.");
  const header = request.headers.get("authorization");
  const digest = (s: string) => createHash("sha256").update(s).digest();
  if (!header || !timingSafeEqual(digest(header), digest(`Bearer ${secret}`)))
    throw new ApiError(401, "Unauthorized.");
}
