import "server-only";
/**
 * Saved listings (A§3.3, A§3.4, A§4.3, WP4).
 * - A row per person and comparison. Removing is a soft delete (`removed_at`); saving the same code
 *   again clears it and keeps the original `created_at` (savedAt) and the `*_at_save` baseline, so the
 *   Saved page's Undo is exact. Removed rows are excluded from every list and count.
 * - "New sales since you saved" counts sales of the same building, bedrooms and completion basis, with
 *   `sale_date` in the current window (ending at min(today, data_through)), whose `created_at`
 *   (recorded in Fairsquare) is after `saved_listings.created_at`. Counting by recorded time, not by row
 *   count, means old sales ageing out of the window create no noise, and a snapshot reload keeps the
 *   `created_at` of sales it already had (REAL_DATA.md section 4).
 * - The header badge counts listings with a sale recorded after `seen_at` (the last "Open").
 * All timestamps are compared inside the database (`now()`), never against the app clock.
 */
import { and, desc, eq, gte, isNull, lte, sql, count, type SQL } from "drizzle-orm";
import { readDataMeta } from "@/lib/data-status";
import { comparisonWindow, type Rules } from "@/lib/domain/analyse";
import type { IsoDate } from "@/lib/domain/dates";
import type { CheckBand, SavedItemView } from "@/lib/types";
import type { Db } from "../client";
import { checks, sales, savedListings, type CheckRow, type SavedListingRow } from "../schema";
import { acsLead, nearbyShown } from "@/lib/copy";
import { currentAnalysis, getCheckRowByCode, storedAcs, storedAnalysis, storedNearby, storedSimilar } from "./checks";

const BANDS: ReadonlySet<string> = new Set(["above", "inline", "below", "thin", "none"]);

function asBand(v: string): CheckBand {
  return (BANDS.has(v) ? v : "none") as CheckBand;
}

/** The join condition for "sales that count for this saved comparison today" (none without data). */
function windowSalesJoin(window: { start: IsoDate; end: IsoDate } | null): SQL {
  if (!window) return sql`false`;
  return and(
    eq(sales.buildingId, checks.buildingId),
    eq(sales.bedrooms, checks.bedrooms),
    eq(sales.completion, checks.completionBasis),
    gte(sales.saleDate, window.start),
    lte(sales.saleDate, window.end),
  ) as SQL;
}

/** New-sale counts per saved row id: recorded after savedAt, and after the last Open. */
async function newSaleCounts(
  db: Db,
  anonId: string,
  window: { start: IsoDate; end: IsoDate } | null,
  savedId?: number,
): Promise<Map<number, { sinceSave: number; unseen: number }>> {
  const rows = await db
    .select({
      savedId: savedListings.id,
      sinceSave: sql<number>`count(${sales.id}) filter (where ${sales.createdAt} > ${savedListings.createdAt})`.mapWith(
        Number,
      ),
      unseen: sql<number>`count(${sales.id}) filter (where ${sales.createdAt} > ${savedListings.seenAt})`.mapWith(Number),
    })
    .from(savedListings)
    .innerJoin(checks, eq(checks.id, savedListings.checkId))
    .leftJoin(sales, windowSalesJoin(window))
    .where(
      and(
        eq(savedListings.anonId, anonId),
        isNull(savedListings.removedAt),
        savedId === undefined ? undefined : eq(savedListings.id, savedId),
      ),
    )
    .groupBy(savedListings.id);
  return new Map(rows.map((r) => [r.savedId, { sinceSave: Number(r.sinceSave), unseen: Number(r.unseen) }]));
}

function toSavedItemView(
  saved: SavedListingRow,
  check: CheckRow,
  now: { band: CheckBand; diff: number | null; count: number },
  counts: { sinceSave: number; unseen: number } | undefined,
): SavedItemView {
  const building =
    check.buildingId !== null && check.buildingName !== null
      ? { id: check.buildingId, name: check.buildingName, area: check.buildingArea ?? "", areaDld: check.buildingAreaDld }
      : null;
  // As the comparison's own page reads it: a stored range of adjusted registered sales that leads.
  const lead = acsLead({ analysis: storedAnalysis(check), acs: storedAcs(check), building });
  // The last resort, as the comparison's own page reads it: the outcome against the range of nearby registered sales.
  const near = nearbyShown({ analysis: storedAnalysis(check), acs: storedAcs(check), similar: storedSimilar(check), nearby: storedNearby(check), building });
  return {
    code: check.code,
    savedAt: saved.createdAt.toISOString(),
    building,
    buildingText: check.buildingText,
    bedrooms: check.bedrooms,
    sizeSqft: check.sizeSqft,
    priceAed: check.priceAed,
    atSave: { band: asBand(saved.bandAtSave), diff: saved.diffAtSave, count: saved.countAtSave },
    now,
    newSalesSinceSave: counts?.sinceSave ?? 0,
    unseenNewSales: counts?.unseen ?? 0,
    acs: lead ? { verdict: lead.verdict, rangeLowPsf: lead.rangeLowPsf, rangeHighPsf: lead.rangeHighPsf } : null,
    nearby: near ? { verdict: near.verdict, rangeLowPsf: near.rangeLowPsf, rangeHighPsf: near.rangeHighPsf } : null,
  };
}

/** Non-removed saved items of a person (optionally one row), newest first, with today's verdict. */
async function loadItems(
  db: Db,
  anonId: string,
  today: IsoDate,
  rules: Rules,
  savedId?: number,
): Promise<SavedItemView[]> {
  const rows = await db
    .select({ saved: savedListings, check: checks })
    .from(savedListings)
    .innerJoin(checks, eq(checks.id, savedListings.checkId))
    .where(
      and(
        eq(savedListings.anonId, anonId),
        isNull(savedListings.removedAt),
        savedId === undefined ? undefined : eq(savedListings.id, savedId),
      ),
    )
    .orderBy(desc(savedListings.createdAt), desc(savedListings.id));
  if (rows.length === 0) return [];

  const { dataThrough } = await readDataMeta(db);
  const window = comparisonWindow(today, dataThrough, rules.windowDays);
  const [counts, nows] = await Promise.all([
    newSaleCounts(db, anonId, window, savedId),
    Promise.all(rows.map((r) => currentAnalysis(db, r.check, today, rules, dataThrough))),
  ]);
  return rows.map((r, i) =>
    toSavedItemView(r.saved, r.check, { band: nows[i].band, diff: nows[i].diff, count: nows[i].count }, counts.get(r.saved.id)),
  );
}

/** GET /api/saved: the person's saved listings, newest first, excluding removed rows. */
export async function listSaved(db: Db, anonId: string, today: IsoDate, rules: Rules): Promise<SavedItemView[]> {
  return loadItems(db, anonId, today, rules);
}

/** The header badge: non-removed saved listings with at least one sale recorded after the last Open. */
export async function countSavedWithNewSales(db: Db, anonId: string, today: IsoDate, rules: Rules): Promise<number> {
  const { dataThrough } = await readDataMeta(db);
  const window = comparisonWindow(today, dataThrough, rules.windowDays);
  if (!window) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(savedListings)
    .innerJoin(checks, eq(checks.id, savedListings.checkId))
    .where(
      and(
        eq(savedListings.anonId, anonId),
        isNull(savedListings.removedAt),
        sql`exists (select 1 from ${sales} where ${sales.buildingId} = ${checks.buildingId} and ${sales.bedrooms} = ${checks.bedrooms} and ${sales.completion} = ${checks.completionBasis} and ${sales.saleDate} >= ${window.start} and ${sales.saleDate} <= ${window.end} and ${sales.createdAt} > ${savedListings.seenAt})`,
      ),
    );
  return Number(row?.n ?? 0);
}

/** Non-removed saved listings of a person. */
export async function countSaved(db: Db, anonId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(savedListings)
    .where(and(eq(savedListings.anonId, anonId), isNull(savedListings.removedAt)));
  return Number(row?.n ?? 0);
}

export type SaveOutcome = "created" | "restored" | "existing";

async function findSavedRow(db: Db, anonId: string, checkId: number): Promise<SavedListingRow | null> {
  const rows = await db
    .select()
    .from(savedListings)
    .where(and(eq(savedListings.anonId, anonId), eq(savedListings.checkId, checkId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Saves a comparison for a person. Idempotent:
 * - not saved yet → inserts the row with today's verdict as the baseline ("created");
 * - removed earlier → clears `removed_at`, keeping the original savedAt and baseline ("restored");
 * - already saved → no change ("existing").
 */
export async function saveCheck(
  db: Db,
  anonId: string,
  check: CheckRow,
  today: IsoDate,
  rules: Rules,
): Promise<{ item: SavedItemView; outcome: SaveOutcome }> {
  let outcome: SaveOutcome;
  let row = await findSavedRow(db, anonId, check.id);
  if (row) {
    if (row.removedAt !== null) {
      await db.update(savedListings).set({ removedAt: null }).where(eq(savedListings.id, row.id));
      outcome = "restored";
    } else {
      outcome = "existing";
    }
  } else {
    const baseline = await currentAnalysis(db, check, today, rules);
    const inserted = await db
      .insert(savedListings)
      .values({
        anonId,
        checkId: check.id,
        bandAtSave: baseline.band,
        diffAtSave: baseline.diff,
        countAtSave: baseline.count,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) {
      row = inserted[0];
      outcome = "created";
    } else {
      // A concurrent save from the same person won the race.
      row = await findSavedRow(db, anonId, check.id);
      if (!row) throw new Error("saveCheck: insert conflicted but no row was found");
      if (row.removedAt !== null) {
        await db.update(savedListings).set({ removedAt: null }).where(eq(savedListings.id, row.id));
      }
      outcome = "existing";
    }
  }
  const [item] = await loadItems(db, anonId, today, rules, row.id);
  if (!item) throw new Error("saveCheck: saved row vanished");
  return { item, outcome };
}

/** Soft-deletes a saved listing. Returns the comparison id when this call removed a visible row, else null. */
export async function unsaveCheck(db: Db, anonId: string, code: string): Promise<number | null> {
  const check = await getCheckRowByCode(db, code);
  if (!check) return null;
  const rows = await db
    .update(savedListings)
    .set({ removedAt: sql`now()` })
    .where(
      and(eq(savedListings.anonId, anonId), eq(savedListings.checkId, check.id), isNull(savedListings.removedAt)),
    )
    .returning({ id: savedListings.id });
  return rows.length > 0 ? check.id : null;
}

/** "Open" from Saved: sets `seen_at = now()`. False (→ 404) for an unknown, unsaved or removed code. */
export async function markSeen(db: Db, anonId: string, code: string): Promise<boolean> {
  const check = await getCheckRowByCode(db, code);
  if (!check) return false;
  const rows = await db
    .update(savedListings)
    .set({ seenAt: sql`now()` })
    .where(
      and(eq(savedListings.anonId, anonId), eq(savedListings.checkId, check.id), isNull(savedListings.removedAt)),
    )
    .returning({ id: savedListings.id });
  return rows.length > 0;
}
