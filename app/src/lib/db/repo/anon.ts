import "server-only";
/**
 * Anonymous people (A§3.4). The id is the uuid inside the signed `mz_aid` cookie.
 */
import { eq, sql } from "drizzle-orm";
import { normaliseCode } from "@/lib/domain/share-code";
import type { Db } from "../client";
import { anonUsers, deletedAnonIds } from "../schema";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Creates the row when it is missing, otherwise bumps `last_seen_at`.
 * `refCode` (the share code from `/?ref=`) is first-touch: it is stored only while the row has none,
 * so a later share link never overwrites the one that brought the person in. Invalid codes are ignored.
 * Returns true when the row was created by this call.
 */
export async function ensureAnonUser(db: Db, id: string, refCode?: string | null): Promise<boolean> {
  if (!UUID_RE.test(id)) throw new Error("ensureAnonUser: not a uuid");
  const ref = refCode ? normaliseCode(refCode) : null;
  const rows = await db
    .insert(anonUsers)
    .values({ id, refCode: ref })
    .onConflictDoUpdate({
      target: anonUsers.id,
      set: {
        lastSeenAt: sql`now()`,
        refCode: sql`coalesce(${anonUsers.refCode}, excluded.ref_code)`,
      },
    })
    .returning({ inserted: sql<boolean>`(xmax = 0)` });
  return rows[0]?.inserted === true;
}

/** Bumps `last_seen_at`. Returns false when the row does not exist. */
export async function touchAnonUser(db: Db, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const rows = await db
    .update(anonUsers)
    .set({ lastSeenAt: sql`now()` })
    .where(eq(anonUsers.id, id))
    .returning({ id: anonUsers.id });
  return rows.length > 0;
}

/** True when `id` was erased by "Delete all my data" (it must never be accepted again). */
export async function isDeletedAnonId(db: Db, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const rows = await db.select({ id: deletedAnonIds.id }).from(deletedAnonIds).where(eq(deletedAnonIds.id, id)).limit(1);
  return rows.length > 0;
}

/** The row, or null. */
export async function getAnonUser(db: Db, id: string) {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(anonUsers).where(eq(anonUsers.id, id)).limit(1);
  return rows[0] ?? null;
}
