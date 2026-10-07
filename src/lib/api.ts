import "server-only";
import { serverSupabase } from "./supabase/server";
import { verifiedSolanaWallet } from "./identity";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function requireWallet() {
  const db = await serverSupabase();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user)
    throw new ApiError(401, "Sign in with your Solana wallet first.");
  const wallet = verifiedSolanaWallet(data.user.identities);
  if (!wallet)
    throw new ApiError(
      403,
      "Sign in with one verified Solana wallet. Other login methods are not supported.",
    );
  return { db, userId: data.user.id, wallet };
}
export function requireSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new ApiError(403, "Request origin does not match this application.");
}
export async function readJSON(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new ApiError(415, "Use JSON for this request.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Missing request body.");
  let total = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 128_000) {
      await reader.cancel();
      throw new ApiError(413, "Agreement is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "Invalid JSON.");
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function failure(error: unknown) {
  if (error instanceof ApiError)
    return json({ error: error.message }, error.status);
  if (error instanceof Error && error.message === "BACKEND_NOT_CONFIGURED")
    return json(
      { error: "Shared workspace setup is pending. No data was saved." },
      503,
    );
  console.error(
    "Pactlance request failed",
    error instanceof Error ? error.name : "unknown",
  );
  return json({ error: "Unable to complete this request. Please retry." }, 500);
}
