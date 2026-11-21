/**
 * The adjusted-registered-sales runtime on small made-up inputs: the pool rules, the weighted median,
 * the rounding, and each reason there is no range. The numbers of the method itself are held by the
 * golden cases (acs-golden.test.ts).
 */
import { describe, expect, it } from "vitest";
import { ACS_CONSTANTS } from "@/lib/acs/model";
import { ACS_REASONS, acsDate, acsDay, acsMedian, acsSiblingKeys, collapseAcs, estimateAcs, prepareAcs, roundHalfEven, weightedQuantile, type AcsModel, type AcsSaleRow } from "@/lib/domain/acs";

const T = 2500;
const flat = () => new Array<number>(48).fill(0);

function model(over: Partial<AcsModel> = {}): AcsModel {
  return {
    version: 2,
    kind: "acs-model",
    dataThrough: acsDate("2020-01-01", T),
    epoch: "2020-01-01",
    T,
    poolFromDay: T - 1094,
    params: ACS_CONSTANTS.params,
    range: ACS_CONSTANTS.range as AcsModel["range"],
    areas: ["Test Area"],
    tau: [flat(), flat()],
    theta: { "0|0": flat().map((_, m) => -0.002 * m) },
    seg: [
      [-0.3, -0.3, -0.3, -0.3, -0.3],
      [-0.3, -0.3, -0.3, -0.3, -0.3],
    ],
    beta2: [-0.4, -0.4],
    prem: [
      [0, 0.1, 0.2, 0.3, 0.4],
      [0, 0.1, 0.2, 0.3, 0.4],
    ],
    buildings: { key: ["a", "b", "c"], area: [0, 0, 0], family: [7, 7, 0] },
    cellSlope: [[0, 2, 0, 0.5, -0.1]],
    ...over,
  };
}

let n = 0;
const sale = (buildingKey: string, daysAgo: number, bed: number, size: number, psf: number): AcsSaleRow => ({ ref: `dld:${String(++n).padStart(4, "0")}`, buildingKey, day: T - daysAgo, bed, size, price: Math.round(size * psf) });
const own = () => Array.from({ length: 8 }, (_, i) => sale("a", 10 + i * 40, 2, 1000 + i * 5, 1500 + (i % 3) * 6));

describe("dates, medians and rounding", () => {
  it("counts days from the epoch and back", () => {
    expect(acsDay("2020-01-01", "2020-01-01")).toBe(0);
    expect(acsDay("2020-01-01", "2026-11-16")).toBe(2511);
    expect(acsDate("2020-01-01", 2511)).toBe("2026-11-16");
    expect(acsDate("2020-01-01", 2511 - 1094)).toBe("2023-11-18");
  });

  it("medians, and half to even as Python rounds", () => {
    expect(acsMedian([3, 1, 2])).toBe(2);
    expect(acsMedian([4, 1, 2, 3])).toBe(2.5);
    expect([0.5, 1.5, 2.5, -0.5, -1.5, 2.4, 2.6].map(roundHalfEven).map((x) => x + 0)).toEqual([0, 2, 2, 0, -2, 2, 3]);
  });

  it("the weighted quantile is the midpoint rule, flat outside the first and last point", () => {
    expect(weightedQuantile([10], [1], 0.5)).toBe(10);
    expect(weightedQuantile([10, 20], [1, 1], 0.5)).toBe(15);
    expect(weightedQuantile([20, 10], [1, 3], 0.5)).toBeCloseTo(12.5, 12);
    expect(weightedQuantile([10, 20, 30], [1, 1, 1], 0.01)).toBe(10);
    expect(weightedQuantile([10, 20, 30], [1, 1, 1], 0.99)).toBe(30);
  });
});

describe("collapseAcs", () => {
  it("keeps ordinary sales one row each, in ref order", () => {
    const rows = [sale("a", 5, 2, 1000, 1500), sale("a", 3, 2, 1010, 1510), sale("a", 9, 1, 700, 1700)];
    const pool = collapseAcs([rows[2], rows[0], rows[1]]);
    expect(pool.map((r) => r.ord)).toEqual(rows.map((r) => r.ref));
    expect(pool.every((r) => r.count === 1 && !r.batch && r.refs.length === 1)).toBe(true);
    expect(pool[0]).toMatchObject({ price: rows[0].price, psf: rows[0].price / 1000 });
  });

  it("exact duplicates (day, bedrooms, size, price) become one row with a count", () => {
    const a = sale("a", 5, 2, 1000, 1500);
    const pool = collapseAcs([a, { ...a, ref: "dld:zz1" }, { ...a, ref: "dld:zz2" }, sale("a", 5, 2, 1000, 1501)]);
    expect(pool.length).toBe(2);
    expect(pool[0]).toMatchObject({ count: 3, batch: false, price: a.price, refs: [a.ref, "dld:zz1", "dld:zz2"] });
  });

  it("5 or more unlike units at one price per sq ft within 3 days become one row per bedroom count", () => {
    const batch = [sale("a", 20, 1, 700, 1400), sale("a", 20, 1, 720, 1400), sale("a", 21, 2, 1000, 1400), sale("a", 21, 2, 1100, 1400), sale("a", 22, 2, 1200, 1400)];
    const pool = collapseAcs([...batch, sale("a", 60, 2, 1000, 1500)]);
    expect(pool.filter((r) => r.batch).map((r) => [r.bed, r.count, r.size, r.price, r.day])).toEqual([
      [1, 2, 710, null, T - 20],
      [2, 3, 1100, null, T - 21],
    ]);
    expect(pool.filter((r) => !r.batch).length).toBe(1);
    // Like units (one bedroom count, sizes within 5%), or the same price over more than 3 days, are ordinary sales.
    const like = Array.from({ length: 5 }, () => sale("a", 30, 2, 1000, 1400));
    like.forEach((r, i) => (r.size = 1000 + i));
    like.forEach((r) => (r.price = Math.round(r.size * 1400)));
    expect(collapseAcs(like).some((r) => r.batch)).toBe(false);
    const spread = batch.map((r, i) => ({ ...r, day: T - 20 - i * 2 }));
    expect(collapseAcs(spread).some((r) => r.batch)).toBe(false);
  });
});

describe("estimateAcs", () => {
  const ix = prepareAcs(model());

  it("names the other buildings of a project family, and none for a building without one or outside the model", () => {
    expect(acsSiblingKeys(ix, "a")).toEqual(["b"]);
    expect(acsSiblingKeys(ix, "c")).toEqual([]);
    expect(acsSiblingKeys(ix, "nowhere")).toEqual([]);
  });

  it("gives a range from own sales, each moved to the data date and to the listing's size", () => {
    const r = estimateAcs(ix, { buildingKey: "a", bed: 2, basis: 0, size: 1020, askingPsf: 1500 }, own(), []);
    expect(r).toMatchObject({ shown: true, reason: null, evidenceClass: 1, verdict: "within", typicalSize: 1017.5 });
    expect(r.comps.length).toBe(8);
    for (const c of r.comps) {
      expect(c.ring).toBe(1);
      expect(c.bedroomLn).toBe(0);
      // The area index falls 0.2% a month into the past, so an older sale is moved up to the data date.
      expect(c.timeLn).toBeCloseTo(0.002 * Math.min(Math.floor(c.ageMonths), 47), 12);
      expect(c.adjustedPsf).toBeCloseTo(c.psf * Math.exp(c.timeLn + c.sizeLn), 9);
    }
    // The building's own size slope, shrunk to the segment's, inside its limits.
    expect(r.features!.beta1).toBeCloseTo((-0.1 + 0.03 * -0.3) / (0.5 + 0.03), 12);
    expect(r.rangeLowPsf! % 10).toBe(0);
    expect(r.lowPsf!).toBeLessThan(r.centrePsf!);
    expect(estimateAcs(ix, { buildingKey: "a", bed: 2, basis: 0, size: 1020, askingPsf: r.rangeHighPsf! + 1 }, own(), []).verdict).toBe("above");
    expect(estimateAcs(ix, { buildingKey: "a", bed: 2, basis: 0, size: 1020, askingPsf: r.rangeLowPsf! - 1 }, own(), []).verdict).toBe("below");
    // The ends themselves are within; without an asking price there is a range and no outcome.
    expect(estimateAcs(ix, { buildingKey: "a", bed: 2, basis: 0, size: 1020, askingPsf: r.rangeHighPsf }, own(), []).verdict).toBe("within");
    // The outcome is decided on the asking price as the page prints it (whole AED per sq ft): 0.4 past an end still reads as that end.
    expect(estimateAcs(ix, { buildingKey: "a", bed: 2, basis: 0, size: 1020, askingPsf: r.rangeHighPsf! + 0.4 }, own(), []).verdict).toBe("within");
    expect(estimateAcs(ix, { buildingKey: "a", bed: 2, basis: 0, size: 1020, askingPsf: r.rangeLowPsf! - 0.4 }, own(), []).verdict).toBe("within");
    expect(estimateAcs(ix, { buildingKey: "a", bed: 2, basis: 0, size: 1020, askingPsf: r.rangeHighPsf! + 0.5 }, own(), []).verdict).toBe("above");
    expect(estimateAcs(ix, { buildingKey: "a", bed: 2, basis: 0, size: 1020, askingPsf: r.rangeLowPsf! - 0.6 }, own(), []).verdict).toBe("below");
    const noAsking = estimateAcs(ix, { buildingKey: "a", bed: 2, basis: 0, size: 1020 }, own(), []);
    expect(noAsking.shown).toBe(true);
    expect(noAsking.verdict).toBeUndefined();
  });

  it("reads sales outside the pool window, of another building or of the wrong list as nothing", () => {
    const q = { buildingKey: "a", bed: 2, basis: 0 as const, size: 1020, askingPsf: 1500 };
    const base = estimateAcs(ix, q, own(), []);
    const noise = [sale("a", 1095, 2, 1000, 900), sale("a", -1, 2, 1000, 900), sale("b", 10, 2, 1000, 900)];
    expect(estimateAcs(ix, q, [...own(), ...noise], [sale("a", 10, 2, 1000, 900)]).centrePsf).toBeCloseTo(base.centrePsf!, 9);
  });

  it("says why there is no range, in the order of the rule", () => {
    const q = { buildingKey: "a", bed: 2, basis: 0 as const, size: 1020, askingPsf: 1500 };
    expect(ACS_REASONS.length).toBe(7);
    // Nothing passes the limits.
    expect(estimateAcs(ix, q, [], [])).toMatchObject({ shown: false, reason: "no_comparables", features: null, comps: [], typicalSize: null });
    expect(estimateAcs(ix, { ...q, size: 5000 }, own(), [])).toMatchObject({ reason: "no_comparables", typicalSize: 1017.5 });
    // Rows without any weight (a model with no budget).
    const broke = prepareAcs(model({ params: { ...ACS_CONSTANTS.params, W0: 0 } }));
    expect(estimateAcs(broke, q, own(), [])).toMatchObject({ shown: false, reason: "no_comparables", comps: [] });
    // More than 3 bedrooms.
    const four = own().map((r) => ({ ...r, bed: 4 }));
    expect(estimateAcs(ix, { ...q, bed: 4 }, four, [])).toMatchObject({ shown: false, reason: "bedrooms_not_validated" });
    // Another building of the project leads: one own sale, many in the sibling.
    const sib = Array.from({ length: 12 }, (_, i) => sale("b", 5 + i * 20, 2, 1000 + i, 1500));
    const lead = estimateAcs(ix, q, [sale("a", 700, 2, 1000, 1500)], sib);
    expect(lead).toMatchObject({ shown: false, reason: "no_close_comparables", evidenceClass: 3, groupUsed: null });
    expect(lead.lowPsf).toBeUndefined();
    // One sibling building never has more than 0.5 of weight in all.
    expect(lead.features!.W3).toBeCloseTo(0.5, 12);
    // Too few: two rows; or other bedroom counts only.
    expect(estimateAcs(ix, q, own().slice(0, 2), [])).toMatchObject({ shown: false, reason: "too_few_comparables" });
    const oneBeds = Array.from({ length: 8 }, (_, i) => sale("a", 10 + i * 30, 1, 700, 1700));
    expect(estimateAcs(ix, q, oneBeds, [])).toMatchObject({ shown: false, reason: "too_few_comparables", evidenceClass: 2, typicalSize: null });
    // The listing's size is far from the sizes sold.
    expect(estimateAcs(ix, { ...q, size: 1250 }, own(), [])).toMatchObject({ shown: false, reason: "size_too_far" });
    // No multipliers for the group.
    const bare = prepareAcs(model({ range: { ...(ACS_CONSTANTS.range as AcsModel["range"]), q: {} } }));
    expect(estimateAcs(bare, q, own(), [])).toMatchObject({ shown: false, reason: "no_calibration", groupUsed: null });
    // Prices far apart.
    const wild = own().map((r, i) => ({ ...r, price: Math.round(r.size * (i % 2 ? 1000 : 2200)) }));
    expect(estimateAcs(ix, q, wild, [])).toMatchObject({ shown: false, reason: "range_too_wide" });
  });

  it("a sale of another bedroom count carries the step between bedroom counts, and counts less", () => {
    const q = { buildingKey: "a", bed: 2, basis: 0 as const, size: 1020, askingPsf: 1500 };
    const oneBed = sale("a", 15, 1, 700, 1700);
    const threeBed = sale("a", 15, 3, 1500, 1400);
    const studio = sale("a", 15, 0, 450, 1900);
    const r = estimateAcs(ix, q, [...own(), oneBed, threeBed, studio], []);
    const by = (ref: string) => r.comps.find((c) => c.refs[0] === ref)!;
    expect(by(oneBed.ref)).toMatchObject({ ring: 2, bedroomLn: 0.2 - 0.1 });
    expect(by(threeBed.ref).bedroomLn).toBeCloseTo(0.2 - 0.3, 12);
    // Two bedroom counts apart counts 0.3 times one apart; a studio at 0.44x the size is still inside 0.4x to 2.5x.
    expect(by(studio.ref).weight / by(oneBed.ref).weight).toBeCloseTo(0.3, 9);
    expect(by(oneBed.ref).sizeLn).toBeCloseTo(-0.4 * Math.log(1020 / 700) + 0.1, 12);
  });

  it("uses Dubai's index for a building whose area has none", () => {
    const m = model({ tau: [flat().map((_, k) => -0.01 * k), flat()], theta: {} });
    const r = estimateAcs(prepareAcs(m), { buildingKey: "a", bed: 2, basis: 0, size: 1020 }, own(), []);
    for (const c of r.comps) expect(c.timeLn).toBeCloseTo(0.01 * Math.min(Math.floor(c.ageMonths), 47), 12);
  });
});
