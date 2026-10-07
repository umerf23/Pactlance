import { z } from "zod";
import {
  failure,
  json,
  requireWallet,
  requireSameOrigin,
  readJSON,
  ApiError,
} from "@/lib/api";
export async function GET() {
  try {
    const { db, userId } = await requireWallet();
    const { data, error } = await db
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new ApiError(503, "Profile unavailable.");
    return json({ displayName: data?.display_name ?? "" });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    requireSameOrigin(request);
    const { db, userId } = await requireWallet();
    const parsed = z
      .object({ displayName: z.string().trim().min(1).max(80) })
      .strict()
      .safeParse(await readJSON(request));
    if (!parsed.success)
      throw new ApiError(
        400,
        "Use a display name between 1 and 80 characters.",
      );
    const { error } = await db
      .from("profiles")
      .upsert({ id: userId, display_name: parsed.data.displayName });
    if (error) throw new ApiError(503, "Profile could not be saved.");
    return json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
