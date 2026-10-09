import { expect, it } from "vitest";
import { matchesFileType } from "../src/lib/evidence/file-type";
it("screens each allowed binary format against bytes", () => {
  const examples: [string, number[]][] = [
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/jpeg", [0xff, 0xd8, 0xff]],
    ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]],
    [
      "video/mp4",
      [0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d],
    ],
    ["application/zip", [0x50, 0x4b, 0x03, 0x04]],
  ];
  for (const [mime, bytes] of examples) {
    expect(matchesFileType(Uint8Array.from(bytes), mime)).toBe(true);
    expect(
      matchesFileType(new TextEncoder().encode("not this format"), mime),
    ).toBe(false);
  }
});
it("rejects empty, null-containing or invalid UTF-8 text and unknown formats", () => {
  expect(
    matchesFileType(
      new TextEncoder().encode("Synthetic evidence"),
      "text/plain",
    ),
  ).toBe(true);
  for (const bytes of [[], [0], [0xff, 0xfe]])
    expect(matchesFileType(Uint8Array.from(bytes), "text/plain")).toBe(false);
  expect(matchesFileType(new Uint8Array(8), "application/octet-stream")).toBe(
    false,
  );
});
