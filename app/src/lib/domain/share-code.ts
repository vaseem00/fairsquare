/** Short share codes for /c/<code>: 6 symbols from a 32-letter alphabet without I, O, 0 or 1. */

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

function defaultRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** byte % 32 is unbiased because 256 % 32 = 0. */
export function generateShareCode(randomBytes: (n: number) => Uint8Array = defaultRandomBytes): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

/** Trim and uppercase; null unless the result is a valid code. */
export function normaliseCode(input: string): string | null {
  const c = String(input ?? "").trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

/** A stable 32-bit seed for a code (FNV-1a), used to draw the same stamp texture for the same code. */
export function codeSeed(code: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
