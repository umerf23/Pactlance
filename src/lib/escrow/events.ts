import { PublicKey } from "@solana/web3.js";
export async function settlementEvents(
  logs: string[],
  program: PublicKey,
  project: PublicKey,
) {
  const tag = Buffer.from(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("event:MilestoneSettled"),
    ),
  ).subarray(0, 8);
  const stack: string[] = [],
    result: { index: number; client: string; freelancer: string }[] = [];
  for (const log of logs) {
    const invoke = /^Program (\w+) invoke \[(\d+)\]$/.exec(log),
      done = /^Program (\w+) (?:success|failed:.*)$/.exec(log);
    if (invoke) {
      stack.length = Number(invoke[2]) - 1;
      stack.push(invoke[1]);
      continue;
    }
    if (done) {
      if (stack.at(-1) === done[1]) stack.pop();
      continue;
    }
    if (
      stack.at(-1) !== program.toBase58() ||
      !log.startsWith("Program data: ")
    )
      continue;
    const data = Buffer.from(log.slice(14), "base64");
    if (
      data.length !== 59 ||
      !data.subarray(0, 8).equals(tag) ||
      !data.subarray(8, 40).equals(project.toBuffer())
    )
      continue;
    result.push({
      index: data.readUInt16LE(40),
      client: data.readBigUInt64LE(42).toString(),
      freelancer: data.readBigUInt64LE(50).toString(),
    });
  }
  return result;
}
