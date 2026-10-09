import { expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { AccountLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { readWalletBalances } from "../src/lib/escrow/wallet-readiness";
import { DEVNET_GENESIS } from "../src/lib/escrow/network";
import { projectIdFromLink, projectLink } from "../src/lib/project-links";
import { refundUnits } from "../src/lib/escrow/refund-amount";
it("converts readable settlement amounts exactly without floating-point rounding", () => {
  expect(refundUnits("12.345678")).toBe(12345678n);
  expect(refundUnits("0.000001")).toBe(1n);
  expect(refundUnits("0.000000")).toBe(0n);
  for (const value of ["-1", "1.0000001", "1e3", "NaN", "", "1,000"])
    expect(refundUnits(value)).toBeNull();
});
it("does not query balances from a foreign network", async () => {
  const getBalance = vi.fn();
  const getAccountInfo = vi.fn();
  await expect(
    readWalletBalances(
      { getGenesisHash: async () => "mainnet", getBalance, getAccountInfo },
      Keypair.generate().publicKey,
      Keypair.generate().publicKey,
    ),
  ).rejects.toThrow("devnet");
  expect(getBalance).not.toHaveBeenCalled();
  expect(getAccountInfo).not.toHaveBeenCalled();
});
it("treats absent token accounts as zero but does not conceal RPC failures", async () => {
  const connection = {
    getGenesisHash: async () => DEVNET_GENESIS,
    getBalance: vi.fn().mockResolvedValue(123),
    getAccountInfo: vi.fn().mockResolvedValue(null),
  };
  const wallet = Keypair.generate().publicKey,
    mint = Keypair.generate().publicKey;
  await expect(readWalletBalances(connection, wallet, mint)).resolves.toEqual({
    lamports: 123,
    tokenUnits: 0n,
  });
  connection.getAccountInfo.mockRejectedValue(new Error("RPC unavailable"));
  await expect(readWalletBalances(connection, wallet, mint)).rejects.toThrow(
    "RPC unavailable",
  );
});
it("verifies token ownership, mint and spendability instead of trusting arbitrary account bytes", async () => {
  const wallet = Keypair.generate().publicKey,
    mint = Keypair.generate().publicKey;
  const bytes = (owner = wallet, tokenMint = mint, state = 1) => {
    const data = Buffer.alloc(AccountLayout.span);
    AccountLayout.encode(
      {
        mint: tokenMint,
        owner,
        amount: 987654321n,
        delegateOption: 0,
        delegate: wallet,
        state,
        isNativeOption: 0,
        isNative: 0n,
        delegatedAmount: 0n,
        closeAuthorityOption: 0,
        closeAuthority: wallet,
      },
      data,
    );
    return data;
  };
  const info = (data: Buffer) => ({
    data,
    executable: false,
    lamports: 1,
    owner: TOKEN_PROGRAM_ID,
    rentEpoch: 0,
  });
  const connection = {
    getGenesisHash: async () => DEVNET_GENESIS,
    getBalance: vi.fn().mockResolvedValue(123),
    getAccountInfo: vi.fn().mockResolvedValue(info(bytes())),
  };
  await expect(readWalletBalances(connection, wallet, mint)).resolves.toEqual({
    lamports: 123,
    tokenUnits: 987654321n,
  });
  for (const data of [
    bytes(Keypair.generate().publicKey),
    bytes(wallet, Keypair.generate().publicKey),
    bytes(wallet, mint, 2),
    bytes(wallet, mint, 0),
  ]) {
    connection.getAccountInfo.mockResolvedValue(info(data));
    await expect(readWalletBalances(connection, wallet, mint)).rejects.toThrow(
      "invalid or frozen",
    );
  }
});
it("accepts one UUID project identifier and rejects malformed links", () => {
  const id = "5767de47-9589-4994-b41e-2930a97d3dd1";
  expect(projectLink("https://app.example/anything", id)).toBe(
    `https://app.example/workspace?project=${id}`,
  );
  for (const input of [
    undefined,
    [id, id],
    "../../api/profile",
    "javascript:alert(1)",
  ])
    expect(projectIdFromLink(input)).toBeNull();
  expect(() => projectLink("https://app.example", "../other")).toThrow();
});
