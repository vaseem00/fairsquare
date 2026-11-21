/**
 * The scale of adjusted registered sales (DESIGN.md section 6.17, REAL_DATA.md section 16): the range
 * for this listing's size at the data date, the asking price, and every registered sale used at its
 * adjusted AED per sq ft. Pure and client-safe; it returns the range scale's geometry
 * (`rangeScaleOf`, similar-scale.ts), so the page and the share card draw it with the same code.
 *
 * - The shaded zone is the stored range (`acs.rangeLowPsf` to `acs.rangeHighPsf`), its two ends
 *   labelled. There is no middle mark: no single figure is stored for a page.
 * - A filled dot is a registered sale of the same bedroom count in this building, adjusted (ring 1).
 * - A hollow ring is a sale of another bedroom count in the building, or one in another building of
 *   the project, adjusted (rings 2 and 3): shape carries the difference, not colour.
 * - When a column would grow past the lane, one mark stands for up to `per` rows.
 * A row adjusted to further than 1.6 times from the range's ends is not drawn (`offScale` counts those).
 */
import { acsShown } from "@/lib/copy";
import type { CheckView } from "@/lib/types";
import { RANGE_REACH, rangeScaleOf, type RangeScaleModel, type RangeVariant } from "./similar-scale";

export type AcsScaleCheck = Pick<CheckView, "acs" | "analysis" | "building">;

export function acsScale(check: AcsScaleCheck, width?: number, opts: { variant?: RangeVariant } = {}): RangeScaleModel | null {
  const a = acsShown(check);
  if (!a) return null;
  const low = a.rangeLowPsf;
  const high = a.rangeHighPsf;
  const rows = a.comparables.map((c, i) => ({ psf: c.adjustedPsf, i, ring: c.ring }));
  const on = rows.filter((r) => r.psf >= low / RANGE_REACH && r.psf <= high * RANGE_REACH);
  const own = on.filter((r) => r.ring === 1);
  return rangeScaleOf(
    {
      low,
      high,
      ask: check.analysis.askingPsf,
      verdict: a.verdict,
      own,
      near: on.filter((r) => r.ring !== 1),
      offScale: rows.length - on.length,
      capped: a.comparables.length < a.comparablesTotal ? { shown: a.comparables.length, of: a.comparablesTotal } : null,
      groupOwn: true,
      ownNewest: own.length ? own.map((r) => a.comparables[r.i].date).sort().at(-1) ?? null : null,
    },
    width,
    opts.variant,
  );
}
