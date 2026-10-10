import bs58 from "bs58";
import { spawnSync, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it, expect } from "vitest";
import {
  assessRelease,
  gateIds,
  requiredObservations,
} from "../scripts/lib/release-policy.mjs";
import {
  compareArtifact,
  redactLog,
  sbfCompilerEvidence,
} from "../scripts/lib/release-context.mjs";
const now = Date.parse("2026-10-09T12:00:00Z"),
  date = new Date(now).toISOString();
const source = {
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  clean: true,
  node: "v24.19.0",
  lockfileSha256: "c".repeat(64),
};
const identity = {
  network: "devnet",
  program: "9T95KC5YSQ7LV2KwUcY7SyBu6cYF6Urv8fXd7kYaWNpL",
  mint: "JCEk9179tFu5y8UQ6oMFSPrDybkXDkhoxMiom2FpyuU7",
};
function fixture() {
  const record = {
    schemaVersion: 1,
    kind: "release-record",
    source: { ...source },
    createdAt: date,
    target: "pap-preview",
    appURL: "https://app.example",
    ...identity,
    owners: {
      deployment: null,
      incident: null,
      upgrades: null,
      reviewers: null,
    },
    gates: Object.fromEntries(
      gateIds.map((id) => [
        id,
        { status: "NOT_RUN", observedAt: null, reviewer: null, evidence: [] },
      ]),
    ) as Record<
      string,
      {
        status: string;
        observedAt: string | null;
        reviewer: string | null;
        evidence: { path: string; sha256: string }[];
      }
    >,
  };
  const automated = ["web", "native", "runtime"].map((suite) => ({
    schemaVersion: 1,
    kind: "local-release-checks",
    suite,
    source: { ...source },
    completedAt: date,
    status: "passed",
    actualTools: {
      node: "v24.19.0",
      npm: "11.9.0",
      rust: "rustc 1.90.0 (test fixture)",
      sbf: "solana-cargo-build-sbf 2.3.0",
      sbfRust: "rustc 1.89.0-dev (test fixture)",
    },
    checks: Array(suite === "web" ? 1 : 2).fill({
      status: "passed",
      exitCode: 0,
      testsPassed: 8,
    }),
    artifactSha256: "d".repeat(64),
  }));
  return {
    record,
    automated,
    artifacts: {} as Record<
      string,
      { digest: string; report: Record<string, unknown> }
    >,
  };
}
function attach(
  f: ReturnType<typeof fixture>,
  id: string,
  details: Record<string, unknown>,
) {
  const path = `validation-results/${id}.json`,
    digest = "e".repeat(64);
  f.record.gates[id] = {
    status: "PASS",
    observedAt: date,
    reviewer: "operator",
    evidence: [{ path, sha256: digest }],
  };
  f.artifacts[path] = {
    digest,
    report: {
      source: { ...source },
      checkedAt: date,
      status: "passed",
      appURL: f.record.appURL,
      ...identity,
      ...details,
    },
  };
}
it("blocks unchecked live gates even when automated checks pass", () => {
  const f = fixture();
  expect(
    assessRelease(f.record, f.automated, f.artifacts, now).blocked,
  ).toEqual(["G2", "G3", "G4", "G5"]);
});
it("rejects stale, dirty, incomplete or different source and cannot override G1 manually", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.automated[0].source.commit = "f".repeat(40);
    },
    (f: ReturnType<typeof fixture>) => {
      f.automated[0].source.clean = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.automated[0].completedAt = "2026-10-01T12:00:00Z";
    },
    (f: ReturnType<typeof fixture>) => {
      f.automated[0].checks = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.record.source.clean = false;
    },
  ]) {
    const f = fixture();
    mutate(f);
    f.record.gates.G1.status = "PASS";
    expect(
      assessRelease(f.record, f.automated, f.artifacts, now).blocked,
    ).toContain("G1");
  }
});
it("validates digests, all required observations and same hosted environment", () => {
  const f = fixture();
  attach(f, "G3", {
    kind: "reviewed-release-observations",
    gate: "G3",
    observations: requiredObservations.G3.map((id) => ({
      id,
      status: "PASS",
      reference: "redacted-evidence",
    })),
  });
  expect(
    assessRelease(f.record, f.automated, f.artifacts, now).blocked,
  ).not.toContain("G3");
  f.artifacts["validation-results/G3.json"].digest = "f".repeat(64);
  expect(
    assessRelease(f.record, f.automated, f.artifacts, now).blocked,
  ).toContain("G3");
  f.artifacts["validation-results/G3.json"].digest = "e".repeat(64);
  f.artifacts["validation-results/G3.json"].report.appURL =
    "https://other.example";
  expect(
    assessRelease(f.record, f.automated, f.artifacts, now).blocked,
  ).toContain("G3");
});
it("rejects wrong capability and incomplete scripted workflow reports", () => {
  const f = fixture();
  attach(f, "G2", {
    kind: "read-only-devnet-preflight",
    genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    decimals: 6,
    papCapability: { version: 1 },
    artifactComparison: {
      bytesMatch: true,
      trailingPaddingZero: true,
      sha256: "d".repeat(64),
    },
  });
  expect(
    assessRelease(f.record, f.automated, f.artifacts, now).blocked,
  ).not.toContain("G2");
  f.artifacts["validation-results/G2.json"].report.papCapability = {
    version: 2,
  };
  expect(
    assessRelease(f.record, f.automated, f.artifacts, now).blocked,
  ).toContain("G2");
  attach(f, "G5", {
    kind: "scripted-pap-devnet-program-test",
    status: "in_progress",
    transactions: [],
    balancesVerified: false,
  });
  expect(
    assessRelease(f.record, f.automated, f.artifacts, now).blocked,
  ).toContain("G5");
});
it("never approves mainnet even with manually selected PASS", () => {
  const f = fixture();
  f.record.target = "mainnet";
  for (const g of Object.values(f.record.gates)) g.status = "PASS";
  expect(assessRelease(f.record, f.automated, f.artifacts, now)).toMatchObject({
    decision: "NO_GO",
    realMoneyPaymentsEnabled: false,
  });
});
it("rejects credential-bearing origins and path traversal", () => {
  const f = fixture();
  f.record.appURL = "https://user:secret@app.example";
  expect(() => assessRelease(f.record, [], {}, now)).toThrow();
  f.record.appURL = "https://app.example";
  f.record.gates.G3.evidence = [
    { path: "validation-results/../secret.json", sha256: "e".repeat(64) },
  ];
  expect(() => assessRelease(f.record, [], {}, now)).toThrow();
});
it("compares exact artifact bytes and rejects nonzero trailing data", () => {
  const b = Buffer.from([1, 2, 3]);
  expect(compareArtifact(Buffer.from([1, 2, 3, 0]), b)).toMatchObject({
    bytesMatch: true,
    trailingPaddingZero: true,
  });
  expect(
    compareArtifact(Buffer.from([1, 2, 3, 9]), b).trailingPaddingZero,
  ).toBe(false);
  expect(compareArtifact(Buffer.from([1, 2]), b).bytesMatch).toBe(false);
});
it("redacts operator credentials and private URLs from logs", () => {
  expect(
    redactLog(
      "RPC https://rpc.example/?api-key=abc Key actual-secret Bearer session-secret",
      {
        SOLANA_RPC_URL: "https://rpc.example/?api-key=abc",
        SUPABASE_SERVICE_ROLE_KEY: "actual-secret",
      },
    ),
  ).not.toMatch(/api-key=abc|actual-secret|session-secret/);
});
it("qualifies controlled preview only with complete distinct finalized receipts and verified balances", () => {
  const f = fixture();
  attach(f, "G2", {
    kind: "read-only-devnet-preflight",
    genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    decimals: 6,
    papCapability: { version: 1 },
    artifactComparison: {
      bytesMatch: true,
      trailingPaddingZero: true,
      sha256: "d".repeat(64),
    },
  });
  attach(f, "G3", {
    kind: "reviewed-release-observations",
    gate: "G3",
    observations: requiredObservations.G3.map((id) => ({
      id,
      status: "PASS",
      reference: "synthetic test fixture",
    })),
  });
  attach(f, "G4", {
    kind: "pap-upgrade-verification",
    capabilityVersion: 1,
    binaryHash: "d".repeat(64),
  });
  const transactions = Array.from({ length: 10 }, (_, i) => ({
    signature: bs58.encode(new Uint8Array(64).fill(i + 1)),
    commitment: "finalized",
    finalizedSlot: 100 + i,
  }));
  attach(f, "G5", {
    kind: "scripted-pap-devnet-program-test",
    transactions,
    balancesVerified: true,
  });
  expect(assessRelease(f.record, f.automated, f.artifacts, now).decision).toBe(
    "READY_FOR_CONTROLLED_BROWSER_VALIDATION",
  );
  transactions[1].signature = transactions[0].signature;
  expect(
    assessRelease(f.record, f.automated, f.artifacts, now).blocked,
  ).toContain("G5");
});

it("uses Cargo's SBF compiler probes and rejects native, old or wrong-path compilers", () => {
  const probe = (version: string, path: string, arch = "sbf") => ({
    outputs: {
      version: { success: true, code: 0, stdout: version + "\n" },
      target: {
        success: true,
        code: 0,
        stdout: `${path}\ntarget_arch="${arch}"\n`,
      },
    },
  });
  expect(
    sbfCompilerEvidence(
      probe(
        "rustc 1.89.0-dev (build)",
        "/cache/solana/v1.56/platform-tools/rust",
      ),
    ),
  ).toMatchObject({ pinned: true });
  for (const fixture of [
    probe("rustc 1.84.1-dev", "/cache/solana/v1.56/platform-tools/rust"),
    probe("rustc 1.89.0-dev", "/cache/solana/v1.48/platform-tools/rust"),
    probe(
      "rustc 1.89.0-dev",
      "/cache/solana/v1.56/platform-tools/rust",
      "x86_64",
    ),
    {},
  ])
    expect(sbfCompilerEvidence(fixture).pinned).toBe(false);
});

it("blocks missing or mismatched tool evidence and duplicate suite reports", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.automated[0].actualTools.node = "v22.0.0";
    },
    (f: ReturnType<typeof fixture>) => {
      f.automated[0].actualTools.npm = "11.8.0";
    },
    (f: ReturnType<typeof fixture>) => {
      f.automated[1].actualTools.rust = "rustc 1.89.0 (fixture)";
    },
    (f: ReturnType<typeof fixture>) => {
      f.automated[2].actualTools.sbf = "solana-cargo-build-sbf 2.2.0";
    },
    (f: ReturnType<typeof fixture>) => {
      f.automated[2].actualTools.sbfRust = "rustc 1.84.1-dev (fixture)";
    },
    (f: ReturnType<typeof fixture>) => {
      f.automated[0].actualTools = {} as (typeof f.automated)[0]["actualTools"];
    },
    (f: ReturnType<typeof fixture>) => {
      f.automated.push(f.automated[0]);
    },
    (f: ReturnType<typeof fixture>) => {
      f.record.source.node = "v22.0.0";
    },
  ]) {
    const f = fixture();
    mutate(f);
    expect(
      assessRelease(f.record, f.automated, f.artifacts, now).blocked,
    ).toContain("G1");
  }
});

it("blocks conflicting, duplicate, unknown and blank manual observations", () => {
  for (const variant of [
    "conflict",
    "duplicate",
    "unknown",
    "blank",
    "missing",
  ]) {
    const f = fixture();
    const observations = requiredObservations.G3.map((id) => ({
      id,
      status: "PASS",
      reference: "reviewed log",
    }));
    if (variant === "conflict")
      observations.push({ ...observations[0], status: "FAIL" });
    if (variant === "duplicate") observations[1] = { ...observations[0] };
    if (variant === "unknown")
      observations.push({
        id: "unexpected",
        status: "FAIL",
        reference: "failed check",
      });
    if (variant === "blank") observations[0].reference = "   ";
    if (variant === "missing") observations.pop();
    attach(f, "G3", {
      kind: "reviewed-release-observations",
      gate: "G3",
      observations,
    });
    expect(
      assessRelease(f.record, f.automated, f.artifacts, now).blocked,
    ).toContain("G3");
  }
});

it("replaces stale approval on rejected assessment and evidence attachment", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-cli-"));
  const script = resolve("scripts/release-record.mjs");
  const decisionPath = join(dir, "validation-results/release-decision.json");
  const recordPath = join(dir, "validation-results/release-record.json");
  const approval = () =>
    writeFileSync(
      decisionPath,
      JSON.stringify({ decision: "READY_FOR_CONTROLLED_BROWSER_VALIDATION" }),
    );
  const run = (args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  try {
    mkdirSync(join(dir, "validation-results"));
    // Invalid JSON must replace a prior approval even before source is read.
    approval();
    writeFileSync(recordPath, "broken JSON");
    expect(run(["assess"]).status).toBe(1);
    expect(JSON.parse(readFileSync(decisionPath, "utf8"))).toMatchObject({
      decision: "NO_GO",
      realMoneyPaymentsEnabled: false,
    });

    const f = fixture();
    writeFileSync(recordPath, JSON.stringify(f.record));
    writeFileSync(join(dir, "package-lock.json"), "{}");
    execFileSync("git", ["init", "--quiet"], { cwd: dir });
    execFileSync("git", ["add", "package-lock.json"], { cwd: dir });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd: dir },
    );
    approval();
    expect(run(["assess"]).status).toBe(1);
    expect(JSON.parse(readFileSync(decisionPath, "utf8")).decision).toBe(
      "NO_GO",
    );

    approval();
    writeFileSync(
      join(dir, "validation-results/G3.json"),
      JSON.stringify({ status: "not_run" }),
    );
    expect(
      run([
        "attach",
        "--gate",
        "G3",
        "--evidence",
        "validation-results/G3.json",
        "--reviewer",
        "operator",
      ]).status,
    ).toBe(0);
    expect(JSON.parse(readFileSync(decisionPath, "utf8")).decision).toBe(
      "NO_GO",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
