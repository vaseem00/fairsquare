/**
 * The source-agnostic shape of a registered sale (REAL_DATA.md sections 0 and 3). Every adapter
 * (today the Data.Dubai CSV, later a licensed API) produces `NormalisedSale` rows; the snapshot, the
 * loader, the analysis and the UI only ever see this shape.
 */
import type { IsoDate } from "@/lib/domain/dates";

/** Off-plan and ready sales are never pooled (REAL_DATA.md section 7). */
export type SaleCompletion = "ready" | "off_plan";
export const SALE_COMPLETIONS: readonly SaleCompletion[] = Object.freeze(["ready", "off_plan"]);

export interface NormalisedSale {
  /** Stable across refreshes and unique: `<source>:<id>`, e.g. `dld:1-11-2024-123`. Stored as `sales.external_ref`. */
  ref: string;
  /** Registration date. */
  date: IsoDate;
  /** The building name exactly as the source writes it, whitespace collapsed (`sales.raw_building_name`). */
  building: string;
  /** The official area name from the source (DLD area, e.g. "Marsa Dubai"). */
  areaDld: string;
  project: string | null;
  masterProject: string | null;
  /** 0 = studio, up to 7. */
  bedrooms: number;
  /** Square feet with 2 decimals. */
  sizeSqft: number;
  /** Whole AED. */
  priceAed: number;
  completion: SaleCompletion;
  /** The DLD project number (a whole number), when the source row has one. */
  projectNumber: number | null;
  /** DLD `has_parking` for the unit; null when the source does not say. */
  parking: boolean | null;
}

/**
 * What the source says about one building (one `dld_key`), written to `buildings.csv.gz` next to the
 * sales. The nearest-place names are DLD's own reference values. `firstSale` and `firstReadySale`
 * look at every flat sale in the source files (all years), not only the 36-month window, so they say
 * roughly how old the building is; the counts are the kept sales of the window.
 */
export interface BuildingFacts {
  building: string;
  areaDld: string;
  projectNumber: number | null;
  project: string | null;
  masterProject: string | null;
  nearestMetro: string | null;
  nearestMall: string | null;
  nearestLandmark: string | null;
  /** The earliest flat sale of any basis in the source files. */
  firstSale: IsoDate;
  /** The earliest ready ("Existing Properties") flat sale in the source files; null when there is none. */
  firstReadySale: IsoDate | null;
  /** The latest kept sale. */
  lastSale: IsoDate;
  /** Kept sales in the window, and how many of them are off-plan and how many have parking. */
  sales: number;
  offPlanSales: number;
  parkingSales: number;
}

/**
 * Why a source row was left out, in the order the rules run (REAL_DATA.md section 2). A row is
 * counted once, under the first rule it fails.
 */
export const EXCLUSION_REASONS = [
  "not_sales",
  "procedure_excluded",
  "not_flat",
  "not_residential",
  "rooms_excluded",
  "no_building_name",
  // A building is identified by its name in its DLD area: a row without an area cannot be loaded.
  "no_area",
  "no_size_or_price",
  "size_out_of_range",
  "psf_out_of_range",
  "bad_date",
  // A date after the day the file was downloaded (a typing slip, or a two-digit year read as 20YY).
  "date_out_of_range",
  "no_transaction_id",
  "repeated_in_other_file",
  "multi_unit_deal",
  // 3 or more rows of one building on one date at one price whose units are unlike (other bedrooms,
  // or sizes more than 5% apart): the price is a block price, not a price for that unit.
  "portfolio_deal",
  // A size under half or over twice the median size of the same building and bedrooms (5 or more
  // sales): the room label or the area is wrong for that row.
  "size_unlike_building",
  "outside_window",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export type ExclusionCounts = Record<ExclusionReason, number>;

export function emptyExclusionCounts(): ExclusionCounts {
  return Object.fromEntries(EXCLUSION_REASONS.map((r) => [r, 0])) as ExclusionCounts;
}
