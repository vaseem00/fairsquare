import "server-only";
/**
 * CSRF origin check (A§6.3) for POST, PUT, PATCH and DELETE:
 * - `Sec-Fetch-Site`, when present, must not be `cross-site`;
 * - an `Origin` header is required, and its host must equal `x-forwarded-host ?? host`
 *   (and, in production, APP_URL's host);
 * - outside production any `http://localhost:*` (or 127.0.0.1) origin is accepted.
 * Anything else is `403 bad_origin`.
 */
import { getEnv } from "@/lib/env";
import { HttpError } from "./errors";

export const UNSAFE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface OriginRequest {
  method: string;
  headers: Headers;
}

function firstValue(v: string | null): string | null {
  const s = v?.split(",")[0]?.trim();
  return s ? s.toLowerCase() : null;
}

function isLocalDevOrigin(url: URL): boolean {
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

/** True when the request may mutate state. Safe methods always pass. */
export function isAllowedOrigin(req: OriginRequest): boolean {
  if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return true;
  const site = req.headers.get("sec-fetch-site");
  if (site && site.toLowerCase() === "cross-site") return false;
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const env = getEnv();
  if (!env.isProduction && isLocalDevOrigin(url)) return true;
  const expectedHost = firstValue(req.headers.get("x-forwarded-host")) ?? firstValue(req.headers.get("host"));
  if (!expectedHost || url.host.toLowerCase() !== expectedHost) return false;
  if (env.isProduction) {
    const appHost = new URL(env.APP_URL).host.toLowerCase();
    if (url.host.toLowerCase() !== appHost) return false;
  }
  return true;
}

/** Throws `403 bad_origin` when the check fails. */
export function assertSameOrigin(req: OriginRequest): void {
  if (!isAllowedOrigin(req)) throw new HttpError(403, "bad_origin");
}
