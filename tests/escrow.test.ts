import { Buffer } from "buffer";
import { describe, expect, it } from "vitest";
import { Keypair, type AccountInfo } from "@solana/web3.js";
import { makeTerms } from "../src/lib/agreements/schema";
import { agreementCommitment } from "../src/lib/agreements/crypto";
import { bindAgreement } from "../src/lib/escrow/terms";
import {
  addresses,
  discriminator,
  encodeProjectTerms,
  verifyProjectAccount,
  createProjectInstruction,
  acceptProjectInstruction,
  fundInstruction,
  submitInstruction,
  approveInstruction,
} from "../src/lib/escrow/client";
const wallets = Array.from({ length: 6 }, () => Keypair.generate().publicKey);
async function fixture() {
  const terms = makeTerms(
    {
      title: "Five video edits",
      scope: "Edit five short videos for client",
      clientWallet: wallets[0].toBase58(),
      freelancerWallet: wallets[1].toBase58(),
      reviewerWallet: wallets[2].toBase58(),
      backupReviewerWallet: wallets[3].toBase58(),
      reviewHours: 72,
      backupDelayHours: 168,
      milestones: [0, 1].map((i) => ({
        title: `Batch ${i}`,
        scope: "Five edited videos delivered",
        acceptanceCriteria: "All five video files play",
        amount: "250.123456",
        fundingDeadline: `2030-01-0${i + 1}T00:00:00.000Z`,
        deliveryDeadline: `2030-02-0${i + 1}T00:00:00.000Z`,
      })),
    },
    "01010101-0101-0101-0101-010101010101",
    1,
  );
  const salt = "42".repeat(32),
    record = {
      project_id: terms.projectId,
      version: 1,
      terms,
      salt,
      commitment: await agreementCommitment(terms, salt),
      created_at: "2030-01-01T00:00:00.000Z",
    };
  const a = await bindAgreement(
    record,
    wallets[4].toBase58(),
    wallets[5].toBase58(),
  );
  const account: AccountInfo<Buffer> = {
    owner: wallets[4],
    executable: false,
    lamports: 1,
    data: Buffer.concat([
      await discriminator("account", "Project"),
      encodeProjectTerms(a),
      Buffer.from([1, 1, 0, 0, 0, 0]),
    ]),
  };
  return { a, record, account };
}
describe("escrow client", () => {
  it("binds fresh terms without mutating the original agreement", async () => {
    const { a, record } = await fixture();
    expect(a.commitment).not.toBe(record.commitment);
    expect(record.terms.escrowProgram).toBeNull();
    expect(a.terms.schemaVersion).toBe(2);
    await expect(
      bindAgreement(
        record,
        "Fg6PaFpoGXkYsidMpWxTWqkZq7FEfcYkgMQhgqJM6dS9",
        wallets[5].toBase58(),
      ),
    ).rejects.toThrow();
    record.terms.scope = "Tampered";
    await expect(
      bindAgreement(record, wallets[4].toBase58(), wallets[5].toBase58()),
    ).rejects.toThrow();
  });
  it("keeps one project across versions and separate milestone vaults", async () => {
    const { a } = await fixture(),
      first = addresses(a),
      second = addresses(a, 1);
    expect(first.project.equals(second.project)).toBe(true);
    expect(first.vault.equals(second.vault)).toBe(false);
    a.terms.version++;
    expect(addresses(a).project.equals(first.project)).toBe(true);
  });
  it("rejects owner, discriminator and economic-term substitutions", async () => {
    const { a, account } = await fixture();
    expect((await verifyProjectAccount(a, account)).next).toBe(0);
    await expect(
      verifyProjectAccount(a, { ...account, owner: wallets[0] }),
    ).rejects.toThrow();
    for (const offset of [0, 8, 60, 240]) {
      const data = Buffer.from(account.data);
      data[offset] ^= 1;
      await expect(
        verifyProjectAccount(a, { ...account, data }),
      ).rejects.toThrow();
    }
  });
  it("blocks funding without both acceptances or with another active milestone", async () => {
    const { a, account } = await fixture(),
      start = 8 + encodeProjectTerms(a).length;
    for (const [offset, value] of [
      [start, 0],
      [start + 1, 0],
      [start + 4, 1],
      [start + 5, 1],
    ]) {
      const data = Buffer.from(account.data);
      data[offset] = value;
      await expect(
        fundInstruction(a, 0, wallets[0], { ...account, data }),
      ).rejects.toThrow();
    }
    await expect(fundInstruction(a, 1, wallets[0], account)).rejects.toThrow();
  });
  it("encodes exact amounts and participant instruction accounts", async () => {
    const { a, account } = await fixture(),
      encoded = encodeProjectTerms(a);
    expect(encoded.readBigUInt64LE(232)).toBe(250123456n);
    const create = await createProjectInstruction(a, wallets[0]);
    expect(create.data.subarray(8).equals(encoded)).toBe(true);
    expect(create.keys[1].isSigner).toBe(true);
    expect(
      (await acceptProjectInstruction(a, wallets[1], account)).data.length,
    ).toBe(40);
    expect(
      (await fundInstruction(a, 0, wallets[0], account)).keys[1].isWritable,
    ).toBe(true);
    expect(
      (await submitInstruction(a, 0, "ab".repeat(32))).keys[0].pubkey.equals(
        wallets[1],
      ),
    ).toBe(true);
    expect(
      (await approveInstruction(a, 0, wallets[1])).keys[0].pubkey.equals(
        wallets[0],
      ),
    ).toBe(true);
  });
  it("rejects empty evidence, fractional seconds, overflow and invalid indices", async () => {
    const { a, account } = await fixture();
    await expect(submitInstruction(a, 0, "0".repeat(64))).rejects.toThrow();
    expect(() => addresses(a, -1)).toThrow();
    expect(() => addresses(a, 2)).toThrow();
    const fractional = structuredClone(a);
    fractional.terms.milestones[0].fundingDeadline =
      fractional.terms.milestones[0].fundingDeadline.replace(".000Z", ".001Z");
    expect(() => encodeProjectTerms(fractional)).toThrow("whole seconds");
    a.terms.milestones[0].amountUnits = (1n << 64n).toString();
    expect(() => encodeProjectTerms(a)).toThrow();
    await expect(fundInstruction(a, 0, wallets[0], account)).rejects.toThrow();
  });
});
