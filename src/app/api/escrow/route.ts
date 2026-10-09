import { z } from "zod";
import { ApiError, failure, json, requireWallet } from "@/lib/api";
import {
  reconcileProject,
  reconcileHistory,
} from "@/lib/escrow/server/reconcile";
import { jsonSafe } from "@/lib/escrow/snapshot";
import { paymentSnapshot } from "@/lib/pap/payments";
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
    if (data[0].terms.protocol && process.env.PAP_PAYMENTS_ENABLED !== "true")
      return json({
        configured: false,
        wallet: auth.wallet,
        reason:
          "PAP payments await the reviewed devnet contract upgrade and operator activation. Agreement review remains available above.",
      });
    if (
      !process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ||
      !process.env.NEXT_PUBLIC_TEST_TOKEN_MINT
    )
      return json({ configured: false, wallet: auth.wallet });
    let context;
    try {
      context = await reconcileProject(id!);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "PAP_CAPABILITY_UNAVAILABLE"
      )
        return json({
          configured: false,
          wallet: auth.wallet,
          reason:
            "The deployed contract has not enabled the PAP payment capability.",
        });
      throw error;
    }
    const { snapshot } = context,
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
    const pap = a.terms.protocol
      ? await paymentSnapshot(id!, auth.wallet, context)
      : undefined;
    return json(
      jsonSafe({
        ...snapshot,
        pap:
          pap && !participant
            ? {
                ...pap,
                milestones: pap.milestones.map((m, i) =>
                  i === snapshot.state?.next ? m : null,
                ),
                deliveryCommitments: {},
                disputeCommitments: {},
              }
            : pap,
        wallet: auth.wallet,
        bindings: undefined,
        draft: participant ? snapshot.draft : null,
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
