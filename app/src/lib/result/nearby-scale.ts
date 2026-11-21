/**
 * The scale of nearby registered sales (DESIGN.md section 6.18, REAL_DATA.md section 17): the range
 * for this listing at the data date, the asking price, and every registered sale used at its adjusted
 * AED per sq ft. Pure and client-safe; it returns the range scale's geometry (`rangeScaleOf`,
 * similar-scale.ts), so the page and the share card draw it with the same code.
 *
 * Every mark is a hollow ring: each is a sale in ANOTHER building (on every range scale a ring is
 * another building, a filled dot the listing's own). There is no filled dot here and no middle mark.
 * When a column would grow past the lane, one ring stands for up to `per` sales. A sale adjusted to
 * further than 1.6 times from the range's ends is not drawn (`offScale` counts those).
 */
import { nearbyShown } from "@/lib/copy";
import type { CheckView } from "@/lib/types";
import { RANGE_REACH, rangeScaleOf, type RangeScaleModel, type RangeVariant } from "./similar-scale";

export type NearbyScaleCheck = Pick<CheckView, "analysis"> & Partial<Pick<CheckView, "acs" | "building" | "similar" | "nearby">>;

export function nearbyScale(check: NearbyScaleCheck, width?: number, opts: { variant?: RangeVariant } = {}): RangeScaleModel | null {
  const n = nearbyShown(check);
  if (!n) return null;
  const low = n.rangeLowPsf;
  const high = n.rangeHighPsf;
  const rows = n.comparables.map((c, i) => ({ psf: c.adjustedPsf, i }));
  const on = rows.filter((r) => r.psf >= low / RANGE_REACH && r.psf <= high * RANGE_REACH);
  return rangeScaleOf(
    {
      low,
      high,
      ask: check.analysis.askingPsf,
      verdict: n.verdict,
      own: [],
      near: on,
      offScale: rows.length - on.length,
      capped: n.comparables.length < n.comparablesTotal ? { shown: n.comparables.length, of: n.comparablesTotal } : null,
      groupOwn: false,
      ownNewest: null,
    },
    width,
    opts.variant,
  );
}
