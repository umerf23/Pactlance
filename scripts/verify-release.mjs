import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import {
  releaseContext,
  redactLog,
  sha256,
  sbfCompilerEvidence,
} from "./lib/release-context.mjs";
const suite = process.argv[process.argv.indexOf("--suite") + 1];
const commands = {
  web: [["npm", ["run", "check"]]],
  native: [
    [
      "cargo",
      [
        "+1.90.0",
        "fmt",
        "--manifest-path",
        "contracts/Cargo.toml",
        "--all",
        "--check",
      ],
    ],
    [
      "cargo",
      [
        "+1.90.0",
        "test",
        "--manifest-path",
        "contracts/Cargo.toml",
        "--workspace",
        "--locked",
      ],
    ],
  ],
  runtime: [
    [
      "cargo-build-sbf",
      [
        "--tools-version",
        "v1.56",
        "--manifest-path",
        "contracts/programs/pactlance/Cargo.toml",
        "--",
        "--locked",
      ],
    ],
    ["npm", ["run", "test:escrow"]],
  ],
};
if (!process.argv.includes("--suite") || !Object.hasOwn(commands, suite)) {
  console.error("Usage: npm run verify:release -- --suite web|native|runtime");
  process.exit(1);
}
mkdirSync("validation-results/ci", { recursive: true });
const source = releaseContext(),
  report = {
    schemaVersion: 1,
    kind: "local-release-checks",
    suite,
    source,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: "in_progress",
    checks: [],
    expectedToolchain:
      suite === "web"
        ? "Node 24.19.0 / npm 11.9.0"
        : "Rust 1.90.0 / Agave 2.3.0 / platform-tools v1.56",
    artifactSha256: null,
    limitation:
      "Local automated checks only. No deployment, hosted privacy, browser wallet or customer-pilot proof.",
  };
const target = `validation-results/ci/${suite}.json`,
  save = () => writeFileSync(target, JSON.stringify(report, null, 2) + "\n");
save();
const npm = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["--version"],
  { encoding: "utf8", shell: process.platform === "win32", timeout: 10000 },
);
report.actualTools = { node: process.version, npm: npm.stdout?.trim() ?? null };
let failed =
  process.version !== "v24.19.0" ||
  npm.status !== 0 ||
  report.actualTools.npm !== "11.9.0";
if (suite === "native") {
  const rust = spawnSync("rustc", ["+1.90.0", "--version"], {
    encoding: "utf8",
    timeout: 10000,
  });
  report.actualTools.rust = rust.stdout?.trim() ?? null;
  failed ||=
    rust.status !== 0 || !report.actualTools.rust?.startsWith("rustc 1.90.0 ");
}
if (suite === "runtime") {
  const sbf = spawnSync("cargo-build-sbf", ["--version"], {
    encoding: "utf8",
    timeout: 10000,
  });
  report.actualTools.sbf = sbf.stdout?.split("\n")[0]?.trim() ?? null;
  failed ||=
    sbf.status !== 0 ||
    report.actualTools.sbf !== "solana-cargo-build-sbf 2.3.0";
}
if (failed) {
  report.status = "failed";
  report.completedAt = new Date().toISOString();
  save();
  console.error("Pinned toolchain missing/mismatched; no check marked passed.");
  process.exit(1);
}
for (const [command, args] of commands[suite]) {
  const start = Date.now(),
    windowsNpm = process.platform === "win32" && command === "npm",
    result = spawnSync(windowsNpm ? "npm.cmd" : command, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 20 * 60 * 1000,
      shell: windowsNpm,
    }),
    output = redactLog(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  let passed = result.status === 0 && !result.error;
  if (suite === "runtime" && command === "cargo-build-sbf" && passed) {
    let compiler = { version: null, pinned: false };
    try {
      compiler = sbfCompilerEvidence(
        JSON.parse(readFileSync("contracts/target/.rustc_info.json", "utf8")),
      );
    } catch {}
    report.actualTools.sbfRust = compiler.version;
    passed = compiler.pinned;
  }
  failed ||= !passed;
  const matches = [
    ...output.matchAll(/(?:Tests\s+|test result: ok\. )(\d+) passed/g),
  ];
  report.checks.push({
    command: [command, ...args].join(" "),
    status: passed ? "passed" : "failed",
    exitCode: result.status,
    durationMs: Date.now() - start,
    testsPassed: matches.length ? Number(matches[0][1]) : null,
  });
  writeFileSync(
    `validation-results/ci/${suite}-${report.checks.length}.log`,
    output,
    { mode: 0o600 },
  );
  console.log(`${passed ? "PASS" : "FAIL"} ${command} ${args.join(" ")}`);
  save();
  if (!passed) break;
}
const after = releaseContext();
if (
  after.commit !== source.commit ||
  after.lockfileSha256 !== source.lockfileSha256 ||
  !after.clean
)
  failed = true;
if (
  suite === "runtime" &&
  !failed &&
  existsSync("contracts/target/deploy/pactlance.so")
)
  report.artifactSha256 = sha256(
    readFileSync("contracts/target/deploy/pactlance.so"),
  );
report.status = failed ? "failed" : source.clean ? "passed" : "dirty_source";
report.completedAt = new Date().toISOString();
save();
console.log(
  `Evidence: ${target}. Dirty/changed source cannot pass. Logs stay local.`,
);
if (report.status !== "passed") process.exitCode = 1;
