import "server-only";
/**
 * Buildings, aliases and recent sales (A§3.4, WP3; REAL_DATA.md sections 5, 7 and 11).
 * - `getAliasRows` keeps a 60 s in-process cache. Past 60 s it serves the cached rows and refreshes
 *   them in the background, and every load prepares the rows for matching, so neither the database
 *   read nor the one-off preparation lands on a person's query. Admin writes, CSV imports and the
 *   open-data load call `invalidateAliasCache()`; the next read then waits for fresh rows.
 * - "Recent" means the comparison window (REAL_DATA.md section 7): `windowDays` ending at
 *   min(today, data_through), and one completion basis (ready or off-plan sales, never both).
 */
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, max, or, sql, type SQL } from "drizzle-orm";
import { salesWindow } from "@/lib/data-status";
import { summariseSales, type CompletionBasis, type Rules } from "@/lib/domain/analyse";
import type { IsoDate } from "@/lib/domain/dates";
import { prepareAliasRows, type AliasRow } from "@/lib/domain/match";
import { log } from "@/lib/log";
import type { CoverageBuilding, CoverageResponse, CoverageType } from "@/lib/types";
import type { Db } from "../client";
import { buildingAliases, buildings, sales, type BuildingRow, type SaleRow } from "../schema";

export const ALIAS_CACHE_MS = 60_000;

/** A comparison window: start ≤ sale_date ≤ end. */
export interface SalesWindow {
  start: IsoDate;
  end: IsoDate;
}

let aliasCache: { db: Db; rows: AliasRow[]; at: number } | null = null;
let refreshing: Promise<AliasRow[]> | null = null;

async function loadAliasRows(db: Db): Promise<AliasRow[]> {
  const at = Date.now();
  const rows = await db
    .select({
      buildingId: buildingAliases.buildingId,
      aliasNorm: buildingAliases.aliasNorm,
      name: buildings.name,
      area: buildings.area,
    })
    .from(buildingAliases)
    .innerJoin(buildings, eq(buildings.id, buildingAliases.buildingId))
    .orderBy(asc(buildingAliases.buildingId), asc(buildingAliases.id));
  prepareAliasRows(rows);
  aliasCache = { db, rows, at };
  return rows;
}

/**
 * Every alias with its building's name and area, for `findCandidates`. Cached for 60 s per database;
 * an expired cache is served while it refreshes in the background (one refresh at a time).
 */
export async function getAliasRows(db: Db): Promise<AliasRow[]> {
  const cached = aliasCache;
  if (!cached || cached.db !== db) return loadAliasRows(db);
  const age = Date.now() - cached.at;
  if (age >= 0 && age < ALIAS_CACHE_MS) return cached.rows;
  refreshing ??= loadAliasRows(db)
    .catch((err: unknown) => {
      log.warn("alias_cache_refresh_failed", { err });
      return cached.rows;
    })
    .finally(() => {
      refreshing = null;
    });
  return cached.rows;
}

/** Tests: the background refresh started by an expired `getAliasRows`, if one is running. */
export function __aliasRefreshForTests(): Promise<AliasRow[]> | null {
  return refreshing;
}

/** Drops the alias cache (admin building/alias writes, CSV imports and the open-data load call this). */
export function invalidateAliasCache(): void {
  aliasCache = null;
}

export async function getBuilding(db: Db, id: number): Promise<BuildingRow | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const rows = await db.select().from(buildings).where(eq(buildings.id, id)).limit(1);
  return rows[0] ?? null;
}

function inWindowSql(w: SalesWindow): SQL {
  return and(gte(sales.saleDate, w.start), lte(sales.saleDate, w.end)) as SQL;
}

/** Sales of one building, bedroom count and completion basis inside the window, newest first. */
export async function recentSales(
  db: Db,
  buildingId: number,
  bedrooms: number,
  completion: CompletionBasis,
  window: SalesWindow,
): Promise<SaleRow[]> {
  return db
    .select()
    .from(sales)
    .where(and(eq(sales.buildingId, buildingId), eq(sales.bedrooms, bedrooms), eq(sales.completion, completion), inWindowSql(window)))
    .orderBy(desc(sales.saleDate), desc(sales.id));
}

/** The sizes (sq ft) of one building's sales of a bedroom count and basis inside the window. */
export async function recentSaleSizes(
  db: Db,
  buildingId: number,
  bedrooms: number,
  completion: CompletionBasis,
  window: SalesWindow,
): Promise<number[]> {
  const rows = await db
    .select({ sizeSqft: sales.sizeSqft })
    .from(sales)
    .where(and(eq(sales.buildingId, buildingId), eq(sales.bedrooms, bedrooms), eq(sales.completion, completion), inWindowSql(window)));
  return rows.map((r) => Number(r.sizeSqft));
}

/** Window sale counts per building for one bedroom count and basis. Buildings without sales are absent. */
export async function countRecentSalesByBuilding(
  db: Db,
  ids: readonly number[],
  bedrooms: number,
  completion: CompletionBasis,
  window: SalesWindow,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ buildingId: sales.buildingId, n: count() })
    .from(sales)
    .where(and(inArray(sales.buildingId, [...ids]), eq(sales.bedrooms, bedrooms), eq(sales.completion, completion), inWindowSql(window)))
    .groupBy(sales.buildingId);
  for (const r of rows) out.set(r.buildingId, Number(r.n));
  return out;
}

/** A date column value as "YYYY-MM-DD" (drivers may hand back a string or a Date). */
export function toIsoDate(v: unknown): IsoDate | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// ---------- coverage (REAL_DATA.md section 11) ----------

/** Buildings per coverage page. */
export const COVERAGE_PAGE_SIZE = 50;
/** Shorter searches are ignored (the whole list is returned). */
export const COVERAGE_QUERY_MIN = 2;

export interface CoverageQuery {
  /** Name or area, 2+ characters after trimming; shorter is ignored. */
  q?: string | null;
  /** 1-based. */
  page?: number;
}

/** `%`, `_` and `\` match themselves in an ILIKE pattern. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const n = (v: unknown) => Number(v ?? 0);

/**
 * One entry per bedroom count of the given buildings that has a sale up to the window end. The two
 * completion bases are never pooled (REAL_DATA.md section 7): each has its own count, and each is
 * comparable when it has MIN_SALES sales once unusual ones are left out, exactly as a comparison
 * counts them (`summariseSales` trims like `analyseWith`).
 */
async function coverageTypes(db: Db, ids: number[], window: SalesWindow, rules: Rules): Promise<Map<number, CoverageType[]>> {
  const out = new Map<number, CoverageType[]>();
  if (ids.length === 0) return out;
  const [typeRows, windowRows] = await Promise.all([
    db
      .select({
        buildingId: sales.buildingId,
        bedrooms: sales.bedrooms,
        ready: sql<number>`count(*) filter (where ${sales.saleDate} >= ${window.start} and ${sales.completion} = 'ready')`.mapWith(Number),
        offPlan: sql<number>`count(*) filter (where ${sales.saleDate} >= ${window.start} and ${sales.completion} = 'off_plan')`.mapWith(Number),
        latest: max(sales.saleDate),
      })
      .from(sales)
      .where(and(inArray(sales.buildingId, ids), lte(sales.saleDate, window.end)))
      .groupBy(sales.buildingId, sales.bedrooms),
    db
      .select({
        buildingId: sales.buildingId,
        bedrooms: sales.bedrooms,
        completion: sales.completion,
        saleDate: sales.saleDate,
        sizeSqft: sales.sizeSqft,
        priceAed: sales.priceAed,
      })
      .from(sales)
      .where(and(inArray(sales.buildingId, ids), inWindowSql(window))),
  ]);
  const byBasis = new Map<string, Array<{ saleDate: IsoDate; sizeSqft: number; priceAed: number }>>();
  for (const r of windowRows) {
    const key = `${r.buildingId}:${r.bedrooms}:${r.completion}`;
    const list = byBasis.get(key) ?? [];
    list.push(r);
    byBasis.set(key, list);
  }
  const summary = (buildingId: number, bedrooms: number, basis: CompletionBasis) =>
    summariseSales(byBasis.get(`${buildingId}:${bedrooms}:${basis}`) ?? []);
  for (const r of typeRows) {
    const ready = summary(r.buildingId, r.bedrooms, "ready");
    const offPlan = summary(r.buildingId, r.bedrooms, "off_plan");
    const list = out.get(r.buildingId) ?? [];
    list.push({
      bedrooms: r.bedrooms,
      readySales: n(r.ready),
      offPlanSales: n(r.offPlan),
      medianPsf: ready.medianPsf,
      latestSaleDate: toIsoDate(r.latest),
      readyComparable: ready.count >= rules.minSales,
      offPlanComparable: offPlan.count >= rules.minSales,
    });
    out.set(r.buildingId, list);
  }
  for (const list of out.values()) list.sort((x, y) => x.bedrooms - y.bedrooms);
  return out;
}

/**
 * The coverage list (GET /api/buildings, /coverage), REAL_DATA.md section 11: buildings with at
 * least one sale up to the window end, searched by name or area on the server (2+ characters) and
 * paged by 50, most sales in the window first (then by name). Each row has its ready and off-plan
 * sale counts in the window, its latest sale date and one entry per bedroom count. With no data
 * loaded (`window` null) the list is empty.
 */
export async function listCoverage(
  db: Db,
  scope: { window: SalesWindow | null; dataThrough: IsoDate | null },
  rules: Rules,
  query: CoverageQuery = {},
): Promise<CoverageResponse> {
  const { window, dataThrough } = scope;
  const q = (query.q ?? "").trim();
  const search = q.length >= COVERAGE_QUERY_MIN ? q.slice(0, 120) : null;
  const page = Math.max(1, Math.trunc(query.page ?? 1) || 1);
  const empty: CoverageResponse = { buildings: [], total: 0, page, pageSize: COVERAGE_PAGE_SIZE, q: search, window, dataThrough };
  if (!window) return empty;

  const agg = db
    .select({
      buildingId: sales.buildingId,
      ready: sql<number>`count(*) filter (where ${sales.saleDate} >= ${window.start} and ${sales.completion} = 'ready')`.as("ready"),
      offPlan: sql<number>`count(*) filter (where ${sales.saleDate} >= ${window.start} and ${sales.completion} = 'off_plan')`.as("off_plan"),
      latest: sql<string>`max(${sales.saleDate})`.as("latest"),
    })
    .from(sales)
    .where(lte(sales.saleDate, window.end))
    .groupBy(sales.buildingId)
    .as("agg");
  const where = search
    ? or(ilike(buildings.name, likePattern(search)), ilike(buildings.area, likePattern(search)), ilike(buildings.areaDld, likePattern(search)))
    : undefined;
  const rows = await db
    .select({
      id: buildings.id,
      name: buildings.name,
      area: buildings.area,
      areaDld: buildings.areaDld,
      ready: agg.ready,
      offPlan: agg.offPlan,
      latest: agg.latest,
      total: sql<number>`count(*) over ()`,
    })
    .from(buildings)
    .innerJoin(agg, eq(agg.buildingId, buildings.id))
    .where(where)
    .orderBy(desc(sql`${agg.ready} + ${agg.offPlan}`), asc(buildings.name), asc(buildings.id))
    .limit(COVERAGE_PAGE_SIZE)
    .offset((page - 1) * COVERAGE_PAGE_SIZE);

  let total = rows.length ? n(rows[0].total) : 0;
  if (rows.length === 0 && page > 1) {
    // Past the last page: still report how many there are.
    const [c] = await db.select({ n: count() }).from(buildings).innerJoin(agg, eq(agg.buildingId, buildings.id)).where(where);
    total = n(c?.n);
  }
  const types = await coverageTypes(
    db,
    rows.map((r) => r.id),
    window,
    rules,
  );
  const list: CoverageBuilding[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    area: r.area,
    areaDld: r.areaDld,
    readySales: n(r.ready),
    offPlanSales: n(r.offPlan),
    latestSaleDate: toIsoDate(r.latest),
    types: types.get(r.id) ?? [],
  }));
  return { ...empty, buildings: list, total };
}

/** `listCoverage` for `today`: the window ends at min(today, data_through). */
export async function getCoverage(db: Db, today: IsoDate, rules: Rules, query: CoverageQuery = {}): Promise<CoverageResponse> {
  return listCoverage(db, await salesWindow(db, today, rules.windowDays), rules, query);
}
