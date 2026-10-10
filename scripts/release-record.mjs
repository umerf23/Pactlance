import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import {
  gateIds,
  publicOrigin,
  releaseRecord,
  assessRelease,
  requiredObservations,
} from "./lib/release-policy.mjs";
import { releaseContext, sha256 } from "./lib/release-context.mjs";
const path = "validation-results/release-record.json";
function load(file) {
  if (!existsSync(file)) return null;
  const root = realpathSync("validation-results") + sep;
  if (!realpathSync(file).startsWith(root))
    throw new Error("Evidence must stay within validation-results.");
  const raw = readFileSync(file);
  if (raw.length > 2000000) throw new Error("Evidence exceeds bounded size.");
  return { digest: sha256(raw), report: JSON.parse(raw.toString()) };
}
try {
  mkdirSync("validation-results", { recursive: true });
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  if (process.argv[2] === "init") {
    const appURL = publicOrigin.parse(
        process.argv.includes("--app")
          ? arg("--app")
          : process.env.APP_URL || "http://localhost:3000",
      ),
      manifest = JSON.parse(
        readFileSync("contracts/devnet-deployment.json", "utf8"),
      );
    const record = releaseRecord.parse({
      schemaVersion: 1,
      kind: "release-record",
      source: releaseContext(),
      createdAt: new Date().toISOString(),
      target: process.argv.includes("--target")
        ? arg("--target")
        : "pap-preview",
      appURL,
      network: "devnet",
      program: manifest.program,
      mint: manifest.mint,
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
      ),
    });
    const destinations = [
      path,
      ...Object.keys(requiredObservations).map(
        (id) => `validation-results/${id}-observations.json`,
      ),
    ];
    if (destinations.some((file) => existsSync(file)))
      throw new Error("Existing release records must be preserved.");
    writeFileSync(path, JSON.stringify(record, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    for (const [id, observations] of Object.entries(requiredObservations))
      writeFileSync(
        `validation-results/${id}-observations.json`,
        JSON.stringify(
          {
            schemaVersion: 1,
            kind: "reviewed-release-observations",
            gate: id,
            status: "not_run",
            source: record.source,
            checkedAt: record.createdAt,
            appURL: record.appURL,
            network: record.network,
            program: record.program,
            mint: record.mint,
            observations: observations.map((key) => ({
              id: key,
              status: "NOT_RUN",
              reference: "",
            })),
          },
          null,
          2,
        ) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    console.log(
      `Created ${path}. All live/operational gates start NOT_RUN; no release is approved.`,
    );
  } else if (process.argv[2] === "attach") {
    const record = releaseRecord.parse(load(path)?.report),
      id = arg("--gate"),
      file = arg("--evidence"),
      reviewer = arg("--reviewer");
    if (
      !["--gate", "--evidence", "--reviewer"].every((n) =>
        process.argv.includes(n),
      ) ||
      id === "G1" ||
      !gateIds.includes(id)
    )
      throw new Error("Specify gate and reviewer.");
    const evidence = load(file);
    if (!evidence) throw new Error("Evidence missing.");
    record.gates[id] = {
      status: "PASS",
      observedAt: new Date().toISOString(),
      reviewer,
      evidence: [{ path: file, sha256: evidence.digest }],
    };
    releaseRecord.parse(record);
    writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
    console.log(
      `Attached reviewed evidence for ${id}. Run release:assess; attachment alone does not pass a gate.`,
    );
  } else if (process.argv[2] === "assess") {
    const record = releaseRecord.parse(load(path)?.report),
      source = releaseContext();
    if (
      !source.clean ||
      source.commit !== record.source.commit ||
      source.tree !== record.source.tree ||
      source.lockfileSha256 !== record.source.lockfileSha256
    )
      throw new Error("Checkout differs from clean candidate.");
    const automated = ["web", "native", "runtime"]
        .map((s) => load(`validation-results/ci/${s}.json`)?.report)
        .filter(Boolean),
      artifacts = {};
    for (const g of Object.values(record.gates))
      for (const ref of g.evidence)
        artifacts[ref.path] = load(resolve(ref.path));
    const decision = assessRelease(record, automated, artifacts);
    writeFileSync(
      "validation-results/release-decision.json",
      JSON.stringify(decision, null, 2) + "\n",
    );
    console.log(
      `${decision.decision}: blocked gates ${decision.blocked.join(", ") || "none"}. Mainnet remains unsupported.`,
    );
    if (decision.decision === "NO_GO") process.exitCode = 1;
  } else throw new Error("Use release:init, release:attach or release:assess.");
} catch {
  console.error(
    "Release record rejected. Check clean candidate, schema, evidence paths and references; existing records were preserved.",
  );
  process.exitCode = 1;
}
