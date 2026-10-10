import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { releaseContext } from "./lib/release-context.mjs";
try {
  let base = process.env.RELEASE_BASE_SHA;
  if (!base || /^0{40}$/.test(base))
    base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], {
      encoding: "utf8",
    }).trim();
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error("Invalid base.");
  const files = execFileSync("git", ["diff", "--name-only", base, "HEAD"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  const groups = {
    program: files.filter((f) => /^contracts\/(programs|idl)/.test(f)),
    migrations: files.filter((f) => /^supabase\/migrations/.test(f)),
    identity: files.filter((f) =>
      /devnet-deployment|Anchor.toml|env.example/.test(f),
    ),
    signing: files.filter((f) => /escrow|wallet|identity|pap/.test(f)),
    dependencies: files.filter((f) =>
      /package(-lock)?\.json|Cargo(\.lock|\.toml)/.test(f),
    ),
  };
  mkdirSync("validation-results/ci", { recursive: true });
  writeFileSync(
    "validation-results/ci/release-diff.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "release-diff",
        source: releaseContext(),
        base,
        checkedAt: new Date().toISOString(),
        groups,
        reviewRequired: Object.values(groups).some((v) => v.length > 0),
        limitation:
          "Classification only; review actual changes before release.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Release change classification saved. No deployment is approved.",
  );
} catch {
  console.error("Release diff unavailable. No approval established.");
  process.exitCode = 1;
}
