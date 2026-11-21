/**
 * The project route (REAL_DATA.md section 15.8): a range for an off-plan listing of a building that is
 * NOT in the data, from the other buildings of its project (resolved by `resolveProject`). Pure
 * TypeScript, no I/O.
 *
 * Reference: the other buildings of the project in its DLD area with 3 or more registered sales of the
 * same bedrooms and basis in the 12 months; the median of their ln(median AED per sq ft), each building
 * once. Range: [reference + lowLog, reference + highLog], fitted out of sample on buildings as they first
 * appeared in the data (they sold above their project's other buildings more often than below, so the
 * range reaches further up than down). Shown only off-plan, for studios to 3 bedrooms, with at least one
 * other building, and when the half-width is within maxHalfWidth. The centre is never shown.
 */
import type { SimilarArtifact, SimilarBasis, SimilarComparable, SimilarResult } from "./similar";

export interface ProjectRouteConstants {
  basis: "off_plan";
  maxBedrooms: number;
  minBuildings: number;
  minComparableSales: number;
  lowLog: number;
  highLog: number;
}

export interface ProjectRouteRequest {
  bedrooms: number;
  basis: SimilarBasis;
  askingPsf: number;
  /** The resolved project: its DLD area and project numbers. */
  areaDld: string;
  projectNumbers: readonly string[];
}

const middle = (s: readonly number[]) => (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2;
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/** The project's other buildings behind the range, most sales first, then by name. */
export function projectRouteComparables(a: SimilarArtifact, route: ProjectRouteConstants, req: Omit<ProjectRouteRequest, "askingPsf">): SimilarComparable[] {
  const numbers = new Set(req.projectNumbers);
  return a.cells
    .filter((c) => {
      const b = a.buildings[c.b];
      return c.bed === req.bedrooms && c.basis === req.basis && c.nRaw12 >= route.minComparableSales && c.med12 !== null && b.areaDld === req.areaDld && b.projectNumber !== "" && numbers.has(b.projectNumber);
    })
    .map((c) => ({ building: a.buildings[c.b], sales: c.nRaw12, medianPsf: c.med12 as number }))
    .sort(
      (x, y) =>
        y.sales - x.sales ||
        (x.building.building < y.building.building ? -1 : x.building.building > y.building.building ? 1 : 0) ||
        (x.building.key < y.building.key ? -1 : x.building.key > y.building.key ? 1 : 0),
    );
}

function refused(reason: SimilarResult["reason"], buildings = 0, sales = 0): SimilarResult {
  return {
    shown: false,
    reason,
    tier: null,
    evidenceClass: buildings > 0 ? "project" : null,
    level: buildings > 0 ? "project" : null,
    comparableBuildings: buildings,
    comparableSales: sales,
    centrePsf: null,
    lowPsf: null,
    highPsf: null,
    halfWidth: null,
    rangeLowPsf: null,
    rangeHighPsf: null,
    verdict: null,
    evidence: { ownSales: null, older12to24: null, older24to36: null, otherBedrooms: null },
  };
}

/**
 * The range for one listing. `c` carries the shared rule numbers (maxHalfWidth, closeHalfWidth,
 * displayRounding) and `route` the route's own.
 */
export function compareProjectRoute(
  a: SimilarArtifact,
  c: { maxHalfWidth: number; closeHalfWidth: number; displayRounding: number },
  route: ProjectRouteConstants,
  req: ProjectRouteRequest,
): SimilarResult {
  if (req.bedrooms > route.maxBedrooms) return refused("bedrooms_not_validated");
  // Ready buildings were never testable (no case had other buildings of its project): never shown.
  if (req.basis !== route.basis) return refused("no_building_evidence");
  const others = projectRouteComparables(a, route, req);
  const sales = others.reduce((n, x) => n + x.sales, 0);
  if (others.length < route.minBuildings || others.length === 0) return refused("no_evidence");
  const ref = middle(others.map((x) => Math.log(x.medianPsf)).sort((x, y) => x - y));
  const low = ref + route.lowLog;
  const high = ref + route.highLog;
  const halfWidth = (route.highLog - route.lowLog) / 2;
  if (halfWidth > c.maxHalfWidth) return { ...refused("range_too_wide", others.length, sales), centrePsf: Math.exp(ref), lowPsf: Math.exp(low), highPsf: Math.exp(high), halfWidth };
  const rangeLowPsf = roundTo(Math.exp(low), c.displayRounding);
  const rangeHighPsf = roundTo(Math.exp(high), c.displayRounding);
  return {
    shown: true,
    reason: null,
    tier: halfWidth <= c.closeHalfWidth ? "close" : "broad",
    evidenceClass: "project",
    level: "project",
    comparableBuildings: others.length,
    comparableSales: sales,
    centrePsf: Math.exp(ref),
    lowPsf: Math.exp(low),
    highPsf: Math.exp(high),
    halfWidth,
    rangeLowPsf,
    rangeHighPsf,
    verdict: req.askingPsf > rangeHighPsf ? "above" : req.askingPsf < rangeLowPsf ? "below" : "within",
    evidence: { ownSales: null, older12to24: null, older24to36: null, otherBedrooms: null },
  };
}
