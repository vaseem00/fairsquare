/**
 * The project route's range (src/lib/domain/project-route.ts, REAL_DATA.md section 15.8), on a small
 * synthetic artifact with the numbers worked out by hand, and the shipped constants' route.
 */
import { describe, expect, it } from "vitest";
import { compareProjectRoute, projectRouteComparables, type ProjectRouteConstants } from "@/lib/domain/project-route";
import type { SimilarArtifact, SimilarCell } from "@/lib/domain/similar";
import { PROJECT_ROUTE_MIN_VERSION, SIMILAR_CONSTANTS } from "@/lib/similar/model";

const ROUTE: ProjectRouteConstants = { basis: "off_plan", maxBedrooms: 3, minBuildings: 1, minComparableSales: 3, lowLog: -0.03, highLog: 0.2 };
const RULE = { maxHalfWidth: 0.2, closeHalfWidth: 0.1, displayRounding: 10 };

const cell = (b: number, bed: number, basis: "ready" | "off_plan", n: number, med: number | null): SimilarCell => ({ b, bed, basis, nRaw12: n, n12: n, med12: med, nOld1: 0, medOld1: null, nOld2: 0, medOld2: null });
const A: SimilarArtifact = {
  version: 1,
  dataThrough: "2026-11-16",
  windowStart: "2025-11-16",
  buildings: [
    { key: "1", building: "Park One 1", areaDld: "Area X", projectNumber: "11", masterProject: "" },
    { key: "2", building: "Park One 2", areaDld: "Area X", projectNumber: "12", masterProject: "" },
    { key: "3", building: "Park One 4", areaDld: "Area X", projectNumber: "14", masterProject: "" },
    { key: "4", building: "Other Tower", areaDld: "Area X", projectNumber: "99", masterProject: "" },
    { key: "5", building: "Park One Far", areaDld: "Area Y", projectNumber: "11", masterProject: "" },
  ],
  cells: [
    cell(0, 2, "off_plan", 40, 1500),
    cell(1, 2, "off_plan", 12, 1600),
    cell(2, 2, "off_plan", 2, 9000), // under 3 sales: not read
    cell(3, 2, "off_plan", 50, 3000), // another project
    cell(4, 2, "off_plan", 30, 5000), // another area
    cell(0, 2, "ready", 10, 1200), // another basis
    cell(0, 1, "off_plan", 10, 1800), // other bedrooms
  ],
};
const REQ = { bedrooms: 2, basis: "off_plan" as const, askingPsf: 1600, areaDld: "Area X", projectNumbers: ["11", "12", "14"] };

describe("compareProjectRoute", () => {
  it("the median of the other buildings' medians, the fitted reach either side, rounded to AED 10", () => {
    const r = compareProjectRoute(A, RULE, ROUTE, REQ);
    const ref = (Math.log(1500) + Math.log(1600)) / 2;
    expect(r).toMatchObject({ shown: true, reason: null, tier: "broad", evidenceClass: "project", level: "project", comparableBuildings: 2, comparableSales: 52, verdict: "within" });
    expect(r.centrePsf).toBeCloseTo(Math.exp(ref), 9);
    expect(r.rangeLowPsf).toBe(Math.round(Math.exp(ref - 0.03) / 10) * 10);
    expect(r.rangeHighPsf).toBe(Math.round(Math.exp(ref + 0.2) / 10) * 10);
    expect([r.rangeLowPsf, r.rangeHighPsf]).toEqual([1500, 1890]);
    expect(r.halfWidth).toBeCloseTo(0.115, 12);
    expect(r.evidence).toEqual({ ownSales: null, older12to24: null, older24to36: null, otherBedrooms: null });
    expect(compareProjectRoute(A, RULE, ROUTE, { ...REQ, askingPsf: 1900 }).verdict).toBe("above");
    expect(compareProjectRoute(A, RULE, ROUTE, { ...REQ, askingPsf: 1490 }).verdict).toBe("below");
    expect(compareProjectRoute(A, RULE, ROUTE, { ...REQ, askingPsf: 1890 }).verdict).toBe("within");
  });

  it("names exactly the buildings it read, most sales first", () => {
    expect(projectRouteComparables(A, ROUTE, REQ).map((x) => [x.building.building, x.sales, x.medianPsf])).toEqual([
      ["Park One 1", 40, 1500],
      ["Park One 2", 12, 1600],
    ]);
  });

  it("refuses ready listings, 4 or more bedrooms, no other building, and a range too wide", () => {
    expect(compareProjectRoute(A, RULE, ROUTE, { ...REQ, basis: "ready" })).toMatchObject({ shown: false, reason: "no_building_evidence", rangeLowPsf: null, rangeHighPsf: null, verdict: null });
    expect(compareProjectRoute(A, RULE, ROUTE, { ...REQ, bedrooms: 4 })).toMatchObject({ shown: false, reason: "bedrooms_not_validated" });
    expect(compareProjectRoute(A, RULE, ROUTE, { ...REQ, bedrooms: 3 })).toMatchObject({ shown: false, reason: "no_evidence", comparableBuildings: 0 });
    expect(compareProjectRoute(A, RULE, ROUTE, { ...REQ, projectNumbers: ["14"] })).toMatchObject({ shown: false, reason: "no_evidence" });
    expect(compareProjectRoute(A, RULE, { ...ROUTE, minBuildings: 3 }, REQ)).toMatchObject({ shown: false, reason: "no_evidence" });
    expect(compareProjectRoute(A, RULE, { ...ROUTE, lowLog: -0.25, highLog: 0.25 }, REQ)).toMatchObject({ shown: false, reason: "range_too_wide", rangeLowPsf: null, verdict: null });
  });
});

describe("the shipped constants carry the route (version 4)", () => {
  it("off-plan, studios to 3 bedrooms, the fitted reach, and the tested share", () => {
    const r = SIMILAR_CONSTANTS.projectRoute!;
    expect(SIMILAR_CONSTANTS.version).toBeGreaterThanOrEqual(PROJECT_ROUTE_MIN_VERSION);
    expect(r).toMatchObject({ basis: "off_plan", maxBedrooms: 3, minBuildings: 1, minComparableSales: 3, heldOf10: 7 });
    // scripts/model/project_route.py on the snapshot of 16 Nov 2026: -2.8% and +21.7%.
    expect(Math.round(Math.expm1(r.lowLog) * 1000) / 10).toBe(-2.8);
    expect(Math.round(Math.expm1(r.highLog) * 1000) / 10).toBe(21.7);
    expect((r.highLog - r.lowLog) / 2).toBeLessThan(SIMILAR_CONSTANTS.maxHalfWidth);
    // The out-of-sample numbers behind the decision to ship it (REAL_DATA.md section 15.8).
    expect(r.backtest).toMatchObject({ cases: 119, coveragePct: 89.9, coverageGroupsWeightedPct: 82, lowestCutoffCoveragePct: 76.9, meanHalfWidthPct: 15.9 });
    // heldOf10 is the lowest measured share, rounded down.
    const b = r.backtest as { coveragePct: number; coverageGroupsWeightedPct: number; lowestCutoffCoveragePct: number };
    expect(Math.floor(Math.min(b.coveragePct, b.coverageGroupsWeightedPct, b.lowestCutoffCoveragePct) / 10)).toBe(r.heldOf10);
  });
});
