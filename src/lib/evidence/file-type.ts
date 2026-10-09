// Validate the declared format against bytes, not browser-supplied MIME metadata.
// This is format screening, not malware scanning or a quality/authorship verdict.
export function matchesFileType(bytes: Uint8Array, mime: string): boolean {
  const starts = (...magic: number[]) =>
    magic.every((value, index) => bytes[index] === value);
  switch (mime) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "application/pdf":
      return starts(0x25, 0x50, 0x44, 0x46, 0x2d);
    case "video/mp4":
      return (
        bytes.length >= 12 &&
        new TextDecoder().decode(bytes.subarray(4, 8)) === "ftyp"
      );
    case "application/zip":
      return starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06);
    case "text/plain":
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return bytes.length > 0 && !bytes.includes(0);
      } catch {
        return false;
      }
    default:
      return false;
  }
}
