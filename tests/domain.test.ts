import { describe, expect, it } from "vitest";
import {
  formatTokenAmount,
  nextFundableMilestone,
  parseTokenAmount,
} from "../src/lib/domain";
import { demoProject } from "../src/lib/fixtures";
import { validatePublicConfig } from "../src/lib/config";
describe("token units", () => {
  it("preserves amounts beyond JS safe integer precision", () => {
    const value = "9007199254.740993";
    expect(formatTokenAmount(parseTokenAmount(value, 6))).toBe(value);
  });
  it.each(["0", "-1", "1e3", "1.0000001", "18446744073709.551616"])(
    "rejects unsafe input %s",
    (value) => {
      expect(() => parseTokenAmount(value, 6)).toThrow();
    },
  );
  it("handles zero-decimal tokens", () => {
    expect(parseTokenAmount("250", 0)).toBe(250n);
    expect(formatTokenAmount(250n, 0)).toBe("250");
  });
});
describe("sequential milestones (presentation only)", () => {
  it("selects the first accepted batch", () => {
    expect(nextFundableMilestone(demoProject.milestones)).toBe("batch-1");
  });
  it.each(["funded", "submitted", "disputed"] as const)(
    "blocks later funding during %s",
    (status) => {
      expect(
        nextFundableMilestone(
          demoProject.milestones.map((m, i) =>
            i === 0 ? { ...m, status } : m,
          ),
        ),
      ).toBeNull();
    },
  );
  it("permits the next batch after settlement", () => {
    expect(
      nextFundableMilestone(
        demoProject.milestones.map((m, i) =>
          i === 0 ? { ...m, status: "settled" } : m,
        ),
      ),
    ).toBe("batch-2");
  });
  it("does not skip unaccepted work", () => {
    expect(
      nextFundableMilestone(
        demoProject.milestones.map((m, i) =>
          i === 0 ? { ...m, status: "awaiting_acceptance" } : m,
        ),
      ),
    ).toBeNull();
  });
});
describe("public configuration", () => {
  it("defaults to devnet with payments disabled", () => {
    expect(validatePublicConfig({})).toMatchObject({
      network: "devnet",
      paymentsEnabled: false,
    });
  });
  it("rejects mainnet", () => {
    expect(() =>
      validatePublicConfig({ NEXT_PUBLIC_SOLANA_NETWORK: "mainnet-beta" }),
    ).toThrow();
  });
  it("rejects insecure RPC", () => {
    expect(() =>
      validatePublicConfig({
        NEXT_PUBLIC_SOLANA_RPC_URL: "http://example.com",
      }),
    ).toThrow();
  });
});
