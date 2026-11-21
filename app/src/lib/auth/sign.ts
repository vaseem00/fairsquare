import "server-only";
/**
 * HMAC signing for cookies and tokens (A§6.1).
 *   sign("aid", uuid)      → "<uuid>.<base64url(HMAC-SHA256(SESSION_SECRET, "aid:" + uuid))>"
 *   verify("aid", signed)  → uuid, or null when the signature does not match
 * Verification tries SESSION_SECRET, then SESSION_SECRET_PREVIOUS, so the secret can be rotated.
 * Comparisons use crypto.timingSafeEqual on equal-length buffers.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/** What a signature is for. A value signed for one purpose never verifies for another. */
export type SignPurpose = "aid" | "adm" | "rec" | (string & {});

function mac(secret: string, purpose: string, value: string): Buffer {
  return createHmac("sha256", secret).update(`${purpose}:${value}`).digest();
}

/** The active secret first, then the previous one (rotation). */
function secrets(): string[] {
  const e = getEnv();
  return e.SESSION_SECRET_PREVIOUS ? [e.SESSION_SECRET, e.SESSION_SECRET_PREVIOUS] : [e.SESSION_SECRET];
}

/** Constant-time equality; false for different lengths without comparing contents. */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** `<value>.<base64url signature>`. The value must not be empty. */
export function sign(purpose: SignPurpose, value: string): string {
  if (!value) throw new Error("sign: empty value");
  return `${value}.${mac(getEnv().SESSION_SECRET, purpose, value).toString("base64url")}`;
}

/** The signed value, or null when the input is malformed or no secret's signature matches. */
export function verify(purpose: SignPurpose, signed: string | null | undefined): string | null {
  if (!signed || signed.length > 1024) return null;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0 || dot === signed.length - 1) return null;
  const value = signed.slice(0, dot);
  const sigText = signed.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(sigText)) return null;
  const given = Buffer.from(sigText, "base64url");
  // Only the canonical encoding counts: the last base64url character carries padding bits that decoding
  // drops, so several spellings decode to the same bytes. Reject every spelling but the one sign() makes.
  if (given.toString("base64url") !== sigText) return null;
  for (const secret of secrets()) {
    if (safeEqual(given, mac(secret, purpose, value))) return value;
  }
  return null;
}

/** HMAC-SHA256(SESSION_SECRET, input) as hex. Used for IP hashes and the admin password check. */
export function hmacHex(input: string, secret: string = getEnv().SESSION_SECRET): string {
  return createHmac("sha256", secret).update(input).digest("hex");
}

/** Plain SHA-256 as hex (admin session ids are stored hashed). */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
