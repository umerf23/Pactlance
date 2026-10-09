import { expect, it, vi } from "vitest";
import { Keypair, Transaction } from "@solana/web3.js";
import type { WalletAdapter } from "@solana/wallet-adapter-base";
import { signDevnetTransaction } from "../src/lib/escrow/wallet-signing";
import { DEVNET_GENESIS } from "../src/lib/escrow/network";
import { fixture } from "./helpers/phase7-fixture";
async function setup() {
  const f = await fixture();
  const sign = vi.fn(async (input: { transaction: Uint8Array }) => {
    const tx = Transaction.from(input.transaction);
    tx.partialSign(f.keys[1]);
    return [
      {
        signedTransaction: new Uint8Array(
          tx.serialize({ requireAllSignatures: false, verifySignatures: true }),
        ),
      },
    ];
  });
  const account = {
    address: f.keys[1].publicKey.toBase58(),
    publicKey: f.keys[1].publicKey.toBytes(),
    chains: ["solana:devnet"],
    features: ["solana:signTransaction"],
  };
  const wallet = {
    accounts: [account],
    chains: ["solana:devnet"],
    features: {
      "solana:signTransaction": {
        supportedTransactionVersions: ["legacy"],
        signTransaction: sign,
      },
    },
  };
  return {
    ...f,
    sign,
    account,
    wallet,
    adapter: { standard: true, wallet } as unknown as WalletAdapter,
    rpc: { getGenesisHash: vi.fn().mockResolvedValue(DEVNET_GENESIS) },
  };
}
it("sends an explicit devnet chain while preserving the other participant's signature", async () => {
  const f = await setup();
  const signed = await signDevnetTransaction(
    f.adapter,
    f.keys[1].publicKey,
    f.rpc,
    f.tx,
  );
  expect(f.sign).toHaveBeenCalledWith(
    expect.objectContaining({ chain: "solana:devnet", account: f.account }),
  );
  expect(
    signed.signatures.find((s) => s.publicKey.equals(f.keys[0].publicKey))
      ?.signature,
  ).toEqual(f.tx.signatures[0].signature);
  expect(signed.verifySignatures()).toBe(true);
});
it("refuses mainnet RPC, mainnet-only accounts and nonstandard providers before prompting", async () => {
  const f = await setup();
  f.rpc.getGenesisHash.mockResolvedValueOnce("mainnet");
  await expect(
    signDevnetTransaction(f.adapter, f.keys[1].publicKey, f.rpc, f.tx),
  ).rejects.toThrow(/devnet/);
  f.account.chains = ["solana:mainnet"];
  await expect(
    signDevnetTransaction(f.adapter, f.keys[1].publicKey, f.rpc, f.tx),
  ).rejects.toThrow(/devnet signing/);
  await expect(
    signDevnetTransaction(
      {} as WalletAdapter,
      f.keys[1].publicKey,
      f.rpc,
      f.tx,
    ),
  ).rejects.toThrow(/Wallet Standard/);
  expect(f.sign).not.toHaveBeenCalled();
});
it("rejects a changed account or reviewed message even if the wallet signs it", async () => {
  const f = await setup();
  await expect(
    signDevnetTransaction(f.adapter, Keypair.generate().publicKey, f.rpc, f.tx),
  ).rejects.toThrow(/devnet signing/);
  f.sign.mockImplementation(async (input) => {
    const tx = Transaction.from(input.transaction);
    tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
    tx.partialSign(f.keys[0], f.keys[1]);
    return [{ signedTransaction: new Uint8Array(tx.serialize()) }];
  });
  await expect(
    signDevnetTransaction(f.adapter, f.keys[1].publicKey, f.rpc, f.tx),
  ).rejects.toThrow(/changed the reviewed/);
});
it("rejects loss of an existing joint signature", async () => {
  const f = await setup();
  f.sign.mockImplementation(async (input) => {
    const tx = Transaction.from(input.transaction);
    tx.signatures.forEach((s) => (s.signature = null));
    tx.partialSign(f.keys[1]);
    return [
      {
        signedTransaction: new Uint8Array(
          tx.serialize({ requireAllSignatures: false }),
        ),
      },
    ];
  });
  await expect(
    signDevnetTransaction(f.adapter, f.keys[1].publicKey, f.rpc, f.tx),
  ).rejects.toThrow(/existing participant/);
});
