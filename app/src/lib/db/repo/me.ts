import "server-only";
/**
 * The person's own data (A§3.4, A§4.3 "Me", A§6.7, WP4).
 * - `getMe` drives the header badge, "Buildings you asked for", the adviser section and Your data.
 * - `deleteAllForAnon` is "Delete all my data", in one transaction: leads become withdrawn audit
 *   records with no name or phone and no anon id; saved listings and comparisons are deleted (so the
 *   person's /c links stop working, and other people's saved rows of those comparisons go with them,
 *   counted in `othersSavedDeleted`); building requests and events keep their rows with `anon_id`
 *   null; the `anon_users` row is deleted and the id is recorded in `deleted_anon_ids`, so a surviving
 *   copy of the signed cookie, or an old recovery link, can never bring it back.
 * - The recovery-link token (signed with the "rec" purpose, 30 days) lives here because it carries the
 *   person's id; it holds no other data.
 */
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { sign, verify } from "@/lib/auth/sign";
import type { Rules } from "@/lib/domain/analyse";
import type { IsoDate } from "@/lib/domain/dates";
import { EMPTY_ME, type MeView } from "@/lib/types";
import type { Db } from "../client";
import { anonUsers, buildingRequests, checks, deletedAnonIds, events, leads, savedListings } from "../schema";
import { UUID_RE } from "./anon";
import { listLeadsForAnon } from "./leads";
import { listRequestsForAnon } from "./requests";
import { countSaved, countSavedWithNewSales } from "./saved";

// ---------- recovery link (A§4.3) ----------
// token = sign("rec", base64url(`${anonId}.${expiresEpochSec}`)) = "<base64url>.<hmac>", valid 30 days.

export const RECOVERY_TTL_SEC = 30 * 24 * 60 * 60;
const RECOVERY_PURPOSE = "rec";

/** A recovery token for `anonId`, valid for 30 days from `now`. */
export function createRecoveryToken(anonId: string, now: Date = new Date()): string {
  if (!UUID_RE.test(anonId)) throw new Error("createRecoveryToken: not a uuid");
  const expires = Math.floor(now.getTime() / 1000) + RECOVERY_TTL_SEC;
  const payload = Buffer.from(`${anonId.toLowerCase()}.${expires}`, "utf8").toString("base64url");
  return sign(RECOVERY_PURPOSE, payload);
}

/** The anon id inside a valid, unexpired recovery token, or null (tampered, malformed or expired). */
export function verifyRecoveryToken(token: string | null | undefined, now: Date = new Date()): string | null {
  const payload = verify(RECOVERY_PURPOSE, token);
  if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const m = /^([0-9a-f-]{36})\.(\d{1,12})$/.exec(decoded);
  if (!m || !UUID_RE.test(m[1])) return null;
  if (Number(m[2]) * 1000 <= now.getTime()) return null;
  return m[1];
}

/** Comparisons the person made. */
export async function countChecks(db: Db, anonId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(checks).where(eq(checks.anonId, anonId));
  return Number(row?.n ?? 0);
}

/** GET /api/me. An unknown id gives the empty MeView. */
export async function getMe(db: Db, anonId: string, today: IsoDate, rules: Rules): Promise<MeView> {
  if (!UUID_RE.test(anonId)) return { ...EMPTY_ME, requests: [], leads: [] };
  const [savedCount, savedWithNewSales, checksCount, requests, leadViews] = await Promise.all([
    countSaved(db, anonId),
    countSavedWithNewSales(db, anonId, today, rules),
    countChecks(db, anonId),
    listRequestsForAnon(db, anonId),
    listLeadsForAnon(db, anonId),
  ]);
  return { savedCount, savedWithNewSales, checksCount, requests, leads: leadViews };
}

export interface DeleteSummary {
  /** Leads that were active and are now withdrawn by the deletion. */
  leadsWithdrawn: number[];
  leadsAnonymised: number;
  checksDeleted: number;
  /** The person's own saved listings. */
  savedDeleted: number;
  /** Other people's saved listings of this person's comparisons, removed with them. */
  othersSavedDeleted: number;
}

/** Deletes or anonymises everything tied to `anonId`, in one transaction, and tombstones the id. */
export async function deleteAllForAnon(db: Db, anonId: string): Promise<DeleteSummary> {
  if (!UUID_RE.test(anonId)) return { leadsWithdrawn: [], leadsAnonymised: 0, checksDeleted: 0, savedDeleted: 0, othersSavedDeleted: 0 };
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const withdrawn = await tx
      .update(leads)
      .set({ status: "withdrawn", withdrawnAt: sql`now()` })
      .where(and(eq(leads.anonId, anonId), isNull(leads.withdrawnAt)))
      .returning({ id: leads.id });
    const anonymised = await tx
      .update(leads)
      .set({ name: null, phoneE164: null, anonId: null })
      .where(eq(leads.anonId, anonId))
      .returning({ id: leads.id });
    const saved = await tx.delete(savedListings).where(eq(savedListings.anonId, anonId)).returning({ id: savedListings.id });
    await tx.update(buildingRequests).set({ anonId: null }).where(eq(buildingRequests.anonId, anonId));
    await tx.update(events).set({ anonId: null }).where(eq(events.anonId, anonId));
    // Other people who saved one of these comparisons lose that saved row by cascade (their /c link
    // stops working too). Counted explicitly so `data_deleted` reports everything that went.
    const othersSaved = await tx
      .delete(savedListings)
      .where(inArray(savedListings.checkId, tx.select({ id: checks.id }).from(checks).where(eq(checks.anonId, anonId))))
      .returning({ id: savedListings.id });
    const deletedChecks = await tx.delete(checks).where(eq(checks.anonId, anonId)).returning({ id: checks.id });
    await tx.delete(anonUsers).where(eq(anonUsers.id, anonId));
    // The cookie is signed but stateless: remember the erased id so no copy of it can recreate it.
    await tx.insert(deletedAnonIds).values({ id: anonId }).onConflictDoNothing();
    return {
      leadsWithdrawn: withdrawn.map((r) => r.id),
      leadsAnonymised: anonymised.length,
      checksDeleted: deletedChecks.length,
      savedDeleted: saved.length,
      othersSavedDeleted: othersSaved.length,
    };
  });
}
