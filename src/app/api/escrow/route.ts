import { z } from "zod";
import { ApiError, failure, json, requireWallet } from "@/lib/api";
import {
  reconcileProject,
  reconcileHistory,
} from "@/lib/escrow/server/reconcile";
import { jsonSafe } from "@/lib/escrow/snapshot";
export async function GET(request: Request) {
  try {
    const auth = await requireWallet("escrow"),
      id = new URL(request.url).searchParams.get("project");
    if (!z.string().uuid().safeParse(id).success)
      throw new ApiError(404, "Project not found.");
    // RLS authorizes participants or a freshly assigned reviewer before any privileged history read.
    const { data, error } = await auth.db
      .from("agreements")
      .select("project_id,terms")
      .eq("project_id", id!)
      .order("version", { ascending: false })
      .limit(1);
    if (error) throw new ApiError(503, "Agreement access unavailable.");
    if (!data?.length) throw new ApiError(404, "Project not found.");
    if (data[0].terms.protocol)
      return json({
        configured: false,
        wallet: auth.wallet,
        reason:
          "PAP workflow is off-chain; configurable policies require a compatible escrow adapter.",
      });
    if (
      !process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ||
      !process.env.NEXT_PUBLIC_TEST_TOKEN_MINT
    )
      return json({ configured: false, wallet: auth.wallet });
    const context = await reconcileProject(id!),
      { snapshot } = context,
      a = snapshot.agreement;
    const participant = [
        a.terms.clientWallet,
        a.terms.freelancerWallet,
      ].includes(auth.wallet),
      m = snapshot.milestones.find((m) => m?.index === snapshot.state?.next);
    const original = m
      ? snapshot.bindings.find((b) => b.terms.version === m.agreementVersion)
      : null;
    const reviewer =
      m?.status === 4 &&
      auth.wallet ===
        (BigInt(snapshot.chainTime) < m.backupAt
          ? original?.terms.reviewerWallet
          : original?.terms.backupReviewerWallet);
    if (!participant && !reviewer)
      throw new ApiError(404, "Project not found.");
    await reconcileHistory(id!, context);
    return json(
      jsonSafe({
        ...snapshot,
        wallet: auth.wallet,
        bindings: undefined,
        draft: participant ? snapshot.draft : null,
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
