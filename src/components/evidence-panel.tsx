"use client";
import { useCallback, useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import {
  evidenceCommitment,
  evidenceInput,
  MAX_FILE_BYTES,
  sha256,
  type EvidenceRecord,
} from "@/lib/evidence/schema";
export async function operationalAPI(path: string, body?: unknown) {
  const response = await fetch(path, {
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
export function EvidencePanel({
  projectId,
  version,
  index,
  canUpload,
  freelancer,
  onSaved,
}: {
  projectId: string;
  version: number;
  index: number;
  canUpload: boolean;
  freelancer: boolean;
  onSaved?: () => Promise<void>;
}) {
  const [records, setRecords] = useState<EvidenceRecord[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [title, setTitle] = useState(""),
    [note, setNote] = useState(""),
    [purpose, setPurpose] = useState<"delivery" | "dispute">(
      freelancer ? "delivery" : "dispute",
    ),
    [kind, setKind] = useState<"file" | "link">("file"),
    [file, setFile] = useState<File | null>(null),
    [url, setURL] = useState(""),
    [downloads, setDownloads] = useState<
      Record<string, { url: string; until: number }>
    >({});
  useEffect(() => {
    const timer = setInterval(() => {
      setDownloads((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([, value]) => value.until > Date.now(),
          ),
        ),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const load = useCallback(async () => {
    const data = await operationalAPI(
      `/api/evidence?project=${projectId}&version=${version}&index=${index}`,
    );
    const items = data.evidence as EvidenceRecord[];
    for (const e of items)
      if (
        !e.salt ||
        !e.commitment ||
        (await evidenceCommitment(e.manifest, e.salt)) !== e.commitment
      )
        throw new Error("Evidence integrity check failed.");
    setRecords(items);
  }, [projectId, version, index]);
  useEffect(() => {
    let active = true;
    operationalAPI(
      `/api/evidence?project=${projectId}&version=${version}&index=${index}`,
    )
      .then(async (d) => {
        const items = d.evidence as EvidenceRecord[];
        for (const e of items)
          if (
            !e.salt ||
            !e.commitment ||
            (await evidenceCommitment(e.manifest, e.salt)) !== e.commitment
          )
            throw new Error("Evidence integrity check failed.");
        if (active) setRecords(items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [projectId, version, index]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (kind === "file" && (!file || file.size > MAX_FILE_BYTES))
        throw new Error("Choose a supported file up to 20 MB.");
      const attachment =
        kind === "link"
          ? { kind: "link" as const, url }
          : {
              kind: "file" as const,
              filename: file!.name,
              mimeType: file!.type,
              byteSize: file!.size,
              fileHash: await sha256(new Uint8Array(await file!.arrayBuffer())),
            };
      const input = evidenceInput.parse({
        projectId,
        version,
        index,
        purpose,
        title,
        note,
        attachment,
      });
      const reserved = await operationalAPI("/api/evidence", input);
      if (kind === "file") {
        const { error } = await browserSupabase()
          .storage.from(reserved.bucket)
          .upload(reserved.path, file!, {
            contentType: file!.type,
            upsert: false,
          });
        if (error) throw new Error("File upload failed. Try a new upload.");
        await operationalAPI(
          `/api/evidence/${reserved.evidence.id}/complete`,
          {},
        );
      }
      setTitle("");
      setNote("");
      setURL("");
      setMessage(
        purpose === "dispute"
          ? "Supporting evidence saved privately. Select it when opening the dispute, or share it with the eligible reviewer."
          : onSaved
            ? "Saved privately. Select this attachment under its delivery requirement, then choose Submit work for review."
            : "Saved privately. Go to Payments, load saved attachments, and select this file or link before submitting delivery.",
      );
      await load();
      await onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save evidence.");
    } finally {
      setBusy(false);
    }
  }
  async function download(id: string) {
    setError("");
    try {
      const d = await operationalAPI(`/api/evidence/${id}/download`);
      setDownloads((old) => ({
        ...old,
        [id]: { url: d.url, until: Date.now() + (d.expiresIn ?? 60) * 1000 },
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="workspace-card evidence-panel">
      <h3>Work files & evidence · milestone {index + 1}</h3>
      <p className="muted">
        Add delivery files or links, and keep evidence for any dispute. Saved
        records are private and cannot be overwritten. Uploading alone does not
        submit work for review.
      </p>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <p role="status">{message}</p>
      {records.length === 0 ? (
        <p>
          No files or links saved yet. Add an attachment below to get started.
        </p>
      ) : (
        records.map((e) => (
          <article className="evidence-row" key={e.id}>
            <strong>{e.title}</strong>
            <p>
              {e.purpose} · {e.kind} ·{" "}
              {new Date(e.completed_at ?? e.created_at).toLocaleString()}
            </p>
            <p className="preserve-lines">{e.note}</p>
            <details className="technical-details">
              <summary>File verification details</summary>
              <code className="wrap-code">Commitment: {e.commitment}</code>
              <p>
                Agreement version {version}. A matching fingerprint verifies
                saved bytes, not work quality, correctness, or authorship.
              </p>
            </details>
            <div className="operational-actions">
              <button className="secondary" onClick={() => download(e.id)}>
                Get secure {e.kind === "file" ? "download" : "link"}
              </button>
              {downloads[e.id] && (
                <a
                  className="secondary"
                  href={downloads[e.id].url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open {e.kind === "file" ? "file" : "link"} ↗
                </a>
              )}
            </div>
          </article>
        ))
      )}
      {canUpload && (
        <form onSubmit={save} className="evidence-form">
          <h4>Add a file or link</h4>
          <div className="form-grid">
            <label>
              What is this attachment for?
              <select
                value={purpose}
                onChange={(e) =>
                  setPurpose(e.target.value as "delivery" | "dispute")
                }
              >
                {freelancer && <option value="delivery">Work delivery</option>}
                <option value="dispute">Supporting a dispute</option>
              </select>
            </label>
            <label>
              Attachment
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "file" | "link")}
              >
                <option value="file">Private file</option>
                <option value="link">External HTTPS link</option>
              </select>
            </label>
          </div>
          <label>
            Title
            <input
              required
              minLength={3}
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Notes
            <textarea
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {kind === "file" ? (
            <label>
              File · maximum 20 MB
              <input
                type="file"
                required
                accept=".pdf,.png,.jpg,.jpeg,.mp4,.zip,.txt"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          ) : (
            <>
              <label>
                HTTPS delivery/evidence link
                <input
                  required
                  type="url"
                  maxLength={2000}
                  value={url}
                  onChange={(e) => setURL(e.target.value)}
                />
              </label>
              <p className="muted">
                External links use the provider’s permissions. Restrict access
                there before sharing.
              </p>
            </>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Verifying and saving…" : "Save attachment"}
          </button>
        </form>
      )}
    </section>
  );
}
