import "server-only";
/**
 * The anonymous id (A§6.1): `mz_aid = <uuid v4>.<base64url(HMAC-SHA256(SESSION_SECRET, "aid:" + uuid))>`.
 * - `readAnon` / `readAnonFromCookies` only verify; they never issue a cookie.
 * - `requireAnon` issues a cookie when there is no valid one (a tampered value counts as absent),
 *   re-issues it on every call (rolling 400-day Max-Age) and upserts `anon_users`. An id erased by
 *   "Delete all my data" (`deleted_anon_ids`) counts as absent: a fresh id is issued.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { Db } from "@/lib/db/client";
import { ensureAnonUser, isDeletedAnonId, UUID_RE } from "@/lib/db/repo/anon";
import { ANON_COOKIE, anonCookieOptions, type CookieOpts } from "@/lib/http/cookies";
import { sign, verify } from "./sign";

const PURPOSE = "aid";

/** The verified uuid inside a cookie value, or null. */
export function verifyAnonCookie(value: string | null | undefined): string | null {
  const id = verify(PURPOSE, value);
  return id && UUID_RE.test(id) ? id.toLowerCase() : null;
}

/** The signed cookie value for an id. */
export function signAnonId(id: string): string {
  if (!UUID_RE.test(id)) throw new Error("signAnonId: not a uuid");
  return sign(PURPOSE, id.toLowerCase());
}

/** Route handlers: the verified anon id from `req.cookies`, or null. */
export function readAnon(req: NextRequest): string | null {
  return verifyAnonCookie(req.cookies.get(ANON_COOKIE)?.value);
}

/** Server pages (e.g. `/c`): `readAnonFromCookies(await cookies())`. Verify only, never issues. */
export function readAnonFromCookies(store: { get(name: string): { value: string } | undefined }): string | null {
  return verifyAnonCookie(store.get(ANON_COOKIE)?.value);
}

export type SetCookie = (name: string, value: string, opts: CookieOpts) => void;

/**
 * The anon id for this request, issuing one when needed. Always (re)sets the cookie and upserts the
 * `anon_users` row; `refCode` is stored on first touch only.
 */
export async function requireAnon(
  db: Db,
  req: NextRequest,
  setCookie: SetCookie,
  refCode?: string | null,
): Promise<{ id: string; issued: boolean }> {
  let existing = readAnon(req);
  // A signed cookie has no server state: a copy left in another browser after "Delete all my data"
  // still verifies. An erased id is never recreated; that browser gets a fresh one instead.
  if (existing && (await isDeletedAnonId(db, existing))) existing = null;
  const id = existing ?? randomUUID();
  await ensureAnonUser(db, id, refCode);
  setAnonCookie(setCookie, id);
  return { id, issued: existing === null };
}

/** Writes `mz_aid` for `id` (also used by the recovery link). */
export function setAnonCookie(setCookie: SetCookie, id: string): void {
  setCookie(ANON_COOKIE, signAnonId(id), anonCookieOptions());
}
