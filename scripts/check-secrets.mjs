import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const rules = [
  ["private key PEM", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "assigned server credential",
    /(?:SUPABASE_SERVICE_ROLE_KEY|CLAIM_WORKER_SECRET_KEY|CRON_SECRET)\s*=\s*["']?[A-Za-z0-9+/=_-]{24,}/,
  ],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{20,}/],
];
let failed = false;
function inspect(text, location) {
  for (const [kind, pattern] of rules)
    if (pattern.test(text)) {
      // Report location/type only: never echo the matching value or source line.
      console.error(`Potential ${kind}: ${location}`);
      failed = true;
    }
}
const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
for (const path of paths) {
  if (/\.(png|jpg|jpeg|gif|woff2?|pdf)$/.test(path)) continue;
  inspect(readFileSync(path, "utf8"), path);
  if (/(?:^|\/)\.env(?:\.|$)/.test(path) && path !== ".env.example") {
    console.error(`Tracked environment file: ${path}`);
    failed = true;
  }
  if (/(?:^|\/)[^/]*-keypair\.json$/.test(path)) {
    console.error(`Tracked keypair file: ${path}`);
    failed = true;
  }
}
// CI fetches full history. This checks all refs available in this clone.
const history = execFileSync(
  "git",
  [
    "log",
    "--all",
    "-p",
    "--format=commit %H",
    "--",
    ".",
    ":!package-lock.json",
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
inspect(history, "available Git history");
if (failed) process.exitCode = 1;
else
  console.log(
    "Credential-pattern checks passed for tracked files and available Git history. Heuristic screening is not proof that no secret exists.",
  );
