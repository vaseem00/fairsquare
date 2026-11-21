/**
 * The similar-buildings comparison (src/lib/domain/similar.ts, REAL_DATA.md section 15).
 * - Golden: the 35 verified cases of tests/fixtures/similar/golden-cases.json, reproduced to 1e-9 on
 *   the cells of the snapshot they were made on (tests/fixtures/similar/similar-cells.csv.gz, frozen
 *   with the constants it was fitted with, so a later data refresh or refit never moves them).
 *   Regenerated on 19 Nov 2026 with the independent reference after rule 10a was tightened: the
 *   snapshot 8f62f3cd, the fitted values of constants version 3, and the rule of version 1 (no
 *   consistency rules, project siblings shown), so every arithmetic path is still covered.
 * - Unit: every evidence tier, every refusal rule, the three scenarios, rounding and edge cases, on
 *   small synthetic artifacts with the expected numbers worked out here by hand.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildSimilarArtifact,
  compareSimilar,
  countBucket,
  productMedian,
  quantile,
  type SimilarArtifact,
  type SimilarBuilding,
  type SimilarConstants,
  type SimilarRequest,
  type SimilarResult,
  type SimilarSale,
} from "@/lib/domain/similar";
import { artifactFromCellRows, readSimilarCells } from "@/lib/ingest/snapshot";
import { SIMILAR_CONSTANTS, SimilarConstantsSchema } from "@/lib/similar/model";

const DIR = path.join(process.cwd(), "tests", "fixtures", "similar");
const C = SimilarConstantsSchema.parse(JSON.parse(readFileSync(path.join(DIR, "constants.json"), "utf8"))) as unknown as SimilarConstants;

interface Golden {
  snapshot: { dataThrough: string };
  artifact: { buildings: number; cells: number; windowStart: string };
  cases: Array<{ id: string; note: string; request: SimilarRequest; expected: SimilarResult }>;
}
const GOLDEN = JSON.parse(readFileSync(path.join(DIR, "golden-cases.json"), "utf8")) as Golden;

/** Numbers within 1e-9 relative; everything else exactly equal. */
function expectClose(actual: unknown, expected: unknown, where: string): void {
  if (typeof expected === "number" && typeof actual === "number") {
    const tol = 1e-9 * Math.max(1, Math.abs(expected));
    expect(Math.abs(actual - expected), `${where}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol);
  } else if (expected !== null && typeof expected === "object") {
    expect(actual !== null && typeof actual === "object", where).toBe(true);
    expect(Object.keys(actual as object).sort(), where).toEqual(Object.keys(expected).sort());
    for (const k of Object.keys(expected)) expectClose((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${where}.${k}`);
  } else {
    expect(actual, where).toBe(expected);
  }
}

// The frozen cells are built from Data.Dubai rows, which this repository does not redistribute
// (docs/DATA_COLLECTION.md). Without them the golden block is skipped; everything else still runs.
const HAS_GOLDEN_CELLS = existsSync(path.join(DIR, "similar-cells.csv.gz"));

describe.skipIf(!HAS_GOLDEN_CELLS)("golden cases (the verified reference, snapshot of 16 Nov 2026)", () => {
  let artifact: SimilarArtifact;
  beforeAll(async () => {
    const file = path.join(DIR, "similar-cells.csv.gz");
    const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
    const rows = await readSimilarCells(file, { sha256, rows: GOLDEN.artifact.cells });
    artifact = artifactFromCellRows(rows, GOLDEN.snapshot.dataThrough, GOLDEN.artifact.windowStart);
  });

  it("the frozen cells are the artifact the cases were made on", () => {
    expect(artifact.cells).toHaveLength(13_575);
    expect(artifact.buildings).toHaveLength(4_348);
    expect(GOLDEN.cases).toHaveLength(35);
  });

  it.each(GOLDEN.cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expectClose(compareSimilar(artifact, C, c.request), c.expected, c.id);
  });

  it("the cases cover every outcome: shown close and broad, each verdict, and all four refusals", () => {
    const seen = new Set(GOLDEN.cases.map((c) => (c.expected.shown ? `${c.expected.tier}/${c.expected.verdict}` : c.expected.reason)));
    for (const k of ["close/above", "close/within", "broad/within", "bedrooms_not_validated", "no_evidence", "no_building_evidence", "range_too_wide"]) {
      expect(seen.has(k), k).toBe(true);
    }
    expect(GOLDEN.cases.some((c) => c.expected.verdict === "below")).toBe(true);
    expect(GOLDEN.cases.some((c) => c.request.scope && c.expected.shown && c.expected.level === "project")).toBe(true);
  });

  it("a not-shown result carries no range and no outcome", () => {
    for (const c of GOLDEN.cases.filter((x) => !x.expected.shown)) {
      const r = compareSimilar(artifact, C, c.request);
      expect([r.rangeLowPsf, r.rangeHighPsf, r.verdict, r.tier], c.id).toEqual([null, null, null, null]);
    }
  });
});

// ---------- synthetic artifacts ----------

const THROUGH = "2026-11-10";
const AREA = "Test Area One";

function building(name: string, projectNumber = "", masterProject = "TEST MASTER", areaDld = AREA): SimilarBuilding {
  return { building: name, areaDld, projectNumber, masterProject };
}

/** `n` sales of one building, bedrooms and basis at `psf`, dated `daysAgo` before THROUGH (1,000 sq ft each). */
function sales(name: string, bedrooms: number, psf: number[], daysAgo: number, completion: "ready" | "off_plan" = "ready", areaDld = AREA): SimilarSale[] {
  const day = new Date(Date.parse(`${THROUGH}T00:00:00Z`) - daysAgo * 86_400_000).toISOString().slice(0, 10);
  return psf.map((p) => ({ date: day, building: name, areaDld, bedrooms, sizeSqft: 1000, priceAed: p * 1000, completion }));
}

/** Always present, so dataThrough is THROUGH whatever else a test adds. */
const ANCHOR = sales("ANCHOR", 7, [1000], 0, "ready", "Test Area Anchor");
const ANCHOR_B = building("ANCHOR", "", "", "Test Area Anchor");

function make(buildings: SimilarBuilding[], rows: SimilarSale[]): SimilarArtifact {
  return buildSimilarArtifact([...rows, ...ANCHOR], [...buildings, ANCHOR_B]);
}

const ask = (buildingKey: string, bedrooms = 2, basis: "ready" | "off_plan" = "ready", askingPsf = 1500): SimilarRequest => ({ bedrooms, basis, askingPsf, buildingKey });

/** Three other buildings of the same community with 2-bed medians 1,400, 1,500 and 1,600. */
const COMMUNITY = [building("REF A"), building("REF B"), building("REF C")];
const COMMUNITY_SALES = [...sales("REF A", 2, [1400, 1400, 1400], 30), ...sales("REF B", 2, [1500, 1500, 1500], 40), ...sales("REF C", 2, [1600, 1600, 1600], 50)];

describe("small functions", () => {
  it("productMedian: the middle, the mean of two middles, and the 0.5x to 2x rule from 5 values", () => {
    expect(productMedian([])).toEqual({ median: null, used: 0 });
    expect(productMedian([3, 1, 2])).toEqual({ median: 2, used: 3 });
    expect(productMedian([4, 1, 3, 2])).toEqual({ median: 2.5, used: 4 });
    // 4 values: nothing is left out, however far.
    expect(productMedian([100, 100, 100, 1000])).toEqual({ median: 100, used: 4 });
    // 5 values: 1,000 is over twice the median and goes; the median is recomputed once.
    expect(productMedian([100, 100, 110, 120, 1000])).toEqual({ median: 105, used: 4 });
    expect(productMedian([10, 100, 100, 110, 120])).toEqual({ median: 105, used: 4 });
  });

  it("quantile interpolates at q x (n - 1); countBucket follows the edges 1, 2, 3, 5, 10, 20", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([0, 10], 0.9)).toBeCloseTo(9, 12);
    expect(quantile([7], 0.1)).toBe(7);
    expect([0, 1, 2, 3, 4, 5, 9, 10, 19, 20, 500].map((n) => countBucket(n, C.countBuckets))).toEqual([0, 1, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });
});

describe("buildSimilarArtifact", () => {
  it("one cell per building, bedrooms and basis, with the three windows cut at 365, 730 and 1,095 days", () => {
    const a = make(
      [building("T1")],
      [
        ...sales("T1", 2, [1000, 1100], 0),
        ...sales("T1", 2, [1200], 365), // the first day of the 12 months (inclusive)
        ...sales("T1", 2, [900], 366), // the day before: 12 to 24 months
        ...sales("T1", 2, [800], 730),
        ...sales("T1", 2, [700], 731), // 24 to 36 months
        ...sales("T1", 2, [600], 1095),
        ...sales("T1", 2, [500], 1096), // older than 36 months: in no window
        ...sales("T1", 2, [2000], 10, "off_plan"),
      ],
    );
    expect(a).toMatchObject({ version: 1, dataThrough: THROUGH, windowStart: "2025-11-10" });
    const cells = a.cells.filter((c) => a.buildings[c.b].building === "T1");
    expect(cells).toEqual([
      { b: 0, bed: 2, basis: "off_plan", nRaw12: 1, n12: 1, med12: 2000, nOld1: 0, medOld1: null, nOld2: 0, medOld2: null },
      { b: 0, bed: 2, basis: "ready", nRaw12: 3, n12: 3, med12: 1100, nOld1: 2, medOld1: 850, nOld2: 2, medOld2: 650 },
    ]);
    expect(a.buildings[0]).toEqual({ key: `T1|${AREA}`, building: "T1", areaDld: AREA, projectNumber: "", masterProject: "TEST MASTER" });
  });

  it("n12 counts the sales the product median used; nRaw12 all of them", () => {
    const a = make([building("T1")], sales("T1", 1, [1000, 1000, 1010, 1020, 5000], 5));
    expect(a.cells[0]).toMatchObject({ nRaw12: 5, n12: 4, med12: 1005 });
  });

  it("does not depend on the order of the sales, groups by keyOf, and refuses a sale of an unknown building", () => {
    const rows = [...sales("T1", 2, [1000, 1300, 1100], 3), ...sales("T2", 0, [900], 400)];
    const bs = [building("T1"), building("T2")];
    expect(make(bs, [...rows].reverse())).toEqual(make(bs, rows));
    // A second spelling of T1 falls into the same building when keyOf says so.
    const lower = (b: string, a: string) => `${b.toLowerCase()}|${a.toLowerCase()}`;
    const merged = buildSimilarArtifact([...rows, ...sales("t1", 2, [1200], 4), ...ANCHOR], [...bs, ANCHOR_B], lower);
    expect(merged.cells[0]).toMatchObject({ nRaw12: 4, med12: 1150 });
    expect(merged.buildings[0].key).toBe(`T1|${AREA}`);
    expect(() => make([building("T1")], sales("NOT LISTED", 2, [1000], 1))).toThrow(/missing from the buildings list/);
    expect(() => buildSimilarArtifact(rows, [building("T1"), building("t1"), building("T2")], lower)).toThrow(/share the key/);
    expect(() => buildSimilarArtifact([], [])).toThrow(/no sales/);
  });
});

describe("the reference: project, then community, then area", () => {
  const scope = (s: SimilarRequest["scope"], bedrooms = 2, basis: "ready" | "off_plan" = "ready"): SimilarRequest => ({ bedrooms, basis, askingPsf: 1500, scope: s });

  it("community: the median of the building medians, with the spread of their logs in the variance", () => {
    const a = make(COMMUNITY, COMMUNITY_SALES);
    const r = compareSimilar(a, C, scope({ areaDld: AREA, masterProject: "TEST MASTER" }));
    expect(r).toMatchObject({ level: "community", evidenceClass: "community", comparableBuildings: 3, comparableSales: 9, shown: false, reason: "no_building_evidence" });
    expect(r.centrePsf).toBeCloseTo(1500, 9);
    // By hand: spread = (q90 - q10) / 2.563 of ln 1400, ln 1500, ln 1600; variance = a2 + b2 x spread².
    const logs = [1400, 1500, 1600].map(Math.log);
    // Three values: q10 sits 0.2 of the way from the first to the second, q90 0.8 from the second to the third.
    const spread = (logs[1] + 0.8 * (logs[2] - logs[1]) - (logs[0] + 0.2 * (logs[1] - logs[0]))) / C.spreadDivisor;
    const [a2, b2] = C.referenceVariance.community.ready;
    const [floor, qLow, qHigh] = C.range80.community;
    const s = Math.sqrt(a2 + b2 * spread * spread + floor * floor);
    expect(r.lowPsf).toBeCloseTo(1500 * Math.exp(-qLow * s), 6);
    expect(r.highPsf).toBeCloseTo(1500 * Math.exp(qHigh * s), 6);
    expect(r.halfWidth).toBeCloseTo(((qLow + qHigh) / 2) * s, 12);
  });

  it("levels need 1 project building, 2 community buildings or 3 area buildings, each with 3 or more sales", () => {
    const a = make(
      [building("P1", "77"), building("P2", "78"), building("O1", "", "OTHER MASTER"), building("FEW", "77")],
      [...sales("P1", 2, [1500, 1500, 1500], 20), ...sales("P2", 2, [1700, 1700, 1700], 20), ...sales("O1", 2, [1300, 1300, 1300], 20), ...sales("FEW", 2, [9000, 9000], 20)],
    );
    // One sibling with 3 sales is enough for the project level; FEW (2 sales) never counts.
    expect(compareSimilar(a, C, scope({ areaDld: AREA, masterProject: "TEST MASTER", projectNumber: "77" }))).toMatchObject({ level: "project", comparableBuildings: 1, comparableSales: 3 });
    // No project: P1 and P2 share the master project.
    expect(compareSimilar(a, C, scope({ areaDld: AREA, masterProject: "TEST MASTER" }))).toMatchObject({ level: "community", comparableBuildings: 2, comparableSales: 6 });
    // One community building is not enough: the area's three.
    expect(compareSimilar(a, C, scope({ areaDld: AREA, masterProject: "OTHER MASTER" }))).toMatchObject({ level: "area", comparableBuildings: 3, comparableSales: 9 });
    expect(compareSimilar(a, C, scope({ areaDld: AREA }))).toMatchObject({ level: "area", comparableBuildings: 3 });
    // Other bedrooms, the other basis, another area: nothing comparable.
    for (const req of [scope({ areaDld: AREA }, 1), scope({ areaDld: AREA }, 2, "off_plan"), scope({ areaDld: "Test Area Two" })]) {
      expect(compareSimilar(a, C, req)).toMatchObject({ shown: false, reason: "no_evidence", level: null, comparableBuildings: 0, centrePsf: null, halfWidth: null });
    }
  });

  it("the listing's own building is never one of its comparables", () => {
    const a = make([building("P1", "77"), building("P2", "77")], [...sales("P1", 2, [1500, 1500, 1500], 20), ...sales("P2", 2, [1700, 1700, 1700], 20)]);
    const r = compareSimilar(a, C, ask(`P1|${AREA}`));
    expect(r).toMatchObject({ level: "project", comparableBuildings: 1, comparableSales: 3 });
    // P1 has 3 own sales (own evidence) and P2 as reference: the centre sits between 1,500 and 1,700.
    expect(r.centrePsf as number).toBeGreaterThan(1500);
    expect(r.centrePsf as number).toBeLessThan(1700);
  });
});

describe("evidence tiers of a known building", () => {
  it("own sales (1 to 4): class own, precision-weighted with the reference", () => {
    const a = make([...COMMUNITY, building("THIN")], [...COMMUNITY_SALES, ...sales("THIN", 2, [1650, 1750], 12)]);
    const r = compareSimilar(a, C, ask(`THIN|${AREA}`, 2, "ready", 1700));
    expect(r).toMatchObject({ shown: true, reason: null, evidenceClass: "own", level: "community", comparableBuildings: 3, comparableSales: 9 });
    expect(r.evidence).toEqual({ ownSales: { n: 2, medianPsf: 1700 }, older12to24: null, older24to36: null, otherBedrooms: null });
    // By hand: centre = weighted mean of ln 1700 (own, 2 sales) and ln 1500 (reference).
    const logs = [1400, 1500, 1600].map(Math.log);
    const spread = (logs[1] + 0.8 * (logs[2] - logs[1]) - (logs[0] + 0.2 * (logs[1] - logs[0]))) / C.spreadDivisor;
    const [a2, b2] = C.referenceVariance.community.ready;
    const vRef = a2 + b2 * spread * spread;
    const vOwn = C.evidenceVariance.own.ready["2"];
    const centre = (Math.log(1700) / vOwn + Math.log(1500) / vRef) / (1 / vOwn + 1 / vRef);
    const s = Math.sqrt(1 / (1 / vOwn + 1 / vRef) + C.range80.own[0] ** 2);
    expect(r.centrePsf).toBeCloseTo(Math.exp(centre), 8);
    expect(r.lowPsf).toBeCloseTo(Math.exp(centre - C.range80.own[1] * s), 8);
    expect(r.highPsf).toBeCloseTo(Math.exp(centre + C.range80.own[2] * s), 8);
    expect(r.halfWidth).toBeCloseTo(((C.range80.own[1] + C.range80.own[2]) / 2) * s, 12);
    // The own sales pull the centre most of the way to 1,700.
    expect(r.centrePsf as number).toBeGreaterThan(1630);
    expect(r.centrePsf as number).toBeLessThan(1700);
  });

  it("5 or more own sales are not second-tier evidence (the same-building comparison has them)", () => {
    const a = make([...COMMUNITY, building("RICH")], [...COMMUNITY_SALES, ...sales("RICH", 2, [1700, 1700, 1700, 1700, 1700], 12)]);
    const r = compareSimilar(a, C, ask(`RICH|${AREA}`));
    expect(r.evidence.ownSales).toBeNull();
    expect(r).toMatchObject({ evidenceClass: "community", shown: false, reason: "no_building_evidence" });
  });

  it("older sales only: class indirect, each window with its own count bucket", () => {
    const a = make([...COMMUNITY, building("OLD")], [...COMMUNITY_SALES, ...sales("OLD", 2, [1450, 1450, 1450, 1450, 1450], 500), ...sales("OLD", 2, [1300], 900)]);
    const r = compareSimilar(a, C, ask(`OLD|${AREA}`));
    expect(r).toMatchObject({ shown: true, evidenceClass: "indirect", level: "community" });
    expect(r.evidence).toEqual({ ownSales: null, older12to24: { n: 5, medianPsf: 1450 }, older24to36: { n: 1, medianPsf: 1300 }, otherBedrooms: null });
    const vRef = (() => {
      const logs = [1400, 1500, 1600].map(Math.log);
      const spread = (logs[1] + 0.8 * (logs[2] - logs[1]) - (logs[0] + 0.2 * (logs[1] - logs[0]))) / C.spreadDivisor;
      return C.referenceVariance.community.ready[0] + C.referenceVariance.community.ready[1] * spread * spread;
    })();
    const parts: Array<[number, number]> = [
      [Math.log(1500), vRef],
      [Math.log(1450), C.evidenceVariance.older12to24.ready["4"]], // 5 sales: bucket 4
      [Math.log(1300), C.evidenceVariance.older24to36.ready["1"]],
    ];
    const den = parts.reduce((n, [, v]) => n + 1 / v, 0);
    expect(r.centrePsf).toBeCloseTo(Math.exp(parts.reduce((n, [e, v]) => n + e / v, 0) / den), 8);
  });

  it("other bedroom types: how far they sit from their own references moves the range, weighted n / (n + 3)", () => {
    const refs = [building("REF A"), building("REF B"), building("REF C")];
    const oneBeds = [...sales("REF A", 1, [1000, 1000, 1000], 30), ...sales("REF B", 1, [1000, 1000, 1000], 30), ...sales("REF C", 1, [1000, 1000, 1000], 30)];
    const a = make([...refs, building("MIX")], [...COMMUNITY_SALES, ...oneBeds, ...sales("MIX", 1, [1100, 1100, 1100], 20), ...sales("MIX", 0, [9999], 20)]);
    const r = compareSimilar(a, C, ask(`MIX|${AREA}`));
    // The studio has no reference of its own (no other studios), so only the 1-beds count: 10% above.
    expect(r.evidence.otherBedrooms?.n).toBe(3);
    expect(r.evidence.otherBedrooms?.offset).toBeCloseTo(Math.log(1.1), 12);
    expect(r).toMatchObject({ evidenceClass: "indirect", level: "community" });
    expect(r.centrePsf as number).toBeGreaterThan(1500);
    expect(r.centrePsf as number).toBeLessThan(1650);
    // Without a reference for the listing's own bedrooms there is nothing to add the offset to.
    const lone = make([...refs, building("MIX")], [...oneBeds, ...sales("MIX", 1, [1100, 1100, 1100], 20)]);
    expect(compareSimilar(lone, C, ask(`MIX|${AREA}`))).toMatchObject({ shown: false, reason: "no_evidence" });
  });

  it("ready and off-plan are never pooled: off-plan sales are no evidence for a ready listing", () => {
    const a = make([...COMMUNITY, building("OFF")], [...COMMUNITY_SALES, ...sales("OFF", 2, [2000, 2000], 10, "off_plan")]);
    expect(compareSimilar(a, C, ask(`OFF|${AREA}`))).toMatchObject({ evidenceClass: "community", shown: false, reason: "no_building_evidence" });
    // Off-plan only: own off-plan sales, no off-plan reference. Shown from the building's own sales.
    const r = compareSimilar(a, C, ask(`OFF|${AREA}`, 2, "off_plan", 2000));
    expect(r).toMatchObject({ shown: true, evidenceClass: "own", level: null, comparableBuildings: 0, comparableSales: 0, verdict: "within" });
    expect(r.centrePsf).toBeCloseTo(2000, 9);
    expect(r.halfWidth).toBeCloseTo(((C.range80.own[1] + C.range80.own[2]) / 2) * Math.sqrt(C.evidenceVariance.own.off_plan["2"] + 0.03 ** 2), 12);
  });

  it("a studio is a bedroom count like any other (0)", () => {
    const a = make(
      [...COMMUNITY, building("STU")],
      [...sales("REF A", 0, [1800, 1800, 1800], 30), ...sales("REF B", 0, [1900, 1900, 1900], 30), ...sales("REF C", 0, [2000, 2000, 2000], 30), ...sales("STU", 0, [1900], 5)],
    );
    expect(compareSimilar(a, C, ask(`STU|${AREA}`, 0, "ready", 1900))).toMatchObject({ shown: true, evidenceClass: "own", level: "community", verdict: "within" });
  });

  it("one building dominating the reference counts once: the reference is the median of building medians", () => {
    const big = Array.from({ length: 300 }, () => 3000);
    const a = make([building("BIG"), building("S1"), building("S2")], [...sales("BIG", 2, big, 15), ...sales("S1", 2, [1500, 1500, 1500], 15), ...sales("S2", 2, [1520, 1520, 1520], 15)]);
    const r = compareSimilar(a, C, { bedrooms: 2, basis: "ready", askingPsf: 1500, scope: { areaDld: AREA } });
    expect(r).toMatchObject({ level: "area", comparableBuildings: 3, comparableSales: 306 });
    expect(r.centrePsf).toBeCloseTo(1520, 9); // not anywhere near 3,000
  });
});

describe("the rule: when a range is shown", () => {
  const own = (psf: number[], bed = 2) => make([building("B")], sales("B", bed, psf, 10));

  it("more than 3 bedrooms: never shown, whatever the evidence", () => {
    for (const bed of [4, 5, 7]) {
      const r = compareSimilar(own([2000, 2000, 2000, 2000], bed), C, ask(`B|${AREA}`, bed));
      expect(r, String(bed)).toMatchObject({ shown: false, reason: "bedrooms_not_validated", evidenceClass: "own", tier: null, rangeLowPsf: null, rangeHighPsf: null, verdict: null });
      expect(r.halfWidth).not.toBeNull();
    }
    expect(compareSimilar(own([2000, 2000, 2000, 2000], 3), C, ask(`B|${AREA}`, 3)).shown).toBe(true);
  });

  it("zero comparables and nothing from the building: no evidence", () => {
    const a = make([building("B")], sales("B", 2, [1500], 10));
    expect(compareSimilar(a, C, ask(`B|${AREA}`, 1))).toMatchObject({ shown: false, reason: "no_evidence", evidenceClass: null, centrePsf: null });
    expect(compareSimilar(a, C, ask("NO SUCH|Nowhere"))).toMatchObject({ shown: false, reason: "no_evidence" });
    expect(compareSimilar(a, C, { bedrooms: 2, basis: "ready", askingPsf: 1, scope: { areaDld: "" } })).toMatchObject({ shown: false, reason: "no_evidence" });
    expect(compareSimilar(a, C, { bedrooms: 2, basis: "ready", askingPsf: 1 })).toMatchObject({ shown: false, reason: "no_evidence" });
  });

  it("only other buildings of the community or the area: never shown; project siblings can be", () => {
    const a = make(
      [building("P1", "77"), building("P2", "77"), building("A1", "", "M2"), building("A2", "", "M2"), building("A3", "", "M3")],
      [
        ...sales("P1", 2, [1500, 1500, 1500], 20, "off_plan"),
        ...sales("P2", 2, [1520, 1520, 1520], 20, "off_plan"),
        ...sales("A1", 2, [1500, 1500, 1500], 20),
        ...sales("A2", 2, [1520, 1520, 1520], 20),
        ...sales("A3", 2, [1540, 1540, 1540], 20),
      ],
    );
    const scope = (s: SimilarRequest["scope"], basis: "ready" | "off_plan" = "ready"): SimilarRequest => ({ bedrooms: 2, basis, askingPsf: 1510, scope: s });
    expect(compareSimilar(a, C, scope({ areaDld: AREA, masterProject: "M2" }))).toMatchObject({ level: "community", evidenceClass: "community", shown: false, reason: "no_building_evidence" });
    expect(compareSimilar(a, C, scope({ areaDld: AREA }))).toMatchObject({ level: "area", evidenceClass: "area", shown: false, reason: "no_building_evidence" });
    // Off-plan siblings of a resolved project: shown, broad (4.2 x 0.0396 = 0.166).
    const p = compareSimilar(a, C, scope({ areaDld: AREA, masterProject: "TEST MASTER", projectNumber: "77" }, "off_plan"));
    expect(p).toMatchObject({ level: "project", evidenceClass: "project", shown: true, tier: "broad", verdict: "within" });
    expect(p.halfWidth).toBeCloseTo(4.2 * Math.sqrt(C.referenceVariance.project.off_plan[0]), 12);
  });

  it("a ready project reference alone is too wide (4.2 x 0.0567 = 0.238 > 0.20)", () => {
    const a = make([building("P1", "77")], sales("P1", 2, [1500, 1500, 1500], 20));
    const r = compareSimilar(a, C, { bedrooms: 2, basis: "ready", askingPsf: 1500, scope: { areaDld: AREA, projectNumber: "77" } });
    expect(r).toMatchObject({ shown: false, reason: "range_too_wide", evidenceClass: "project", rangeLowPsf: null, verdict: null });
    expect(r.halfWidth as number).toBeGreaterThan(C.maxHalfWidth);
    expect(r.lowPsf).not.toBeNull();
  });

  it("one old sale and nothing else: too wide", () => {
    const a = make([building("B")], sales("B", 2, [1500], 900));
    const r = compareSimilar(a, C, ask(`B|${AREA}`));
    expect(r).toMatchObject({ shown: false, reason: "range_too_wide", evidenceClass: "indirect" });
    expect(r.halfWidth).toBeCloseTo(((C.range80.indirect[1] + C.range80.indirect[2]) / 2) * Math.sqrt(C.evidenceVariance.older24to36.ready["1"] + 0.03 ** 2), 12);
  });

  it("close up to a half-width of 0.10, broad up to 0.20", () => {
    // 4 own off-plan sales: sqrt(0.00108 + 0.0009) x 1.754 = 0.078: close.
    const four = make([building("B")], sales("B", 2, [1500, 1500, 1500, 1500], 10, "off_plan"));
    expect(compareSimilar(four, C, ask(`B|${AREA}`, 2, "off_plan"))).toMatchObject({ shown: true, tier: "close" });
    // 1 own ready sale: sqrt(0.00904 + 0.0009) x 1.754 = 0.175: broad.
    const r = compareSimilar(own([1500]), C, ask(`B|${AREA}`));
    expect(r).toMatchObject({ shown: true, tier: "broad", level: null });
    expect(r.halfWidth as number).toBeGreaterThan(C.closeHalfWidth);
    // The bounds themselves follow the constants.
    const tight: SimilarConstants = { ...C, closeHalfWidth: r.halfWidth as number };
    expect(compareSimilar(own([1500]), tight, ask(`B|${AREA}`)).tier).toBe("close");
    const strict: SimilarConstants = { ...C, maxHalfWidth: (r.halfWidth as number) - 1e-9 };
    expect(compareSimilar(own([1500]), strict, ask(`B|${AREA}`))).toMatchObject({ shown: false, reason: "range_too_wide" });
  });

  it("the upper side of the range is wider than the lower side", () => {
    const r = compareSimilar(own([1500, 1500]), C, ask(`B|${AREA}`));
    expect((r.highPsf as number) / 1500 - 1).toBeGreaterThan(1 - (r.lowPsf as number) / 1500);
  });
});

/**
 * Version 2 of the rule (REAL_DATA.md section 15.3), with the SHIPPED constants. The frozen constants
 * above (the rule of version 1) have none of these rules, so the golden cases keep testing the arithmetic.
 */
describe("the consistency rules of the shipped constants (version 2)", () => {
  const S = SIMILAR_CONSTANTS as unknown as SimilarConstants;

  it("the frozen constants have none of them; the shipped ones have all three and never show another building alone", () => {
    expect([C.requireEvidenceBeyondOwnSales, C.maxOwnMedianRatio, C.ownMedianInsideRange]).toEqual([undefined, undefined, undefined]);
    expect(S.version).toBeGreaterThanOrEqual(2);
    expect(S).toMatchObject({ requireEvidenceBeyondOwnSales: true, maxOwnMedianRatio: 1.25, ownMedianInsideRange: true });
    expect(S.neverShownClasses).toEqual(["project", "community", "area"]);
  });

  it("never from the 1 to 4 sales of the 12 months alone: those are the sales the first tier calls too few", () => {
    for (const psf of [[1500], [1500, 1520], [1500, 1500, 1500, 1500]]) {
      const a = make([building("B")], sales("B", 2, psf, 10));
      expect(compareSimilar(a, C, ask(`B|${AREA}`)).shown, String(psf.length)).toBe(true); // version 1 showed it
      const r = compareSimilar(a, S, ask(`B|${AREA}`));
      expect(r, String(psf.length)).toMatchObject({ shown: false, reason: "own_sales_only", evidenceClass: "own", tier: null, rangeLowPsf: null, rangeHighPsf: null, verdict: null });
    }
    // With something more it shows: other buildings, earlier sales, or another bedroom type.
    const withOthers = make([...COMMUNITY, building("B")], [...COMMUNITY_SALES, ...sales("B", 2, [1500, 1520], 10)]);
    expect(compareSimilar(withOthers, S, ask(`B|${AREA}`))).toMatchObject({ shown: true, evidenceClass: "own", level: "community" });
    const withOlder = make([building("B")], [...sales("B", 2, [1500, 1520], 10), ...sales("B", 2, [1480, 1490, 1500], 500)]);
    expect(compareSimilar(withOlder, S, ask(`B|${AREA}`))).toMatchObject({ shown: true, evidenceClass: "own", level: null, comparableBuildings: 0 });
  });

  it("the building's own medians more than a quarter apart: not shown", () => {
    const at = (older: number) => make([...COMMUNITY, building("B")], [...COMMUNITY_SALES, ...sales("B", 2, [1500, 1500], 10), ...sales("B", 2, [older, older, older], 500)]);
    // 1,500 against 1,190: 1.26 times.
    const far = compareSimilar(at(1190), S, ask(`B|${AREA}`));
    expect(far).toMatchObject({ shown: false, reason: "evidence_disagrees", rangeLowPsf: null, rangeHighPsf: null, verdict: null, tier: null });
    expect(far.evidence).toMatchObject({ ownSales: { n: 2, medianPsf: 1500 }, older12to24: { n: 3, medianPsf: 1190 } });
    expect(compareSimilar(at(1190), C, ask(`B|${AREA}`)).shown).toBe(true); // version 1 showed a narrow range between the two
    // Exactly 1.25 times is allowed (the rule is "more than"); the inside-the-range rule is switched off to test this one alone.
    const edge: SimilarConstants = { ...S, ownMedianInsideRange: false };
    expect(compareSimilar(at(1200), edge, ask(`B|${AREA}`)).shown).toBe(true);
    expect(compareSimilar(at(1199), edge, ask(`B|${AREA}`))).toMatchObject({ shown: false, reason: "evidence_disagrees" });
    // The two older years count too, with or without sales in the 12 months.
    const olderOnly = make([...COMMUNITY, building("B")], [...COMMUNITY_SALES, ...sales("B", 2, [1500, 1500, 1500], 500), ...sales("B", 2, [1100, 1100, 1100], 900)]);
    expect(compareSimilar(olderOnly, S, ask(`B|${AREA}`))).toMatchObject({ shown: false, reason: "evidence_disagrees", evidenceClass: "indirect" });
    // A reference far from the building is not this rule's business: only the building's own medians are compared.
    const close = make([...COMMUNITY, building("B")], [...COMMUNITY_SALES, ...sales("B", 2, [1500, 1500], 10), ...sales("B", 2, [1450, 1450, 1450], 500)]);
    expect(compareSimilar(close, S, ask(`B|${AREA}`))).toMatchObject({ shown: true });
  });

  it("the median of the building's own 12-month sales outside the rounded range: not shown", () => {
    // One sale at 1,900; five earlier ones at 1,550 (1.23 times, inside the ratio); the community at 1,500.
    const a = make([...COMMUNITY, building("B")], [...COMMUNITY_SALES, ...sales("B", 2, [1900], 10), ...sales("B", 2, [1550, 1550, 1550, 1550, 1550], 500)]);
    const v1 = compareSimilar(a, C, ask(`B|${AREA}`, 2, "ready", 1900));
    // Version 1: a range that ends below the building's own sale, and "above" for a listing priced like it.
    expect(v1).toMatchObject({ shown: true, verdict: "above" });
    expect(v1.rangeHighPsf as number).toBeLessThan(1900);
    const r = compareSimilar(a, S, ask(`B|${AREA}`, 2, "ready", 1900));
    expect(r).toMatchObject({ shown: false, reason: "evidence_disagrees", rangeLowPsf: null, rangeHighPsf: null, verdict: null });
    // The arithmetic is unchanged: only the decision differs.
    expect([r.centrePsf, r.lowPsf, r.highPsf, r.halfWidth]).toEqual([v1.centrePsf, v1.lowPsf, v1.highPsf, v1.halfWidth]);
    // On the end of the range counts as inside.
    const inside = make([...COMMUNITY, building("B")], [...COMMUNITY_SALES, ...sales("B", 2, [1600], 10), ...sales("B", 2, [1550, 1550, 1550, 1550, 1550], 500)]);
    const ok = compareSimilar(inside, S, ask(`B|${AREA}`));
    expect(ok.shown).toBe(true);
    expect(ok.rangeLowPsf as number).toBeLessThanOrEqual(1600);
    expect(ok.rangeHighPsf as number).toBeGreaterThanOrEqual(1600);
  });

  it("other buildings alone are never shown, project siblings included; a building's other bedroom types still count as its own", () => {
    const a = make(
      [building("P1", "77"), building("P2", "77"), building("P3", "77")],
      [...sales("P1", 2, [1500, 1500, 1500], 20, "off_plan"), ...sales("P2", 2, [1520, 1520, 1520], 20, "off_plan"), ...sales("P1", 1, [1700, 1700, 1700], 20, "off_plan"), ...sales("P3", 1, [1720, 1720, 1720], 20, "off_plan")],
    );
    const scope: SimilarRequest = { bedrooms: 2, basis: "off_plan", askingPsf: 1510, scope: { areaDld: AREA, masterProject: "TEST MASTER", projectNumber: "77" } };
    expect(compareSimilar(a, C, scope)).toMatchObject({ evidenceClass: "project", shown: true });
    expect(compareSimilar(a, S, scope)).toMatchObject({ evidenceClass: "project", shown: false, reason: "no_building_evidence", rangeLowPsf: null });
    // A known building with no sale of the type on that basis and nothing else of its own: the same refusal.
    const known = make([building("P1", "77"), building("P2", "77"), building("NEW", "77")], [...sales("P1", 2, [1500, 1500, 1500], 20, "off_plan"), ...sales("P2", 2, [1520, 1520, 1520], 20, "off_plan"), ...sales("NEW", 2, [1400], 20)]);
    expect(compareSimilar(known, S, ask(`NEW|${AREA}`, 2, "off_plan"))).toMatchObject({ evidenceClass: "project", shown: false, reason: "no_building_evidence" });
    // P3 sells 1-beds only: a 2-bed there is read from its 1-beds against the project (class indirect).
    expect(compareSimilar(a, S, ask(`P3|${AREA}`, 2, "off_plan"))).toMatchObject({ evidenceClass: "indirect", level: "project", shown: true });
  });

  it("the refusals come in a fixed order: bedrooms, no building evidence, own sales only, too wide, disagreement", () => {
    const fourBeds = make([building("B")], sales("B", 4, [1500, 1500], 10));
    expect(compareSimilar(fourBeds, S, ask(`B|${AREA}`, 4)).reason).toBe("bedrooms_not_validated");
    // One old sale and one much older, far apart: too wide is said before the disagreement.
    const wide = make([building("B")], [...sales("B", 2, [1500], 500), ...sales("B", 2, [1000], 900)]);
    const r = compareSimilar(wide, { ...S, maxHalfWidth: 0.01 }, ask(`B|${AREA}`));
    expect(r.reason).toBe("range_too_wide");
  });
});

describe("rounding and the outcome", () => {
  const a = make([building("B")], sales("B", 2, [1503, 1503], 10));
  const base = compareSimilar(a, C, ask(`B|${AREA}`));

  it("the range is rounded to the nearest AED 10 per sq ft; the centre is never rounded into it", () => {
    expect(base.rangeLowPsf).toBe(Math.round((base.lowPsf as number) / 10) * 10);
    expect(base.rangeHighPsf).toBe(Math.round((base.highPsf as number) / 10) * 10);
    expect((base.rangeLowPsf as number) % 10).toBe(0);
    expect((base.rangeHighPsf as number) % 10).toBe(0);
    expect(base.centrePsf).toBeCloseTo(1503, 9);
  });

  it("the asking price is judged against exactly the rounded range, inclusive at both ends", () => {
    const lo = base.rangeLowPsf as number;
    const hi = base.rangeHighPsf as number;
    const verdict = (askingPsf: number) => compareSimilar(a, C, { ...ask(`B|${AREA}`), askingPsf }).verdict;
    expect(verdict(lo)).toBe("within");
    expect(verdict(hi)).toBe("within");
    expect(verdict(lo - 0.01)).toBe("below");
    expect(verdict(hi + 0.01)).toBe("above");
    expect(verdict((lo + hi) / 2)).toBe("within");
  });

  it("the asking price changes the outcome only, never the range", () => {
    const other = compareSimilar(a, C, { ...ask(`B|${AREA}`), askingPsf: 99_999 });
    expect({ ...other, verdict: null }).toEqual({ ...base, verdict: null });
  });
});

describe("time", () => {
  it("there is no time adjustment: older sales enter at their own prices, with a wider spread the older they are", () => {
    const recent = C.evidenceVariance.older12to24.ready;
    const old = C.evidenceVariance.older24to36.ready;
    for (const k of ["1", "2", "3", "4", "5", "6"]) expect(old[k], k).toBeGreaterThan(recent[k]);
    const a = make([building("B")], [...sales("B", 2, [1000, 1000, 1000], 400), ...sales("B", 2, [2000, 2000, 2000], 800)]);
    const r = compareSimilar(a, C, ask(`B|${AREA}`));
    // The centre is the precision-weighted mean of ln 1000 and ln 2000, nearer the more recent.
    const v1 = recent["3"];
    const v2 = old["3"];
    expect(r.centrePsf).toBeCloseTo(Math.exp((Math.log(1000) / v1 + Math.log(2000) / v2) / (1 / v1 + 1 / v2)), 8);
    expect(r.centrePsf as number).toBeLessThan(Math.sqrt(1000 * 2000));
  });

  it("the windows move with dataThrough: the same sales a year later are older evidence, not own sales", () => {
    const rows = sales("B", 2, [1500, 1500], 10);
    const now = make([building("B")], rows);
    expect(compareSimilar(now, C, ask(`B|${AREA}`)).evidenceClass).toBe("own");
    const later = buildSimilarArtifact([...rows, { ...ANCHOR[0], date: "2027-11-20" }], [building("B"), ANCHOR_B]);
    expect(later.dataThrough).toBe("2027-11-20");
    const r = compareSimilar(later, C, ask(`B|${AREA}`));
    expect(r.evidence).toMatchObject({ ownSales: null, older12to24: { n: 2, medianPsf: 1500 } });
    expect(r.evidenceClass).toBe("indirect");
  });
});
