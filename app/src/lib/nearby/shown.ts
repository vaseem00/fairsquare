/**
 * Whether a stored nearby-registered-sales result may be shown (REAL_DATA.md section 17.4). Pure and
 * client-safe. The server's rule decides first (`estimateNearby`); this is the last line of defence on
 * everything that draws or words the range, so an entry that should not have been stored as shown
 * still shows nothing and the page stays "Too few sales to compare yet" or "Not covered yet":
 * - no range without both ends in order and an outcome;
 * - no range without the place named (the page must say which other buildings it read);
 * - no range without the registered sales and the buildings behind it listed;
 * - no range without the tested share (the weakness note states it).
 */
import type { NearbyView } from "@/lib/types";

export type ShownNearby = NearbyView & {
  shown: true;
  rangeLowPsf: number;
  rangeHighPsf: number;
  verdict: NonNullable<NearbyView["verdict"]>;
  scope: NonNullable<NearbyView["scope"]>;
  tested: NonNullable<NearbyView["tested"]>;
};

export function shownNearby(n: NearbyView | null | undefined): ShownNearby | null {
  if (!n || !n.shown || n.rangeLowPsf === null || n.rangeHighPsf === null || n.verdict === null || n.scope === null || n.tested === null) return null;
  if (!(n.rangeLowPsf > 0) || !(n.rangeHighPsf >= n.rangeLowPsf)) return null;
  if (n.comparables.length === 0 || n.buildings.length === 0) return null;
  const named = n.scope === "area" ? !!n.area?.trim() : !!n.community?.trim();
  if (!named) return null;
  return n as ShownNearby;
}
