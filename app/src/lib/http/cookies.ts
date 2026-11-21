import "server-only";
/**
 * Cookie names, attributes and serialisation (A§6.1). Route handlers never use `next/headers`:
 * they read `req.cookies` and write Set-Cookie on the response through `ctx.setCookie()`.
 */
import { getEnv } from "@/lib/env";

export const ANON_COOKIE = "mz_aid";
export const ADMIN_COOKIE = "mz_admin";

/** 400 days, the longest Max-Age browsers accept. Re-issued on each anon-required request. */
export const ANON_MAX_AGE_SEC = 400 * 24 * 60 * 60;
/** Admin sessions last 12 hours. */
export const ADMIN_MAX_AGE_SEC = 12 * 60 * 60;

export interface CookieOpts {
  /** Seconds; 0 deletes the cookie. */
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
}

const NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** One Set-Cookie header value. The value is URI-encoded. */
export function serializeCookie(name: string, value: string, opts: CookieOpts = {}): string {
  if (!NAME_RE.test(name)) throw new Error(`cookie: invalid name "${name}"`);
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? "/"}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite[0].toUpperCase()}${opts.sameSite.slice(1)}`);
  return parts.join("; ");
}

/** Secure only in production (local dev runs on http://localhost). */
function secure(): boolean {
  return getEnv().isProduction;
}

/** mz_aid: HttpOnly, Secure (prod), SameSite=Lax, Path=/, Max-Age 400 days. */
export function anonCookieOptions(): CookieOpts {
  return { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", maxAge: ANON_MAX_AGE_SEC };
}

/** mz_admin: HttpOnly, Secure (prod), SameSite=Strict, Path=/, Max-Age 12 h. */
export function adminCookieOptions(): CookieOpts {
  return { httpOnly: true, secure: secure(), sameSite: "strict", path: "/", maxAge: ADMIN_MAX_AGE_SEC };
}

/** Options that delete a cookie set with `base` (same Path/SameSite, Max-Age=0). */
export function clearCookieOptions(base: CookieOpts): CookieOpts {
  return { ...base, maxAge: 0, expires: new Date(0) };
}
