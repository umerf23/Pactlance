import nacl from "tweetnacl";
import bs58 from "bs58";
export function verifyWalletSignature(
  wallet: string,
  message: string,
  signature: string,
): boolean {
  try {
    const publicKey = bs58.decode(wallet);
    const bytes = bs58.decode(signature);
    return (
      publicKey.length === 32 &&
      bytes.length === 64 &&
      nacl.sign.detached.verify(
        new TextEncoder().encode(message),
        bytes,
        publicKey,
      )
    );
  } catch {
    return false;
  }
}
