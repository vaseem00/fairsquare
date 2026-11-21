import "server-only";
/**
 * Building matching for GET /api/buildings/match and POST /api/extract (A§2.3, A§4.3, WP3).
 * Candidates never carry the numeric score: the UI shows "strong"/"possible" and sale counts only.
 */
import { salesWindow } from "@/lib/data-status";
import { getAliasRows, countRecentSalesByBuilding, recentSaleSizes } from "@/lib/db/repo/buildings";
import type { Db } from "@/lib/db/client";
import { completionBasis } from "@/lib/domain/analyse";
import type { IsoDate } from "@/lib/domain/dates";
import { findCandidates, needsAreaCheck, needsTowerCheck, preselect } from "@/lib/domain/match";
import { getEnv } from "@/lib/env";
import { sizeClusters } from "@/lib/result/scale-model";
import type { Completion, MatchResponse, SizeClusterView } from "@/lib/types";

export const EMPTY_MATCH: MatchResponse = Object.freeze({
  candidates: [],
  preselectId: null,
  towerCheck: false,
  areaCheck: false,
}) as MatchResponse;

const empty = (): MatchResponse => ({ candidates: [], preselectId: null, towerCheck: false, areaCheck: false });

/**
 * Up to 3 candidate buildings for the typed name (and optional area hint), the pre-selected building
 * when the top match is strong and not tied, whether to ask for the tower number (towers that differ
 * only by a number) and whether to ask for the area (the same name in two areas). With `beds`, each
 * candidate carries its number of sales in the comparison window for that bedroom count and the
 * listing's completion basis (off-plan sales for an off-plan listing, ready sales otherwise); 0 while
 * no sales data is loaded. With `beds` and loaded data, the pre-selected candidate also carries the
 * usual sizes of those same sales (`sizes`, the size buttons of RESULT_SPEC section 2.5).
 */
export async function matchBuildings(
  db: Db,
  q: string,
  area: string | null,
  beds: number | null,
  today: IsoDate,
  completion: Completion | null = null,
): Promise<MatchResponse> {
  if (!q || !q.trim()) return empty();
  const rows = await getAliasRows(db);
  const cands = findCandidates(q, rows, area);
  if (cands.length === 0) return empty();
  const preselectId = preselect(cands);

  let counts: Map<number, number> | null = null;
  let sizes: SizeClusterView[] | null = null;
  let basisSales: { ready: number; offPlan: number } | null = null;
  if (beds !== null && beds !== undefined) {
    const { window } = await salesWindow(db, today, getEnv().rules.windowDays);
    const basis = completionBasis(completion);
    counts = window ? await countRecentSalesByBuilding(db, cands.map((c) => c.buildingId), beds, basis, window) : new Map();
    if (window && preselectId !== null) {
      const clusters = sizeClusters(await recentSaleSizes(db, preselectId, beds, basis, window));
      sizes = clusters.map((c) => ({ sqft: c.sqft, sales: c.sales }));
      // Both kinds for the preselected building, so the scene can ask "Is it ready or off-plan?".
      const other = basis === "ready" ? "off_plan" : "ready";
      const otherCount = (await countRecentSalesByBuilding(db, [preselectId], beds, other, window)).get(preselectId) ?? 0;
      const own = counts.get(preselectId) ?? 0;
      basisSales = basis === "ready" ? { ready: own, offPlan: otherCount } : { ready: otherCount, offPlan: own };
    }
  }

  return {
    candidates: cands.map((c) => ({
      buildingId: c.buildingId,
      name: c.name,
      area: c.area,
      strength: c.strength,
      salesForBedrooms: counts ? (counts.get(c.buildingId) ?? 0) : null,
      ...(sizes && c.buildingId === preselectId ? { sizes } : {}),
      ...(basisSales && c.buildingId === preselectId ? { basisSales } : {}),
    })),
    preselectId,
    towerCheck: needsTowerCheck(cands),
    areaCheck: needsAreaCheck(cands),
  };
}
