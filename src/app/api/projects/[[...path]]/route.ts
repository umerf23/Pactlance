import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ApiError,
  failure,
  json,
  readJSON,
  requireSameOrigin,
  requireWallet,
} from "@/lib/api";
import { adminSupabase } from "@/lib/supabase/server";
import {
  agreementInput,
  makeTerms,
  validateFutureDeadlines,
  acceptanceMessage,
} from "@/lib/agreements/schema";
import { reconcileProject } from "@/lib/escrow/server/reconcile";
import { agreementCommitment, canonicalJSON } from "@/lib/agreements/crypto";
import { verifyWalletSignature } from "@/lib/agreements/signatures";
type Context = { params: Promise<{ path?: string[] }> };
async function projectForUser(
  id: string,
  auth: Awaited<ReturnType<typeof requireWallet>>,
) {
  if (!z.string().uuid().safeParse(id).success)
    throw new ApiError(404, "Project not found.");
  const { data, error } = await auth.db
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error)
    throw new ApiError(503, "Database setup is incomplete or unavailable.");
  if (!data) throw new ApiError(404, "Project not found.");
  return data;
}
export async function GET(_request: Request, context: Context) {
  try {
    const auth = await requireWallet();
    const path = (await context.params).path ?? [];
    if (!path.length) {
      const { data, error } = await auth.db
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error)
        throw new ApiError(503, "Database setup is incomplete or unavailable.");
      return json({ projects: data });
    }
    if (path.length !== 1) throw new ApiError(404, "Not found.");
    const project = await projectForUser(path[0], auth);
    const [agreements, acceptances] = await Promise.all([
      auth.db
        .from("agreements")
        .select("*")
        .eq("project_id", project.id)
        .order("version", { ascending: false }),
      auth.db
        .from("agreement_acceptances")
        .select(
          "wallet,version,commitment,signed_message,signature,accepted_at",
        )
        .eq("project_id", project.id),
    ]);
    if (agreements.error || acceptances.error)
      throw new ApiError(503, "Could not load agreement history.");
    return json({
      project,
      agreement: agreements.data.find(
        (a) => a.version === project.current_version,
      ),
      history: agreements.data,
      acceptances: acceptances.data,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request, context: Context) {
  return mutate(request, context, false);
}
export async function PATCH(request: Request, context: Context) {
  return mutate(request, context, true);
}
async function mutate(request: Request, context: Context, revision: boolean) {
  try {
    requireSameOrigin(request);
    const auth = await requireWallet("write");
    const path = (await context.params).path ?? [];
    const body = await readJSON(request);
    const admin = adminSupabase();
    if (!revision && path.length === 2 && path[1] === "accept") {
      const project = await projectForUser(path[0], auth);
      const parsed = z
        .object({
          version: z.number().int().positive(),
          commitment: z.string().regex(/^[a-f0-9]{64}$/),
          signature: z.string().max(100),
        })
        .strict()
        .safeParse(body);
      if (!parsed.success)
        throw new ApiError(400, "Invalid acceptance request.");
      const { version, commitment, signature } = parsed.data;
      if (project.current_version !== version)
        throw new ApiError(
          409,
          "The agreement changed. Review the latest version before signing.",
        );
      const { data: agreement, error } = await auth.db
        .from("agreements")
        .select("*")
        .eq("project_id", project.id)
        .eq("version", version)
        .single();
      if (error || !agreement) throw new ApiError(404, "Agreement not found.");
      if (
        agreement.commitment !== commitment ||
        (await agreementCommitment(agreement.terms, agreement.salt)) !==
          commitment
      )
        throw new ApiError(409, "Agreement commitment does not match.");
      const message = acceptanceMessage(
        new URL(request.url).origin,
        project.id,
        version,
        commitment,
      );
      if (!verifyWalletSignature(auth.wallet, message, signature))
        throw new ApiError(
          403,
          "The signature does not match your signed-in wallet and agreement.",
        );
      const result = await admin.rpc("record_agreement_acceptance", {
        p_project: project.id,
        p_actor: auth.wallet,
        p_version: version,
        p_commitment: commitment,
        p_message: message,
        p_signature: signature,
      });
      if (result.error)
        throw new ApiError(
          409,
          "The agreement changed or is locked. Reload before trying again.",
        );
      return json({ accepted: true, version, onChain: false });
    }
    if ((revision && path.length !== 1) || (!revision && path.length !== 0))
      throw new ApiError(404, "Not found.");
    const parsed = z
      .object({
        agreement: agreementInput,
        expectedVersion: z.number().int().positive().optional(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      throw new ApiError(
        400,
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
    const input = parsed.data.agreement;
    if (
      auth.wallet !== input.clientWallet &&
      auth.wallet !== input.freelancerWallet
    )
      throw new ApiError(
        403,
        "Your wallet must be one of the two participants.",
      );
    let settledPrefix = 0;
    let id = randomUUID();
    let version = 1;
    if (revision) {
      const existing = await projectForUser(path[0], auth);
      id = existing.id;
      const previous = await auth.db
        .from("agreements")
        .select("terms")
        .eq("project_id", id)
        .eq("version", existing.current_version)
        .single();
      if (previous.error)
        throw new ApiError(503, "Agreement history unavailable.");
      if (!!previous.data.terms.protocol !== !!input.protocol)
        throw new ApiError(
          409,
          "Create a separate project when switching between PAP workflow and legacy escrow.",
        );
      if (input.protocol) {
        const runtime = await admin
          .from("agreement_execution")
          .select("state,active_version")
          .eq("project_id", id)
          .maybeSingle();
        if (runtime.error)
          throw new ApiError(
            503,
            "PAP execution unavailable; install the migration before proposing amendments.",
          );
        if (runtime.data) {
          const active = await auth.db
            .from("agreements")
            .select("terms")
            .eq("project_id", id)
            .eq("version", runtime.data.active_version)
            .single();
          if (active.error)
            throw new ApiError(503, "Active terms unavailable.");
          const revised = makeTerms(input, id, existing.current_version + 1);
          for (const [i, m] of runtime.data.state.milestones.entries())
            if (m.acceptedAt) {
              settledPrefix = i + 1;
              if (
                canonicalJSON(revised.milestones[i] ?? null) !==
                  canonicalJSON(active.data.terms.milestones[i]) ||
                canonicalJSON(revised.protocol!.milestones[i] ?? null) !==
                  canonicalJSON(active.data.terms.protocol.milestones[i])
              )
                throw new ApiError(
                  400,
                  "Completed milestone terms and payment allocations cannot change.",
                );
            }
        }
      }
      if (
        !input.protocol &&
        process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID &&
        process.env.NEXT_PUBLIC_TEST_TOKEN_MINT
      ) {
        const { snapshot } = await reconcileProject(id);
        if (snapshot.state?.active || snapshot.state?.cancelled)
          throw new ApiError(
            409,
            "Active or cancelled escrow terms cannot be changed.",
          );
        settledPrefix = snapshot.state?.next ?? 0;
        const revised = makeTerms(input, id, existing.current_version + 1);
        if (revised.milestones.length <= settledPrefix)
          throw new ApiError(
            400,
            "Keep settled history and at least one future milestone.",
          );
        for (let i = 0; i < settledPrefix; i++)
          if (
            canonicalJSON(revised.milestones[i]) !==
            canonicalJSON(snapshot.agreement.terms.milestones[i])
          )
            throw new ApiError(400, "Settled milestone terms cannot change.");
      } else if (existing.locked) {
        throw new ApiError(409, "Funded terms cannot be changed.");
      }
      if (existing.current_version !== parsed.data.expectedVersion)
        throw new ApiError(
          409,
          "A newer version exists. Reload before editing.",
        );
      if (
        existing.client_wallet !== input.clientWallet ||
        existing.freelancer_wallet !== input.freelancerWallet
      )
        throw new ApiError(
          400,
          "Participant wallets cannot be changed. Create a new project.",
        );
      version = existing.current_version + 1;
    }
    try {
      validateFutureDeadlines({
        ...input,
        milestones: input.milestones.slice(settledPrefix),
      });
    } catch (e) {
      throw new ApiError(400, (e as Error).message);
    }
    const terms = makeTerms(input, id, version, auth.wallet);
    const salt = randomBytes(32).toString("hex");
    const commitment = await agreementCommitment(terms, salt);
    const result = await admin.rpc("save_agreement_version", {
      p_project: id,
      p_actor: auth.wallet,
      p_expected_version: revision ? version - 1 : 0,
      p_terms: terms,
      p_salt: salt,
      p_commitment: commitment,
    });
    if (result.error)
      throw new ApiError(
        409,
        "Could not save. The project may have changed; reload before retrying.",
      );
    return json({ id, version }, revision ? 200 : 201);
  } catch (e) {
    return failure(e);
  }
}
