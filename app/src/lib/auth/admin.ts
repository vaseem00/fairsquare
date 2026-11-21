import "server-only";
/**
 * Admin authentication (A§6.2).
 * - The password check compares HMAC(SESSION_SECRET, password) with HMAC(SESSION_SECRET, ADMIN_PASSWORD)
 *   in constant time, so the length is not leaked. No ADMIN_PASSWORD → login always fails (logged).
 * - A session is 32 random bytes (base64url). The cookie holds `<token>.<HMAC("adm:" + token)>`;
 *   the database holds only sha256(token), so a database leak yields no usable cookie.
 * - A session is valid when the signature verifies, the row exists, `expires_at > now` and it is not revoked.
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { adminSessions } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { ADMIN_MAX_AGE_SEC } from "@/lib/http/cookies";
import { log } from "@/lib/log";
import { hmacHex, safeEqual, sha256Hex, sign, verify } from "./sign";

const PURPOSE = "adm";
export const ADMIN_SESSION_TTL_MS = ADMIN_MAX_AGE_SEC * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** True when `password` equals ADMIN_PASSWORD. Always false (with a warning) when it is unset. */
export function checkAdminPassword(password: string): boolean {
  const expected = getEnv().ADMIN_PASSWORD;
  if (!expected) {
    log.warn("admin_login_disabled", { reason: "ADMIN_PASSWORD is not set" });
    return false;
  }
  const a = Buffer.from(hmacHex(`pw:${password}`), "hex");
  const b = Buffer.from(hmacHex(`pw:${expected}`), "hex");
  return safeEqual(a, b);
}

/** Inserts a session row and returns the signed cookie value. */
export async function createAdminSession(db: Db, ipHash: string): Promise<{ cookieValue: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS);
  await db.insert(adminSessions).values({ idHash: sha256Hex(token), expiresAt, ipHash });
  return { cookieValue: sign(PURPOSE, token), expiresAt };
}

function tokenFrom(cookieValue: string | null | undefined): string | null {
  const token = verify(PURPOSE, cookieValue);
  return token && TOKEN_RE.test(token) ? token : null;
}

/** True for a correctly signed, existing, unexpired and unrevoked session. */
export async function verifyAdminSession(db: Db, cookieValue: string | null | undefined): Promise<boolean> {
  const token = tokenFrom(cookieValue);
  if (!token) return false;
  const rows = await db
    .select({ idHash: adminSessions.idHash })
    .from(adminSessions)
    .where(
      and(
        eq(adminSessions.idHash, sha256Hex(token)),
        gt(adminSessions.expiresAt, new Date()),
        isNull(adminSessions.revokedAt),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

/** Revokes the session behind a cookie value. Returns true when a live row was revoked. */
export async function revokeAdminSession(db: Db, cookieValue: string | null | undefined): Promise<boolean> {
  const token = tokenFrom(cookieValue);
  if (!token) return false;
  const rows = await db
    .update(adminSessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(adminSessions.idHash, sha256Hex(token)), isNull(adminSessions.revokedAt)))
    .returning({ idHash: adminSessions.idHash });
  return rows.length > 0;
}
