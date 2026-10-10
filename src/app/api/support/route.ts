import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ApiError,
  failure,
  json,
  readJSON,
  requireSameOrigin,
  requireWallet,
} from "@/lib/api";
import { operationalHealth } from "@/lib/operations/server/health";
import { adminSupabase } from "@/lib/supabase/server";
async function support(scope: "read" | "write" = "read") {
  const a = await requireWallet(scope);
  const { data, error } = await a.db
    .from("support_members")
    .select("user_id")
    .eq("user_id", a.userId)
    .maybeSingle();
  if (error) throw new ApiError(503, "Support setup is unavailable.");
  if (!data) throw new ApiError(403, "Support access is required.");
  return a;
}
export async function GET() {
  try {
    await support();
    const admin = adminSupabase();
    const [m, t, n, health] = await Promise.all([
      admin
        .from("milestone_cache")
        .select(
          "project_id,milestone_index,chain_address,state,verified_at,finalized_slot",
        )
        .in("state", ["funded", "submitted", "disputed"])
        .order("verified_at", { ascending: true })
        .limit(100),
      admin
        .from("transaction_events")
        .select("project_id,signature,event_kind,status,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("support_notes")
        .select("id,project_id,note,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      operationalHealth(admin),
    ]);
    if (m.error || t.error || n.error)
      throw new ApiError(503, "Support metadata is unavailable.");
    return json({
      milestones: m.data,
      transactions: t.data,
      notes: n.data,
      health,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const a = await support("write");
    const p = z
      .object({
        projectId: z.string().uuid(),
        note: z.string().trim().min(1).max(2000),
      })
      .strict()
      .safeParse(await readJSON(request));
    if (!p.success) throw new ApiError(400, "Invalid support note.");
    const { error } = await adminSupabase().from("support_notes").insert({
      id: randomUUID(),
      project_id: p.data.projectId,
      author_id: a.userId,
      note: p.data.note,
    });
    if (error)
      throw new ApiError(400, "Project not found or note could not be saved.");
    return json({ saved: true }, 201);
  } catch (e) {
    return failure(e);
  }
}
