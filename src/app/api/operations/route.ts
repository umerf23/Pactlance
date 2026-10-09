import { z } from "zod";
import {
  ApiError,
  failure,
  json,
  readJSON,
  requireSameOrigin,
  requireWallet,
} from "@/lib/api";
import {
  reminders,
  reviewerEligible,
  type MilestoneCache,
} from "@/lib/operations/model";
export async function GET(request: Request) {
  try {
    const auth = await requireWallet(),
      q = new URL(request.url).searchParams;
    let cache = auth.db
      .from("milestone_cache")
      .select("*")
      .order("verified_at", { ascending: false })
      .limit(100);
    let events = auth.db
      .from("transaction_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    const project = q.get("project");
    if (project) {
      if (!z.string().uuid().safeParse(project).success)
        throw new ApiError(400, "Invalid project.");
      cache = cache.eq("project_id", project);
      events = events.eq("project_id", project);
    }
    const [m, t, r, s] = await Promise.all([
      cache,
      events,
      auth.db.from("notification_receipts").select("notice_key"),
      auth.db
        .from("support_members")
        .select("user_id")
        .eq("user_id", auth.userId)
        .maybeSingle(),
    ]);
    if (m.error || t.error || r.error || s.error)
      throw new ApiError(503, "Operations setup is incomplete or unavailable.");
    const milestones = (m.data ?? []) as MilestoneCache[];
    const dismissed = new Set((r.data ?? []).map((v) => v.notice_key));
    const notices = (await reminders(milestones, auth.wallet)).filter(
      (v) => !dismissed.has(v.key),
    );
    const assignments = milestones.filter((v) =>
      reviewerEligible(v, auth.wallet),
    );
    const agreements = (
      await Promise.all(
        assignments.map(async (a) => {
          const { data, error } = await auth.db
            .from("agreements")
            .select("project_id,version,terms")
            .eq("project_id", a.project_id)
            .eq("version", a.agreement_version)
            .maybeSingle();
          if (error)
            throw new ApiError(503, "Reviewer agreement lookup failed.");
          return data;
        }),
      )
    ).filter(Boolean);
    return json({
      milestones,
      transactions: t.data,
      notices,
      assignments,
      agreements,
      support: !!s.data,
      chainConfigured:
        !!process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID &&
        !!process.env.NEXT_PUBLIC_TEST_TOKEN_MINT,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const auth = await requireWallet("write");
    const p = z
      .object({ noticeKey: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .safeParse(await readJSON(request));
    if (!p.success) throw new ApiError(400, "Invalid reminder.");
    const { error } = await auth.db
      .from("notification_receipts")
      .upsert(
        { user_id: auth.userId, notice_key: p.data.noticeKey },
        { onConflict: "user_id,notice_key" },
      );
    if (error) throw new ApiError(503, "Could not dismiss reminder.");
    return json({ dismissed: true });
  } catch (e) {
    return failure(e);
  }
}
