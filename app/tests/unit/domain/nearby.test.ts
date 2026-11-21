/**
 * The nearby method on small made-up markets (REAL_DATA.md section 17; scripts/model/nearby/SPEC.md):
 * the scope, the cap per building, the building-age adjustment, every refusal and the outcome against
 * the rounded range. The golden test (nearby-golden.test.ts) pins the numbers against the reference.
 */
import { describe, expect, it } from "vitest";
import { estimateNearby, nearbyQuantile, nearbyVintage, type NearbyIndex, type NearbyRequest, type NearbySaleRow } from "@/lib/domain/nearby";
import { nearbyDomainConstants } from "@/lib/nearby/model";

const C = nearbyDomainConstants();
const T = 2500;
const flat = Array.from({ length: 48 }, () => 0);
const IX: NearbyIndex = { T, areas: new Map([["Area A", 0]]), theta: { "0|0": flat, "0|1": flat }, tau: [flat, flat], seg: [[-0.2, -0.2, -0.2, -0.2, -0.2], [-0.2, -0.2, -0.2, -0.2, -0.2]] };

let seq = 0;
function sale(building: string, psf: number, over: Partial<NearbySaleRow> = {}): NearbySaleRow {
  const sizeSqft = over.sizeSqft ?? 1000;
  return { ref: `t:${++seq}`, buildingId: building, building, areaDld: "Area A", day: T - 30, sizeSqft, priceAed: psf * sizeSqft, firstSaleDay: T - 2000, firstReadySaleDay: T - 1000, inCommunity: true, inArea: true, ...over };
}
/** `n` buildings with 4 sales each around `psf`. */
function market(n: number, psf = 1000, over: Partial<NearbySaleRow> = {}): NearbySaleRow[] {
  return Array.from({ length: n }, (_, b) => [0.96, 0.99, 1.01, 1.04].map((k) => sale(`B${b}`, psf * k, over))).flat();
}
const OUT: NearbyRequest = { bedrooms: 2, basis: 0, sizeSqft: 1000, askingPsf: 1000, own: null, masterKnown: true, areaKnown: true };

describe("estimateNearby", () => {
  it("gives a range from the community's other buildings and places the asking price against the rounded ends", () => {
    const r = estimateNearby(IX, C, OUT, market(8));
    expect(r).toMatchObject({ kind: "out", shown: true, reason: null, scope: "community", group: "Rc0", buildings: 8, comparables: 32, verdict: "within", vintageAdjusted: false });
    expect(r.rangeLowPsf as number).toBeLessThan(1000);
    expect(r.rangeHighPsf as number).toBeGreaterThan(1000);
    expect((r.rangeLowPsf as number) % 10).toBe(0);
    expect(estimateNearby(IX, C, { ...OUT, askingPsf: (r.rangeHighPsf as number) + 1 }, market(8)).verdict).toBe("above");
    expect(estimateNearby(IX, C, { ...OUT, askingPsf: (r.rangeHighPsf as number) + 0.4 }, market(8)).verdict).toBe("within");
    expect(estimateNearby(IX, C, { ...OUT, askingPsf: (r.rangeLowPsf as number) - 1 }, market(8)).verdict).toBe("below");
    // No asking price: a range, no outcome.
    expect(estimateNearby(IX, C, { ...OUT, askingPsf: null }, market(8)).verdict).toBeUndefined();
  });

  it("caps a building's weight, so one building with many sales does not make the range", () => {
    const rows = [...market(6), ...Array.from({ length: 200 }, () => sale("BIG", 3000))];
    const r = estimateNearby(IX, C, OUT, rows);
    const big = r.buildingShares.find((b) => b.building === "BIG");
    expect(big?.sales).toBe(200);
    expect(big?.weightShare as number).toBeLessThan(0.3);
    expect(r.centrePsf as number).toBeLessThan(1100);
  });

  it("reads the rest of the DLD area at a lower weight when the community has under 3 buildings", () => {
    const rows = [...market(2), ...market(6, 1000, { inCommunity: false }).map((s) => ({ ...s, buildingId: `X${s.buildingId}`, building: `X${s.building}` }))];
    const r = estimateNearby(IX, C, OUT, rows);
    expect(r.scope).toBe("community_and_area");
    expect(r.group).toBe("Ra");
    expect(r.rows.filter((x) => x.inCommunity).length).toBe(8);
    expect(r.rows.filter((x) => !x.inCommunity).length).toBe(24);
    // With no area known the community stays alone, and 2 buildings are too few.
    expect(estimateNearby(IX, C, { ...OUT, areaKnown: false }, rows)).toMatchObject({ scope: "community", shown: false, reason: "too_few_buildings" });
    // With no community known the area is read alone.
    expect(estimateNearby(IX, C, { ...OUT, masterKnown: false }, rows)).toMatchObject({ scope: "area", shown: true });
    expect(estimateNearby(IX, C, { ...OUT, masterKnown: false, areaKnown: false }, rows)).toMatchObject({ shown: false, reason: "no_comparables" });
  });

  it("refuses in the order of the rule", () => {
    expect(estimateNearby(IX, C, OUT, [])).toMatchObject({ shown: false, reason: "no_comparables", rows: [] });
    // Sales outside the 730 days are not read.
    expect(estimateNearby(IX, C, OUT, market(8, 1000, { day: T - 730 }))).toMatchObject({ reason: "no_comparables" });
    expect(estimateNearby(IX, C, { ...OUT, bedrooms: 4 }, market(8))).toMatchObject({ shown: false, reason: "bedrooms_not_validated" });
    expect(estimateNearby(IX, C, OUT, market(2))).toMatchObject({ shown: false, reason: "too_few_buildings", buildings: 2 });
    // Old sales carry little weight: many buildings, but under a weight of 1 in all.
    expect(estimateNearby(IX, C, OUT, market(3, 1000, { day: T - 700 }).filter((_, i) => i % 4 === 0))).toMatchObject({ shown: false, reason: "too_few_buildings" });
    // Every sale is far from the listing's size.
    const far = estimateNearby(IX, C, { ...OUT, sizeSqft: 1700 }, Array.from({ length: 10 }, () => market(8)).flat());
    expect(far).toMatchObject({ shown: false, reason: "size_too_far" });
    expect(far.sizeDistance as number).toBeGreaterThan(0.5);
    // Buildings priced far apart: the range is too wide to say anything.
    const wide = Array.from({ length: 8 }, (_, b) => [1, 1.02].map((k) => sale(`W${b}`, 400 * 1.5 ** b * k))).flat();
    const w = estimateNearby(IX, C, OUT, wide);
    expect(w).toMatchObject({ shown: false, reason: "range_too_wide" });
    expect(w.halfWidth as number).toBeGreaterThan(0.5);
    expect(w.rangeLowPsf).toBeUndefined();
    // A group with no multipliers has no range.
    const none = estimateNearby(IX, { ...C, range: { in: {}, out: {} } }, OUT, market(8));
    expect(none).toMatchObject({ shown: false, reason: "no_calibration" });
    expect(none.lowPsf).toBeUndefined();
  });

  it("names the groups: thin, 3-bed, size distance, off-plan", () => {
    expect(estimateNearby(IX, C, OUT, market(4)).group).toBe("Rt");
    expect(estimateNearby(IX, C, { ...OUT, bedrooms: 3 }, market(8)).group).toBe("Rb");
    expect(estimateNearby(IX, C, { ...OUT, sizeSqft: 1150 }, market(8)).group).toBe("Rc1");
    expect(estimateNearby(IX, C, { ...OUT, sizeSqft: 1300 }, market(8)).group).toBe("Rc2");
    expect(estimateNearby(IX, C, { ...OUT, basis: 1 }, market(8)).group).toBe("Oc0");
  });

  it("adjusts for building age for a building in the data and for an off-plan listing, never for a ready one that is not in the data", () => {
    const rows = market(8);
    const out = estimateNearby(IX, C, OUT, rows);
    expect(out.rows.every((x) => x.vintageLn === 0)).toBe(true);
    // Off-plan, not in the data: taken as a new launch; the others launched 2000 days ago.
    const off = estimateNearby(IX, C, { ...OUT, basis: 1 }, rows);
    expect(off.vintageAdjusted).toBe(true);
    const g = (age: number) => nearbyVintage(C.vintage, 1, age);
    expect(off.rows[0].vintageLn).toBeCloseTo(g(0) - g(2000 / 365.25), 12);
    // In the data, ready: its own age from its first ready sale, and buildings of another age count less.
    const own = { firstSaleDay: T - 2000, firstReadySaleDay: T - 1000 };
    const same = estimateNearby(IX, C, { ...OUT, own }, rows);
    expect(same).toMatchObject({ kind: "in", vintageAdjusted: true });
    expect(same.rows.every((x) => Math.abs(x.vintageLn) < 1e-12)).toBe(true);
    const older = estimateNearby(IX, C, { ...OUT, own }, [...rows, ...market(8, 1000, { firstReadySaleDay: T - 4000 }).map((s) => ({ ...s, buildingId: `O${s.buildingId}`, building: `O${s.building}` }))]);
    const share = (prefix: string) => older.buildingShares.filter((b) => b.building.startsWith(prefix)).reduce((n, b) => n + b.weightShare, 0);
    expect(share("OB")).toBeLessThan(share("B") / 50);
    // A ready building with no ready sale of its own: age 0 in the curve, and no age weighting.
    const young = estimateNearby(IX, C, { ...OUT, own: { firstSaleDay: T - 300, firstReadySaleDay: null } }, rows);
    expect(young.rows[0].vintageLn).toBeCloseTo(nearbyVintage(C.vintage, 0, 0) - nearbyVintage(C.vintage, 0, 1000 / 365.25), 12);
    expect(young.weight).toBeCloseTo(out.weight as number, 9);
    // A row with no date counts as age 0 in the curve, and as 50 years (off-plan) in the weighting.
    const noDate = estimateNearby(IX, C, { ...OUT, basis: 1, own: { firstSaleDay: T - 100, firstReadySaleDay: null } }, market(8, 1000, { firstSaleDay: null }));
    expect(noDate.reason).toBe("too_few_buildings");
    expect(noDate.rows[0].vintageLn).toBeCloseTo(g(100 / 365.25) - g(0), 12);
  });

  it("moves a sale to the data date with its area's index, or Dubai's when the area has none", () => {
    const theta = Array.from({ length: 48 }, (_, i) => 0.01 * i);
    const tau = Array.from({ length: 48 }, (_, i) => 0.02 * i);
    const ix: NearbyIndex = { ...IX, theta: { "0|0": theta }, tau: [tau, tau] };
    const rows = [...market(4, 1000, { day: T - 100 }), ...market(4, 1000, { day: T - 100, areaDld: "Elsewhere" }).map((s) => ({ ...s, buildingId: `E${s.buildingId}`, building: `E${s.building}` }))];
    const r = estimateNearby(ix, C, OUT, rows);
    const here = r.rows.find((x) => x.building === "B0");
    const there = r.rows.find((x) => x.building === "EB0");
    expect(here?.timeLn).toBeCloseTo(-0.03, 12);
    expect(there?.timeLn).toBeCloseTo(-0.06, 12);
    // A sale older than 47 months uses the last month of the index.
    const old = estimateNearby(ix, { ...C, params: { ...C.params, windowDays: 2000 } }, OUT, market(4, 1000, { day: T - 1900 }));
    expect(old.rows[0].timeLn).toBeCloseTo(-0.47, 12);
  });
});

describe("nearbyQuantile and nearbyVintage", () => {
  it("interpolates between the mid-points of the weights", () => {
    expect(nearbyQuantile([1, 2, 3], [1, 1, 1], 0.5)).toBe(2);
    expect(nearbyQuantile([1, 2, 3], [1, 1, 1], 0)).toBe(1);
    expect(nearbyQuantile([1, 2, 3], [1, 1, 1], 1)).toBe(3);
    expect(nearbyQuantile([1, 3], [1, 1], 0.5)).toBe(2);
    expect(nearbyQuantile([5], [2], 0.9)).toBe(5);
  });
  it("is linear between the listed ages and flat outside them", () => {
    const v = C.vintage;
    expect(nearbyVintage(v, 0, 0)).toBe(v.ready[0]);
    expect(nearbyVintage(v, 0, 99)).toBe(v.ready[v.ready.length - 1]);
    expect(nearbyVintage(v, 1, (v.offPlanAges[1] + v.offPlanAges[2]) / 2)).toBeCloseTo((v.offPlan[1] + v.offPlan[2]) / 2, 12);
    expect(nearbyVintage(v, 1, 99)).toBe(0);
  });
});
