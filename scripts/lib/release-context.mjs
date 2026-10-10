import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function releaseContext() {
  const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  return {
    commit: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
    clean: git(["status", "--porcelain", "--untracked-files=normal"]) === "",
    node: process.version,
    lockfileSha256: sha256(readFileSync("package-lock.json")),
  };
}
export function requireCleanSource() {
  const source = releaseContext();
  if (!source.clean)
    throw new Error("Commit reviewed source before devnet writes.");
  return source;
}
export function compareArtifact(deployedCode, artifact) {
  return {
    sha256: sha256(artifact),
    size: artifact.length,
    bytesMatch:
      deployedCode.length >= artifact.length &&
      deployedCode.subarray(0, artifact.length).equals(artifact),
    trailingPaddingZero:
      deployedCode.length >= artifact.length &&
      deployedCode.subarray(artifact.length).every((b) => b === 0),
  };
}
// Cargo records the compiler probes actually used for the build. Agave's
// post-processing installer may relink rustup afterwards, so that link is not
// reliable evidence of which compiler produced the artifact.
export function sbfCompilerEvidence(info) {
  const outputs = Object.values(info?.outputs ?? {}).filter(
    (v) => v?.success === true && v.code === 0 && typeof v.stdout === "string",
  );
  const version =
    outputs
      .find((v) => /^rustc 1\.89\.0(?:-dev)?[ \n]/.test(v.stdout))
      ?.stdout.split("\n")[0] ?? null;
  const pinned = outputs.some(
    (v) =>
      v.stdout.includes('target_arch="sbf"') &&
      /\/v1\.56\/platform-tools\/rust\n/.test(v.stdout.replaceAll("\\", "/")),
  );
  return { version, pinned: !!version && pinned };
}
/** @param {unknown} value @param {Record<string,string|undefined>} env */
export function redactLog(value, env = process.env) {
  let result = String(value).replace(/\x1b\[[0-9;]*m/g, "");
  for (const [name, secret] of Object.entries(env))
    if (
      secret &&
      secret.length >= 8 &&
      /SECRET|PASSWORD|TOKEN|KEY|RPC_URL/.test(name)
    )
      result = result.split(secret).join("[REDACTED]");
  return result
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/https?:\/\/[^\s"'<>]+/g, (url) => {
      try {
        const u = new URL(url);
        if (u.username || u.password || u.search) return "[REDACTED_URL]";
      } catch {
        return "[REDACTED_URL]";
      }
      return url;
    });
}
