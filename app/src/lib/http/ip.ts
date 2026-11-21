import "server-only";
/**
 * Client IP and its hash (A§6.4). Raw IPs are never stored or logged:
 * ipHash = HMAC-SHA256(SESSION_SECRET, "ip:" + ip), truncated to 32 hex characters.
 *
 * Which header: the client controls everything it sends, and an edge proxy *appends* the address it
 * saw to `x-forwarded-for`, so the leftmost entry is whatever the client wrote. Never use it.
 * - `x-real-ip` first: Railway's edge sets it to the address that connected to it.
 * - Otherwise the rightmost `x-forwarded-for` entry: the one the nearest (trusted) proxy added.
 * - Otherwise "unknown" (local development, tests).
 */
import { hmacHex } from "@/lib/auth/sign";

interface HasHeaders {
  /** A Request's headers, or next/headers' read-only headers() in a server component. */
  headers: Pick<Headers, "get">;
}

export function clientIp(req: HasHeaders): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return hops.at(-1) ?? "unknown";
}

export function hashIp(ip: string): string {
  return hmacHex(`ip:${ip}`).slice(0, 32);
}

export function ipHashFor(req: HasHeaders): string {
  return hashIp(clientIp(req));
}
