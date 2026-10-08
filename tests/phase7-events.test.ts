import { it, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import { settlementEvents } from "../src/lib/escrow/events";
async function setup() {
  const program = Keypair.generate().publicKey,
    project = Keypair.generate().publicKey,
    other = Keypair.generate().publicKey,
    b = Buffer.alloc(59),
    tag = Buffer.from(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("event:MilestoneSettled"),
      ),
    ).subarray(0, 8);
  tag.copy(b);
  project.toBuffer().copy(b, 8);
  b.writeUInt16LE(1, 40);
  b.writeBigUInt64LE(40n, 42);
  b.writeBigUInt64LE(60n, 50);
  return {
    program,
    project,
    other,
    line: `Program data: ${b.toString("base64")}`,
  };
}
it("reads the escrow's actual settlement split", async () => {
  const f = await setup();
  expect(
    await settlementEvents(
      [
        `Program ${f.program} invoke [1]`,
        f.line,
        `Program ${f.program} success`,
      ],
      f.program,
      f.project,
    ),
  ).toEqual([{ index: 1, client: "40", freelancer: "60" }]);
});
it("ignores another program's matching-looking events", async () => {
  const f = await setup();
  expect(
    await settlementEvents(
      [
        `Program ${f.program} invoke [1]`,
        `Program ${f.other} invoke [2]`,
        f.line,
        `Program ${f.other} success`,
        `Program ${f.program} success`,
      ],
      f.program,
      f.project,
    ),
  ).toEqual([]);
});
it("ignores fabricated invocation text inside program logs", async () => {
  const f = await setup();
  expect(
    await settlementEvents(
      [
        `Program ${f.other} invoke [1]`,
        `Program log: Program ${f.program} invoke [1]`,
        f.line,
      ],
      f.program,
      f.project,
    ),
  ).toEqual([]);
});
