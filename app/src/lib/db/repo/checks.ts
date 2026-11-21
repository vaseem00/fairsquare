import "server-only";
/**
 * Stored comparisons (A§3.4, WP3). A row keeps the numbers, the verdict and the sales it used (up to
 * SNAPSHOT_MAX, newest first), never an image. `getCheckWithCurrent` also recomputes the verdict for
 * today, so a card that sits in WhatsApp for weeks stays honest.
 */
import { eq } from "drizzle-orm";
import { readDataMeta } from "@/lib/data-status";
import { analyseWith, comparisonWindow, type Rules } from "@/lib/domain/analyse";
import { diffDays, type IsoDate } from "@/lib/domain/dates";
import { generateShareCode, normaliseCode } from "@/lib/domain/share-code";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { similarFor } from "@/lib/services/similar";
import { ACS_MIN_CONSTANTS_VERSION } from "@/lib/acs/model";
import { NEARBY_MIN_CONSTANTS_VERSION } from "@/lib/nearby/model";
import { SIMILAR_MIN_CONSTANTS_VERSION } from "@/lib/similar/model";
import type { AcsView, AnalysisView, CheckView, NearbyView, SaleView, SimilarView } from "@/lib/types";
import { AcsViewSchema, NearbyViewSchema, SimilarViewSchema } from "@/lib/validation/api";
import type { Db } from "../client";
import { checks, type CheckRow, type NewCheck, type SaleRow, type SaleSnapshot } from "../schema";
import { recentSales } from "./buildings";

export const CODE_ATTEMPTS = 5;
/**
 * The most sales a comparison stores. Every sale behind the verdict is kept up to this (REAL_DATA.md
 * section 9: the list stays visible), well above what one building, bedroom count and completion
 * basis registers in 12 months; a longer list keeps its newest sales and the page says so
 * ("Showing the newest 2,000 of 2,312 sales").
 */
export const SNAPSHOT_MAX = 2_000;

/** True for a Postgres unique violation (23505), also when the driver error is wrapped in `cause`. */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 5; depth++) {
    if (typeof e === "object" && (e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Inserts a comparison under a fresh share code. On a code collision (unique violation) it draws a
 * new code and retries, up to 5 attempts in all.
 */
export async function createCheck(
  db: Db,
  values: Omit<NewCheck, "code" | "id" | "createdAt">,
  newCode: () => string = generateShareCode,
): Promise<CheckRow> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= CODE_ATTEMPTS; attempt++) {
    const code = newCode();
    try {
      const [row] = await db
        .insert(checks)
        .values({ ...values, code })
        .returning();
      return row;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      lastErr = err;
      log.warn("check_code_collision", { attempt });
    }
  }
  throw new Error(`createCheck: no free share code after ${CODE_ATTEMPTS} attempts`, { cause: lastErr });
}

/** The row for a share code (trimmed and uppercased first), or null when unknown or malformed. */
export async function getCheckRowByCode(db: Db, code: string): Promise<CheckRow | null> {
  const c = normaliseCode(code);
  if (!c) return null;
  const rows = await db.select().from(checks).where(eq(checks.code, c)).limit(1);
  return rows[0] ?? null;
}

/** The stored analysis of a row. */
export function storedAnalysis(row: CheckRow): AnalysisView {
  return {
    band: row.band,
    askingPsf: row.askingPsf,
    medianPsf: row.medianPsf,
    medianPriceAed: row.medianPriceAed,
    count: row.salesCount,
    diff: row.diff,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    completionBasis: row.completionBasis,
    outliersDropped: row.outliersDropped,
    medianSizeSqft: row.medianSizeSqft,
    dataThrough: row.dataThrough,
  };
}

/** A stored sale as shown: its price per sq ft, and its source only when it is not open data. */
function saleView(s: SaleSnapshot): SaleView {
  return {
    saleDate: s.saleDate,
    sizeSqft: s.sizeSqft,
    priceAed: s.priceAed,
    psf: s.priceAed / s.sizeSqft,
    ...(s.source && s.source !== "open_data" ? { source: s.source } : {}),
  };
}

/**
 * The similar-buildings comparison stored with a row (`checks.similar`), or null: none stored, an
 * entry this build cannot read (another version), or one that is withdrawn (REAL_DATA.md section
 * 15.4): the tier is switched off (SIMILAR_TIER=off), or the entry was made by constants older than
 * SIMILAR_MIN_CONSTANTS_VERSION, whose rule has since been tightened. A withdrawn entry stays in the
 * database; every page, card, preview image and share text reads it through here and shows the
 * result without it.
 */
export function storedSimilar(row: Pick<CheckRow, "similar">, tier: "on" | "off" = getEnv().SIMILAR_TIER): SimilarView | null {
  if (row.similar === null || row.similar === undefined || tier === "off") return null;
  const r = SimilarViewSchema.safeParse(row.similar);
  if (!r.success || r.data.modelVersion < SIMILAR_MIN_CONSTANTS_VERSION) return null;
  return r.data;
}

/**
 * The adjusted-registered-sales result stored with a row (`checks.acs_view`, REAL_DATA.md section
 * 16.4), or null: none stored (every comparison made before it existed), an entry this build cannot
 * read (another version), the tier switched off (ACS_TIER=off), or an entry made by constants older
 * than ACS_MIN_CONSTANTS_VERSION. Nothing is ever computed for a stored comparison here. The parse
 * drops what stays on the server (the middle figure, the unrounded ends), so they never reach a page.
 * With null the comparison shows as the same-building result and the second tier stored beside it.
 */
export function storedAcs(row: Pick<CheckRow, "acsView">, tier: "on" | "off" = getEnv().ACS_TIER): AcsView | null {
  if (row.acsView === null || row.acsView === undefined || tier === "off") return null;
  const r = AcsViewSchema.safeParse(row.acsView);
  if (!r.success || r.data.constantsVersion < ACS_MIN_CONSTANTS_VERSION) return null;
  return r.data;
}

/**
 * The nearby-registered-sales result stored with a row (`checks.nearby_view`, REAL_DATA.md section
 * 17.4), or null: none stored (something else gave a comparison, or the row is older than it), an
 * entry this build cannot read, the switch (NEARBY_TIER=off), or an entry made by constants older than
 * NEARBY_MIN_CONSTANTS_VERSION. Nothing is ever computed for a stored comparison here. The parse drops
 * what stays on the server. With null the comparison reads "Too few sales to compare yet" or "Not
 * covered yet", as before it existed.
 */
export function storedNearby(row: Pick<CheckRow, "nearbyView">, tier: "on" | "off" = getEnv().NEARBY_TIER): NearbyView | null {
  if (row.nearbyView === null || row.nearbyView === undefined || tier === "off") return null;
  const r = NearbyViewSchema.safeParse(row.nearbyView);
  if (!r.success || r.data.constantsVersion < NEARBY_MIN_CONSTANTS_VERSION) return null;
  return r.data;
}

/** The public DTO of a stored comparison. `url` is `${appUrl}/c/${code}`. */
export function toCheckView(row: CheckRow, appUrl: string): CheckView {
  const base = appUrl.replace(/\/+$/, "");
  return {
    code: row.code,
    url: `${base}/c/${row.code}`,
    createdAt: row.createdAt.toISOString(),
    building:
      row.buildingId !== null && row.buildingName !== null
        ? { id: row.buildingId, name: row.buildingName, area: row.buildingArea ?? "", areaDld: row.buildingAreaDld }
        : null,
    buildingText: row.buildingText,
    areaText: row.areaText,
    bedrooms: row.bedrooms,
    sizeSqft: row.sizeSqft,
    priceAed: row.priceAed,
    propertyType: row.propertyType,
    completion: row.completion,
    source: row.source,
    analysis: storedAnalysis(row),
    sales: (row.salesSnapshot ?? []).map(saleView),
    setAsideSales: (row.setAsideSnapshot ?? []).map(saleView),
    sizeSource: row.sizeSource ?? null,
    rules: {
      minSales: row.minSales,
      windowDays: diffDays(row.windowStart, row.windowEnd),
      bandPct: row.bandPct,
    },
    similar: storedSimilar(row),
    acs: storedAcs(row),
    nearby: storedNearby(row),
  };
}

/**
 * The verdict of a stored comparison recomputed for `today` with `rules` (REAL_DATA.md section 7):
 * the same completion basis, over the window ending at min(today, data_through). A comparison with no
 * building ("None of these", or a deleted building) has nothing to recompute and keeps its stored
 * analysis, and so does every comparison while no sales data is loaded. One made before any data was
 * loaded ("none" with a building) gets its first real verdict here once data is there.
 * Pass `dataThrough` when it is known (lists); otherwise it is read from app_meta.
 */
export async function currentAnalysis(
  db: Db,
  row: CheckRow,
  today: IsoDate,
  rules: Rules,
  dataThrough?: IsoDate | null,
): Promise<AnalysisView> {
  return (await recompute(db, row, today, rules, dataThrough))?.analysis ?? storedAnalysis(row);
}

/**
 * Today's analysis of a comparison, the sales it used and the ones it set aside (both newest first);
 * null when there is nothing to recompute.
 */
async function recompute(
  db: Db,
  row: CheckRow,
  today: IsoDate,
  rules: Rules,
  dataThrough?: IsoDate | null,
): Promise<{ analysis: AnalysisView; used: SaleRow[]; setAside: SaleRow[]; window: { start: IsoDate; end: IsoDate } } | null> {
  if (row.buildingId === null) return null;
  const through = dataThrough === undefined ? (await readDataMeta(db)).dataThrough : dataThrough;
  const window = comparisonWindow(today, through, rules.windowDays);
  if (!window) return null;
  const basis = row.completionBasis;
  const rows = await recentSales(db, row.buildingId, row.bedrooms, basis, window);
  const { analysis: a, used, setAside } = analyseWith(row.priceAed, row.sizeSqft, rows, rules);
  return {
    analysis: {
      band: a.band,
      askingPsf: a.askingPsf,
      medianPsf: a.medianPsf,
      medianPriceAed: a.medianPriceAed,
      count: a.count,
      diff: a.diff,
      windowStart: window.start,
      windowEnd: window.end,
      completionBasis: basis,
      outliersDropped: a.outliersDropped,
      medianSizeSqft: a.medianSizeSqft,
      dataThrough: through,
    },
    used,
    setAside,
    window,
  };
}

/**
 * Today's similar-buildings comparison of a stored comparison whose verdict today is "too few"
 * (REAL_DATA.md section 15.4); null otherwise, and whenever the second tier does not apply.
 */
async function similarNow(db: Db, row: CheckRow, now: NonNullable<Awaited<ReturnType<typeof recompute>>>): Promise<SimilarView | null> {
  if (row.buildingId === null || now.analysis.band !== "thin") return null;
  return similarFor(db, {
    band: "thin",
    building: { id: row.buildingId, area: row.buildingArea ?? "" },
    areaText: row.areaText,
    bedrooms: row.bedrooms,
    basis: row.completionBasis,
    askingPsf: now.analysis.askingPsf,
    window: now.window,
  });
}

/** A sale row as stored with a comparison (and shown): its source only when it is not open data. */
export function snapshotOf(s: Pick<SaleRow, "saleDate" | "sizeSqft" | "priceAed" | "source">): SaleSnapshot {
  return { saleDate: s.saleDate, sizeSqft: s.sizeSqft, priceAed: s.priceAed, source: s.source };
}

/**
 * The comparison as people see it (/c, GET /api/checks/[code], the OG card). One made while no sales
 * data was loaded is stored as "not covered" but keeps its building: once data is there its first
 * real verdict is today's, shown with the sales behind it (and, when that verdict is "too few", with
 * today's similar-buildings comparison), so the page never keeps saying "We don't cover X yet" for a
 * covered building. Every other comparison is shown as stored: `check.similar` is what the person
 * saw, with the 12 months it was stated for, unless it is withdrawn (`storedSimilar`). The second
 * tier is not recomputed for other views: a stored range stays the dated statement it was.
 */
export async function publicCheckView(
  db: Db,
  row: CheckRow,
  today: IsoDate,
  rules: Rules,
  appUrl: string,
): Promise<{ check: CheckView; current: AnalysisView }> {
  const view = toCheckView(row, appUrl);
  const now = await recompute(db, row, today, rules);
  if (!now) return { check: view, current: storedAnalysis(row) };
  if (row.band === "none" && now.analysis.band !== "none") {
    const similar = await similarNow(db, row, now);
    const { sales, setAsideSales } = toCheckView(
      {
        ...row,
        salesSnapshot: now.used.slice(0, SNAPSHOT_MAX).map(snapshotOf),
        setAsideSnapshot: now.setAside.slice(0, SNAPSHOT_MAX).map(snapshotOf),
      },
      appUrl,
    );
    // The first real verdict replaces what was stored for "not covered": no nearby range beside it.
    return { check: { ...view, analysis: now.analysis, sales, setAsideSales, similar, nearby: null }, current: now.analysis };
  }
  return { check: view, current: now.analysis };
}

/** GET /api/checks/[code] and the /c page: the comparison (`publicCheckView`) plus today's verdict, or null. */
export async function getCheckWithCurrent(
  db: Db,
  code: string,
  today: IsoDate,
  rules: Rules,
  appUrl: string,
): Promise<{ check: CheckView; current: AnalysisView } | null> {
  const row = await getCheckRowByCode(db, code);
  if (!row) return null;
  return publicCheckView(db, row, today, rules, appUrl);
}
