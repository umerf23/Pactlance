import { spawnSync } from "node:child_process";
const required = [
  ["node", "--version"],
  ["npm", "--version"],
  ["git", "--version"],
  ["rustc", "--version"],
  ["cargo", "--version"],
  ["solana", "--version"],
  ["anchor", "--version"],
];
let missing = false;
for (const [tool, flag] of required) {
  const result = spawnSync(tool, [flag], { encoding: "utf8" });
  const ok = !result.error && result.status === 0;
  console.log(
    `${ok ? "OK" : "MISSING"} ${tool}: ${ok ? result.stdout.trim() : "install before contract development"}`,
  );
  if (!ok) missing = true;
}
if (missing) process.exitCode = 1;
