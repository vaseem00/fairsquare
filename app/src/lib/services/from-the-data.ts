import "server-only";
/**
 * "From the data" (REAL_DATA.md section 10): the small panel beside the tool on the home page, built
 * from the loaded DLD open-data sales only (never sales the admin added). The building with the most ready 2-bed sales in the comparison window, its area, the median
 * AED per sq ft of those sales (unusual ones left out, as in a comparison), how many there are and
 * the dates of the first and last. Never a listing or an asking price.
 * Kept for an hour per snapshot and window: a new snapshot (app_meta.open_data_sha) or a new window
 * end recomputes it at once. Nothing is cached while no data is loaded, so the panel appears as soon
 * as the first load finishes.
 */
import { and, asc, count, desc, eq, gte, lte } from "drizzle-orm";
import { readDataMeta } from "@/lib/data-status";
import type { Db } from "@/lib/db/client";
import { getBuilding, recentSales } from "@/lib/db/repo/buildings";
import { sales } from "@/lib/db/schema";
import { comparisonWindow, summariseSales, type Rules } from "@/lib/domain/analyse";
import type { IsoDate } from "@/lib/domain/dates";
import type { FromTheData } from "@/lib/types";

export const FROM_THE_DATA_TTL_MS = 60 * 60 * 1000;
export const FROM_THE_DATA_BEDROOMS = 2;

let cache: { db: Db; key: string; value: FromTheData; at: number } | null = null;

/** The panel for `today`, or null when no data is loaded or no ready 2-bed sale is in the window. */
export async function getFromTheData(db: Db, today: IsoDate, rules: Pick<Rules, "windowDays">): Promise<FromTheData | null> {
  const meta = await readDataMeta(db);
  const window = comparisonWindow(today, meta.dataThrough, rules.windowDays);
  if (!window) return null;
  const key = `${meta.sha ?? ""}|${window.start}|${window.end}`;
  const now = Date.now();
  if (cache && cache.db === db && cache.key === key && now - cache.at >= 0 && now - cache.at < FROM_THE_DATA_TTL_MS) {
    return cache.value;
  }

  const [top] = await db
    .select({ buildingId: sales.buildingId, n: count() })
    .from(sales)
    .where(
      and(
        eq(sales.bedrooms, FROM_THE_DATA_BEDROOMS),
        eq(sales.completion, "ready"),
        // The DLD open data only: sales the admin added are never shown as the published data.
        eq(sales.source, "open_data"),
        gte(sales.saleDate, window.start),
        lte(sales.saleDate, window.end),
      ),
    )
    .groupBy(sales.buildingId)
    .orderBy(desc(count()), asc(sales.buildingId))
    .limit(1);
  if (!top) return null;
  const building = await getBuilding(db, top.buildingId);
  if (!building) return null;
  const rows = await recentSales(db, building.id, FROM_THE_DATA_BEDROOMS, "ready", window);
  const s = summariseSales(rows.filter((r) => r.source === "open_data"));
  if (s.medianPsf === null || s.firstSaleDate === null || s.lastSaleDate === null) return null;

  const value: FromTheData = {
    building: { id: building.id, name: building.name, area: building.area, areaDld: building.areaDld },
    bedrooms: FROM_THE_DATA_BEDROOMS,
    completion: "ready",
    count: s.count,
    medianPsf: s.medianPsf,
    outliersDropped: s.outliersDropped,
    firstSaleDate: s.firstSaleDate,
    lastSaleDate: s.lastSaleDate,
    window,
  };
  cache = { db, key, value, at: now };
  return value;
}

/** Drops the cached panel (the open-data loader calls this after a load). */
export function invalidateFromTheData(): void {
  cache = null;
}
