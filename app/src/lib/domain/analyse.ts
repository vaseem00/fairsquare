/**
 * Compare an asking price per sq ft with the median of recent sales (port of compare.py), with the
 * real-data rules of REAL_DATA.md section 7: completion basis, a window that ends at
 * min(today, data_through), at least MIN_SALES sales, outlier trimming and the size check.
 */
import { addDays, diffDays, type IsoDate } from "./dates";

export interface Rules {
  minSales: number;
  windowDays: number;
  bandPct: number;
}
export const DEFAULT_RULES: Rules = Object.freeze({ minSales: 5, windowDays: 365, bandPct: 5 });

/** Outliers are trimmed only from this many sales up (REAL_DATA.md section 7: "When n ≥ 5"). */
export const OUTLIER_MIN_SALES = 5;
/** A sale below this fraction of the median price per sq ft is left out. */
export const OUTLIER_LOW = 0.5;
/** A sale above this multiple of the median price per sq ft is left out. */
export const OUTLIER_HIGH = 2;
/** The size note shows when the listing differs from the median sale size by more than this (fraction). */
export const SIZE_NOTE_THRESHOLD = 0.2;
/** Data older than this many days (data_through before today) is stale (REAL_DATA.md section 7). */
export const STALE_AFTER_DAYS = 45;

export type Band = "above" | "inline" | "below" | "thin";
/** Which sales a listing is compared with: off-plan listings with off-plan sales, all others with ready ones. */
export type CompletionBasis = "ready" | "off_plan";

export interface SaleInput {
  saleDate: IsoDate;
  sizeSqft: number;
  priceAed: number;
}
export interface Analysis {
  askingPsf: number;
  /** Sales used (after outliers were left out). */
  count: number;
  /** Median of what exists, also when thin (null only when count = 0). */
  medianPsf: number | null;
  /** Null when thin. */
  medianPriceAed: number | null;
  /** 0.1395 = 13.95% above; null when count < minSales. */
  diff: number | null;
  band: Band;
  /** Sales left out as unusual (below 0.5× or above 2× the median per sq ft). */
  outliersDropped: number;
  /** Median size of the sales used, null when count = 0. */
  medianSizeSqft: number | null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** start = today − windowDays (inclusive), end = today. */
export function windowBounds(today: IsoDate, windowDays: number): { start: IsoDate; end: IsoDate } {
  return { start: addDays(today, -windowDays), end: today };
}

/** Keeps sales with start ≤ saleDate ≤ today. */
export function inWindow<T extends { saleDate: IsoDate }>(
  sales: readonly T[],
  today: IsoDate,
  windowDays: number,
): T[] {
  const { start, end } = windowBounds(today, windowDays);
  return sales.filter((s) => s.saleDate >= start && s.saleDate <= end);
}

/** The day the comparison window ends: min(today, dataThrough). Null when no sales data is loaded. */
export function windowEndFor(today: IsoDate, dataThrough: IsoDate | null): IsoDate | null {
  if (!dataThrough) return null;
  return dataThrough < today ? dataThrough : today;
}

/**
 * The comparison window (REAL_DATA.md section 7): `windowDays` ending at min(today, dataThrough).
 * Null when no sales data is loaded (comparisons are then "not covered").
 */
export function comparisonWindow(
  today: IsoDate,
  dataThrough: IsoDate | null,
  windowDays: number,
): { start: IsoDate; end: IsoDate } | null {
  const end = windowEndFor(today, dataThrough);
  return end === null ? null : windowBounds(end, windowDays);
}

/** True when the data runs to more than STALE_AFTER_DAYS days before today. False when nothing is loaded. */
export function isStale(today: IsoDate, dataThrough: IsoDate | null, afterDays: number = STALE_AFTER_DAYS): boolean {
  return dataThrough !== null && diffDays(dataThrough, today) > afterDays;
}

/** Off-plan listings are compared with off-plan sales; ready or unknown ones with ready sales. */
export function completionBasis(completion: "ready" | "off_plan" | "unknown" | null | undefined): CompletionBasis {
  return completion === "off_plan" ? "off_plan" : "ready";
}

/** diff ≥ b → above; diff ≤ −b → below; otherwise inline. bandPct is in percent (5 = 5%). */
export function bandFor(diff: number, bandPct: number): "above" | "inline" | "below" {
  const b = bandPct / 100;
  if (diff >= b) return "above";
  if (diff <= -b) return "below";
  return "inline";
}

const psfOf = (s: SaleInput) => s.priceAed / s.sizeSqft;

/**
 * Leaves out unusual sales (REAL_DATA.md section 7): with OUTLIER_MIN_SALES or more sales, a sale
 * whose price per sq ft is below 0.5× or above 2× the median is dropped (once; the median is then
 * recomputed by the caller). Fewer sales are kept as they are. Pass valid sales only.
 */
export function trimOutliers<T extends SaleInput>(sales: readonly T[]): { kept: T[]; dropped: number } {
  if (sales.length < OUTLIER_MIN_SALES) return { kept: [...sales], dropped: 0 };
  const m = median(sales.map(psfOf)) as number;
  const kept = sales.filter((s) => {
    const psf = psfOf(s);
    return psf >= OUTLIER_LOW * m && psf <= OUTLIER_HIGH * m;
  });
  return { kept, dropped: sales.length - kept.length };
}

/**
 * The full comparison, also returning the sales it used and the unusual ones it set aside (both in
 * input order) so a caller can store exactly those. Does not filter by date or completion: pass the
 * window's sales of one basis. Drops sales with a non-positive size or price, then trims outliers.
 * Throws RangeError when sizeSqft ≤ 0 (validation stops that earlier).
 */
export function analyseWith<T extends SaleInput>(
  priceAed: number,
  sizeSqft: number,
  sales: readonly T[],
  rules: Rules = DEFAULT_RULES,
): { analysis: Analysis; used: T[]; setAside: T[] } {
  if (!(sizeSqft > 0)) throw new RangeError("sizeSqft must be greater than 0");
  const valid = sales.filter((s) => s.sizeSqft > 0 && s.priceAed > 0);
  const { kept: used, dropped } = trimOutliers(valid);
  const kept = new Set<T>(used);
  const setAside = valid.filter((s) => !kept.has(s));
  const askingPsf = priceAed / sizeSqft;
  const medianPsf = median(used.map(psfOf));
  const base = { askingPsf, count: used.length, medianPsf, outliersDropped: dropped, medianSizeSqft: median(used.map((s) => s.sizeSqft)) };
  if (used.length < rules.minSales || medianPsf === null) {
    return { analysis: { ...base, medianPriceAed: null, diff: null, band: "thin" }, used, setAside };
  }
  const diff = askingPsf / medianPsf - 1;
  return {
    analysis: { ...base, medianPriceAed: median(used.map((s) => s.priceAed)), diff, band: bandFor(diff, rules.bandPct) },
    used,
    setAside,
  };
}

/**
 * A summary of one group of sales ("From the data", REAL_DATA.md section 10): the count and median
 * price per sq ft after outliers are left out, and the date range of the sales kept.
 */
export function summariseSales<T extends SaleInput>(
  sales: readonly T[],
): { count: number; medianPsf: number | null; outliersDropped: number; firstSaleDate: IsoDate | null; lastSaleDate: IsoDate | null } {
  const valid = sales.filter((s) => s.sizeSqft > 0 && s.priceAed > 0);
  const { kept, dropped } = trimOutliers(valid);
  const dates = kept.map((s) => s.saleDate).sort();
  return {
    count: kept.length,
    medianPsf: median(kept.map(psfOf)),
    outliersDropped: dropped,
    firstSaleDate: dates[0] ?? null,
    lastSaleDate: dates.at(-1) ?? null,
  };
}

/** `analyseWith` without the list of sales used. */
export function analyse(priceAed: number, sizeSqft: number, sales: readonly SaleInput[], rules: Rules = DEFAULT_RULES): Analysis {
  return analyseWith(priceAed, sizeSqft, sales, rules).analysis;
}

/**
 * The size check (REAL_DATA.md section 7): how much larger (positive) or smaller (negative) the listing
 * is than the median size of the compared sales, when that is more than 20% either way; otherwise null.
 */
export function sizeDifference(listingSqft: number, medianSizeSqft: number | null): number | null {
  if (medianSizeSqft === null || !(medianSizeSqft > 0) || !(listingSqft > 0)) return null;
  const d = listingSqft / medianSizeSqft - 1;
  return Math.abs(d) > SIZE_NOTE_THRESHOLD ? d : null;
}
