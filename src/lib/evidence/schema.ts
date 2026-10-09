import { z } from "zod";
import { canonicalJSON } from "../agreements/crypto";
export const EVIDENCE_BUCKET = "pactlance-evidence";
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const evidenceInput = z
  .object({
    projectId: z.string().uuid(),
    version: z.number().int().positive(),
    index: z.number().int().min(0).max(19),
    purpose: z.enum(["delivery", "dispute"]),
    title: z.string().trim().min(3).max(120),
    note: z.string().trim().max(2000),
    attachment: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("file"),
          filename: z
            .string()
            .min(1)
            .max(160)
            .refine((v) => !/[\x00-\x1f/\\]/.test(v)),
          mimeType: z.enum([
            "application/pdf",
            "image/png",
            "image/jpeg",
            "video/mp4",
            "application/zip",
            "text/plain",
          ]),
          byteSize: z.number().int().min(1).max(MAX_FILE_BYTES),
          fileHash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      z
        .object({
          kind: z.literal("link"),
          url: z
            .string()
            .url()
            .max(2000)
            .refine((v) => {
              const u = new URL(v);
              return u.protocol === "https:" && !u.username && !u.password;
            }, "Use an HTTPS link without embedded credentials."),
        })
        .strict(),
    ]),
  })
  .strict();
export interface EvidenceRecord {
  id: string;
  project_id: string;
  agreement_version: number;
  milestone_index: number;
  uploader_wallet: string;
  purpose: "delivery" | "dispute";
  title: string;
  note: string;
  kind: "file" | "link";
  external_url: string | null;
  storage_path: string | null;
  filename: string | null;
  mime_type: string | null;
  byte_size: number | null;
  file_hash: string | null;
  status: "pending" | "ready";
  salt: string | null;
  commitment: string | null;
  manifest: unknown;
  created_at: string;
  completed_at: string | null;
}
export async function sha256(value: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(value));
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function evidenceManifest(e: EvidenceRecord) {
  return {
    schemaVersion: 1,
    projectId: e.project_id,
    agreementVersion: e.agreement_version,
    milestoneIndex: e.milestone_index,
    evidenceId: e.id,
    uploader: e.uploader_wallet,
    purpose: e.purpose,
    title: e.title,
    note: e.note,
    attachment:
      e.kind === "file"
        ? {
            kind: "file",
            filename: e.filename,
            mimeType: e.mime_type,
            byteSize: e.byte_size,
            sha256: e.file_hash,
          }
        : { kind: "link", url: e.external_url },
  };
}
export async function evidenceCommitment(manifest: unknown, salt: string) {
  if (!/^[a-f0-9]{64}$/.test(salt)) throw new Error("Invalid evidence salt.");
  return sha256(
    new TextEncoder().encode(
      `pactlance:evidence:v1\n${salt}\n${canonicalJSON(manifest)}`,
    ),
  );
}
export function evidencePath(project: string, id: string) {
  return `${z.string().uuid().parse(project)}/${z.string().uuid().parse(id)}`;
}
