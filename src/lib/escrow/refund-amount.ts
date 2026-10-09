import { parseTokenAmount } from "../domain";

export function refundUnits(value: string): bigint | null {
  if (/^0(?:\.0{1,6})?$/.test(value)) return 0n;
  try {
    return parseTokenAmount(value, 6);
  } catch {
    return null;
  }
}
