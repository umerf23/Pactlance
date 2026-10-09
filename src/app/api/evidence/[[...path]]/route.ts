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
  EVIDENCE_BUCKET,
  MAX_FILE_BYTES,
  evidenceInput,
  evidenceManifest,
  evidenceCommitment,
  evidencePath,
  sha256,
  type EvidenceRecord,
} from "@/lib/evidence/schema";
type Context = { params: Promise<{ path?: string[] }> };
async function visible(
  id: string,
  auth: Awaited<ReturnType<typeof requireWallet>>,
) {
  if (!z.string().uuid().safeParse(id).success)
    throw new ApiError(404, "Evidence not found.");
  const { data, error } = await auth.db
    .from("evidence")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiError(503, "Evidence storage is unavailable.");
  if (!data) throw new ApiError(404, "Evidence not found.");
  return data as EvidenceRecord;
}
async function complete(e: EvidenceRecord, actor: string) {
  const admin = adminSupabase();
  let actualHash: string | null = null;
  if (e.kind === "file") {
    const { data, error } = await admin.storage
      .from(EVIDENCE_BUCKET)
      .download(e.storage_path!);
    if (error || !data)
      throw new ApiError(
        409,
        "Upload the file before completing the evidence.",
      );
    if (data.size > MAX_FILE_BYTES || data.size !== e.byte_size)
      throw new ApiError(409, "Uploaded file size does not match.");
    actualHash = await sha256(new Uint8Array(await data.arrayBuffer()));
    if (actualHash !== e.file_hash)
      throw new ApiError(
        409,
        "Uploaded file content does not match its recorded hash. Create a new upload.",
      );
  }
  const manifest = evidenceManifest(e),
    salt = randomBytes(32).toString("hex"),
    commitment = await evidenceCommitment(manifest, salt);
  const { error } = await admin.rpc("complete_evidence", {
    p_id: e.id,
    p_actor: actor,
    p_file_hash: actualHash,
    p_salt: salt,
    p_commitment: commitment,
    p_manifest: manifest,
  });
  if (error)
    throw new ApiError(
      409,
      "Evidence changed, expired or was already completed.",
    );
  return { ...e, status: "ready", manifest, salt, commitment };
}
export async function GET(request: Request, context: Context) {
  try {
    const auth = await requireWallet(),
      path = (await context.params).path ?? [];
    if (path.length === 2 && path[1] === "download") {
      const e = await visible(path[0], auth);
      if (e.status !== "ready")
        throw new ApiError(409, "Evidence is not complete.");
      if (e.kind === "link")
        return json({ url: e.external_url, external: true });
      const { data, error } = await auth.db.storage
        .from(EVIDENCE_BUCKET)
        .createSignedUrl(e.storage_path!, 60, { download: e.filename! });
      if (error || !data)
        throw new ApiError(403, "File access expired or is unavailable.");
      return json({ url: data.signedUrl, expiresIn: 60, external: false });
    }
    if (path.length) throw new ApiError(404, "Not found.");
    const q = new URL(request.url).searchParams;
    const p = z
      .object({
        project: z.string().uuid(),
        version: z.coerce.number().int().positive(),
        index: z.coerce.number().int().min(0).max(19),
      })
      .safeParse(Object.fromEntries(q));
    if (!p.success)
      throw new ApiError(400, "Select a project version and milestone.");
    const { data: agreement, error: ae } = await auth.db
      .from("agreements")
      .select("version")
      .eq("project_id", p.data.project)
      .eq("version", p.data.version)
      .maybeSingle();
    if (ae) throw new ApiError(503, "Agreement lookup is unavailable.");
    if (!agreement) throw new ApiError(404, "Project not found.");
    const { data, error } = await auth.db
      .from("evidence")
      .select("*")
      .eq("project_id", p.data.project)
      .eq("agreement_version", p.data.version)
      .eq("milestone_index", p.data.index)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new ApiError(503, "Evidence storage is unavailable.");
    return json({ evidence: data });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const auth = await requireWallet(),
      path = (await context.params).path ?? [];
    if (path.length === 2 && path[1] === "complete") {
      const e = await visible(path[0], auth);
      if (e.uploader_wallet !== auth.wallet)
        throw new ApiError(
          403,
          "Only the uploader can complete this evidence.",
        );
      if (e.status !== "pending")
        throw new ApiError(409, "Evidence is already complete.");
      return json({ evidence: await complete(e, auth.wallet) });
    }
    if (path.length) throw new ApiError(404, "Not found.");
    const p = evidenceInput.safeParse(await readJSON(request));
    if (!p.success)
      throw new ApiError(400, p.error.issues.map((i) => i.message).join("; "));
    const v = p.data;
    const { data: project, error: pe } = await auth.db
      .from("projects")
      .select("client_wallet,freelancer_wallet")
      .eq("id", v.projectId)
      .maybeSingle();
    if (pe) throw new ApiError(503, "Project lookup is unavailable.");
    if (
      !project ||
      ![project.client_wallet, project.freelancer_wallet].includes(auth.wallet)
    )
      throw new ApiError(404, "Project not found.");
    if (v.purpose === "delivery" && auth.wallet !== project.freelancer_wallet)
      throw new ApiError(
        403,
        "Only the freelancer can prepare delivery evidence.",
      );
    const { data: agreement, error: ae } = await auth.db
      .from("agreements")
      .select("terms")
      .eq("project_id", v.projectId)
      .eq("version", v.version)
      .maybeSingle();
    if (
      ae ||
      !agreement ||
      !Array.isArray(agreement.terms?.milestones) ||
      v.index >= agreement.terms.milestones.length
    )
      throw new ApiError(404, "Milestone not found.");
    const admin = adminSupabase(),
      id = randomUUID(),
      attachment = v.attachment;
    const { count, error: ce } = await admin
      .from("evidence")
      .select("id", { count: "exact", head: true })
      .eq("uploader_wallet", auth.wallet)
      .eq("status", "pending")
      .gt("created_at", new Date(Date.now() - 600000).toISOString());
    if (ce) throw new ApiError(503, "Evidence storage is unavailable.");
    if ((count ?? 0) >= 10)
      throw new ApiError(429, "Finish existing uploads or wait ten minutes.");
    const row: Omit<
      EvidenceRecord,
      | "status"
      | "salt"
      | "commitment"
      | "manifest"
      | "created_at"
      | "completed_at"
    > = {
      external_url: null as string | null,
      storage_path: null as string | null,
      filename: null as string | null,
      mime_type: null as string | null,
      byte_size: null as number | null,
      file_hash: null as string | null,
      id,
      project_id: v.projectId,
      agreement_version: v.version,
      milestone_index: v.index,
      uploader_wallet: auth.wallet,
      purpose: v.purpose,
      title: v.title,
      note: v.note,
      kind: attachment.kind,
      ...(attachment.kind === "link"
        ? { external_url: attachment.url }
        : {
            storage_path: evidencePath(v.projectId, id),
            filename: attachment.filename,
            mime_type: attachment.mimeType,
            byte_size: attachment.byteSize,
            file_hash: attachment.fileHash,
          }),
    };
    const { data, error } = await admin
      .from("evidence")
      .insert(row)
      .select("*")
      .single();
    if (error || !data)
      throw new ApiError(503, "Could not reserve evidence storage.");
    const e = data as EvidenceRecord;
    return attachment.kind === "link"
      ? json({ evidence: await complete(e, auth.wallet) }, 201)
      : json(
          { evidence: e, bucket: EVIDENCE_BUCKET, path: e.storage_path },
          201,
        );
  } catch (e) {
    return failure(e);
  }
}
