/**
 * The adjusted-registered-sales runtime against the Python reference (scripts/model/acs/acs.py) on
 * every golden case: each number within 1e-9 relative to max(1, |expected|); strings, booleans and
 * nulls equal (REAL_DATA.md section 16.7).
 */
import { describe, expect, it } from "vitest";
import { acsDate, acsSiblingKeys, estimateAcs, prepareAcs } from "@/lib/domain/acs";
import { AcsConstantsSchema, ACS_CONSTANTS } from "@/lib/acs/model";
import { goldenCases, goldenExpected, goldenModel, goldenSales } from "../../fixtures/acs/load";

const TOL = 1e-9;

function clean(v: unknown): unknown {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x)]));
  return v;
}

describe("estimateAcs against acs.py (golden cases)", () => {
  const model = goldenModel();
  const ix = prepareAcs(model);
  const sales = goldenSales(model.epoch);
  const cases = goldenCases();
  const expected = goldenExpected();
  const own = (key: string, basis: number) => sales.get(`${key}#${basis}`) ?? [];
  const siblings = (key: string, basis: number) => acsSiblingKeys(ix, key).flatMap((k) => sales.get(`${k}#${basis}`) ?? []);

  it("agrees on all 106 cases to 1e-9", () => {
    expect(cases.length).toBe(106);
    expect(expected.length).toBe(106);
    let numbers = 0;
    let largest = 0;
    const problems: string[] = [];
    const compare = (where: string, got: unknown, want: unknown): void => {
      if (want === null && (got === undefined || got === null)) return;
      if (typeof want === "number" && typeof got === "number") {
        const d = Math.abs(got - want) / Math.max(1, Math.abs(want));
        numbers++;
        largest = Math.max(largest, d);
        if (d > TOL) problems.push(`${where}: ${got} != ${want}`);
      } else if (Array.isArray(want) && Array.isArray(got)) {
        if (want.length !== got.length) problems.push(`${where}: length ${got.length} != ${want.length}`);
        else want.forEach((x, i) => compare(`${where}[${i}]`, got[i], x));
      } else if (want && got && typeof want === "object" && typeof got === "object") {
        for (const k of Object.keys(want)) compare(`${where}.${k}`, (got as Record<string, unknown>)[k], (want as Record<string, unknown>)[k]);
      } else if (got !== want) problems.push(`${where}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
    };
    const outcomes = new Map<string, number>();
    cases.forEach((q, i) => {
      const r = estimateAcs(ix, q, own(q.buildingKey, q.basis), siblings(q.buildingKey, q.basis));
      const o = r.shown ? "shown" : (r.reason as string);
      outcomes.set(o, (outcomes.get(o) ?? 0) + 1);
      compare(`case ${i} (${q.name})`, clean({ ...r, comps: r.comps.map((c) => ({ ...c, date: acsDate(model.epoch, c.day) })) }), expected[i]);
    });
    expect(problems.slice(0, 20)).toEqual([]);
    expect(numbers).toBe(36_733);
    expect(largest).toBeLessThan(TOL);
    expect(Object.fromEntries(outcomes)).toEqual({
      shown: 55,
      range_too_wide: 11,
      size_too_far: 11,
      too_few_comparables: 10,
      no_close_comparables: 7,
      bedrooms_not_validated: 6,
      no_comparables: 6,
    });
  });

  it("the order of the sales handed in does not change an answer", () => {
    for (const q of cases.slice(0, 30)) {
      const a = estimateAcs(ix, q, own(q.buildingKey, q.basis), siblings(q.buildingKey, q.basis));
      const b = estimateAcs(ix, q, [...own(q.buildingKey, q.basis)].reverse(), [...siblings(q.buildingKey, q.basis)].reverse());
      expect(b).toEqual(a);
    }
  });

  it("the shipped constants are the fit the golden model was made with", () => {
    expect(ACS_CONSTANTS.params).toEqual(model.params);
    expect(ACS_CONSTANTS.range).toEqual(model.range);
    expect(ACS_CONSTANTS.fittedOn.dataThrough).toBe(model.dataThrough);
    expect(AcsConstantsSchema.safeParse({ ...ACS_CONSTANTS, version: 0 }).success).toBe(false);
  });
});
