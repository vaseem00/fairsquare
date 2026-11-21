/**
 * The nearby runtime against the Python reference (`nearby()` in scripts/model/nearby/make.py) on the
 * 42 golden cases: the expected values are printed to 6 significant figures, so every number must
 * agree to 6e-6 relative; strings, booleans and nulls equal (REAL_DATA.md section 17).
 */
import { describe, expect, it } from "vitest";
import { acsDate } from "@/lib/domain/acs";
import { estimateNearby } from "@/lib/domain/nearby";
import { NEARBY_CONSTANTS, nearbyDomainConstants } from "@/lib/nearby/model";
import { goldenNearby, goldenNearbyData, goldenNearbyIndex } from "../../fixtures/nearby/load";

const TOL = 6e-6;

describe("estimateNearby against make.py (golden cases)", () => {
  const golden = goldenNearby();
  const ix = goldenNearbyIndex();
  const data = goldenNearbyData(ix.epoch);
  const constants = nearbyDomainConstants();

  it("the fixtures belong to the shipped constants", () => {
    expect(golden.constantsVersion).toBe(NEARBY_CONSTANTS.version);
    expect(golden.dataThrough).toBe(NEARBY_CONSTANTS.fittedOn);
    expect(ix.dataThrough).toBe(golden.dataThrough);
    expect(NEARBY_CONSTANTS.nominal).toBe(0.8);
    expect(NEARBY_CONSTANTS.tested.heldOf10).toBe(7);
  });

  it("agrees on all 42 cases", () => {
    expect(golden.cases.length).toBe(42);
    let numbers = 0;
    let largest = 0;
    const problems: string[] = [];
    const compare = (where: string, got: unknown, want: unknown): void => {
      if (want === null && (got === undefined || got === null)) return;
      if (typeof want === "number" && typeof got === "number") {
        const d = Math.abs(got - want) / Math.max(1e-12, Math.abs(want));
        numbers++;
        if (want !== 0 || got !== 0) largest = Math.max(largest, want === 0 ? Math.abs(got) : d);
        if (want === 0 ? Math.abs(got) > 1e-12 : d > TOL) problems.push(`${where}: ${got} != ${want}`);
      } else if (Array.isArray(want) && Array.isArray(got)) {
        if (want.length !== got.length) problems.push(`${where}: length ${got.length} != ${want.length}`);
        else want.forEach((x, i) => compare(`${where}[${i}]`, got[i], x));
      } else if (want && got && typeof want === "object" && typeof got === "object") {
        for (const k of Object.keys(want)) compare(`${where}.${k}`, (got as Record<string, unknown>)[k], (want as Record<string, unknown>)[k]);
      } else if (got !== want) problems.push(`${where}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
    };
    const outcomes = new Map<string, number>();
    for (const c of golden.cases) {
      const { request, rows } = data.read(c.input);
      const r = estimateNearby(ix, constants, request, rows);
      const o = r.shown ? "shown" : (r.reason as string);
      outcomes.set(o, (outcomes.get(o) ?? 0) + 1);
      const got = {
        ...r,
        topComparables: r.rows.slice(0, 3).map((x) => ({ ...x, date: acsDate(ix.epoch, x.day) })),
        topBuildings: r.buildingShares.slice(0, 3).map((b) => ({ weightShare: b.weightShare })),
      };
      const expectedTop = c.expected.topBuildings as { building: string; weightShare: number }[] | undefined;
      compare(`case ${c.id}`, got, expectedTop ? { ...c.expected, topBuildings: expectedTop.map((b) => ({ weightShare: b.weightShare })) } : c.expected);
      // Buildings at the cap have the same weight but for the last bit of a power (Python's pow and
      // V8's differ there), so their order among themselves is not the reference's: each expected
      // building must be one of those with that share.
      for (const want of (c.expected.topBuildings as { building: string; weightShare: number }[] | undefined) ?? []) {
        const same = r.buildingShares.filter((b) => Math.abs(b.weightShare - want.weightShare) <= TOL * want.weightShare).map((b) => b.building);
        if (!same.includes(want.building)) problems.push(`case ${c.id}: building ${want.building} has not the share ${want.weightShare}`);
      }
      // A shown case always has both ends and an outcome; a refused one never has rounded ends.
      if (r.shown) expect(r.rangeLowPsf !== undefined && r.rangeHighPsf !== undefined && r.verdict !== undefined, `case ${c.id}`).toBe(true);
      else expect(r.rangeLowPsf === undefined && r.rangeHighPsf === undefined && r.verdict === undefined, `case ${c.id}`).toBe(true);
    }
    expect(problems.slice(0, 20)).toEqual([]);
    expect(largest).toBeLessThan(TOL);
    expect(numbers).toBeGreaterThan(1000);
    const want = new Map<string, number>();
    for (const c of golden.cases) {
      const o = c.expected.shown ? "shown" : (c.expected.reason as string);
      want.set(o, (want.get(o) ?? 0) + 1);
    }
    expect(Object.fromEntries(outcomes)).toEqual(Object.fromEntries(want));
    // 35 ranges and three of the refusals; size_too_far and range_too_wide are in nearby.test.ts (the reference has no case of them).
    expect(Object.fromEntries(outcomes)).toEqual({ shown: 35, too_few_buildings: 5, bedrooms_not_validated: 1, no_comparables: 1 });
  });

  it("the owner's case: Dubai Science Park, ready 2-bed, 1,491 sq ft at AED 2,695,000", () => {
    const { request, rows } = data.read({ bedrooms: 2, basis: 0, sizeSqft: 1491, master: "Dubai Science Park", area: "Al Barshaa South Second", askingPsf: 2695000 / 1491 });
    const r = estimateNearby(ix, constants, request, rows);
    expect(r).toMatchObject({ kind: "out", shown: true, scope: "community", group: "Rc1", rangeLowPsf: 990, rangeHighPsf: 1770, verdict: "above", buildings: 10, comparables: 134, vintageAdjusted: false });
    // The shares add up, and the rows come largest weight first.
    expect(r.rows.reduce((n, x) => n + x.weightShare, 0)).toBeCloseTo(1, 9);
    expect(r.buildingShares.reduce((n, x) => n + x.weightShare, 0)).toBeCloseTo(1, 9);
    expect(r.rows.every((x, i) => i === 0 || r.rows[i - 1].weightShare >= x.weightShare)).toBe(true);
    expect(r.rows.every((x) => x.vintageLn === 0)).toBe(true);
  });
});
