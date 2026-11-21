/**
 * Whether a stored adjusted-registered-sales result leads a comparison (REAL_DATA.md section 16.4).
 * Pure and client-safe. The server's rule decides first (`estimateAcs`); this is the last line of
 * defence on everything that draws or words the range, so an entry that should not have been stored
 * as shown still shows nothing and the page falls back to the same-building median or the second tier:
 * - no range without both ends in order and an outcome;
 * - no range without the registered sales behind it listed, at least one of them a sale of the same
 *   bedroom count in the building itself (the page must be able to show what it adjusted).
 */
import type { AcsView } from "@/lib/types";

export type ShownAcs = AcsView & {
  shown: true;
  rangeLowPsf: number;
  rangeHighPsf: number;
  verdict: NonNullable<AcsView["verdict"]>;
};

export function shownAcs(a: AcsView | null | undefined): ShownAcs | null {
  if (!a || !a.shown || a.rangeLowPsf === null || a.rangeHighPsf === null || a.verdict === null) return null;
  if (!(a.rangeLowPsf > 0) || !(a.rangeHighPsf >= a.rangeLowPsf)) return null;
  if (a.comparables.length === 0 || a.evidence.ownSales < 1) return null;
  return a as ShownAcs;
}
