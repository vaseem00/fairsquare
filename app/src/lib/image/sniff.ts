/**
 * Image type by magic bytes (A§4.3 step 5, A§5.7). The declared MIME type and file name are ignored:
 * only JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`) and WebP (`RIFF....WEBP`) are accepted.
 * Pure and dependency-free; used by POST /api/extract.
 */

export type SniffedType = "image/jpeg" | "image/png" | "image/webp";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

/** The image type the bytes start with, or null when they are not a JPEG, PNG or WebP image. */
export function sniffImage(bytes: Uint8Array): SniffedType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  // "RIFF" <4-byte size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}
