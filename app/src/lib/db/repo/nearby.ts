import "server-only";
/**
 * The one read of nearby registered sales (REAL_DATA.md section 17.2; scripts/model/nearby/SPEC.md
 * section 2): the open-data sales of one bedroom count and basis, registered in the 730 days to the
 * data date, in the buildings of a DLD area or a community, without the listing's own building.
 * Sales added by hand are not read.
 */
import { and, eq, gt, isNotNull, lte, ne, or, type SQL } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/domain/dates";
import type { Db } from "../client";
import { buildings, sales } from "../schema";

export interface NearbySaleDbRow {
  ref: string;
  buildingId: number;
  buildingName: string;
  areaDld: string | null;
  masterProject: string | null;
  firstSaleDate: IsoDate | null;
  firstReadySaleDate: IsoDate | null;
  saleDate: IsoDate;
  sizeSqft: number;
  priceAed: number;
}

export interface NearbyRead {
  bedrooms: number;
  basis: "ready" | "off_plan";
  /** buildings.area_dld; null or "": unknown, and it never matches. */
  areaDld: string | null;
  /** buildings.master_project; null or "": unknown, and it never matches. */
  masterProject: string | null;
  /** The listing's own building, never a comparable; null when it is not in the data. */
  excludeBuildingId: number | null;
  dataThrough: IsoDate;
  windowDays: number;
}

export async function nearbySales(db: Db, q: NearbyRead): Promise<NearbySaleDbRow[]> {
  const places: SQL[] = [];
  if (q.areaDld) places.push(eq(buildings.areaDld, q.areaDld));
  if (q.masterProject) places.push(eq(buildings.masterProject, q.masterProject));
  if (places.length === 0) return [];
  const rows = await db
    .select({
      ref: sales.externalRef,
      buildingId: sales.buildingId,
      buildingName: buildings.name,
      areaDld: buildings.areaDld,
      masterProject: buildings.masterProject,
      firstSaleDate: buildings.firstSaleDate,
      firstReadySaleDate: buildings.firstReadySaleDate,
      saleDate: sales.saleDate,
      sizeSqft: sales.sizeSqft,
      priceAed: sales.priceAed,
    })
    .from(sales)
    .innerJoin(buildings, eq(buildings.id, sales.buildingId))
    .where(
      and(
        eq(sales.source, "open_data"),
        isNotNull(sales.externalRef),
        eq(sales.bedrooms, q.bedrooms),
        eq(sales.completion, q.basis),
        gt(sales.saleDate, addDays(q.dataThrough, -q.windowDays)),
        lte(sales.saleDate, q.dataThrough),
        places.length === 1 ? places[0] : or(...places),
        q.excludeBuildingId === null ? undefined : ne(sales.buildingId, q.excludeBuildingId),
      ),
    );
  return rows.map((r) => ({
    ref: r.ref as string,
    buildingId: Number(r.buildingId),
    buildingName: r.buildingName,
    areaDld: r.areaDld,
    masterProject: r.masterProject,
    firstSaleDate: r.firstSaleDate,
    firstReadySaleDate: r.firstReadySaleDate,
    saleDate: r.saleDate,
    sizeSqft: Number(r.sizeSqft),
    priceAed: Number(r.priceAed),
  }));
}
