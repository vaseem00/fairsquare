/**
 * scaleModel() against the owner's Aykon listing (tests/fixtures/aykon-check.json, the real DLD
 * sales): every row of RESULT_SPEC section 12.3 and every dot stack of Appendix B.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyseWith } from "@/lib/domain/analyse";
import { formatInt, formatPctNumber } from "@/lib/format";
import {
  COLUMN_MAX,
  QUANTILE_DOTS,
  SMALL_DOT,
  evidenceOf,
  isSameSize,
  nearestDot,
  quantileOf,
  recentSet,
  scaleDomain,
  scaleModel,
  sizeClusters,
  tickValues,
  variantForWidth,
  type ScaleGeometry,
  type ScaleModel,
} from "@/lib/result/scale-model";
import { cardDotsText, evidenceDefinitions, gapText, scaleSummary } from "@/lib/result/words";
import type { CheckView, SaleView } from "@/lib/types";
import { CheckViewSchema } from "@/lib/validation/api";

const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", "aykon-check.json"), "utf8")) as {
  check: unknown;
  match: { candidates: Array<{ salesForBedrooms: number }> };
};
/** The stored comparison FYZ79D: ready 2-bed, 812 sq ft, AED 1,450,000. */
const AYKON: CheckView = CheckViewSchema.parse(fixture.check);

/** The same comparison at another asking price (the illustrative states of section 6). */
function asking(priceAed: number, check: CheckView = AYKON): CheckView {
  const { analysis } = analyseWith(priceAed, check.sizeSqft, check.sales, check.rules);
  return { ...check, priceAed, analysis: { ...check.analysis, ...analysis } };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

function model(check: CheckView, width: number): ScaleModel {
  const m = scaleModel(check, width);
  expect(m).not.toBeNull();
  return m as ScaleModel;
}

/** Appendix B notation: "column centre x : dots (filled ones)", left or right of the pin. */
function stacks(g: ScaleGeometry, side: "left" | "right"): string {
  return g.columns
    .filter((c) => c.side === side)
    .map((c) => {
      const filled = c.dots.filter((i) => g.dots[i].recent).length;
      return `${c.cx.toFixed(1)}:${c.dots.length}${filled ? `(${filled}F)` : ""}`;
    })
    .join(" ");
}

/** Visible label texts under the axis, left to right ("Median 1,761" for the median label). */
function visibleLabels(m: ScaleModel): string[] {
  const g = m.geometry;
  const items = [
    { x: g.medianLabel.left + g.medianLabel.width / 2, text: `Median ${formatInt(m.median)}` },
    ...g.ticks.filter((t) => t.visible).map((t) => ({ x: t.x, text: formatInt(t.value) })),
  ];
  return items.sort((a, b) => a.x - b.x).map((i) => i.text);
}

describe("the fixture is the owner's listing", () => {
  it("43 ready 2-bed sales in Aykon City (2) -Tower C, in line at +1.4%", () => {
    expect(AYKON.code).toBe("FYZ79D");
    expect(AYKON.url).toBe("https://fairsquare.example/c/FYZ79D");
    expect(AYKON.sales).toHaveLength(43);
    expect(AYKON.analysis).toMatchObject({ band: "inline", count: 43, outliersDropped: 0, dataThrough: "2026-11-16" });
    expect(AYKON.setAsideSales).toEqual([]);
    expect(fixture.match.candidates[0].salesForBedrooms).toBe(43);
  });
});

describe("RESULT_SPEC 12.3: in line (AED 1,450,000 = 1,786 per sq ft)", () => {
  const m = model(AYKON, 358);
  const g = m.geometry;

  it("domain [1400, 3000]", () => {
    expect(g.domain).toEqual([1400, 3000]);
    expect(g.pxPerAed).toBeCloseTo(0.20375, 10);
  });

  it("phone x: ask 94.6, median 89.5, zone 71.6 to 107.5, ticks 36.4 / 138.3 / 240.1 / 342.0", () => {
    expect(g.variant).toBe("phone");
    expect(r1(g.ask.x)).toBe(94.6);
    expect(r1(g.pin.x)).toBe(94.6);
    expect(r1(g.median.x)).toBe(89.5);
    expect(r1(g.fulcrum.x)).toBe(89.5);
    expect([r1(g.zone.x0), r1(g.zone.x1)]).toEqual([71.6, 107.5]);
    expect(g.ticks.map((t) => t.value)).toEqual([1500, 2000, 2500, 3000]);
    expect(g.ticks.map((t) => r1(t.x))).toEqual([36.4, 138.3, 240.1, 342.0]);
  });

  it("25 sales below the ask, 18 above: the dots left of the pin are exactly the 'higher than 25'", () => {
    expect(m.below).toBe(25);
    expect(m.above).toBe(18);
    expect(m.k).toBe(25);
    expect(m.direction).toBe("higher");
    expect(g.leftOfPin).toBe(25);
    expect(g.rightOfPin).toBe(18);
    expect(m.n).toBe(43);
  });

  it("tallest phone column 6; the axis at chart y 109, zone y 64 to 109, height 149", () => {
    expect(g.tallest).toBe(6);
    expect(g.dot).toEqual({ d: 7, r: 3.5, pitch: 7.5 });
    expect(g.axisY).toBe(109);
    expect([g.zone.y0, g.zone.y1]).toEqual([64, 109]);
    expect(g.labelTop).toBe(121);
    expect(g.height).toBe(149);
    expect(g.stamp).toEqual({ cx: g.ask.x, cy: 30, w: 92, h: 52, rotate: -4 });
    expect(g.dots).toHaveLength(43);
    expect(g.dots.filter((d) => d.recent)).toHaveLength(11);
  });

  it("phone stacks as in Appendix B", () => {
    expect(stacks(g, "left")).toBe("30.8:1(1F) 45.8:5(3F) 53.3:6(2F) 60.8:1(1F) 68.3:2(1F) 75.8:3 83.3:3 90.8:4(1F)");
    expect(stacks(g, "right")).toBe("98.3:5 105.8:2 113.3:1 120.8:2 158.3:1 173.3:1(1F) 188.3:1 233.3:2 263.3:1(1F) 270.8:1 323.3:1");
    // Filled dots line the axis; a dot at level L sits at axisY − r − L x pitch.
    for (const c of g.columns) {
      const levels = c.dots.map((i) => g.dots[i]);
      const firstHollow = levels.findIndex((d) => !d.recent);
      if (firstHollow >= 0) expect(levels.slice(firstHollow).every((d) => !d.recent)).toBe(true);
      levels.forEach((d, level) => {
        expect(d.level).toBe(level);
        expect(d.cy).toBeCloseTo(g.axisY - g.dot.r - level * g.dot.pitch, 10);
      });
    }
  });

  it("recent: 11 sales from 2026-08-18, median 1,601.56, trigger true (−9.05%), the ask higher than 9 of them", () => {
    const r = m.recent;
    expect(r.since).toBe("2026-08-18");
    expect(r.through).toBe("2026-11-16");
    expect(r.count).toBe(11);
    expect(r.sales.at(-1)?.saleDate).toBe("2026-08-25");
    expect(r2(r.medianPsf as number)).toBe(1601.56);
    expect(formatInt(r.medianPsf as number)).toBe("1,602");
    expect(r.trigger).toBe(true);
    expect(r2((r.drift as number) * 100)).toBe(-9.05);
    expect(r.direction).toBe("lower");
    expect(r.askDirection).toBe("higher");
    expect(r.askK).toBe(9);
  });

  it("evidence: Strong; Q1 1,599.0, Q3 1,854.0, middle half 14.48% of the median", () => {
    const e = m.evidence;
    expect(e.tier).toBe("strong");
    expect(e.baseTier).toBe("strong");
    expect(r1(e.q1 as number)).toBe(1599.0);
    expect(r1(e.q3 as number)).toBe(1854.0);
    expect(r2((e.spread as number) * 100)).toBe(14.48);
    expect(e).toMatchObject({ count: 43, recentCount: 11, fewRecent: false, wideSpread: false });
  });

  it("same size: 31 sales within 3% of 812 sq ft; the newest 3 are 1,200,000 / 1,256,921 / 1,260,045", () => {
    const s = m.sameSize;
    expect(s.count).toBe(31);
    expect(s.newest.map((x) => x.priceAed)).toEqual([1_200_000, 1_256_921, 1_260_045]);
    expect(s.newest.map((x) => x.saleDate)).toEqual(["2026-11-03", "2026-11-02", "2026-11-02"]);
    expect(s.newestPriceRange).toEqual({ lo: 1_200_000, hi: 1_260_045 });
    // The newest sale (943 sq ft) is not the same size.
    expect(isSameSize(942.59, 812)).toBe(false);
    expect(isSameSize(836.36, 812)).toBe(true);
  });

  it("size clusters [815, 31], [895, 6], [945, 6]", () => {
    const c = sizeClusters(AYKON.sales.map((s) => s.sizeSqft));
    expect(c.map((k) => [k.sqft, k.sales])).toEqual([
      [815, 31],
      [895, 6],
      [945, 6],
    ]);
    // Section 2.5: 799 to 825, 879 to 898 and 943 to 953 sq ft.
    expect(c.map((k) => [Math.round(k.min), Math.round(k.max)])).toEqual([
      [799, 825],
      [879, 898],
      [943, 953],
    ]);
  });

  it("premium: 8 sales at 1.15 x the median or more, the lowest 2,091", () => {
    expect(m.premium.count).toBe(8);
    expect(formatInt(m.premium.lowestPsf as number)).toBe("2,091");
    expect(m.premium.show).toBe(true);
    expect(formatInt(m.premium.threshold)).toBe("2,025");
  });

  it("the zone: AED 1,673 to 1,849, 17 sales inside", () => {
    expect(formatInt(m.zone.lo)).toBe("1,673");
    expect(formatInt(m.zone.hi)).toBe("1,849");
    expect(m.zone.count).toBe(17);
  });

  it("the gap sentence: AED 25 per sq ft above the median (1.4%), higher than 25 of the 43", () => {
    expect(m.gap).toMatchObject({ kind: "above", aed: 25, withPct: true, k: 25, n: 43, extreme: null });
    expect(formatPctNumber(m.gap.pct)).toBe("1.4");
    expect(formatInt(m.ask)).toBe("1,786");
    expect(formatInt(m.median)).toBe("1,761");
    expect(formatInt(m.lowest.psf)).toBe("1,470");
    expect(formatInt(m.highest.psf)).toBe("2,899");
    expect(m.highest.saleDate).toBe("2026-04-09");
  });

  it("visible phone labels: 'Median 1,761', '2,500', '3,000' (1,500 and 2,000 hidden)", () => {
    expect(visibleLabels(m)).toEqual(["Median 1,761", "2,500", "3,000"]);
    expect(g.ticks.filter((t) => !t.visible).map((t) => t.value)).toEqual([1500, 2000]);
    const last = g.ticks.at(-1);
    expect(last?.label).toEqual({ left: 358 - 16 - 36, width: 36, align: "right" });
  });
});

describe("RESULT_SPEC 12.3 and section 6: the illustrative asking prices", () => {
  it("above (1,650,000): 2,032, +15.39% printed 15.4, gap 271, higher than 35, recent higher than 9", () => {
    const m = model(asking(1_650_000), 358);
    expect(m.band).toBe("above");
    expect(formatInt(m.ask)).toBe("2,032");
    expect(r2(m.diff * 100)).toBe(15.39);
    expect(formatPctNumber(m.diff)).toBe("15.4");
    expect(m.gap).toMatchObject({ kind: "above", aed: 271, withPct: false, k: 35, n: 43 });
    expect(m.k).toBe(35);
    expect(m.recent).toMatchObject({ askDirection: "higher", askK: 9 });
    // A8 and Appendix B "Phone 358, above".
    const g = m.geometry;
    expect(g.domain).toEqual([1400, 3000]);
    expect(r1(g.ask.x)).toBe(144.8);
    expect(g.tallest).toBe(5);
    expect(g.axisY).toBe(101.5);
    expect([g.leftOfPin, g.rightOfPin]).toEqual([35, 8]);
    expect(stacks(g, "left")).toBe("28.5:1(1F) 43.5:2(2F) 51.0:5(1F) 58.5:5(3F) 66.0:1(1F) 73.5:3 81.0:3 88.5:4(1F) 96.0:2 103.5:5 111.0:2 118.5:2");
    expect(stacks(g, "right")).toBe("156.0:1 178.5:1(1F) 186.0:1 231.0:2 261.0:1(1F) 268.5:1 321.0:1");
    // The median, zone and labels are unchanged.
    expect(r1(g.median.x)).toBe(89.5);
    expect(visibleLabels(m)).toEqual(["Median 1,761", "2,500", "3,000"]);
  });

  it("below (1,300,000): 1,601, −9.08% printed 9.1, gap 160, lower than 32, recent lower than 6", () => {
    const m = model(asking(1_300_000), 358);
    expect(m.band).toBe("below");
    expect(formatInt(m.ask)).toBe("1,601");
    expect(r2(m.diff * 100)).toBe(-9.08);
    expect(formatPctNumber(m.diff)).toBe("9.1");
    expect(m.gap).toMatchObject({ kind: "below", aed: 160, withPct: false, k: 32, n: 43 });
    expect(m.direction).toBe("lower");
    expect(m.recent).toMatchObject({ askDirection: "lower", askK: 6 });
    // A9 and Appendix B "Phone 358, below": the stamp centred at x 57.0, spanning x 11 to 103.
    const g = m.geometry;
    expect(r1(g.ask.x)).toBe(57.0);
    const stamp = g.stamp as NonNullable<ScaleGeometry["stamp"]>;
    expect(r1(stamp.cx)).toBe(57.0);
    expect([Math.round(stamp.cx - stamp.w / 2), Math.round(stamp.cx + stamp.w / 2)]).toEqual([11, 103]);
    expect(g.tallest).toBe(5);
    expect([g.leftOfPin, g.rightOfPin]).toEqual([11, 32]);
    expect(stacks(g, "left")).toBe("30.7:1(1F) 45.7:5(3F) 53.2:5(1F)");
    expect(stacks(g, "right")).toBe(
      "60.7:2(2F) 68.2:2(1F) 75.7:3 83.2:3 90.7:4(1F) 98.2:5 105.7:2 113.2:1 120.7:2 158.2:1 173.2:1(1F) 188.2:1 233.2:2 263.2:1(1F) 270.7:1 323.2:1",
    );
  });

  it("above every sale (2,400,000): 2,956, 67.8%, domain hi 3,100; the highest was 2,899 on 9 Apr 2026", () => {
    const m = model(asking(2_400_000), 358);
    expect(formatInt(m.ask)).toBe("2,956");
    expect(formatPctNumber(m.diff)).toBe("67.8");
    expect(m.geometry.domain).toEqual([1400, 3100]);
    expect(m.gap).toMatchObject({ kind: "aboveAll", aed: 1195, k: 43, n: 43 });
    expect(m.gap.extreme?.saleDate).toBe("2026-04-09");
    expect(formatInt(m.gap.extreme?.psf as number)).toBe("2,899");
    // The stamp sits right of every dot.
    const g = m.geometry;
    expect(g.rightOfPin).toBe(0);
    expect(Math.max(...g.dots.map((d) => d.cx))).toBeLessThan(g.ask.x);
  });

  it("below every sale: the mirror image", () => {
    const m = model(asking(1_000_000), 358);
    expect(m.gap).toMatchObject({ kind: "belowAll", k: 43, n: 43 });
    expect(m.gap.extreme?.saleDate).toBe("2026-11-03");
    expect(formatInt(m.gap.extreme?.psf as number)).toBe("1,470");
    expect(m.geometry.leftOfPin).toBe(0);
  });

  it("the same as the median: the zero sentence counts the sales below", () => {
    const m = model(asking(Math.round(AYKON.analysis.medianPsf as number * AYKON.sizeSqft)), 358);
    expect(m.gap.kind).toBe("zero");
    expect(m.gap.k).toBe(m.below);
  });
});

describe("Appendix B: desktop 576 and the card 952", () => {
  it("desktop: pin 147.1, median 138.7, zone 108.8 to 168.7, ticks 50 / 220 / 390 / 560, dot 9, tallest 5, height 170", () => {
    const m = model(AYKON, 576);
    const g = m.geometry;
    expect(g.variant).toBe("desktop");
    expect(g.pxPerAed).toBeCloseTo(0.34, 10);
    expect(r1(g.ask.x)).toBe(147.1);
    expect(r1(g.median.x)).toBe(138.7);
    expect([r1(g.zone.x0), r1(g.zone.x1)]).toEqual([108.8, 168.7]);
    expect(g.ticks.map((t) => r1(t.x))).toEqual([50.0, 220.0, 390.0, 560.0]);
    expect(g.dot).toEqual({ d: 9, r: 4.5, pitch: 9.5 });
    expect(g.tallest).toBe(5);
    expect(g.exactHeight).toBe(169.5);
    expect(g.height).toBe(170);
    expect(g.stamp).toMatchObject({ w: 116, h: 65, cy: 37 });
    expect(stacks(g, "left")).toBe("37.9:1(1F) 66.4:5(3F) 75.9:2 85.4:5(3F) 104.4:2(1F) 113.9:2 123.4:3 132.9:1 142.4:4(1F)");
    expect(stacks(g, "right")).toBe("151.9:2 161.4:4 170.9:2 189.9:2 246.9:1 284.9:1(1F) 303.9:1 379.9:2 427.4:1(1F) 446.4:1 522.4:1");
    // Desktop shows "1,500", "Median 1,761", "2,500", "3,000".
    expect(visibleLabels(m)).toEqual(["1,500", "Median 1,761", "2,500", "3,000"]);
  });

  it("card: pin 237.8, median 223.5, zone 172.9 to 274.2, ticks 73.5 / 361.0 / 648.5 / 936.0, dot 16, tallest 5", () => {
    const m = model(AYKON, 952);
    const g = m.geometry;
    expect(g.variant).toBe("card");
    expect(g.pxPerAed).toBeCloseTo(0.575, 10);
    expect(r1(g.ask.x)).toBe(237.8);
    expect(r1(g.median.x)).toBe(223.5);
    expect([r1(g.zone.x0), r1(g.zone.x1)]).toEqual([172.9, 274.2]);
    expect(g.ticks.map((t) => r1(t.x))).toEqual([73.5, 361.0, 648.5, 936.0]);
    expect(g.dot).toEqual({ d: 16, r: 8, pitch: 16.5 });
    expect(g.tallest).toBe(5);
    // The ShareCard artboard: dots from y 48, axis at 130.5, fulcrum 18 x 12, 180 tall, no stamp.
    expect([g.zone.y0, g.axisY]).toEqual([48, 130.5]);
    expect(g.fulcrum).toMatchObject({ y: 132.5, w: 18, h: 12 });
    expect(g.height).toBe(180);
    expect(g.stamp).toBeNull();
    expect(stacks(g, "left")).toBe("48.0:1(1F) 97.5:2(2F) 114.0:5(1F) 130.5:5(3F) 163.5:1(1F) 180.0:3 196.5:3 213.0:1 229.5:4(1F)");
    expect(stacks(g, "right")).toBe("246.0:2 262.5:4 279.0:2 312.0:2 411.0:1 460.5:1(1F) 493.5:1 625.5:2 724.5:1(1F) 741.0:1 873.0:1");
    expect(visibleLabels(m)).toEqual(["1,500", "Median 1,761", "2,000", "2,500", "3,000"]);
  });

  it("desktop at the width the page renders at 1280 (6 of 12 columns of 1200px content, 24px gaps: 588) keeps all four labels", () => {
    const width = ((1200 - 11 * 24) / 12) * 6 + 5 * 24;
    expect(width).toBe(588);
    const m = scaleModel(AYKON, width, { variant: "desktop" }) as ScaleModel;
    expect(m.geometry.dot.d).toBe(9);
    expect(visibleLabels(m)).toEqual(["1,500", "Median 1,761", "2,500", "3,000"]);
  });

  it("an explicit variant wins over the width", () => {
    expect(variantForWidth(358)).toBe("phone");
    expect(variantForWidth(576)).toBe("desktop");
    expect(variantForWidth(952)).toBe("card");
    expect(model(AYKON, 358).geometry.variant).toBe("phone");
    const wide = scaleModel(AYKON, 700, { variant: "phone" });
    expect(wide?.geometry.dot.d).toBe(7);
    expect(scaleModel(AYKON)?.geometry.width).toBe(358);
  });
});

describe("rules beyond the Aykon numbers", () => {
  /** A synthetic comparison of `sales` [daysBeforeThrough, size, price] at 1,000,000 for 1,000 sq ft. */
  function synthetic(rows: Array<[number, number, number]>, priceAed = 1_000_000): CheckView {
    const through = "2026-11-16";
    const sales: SaleView[] = rows.map(([daysAgo, sizeSqft, p]) => {
      const d = new Date(Date.parse(`${through}T00:00:00Z`) - daysAgo * 86_400_000).toISOString().slice(0, 10);
      return { saleDate: d, sizeSqft, priceAed: p, psf: p / sizeSqft };
    });
    sales.sort((a, b) => b.saleDate.localeCompare(a.saleDate));
    const { analysis } = analyseWith(priceAed, 1000, sales, AYKON.rules);
    return { ...AYKON, sizeSqft: 1000, priceAed, sales, analysis: { ...AYKON.analysis, ...analysis } };
  }

  it("no scale without a verdict: too few, not covered, or no stored sales", () => {
    expect(scaleModel({ ...AYKON, analysis: { ...AYKON.analysis, band: "thin" } }, 358)).toBeNull();
    expect(scaleModel({ ...AYKON, analysis: { ...AYKON.analysis, band: "none", medianPsf: null } }, 358)).toBeNull();
    expect(scaleModel({ ...AYKON, sales: [] }, 358)).toBeNull();
  });

  it("the recent line needs 5 recent sales and a drift above 5%", () => {
    // 6 recent sales at 900 against older ones at 1,000.
    const drift = synthetic([
      ...Array.from({ length: 6 }, (_, i): [number, number, number] => [10 + i, 1000, 900_000]),
      ...Array.from({ length: 14 }, (_, i): [number, number, number] => [120 + i * 10, 1000, 1_000_000]),
    ]);
    expect(recentSet(drift)).toMatchObject({ count: 6, trigger: true, direction: "lower" });
    // 4 recent sales: no line, whatever the drift.
    const few = synthetic([
      ...Array.from({ length: 4 }, (_, i): [number, number, number] => [10 + i, 1000, 800_000]),
      ...Array.from({ length: 10 }, (_, i): [number, number, number] => [120 + i * 10, 1000, 1_000_000]),
    ]);
    expect(recentSet(few)).toMatchObject({ count: 4, trigger: false });
    // 5% exactly is not more than 5%.
    const flat = synthetic([
      ...Array.from({ length: 5 }, (_, i): [number, number, number] => [10 + i, 1000, 1_000_000]),
      ...Array.from({ length: 10 }, (_, i): [number, number, number] => [120 + i * 10, 1000, 1_000_000]),
    ]);
    expect(recentSet(flat)).toMatchObject({ count: 5, trigger: false, drift: 0, direction: null });
    // No recent sales at all.
    const none = synthetic(Array.from({ length: 8 }, (_, i): [number, number, number] => [120 + i * 10, 1000, 1_000_000]));
    expect(recentSet(none)).toMatchObject({ count: 0, medianPsf: null, trigger: false, askDirection: null, askK: 0 });
  });

  it("evidence tiers: from the count, down one for few recent sales, one more for a wide middle half, never below Limited", () => {
    const tight = (n: number, recent: number) =>
      synthetic(Array.from({ length: n }, (_, i): [number, number, number] => [i < recent ? 5 + i : 120 + i, 1000, 1_000_000 + (i % 3) * 10_000]));
    expect(evidenceOf(tight(25, 5)).tier).toBe("strong");
    expect(evidenceOf(tight(25, 2))).toMatchObject({ tier: "moderate", fewRecent: true });
    expect(evidenceOf(tight(12, 5)).tier).toBe("moderate");
    expect(evidenceOf(tight(7, 5)).tier).toBe("limited");
    expect(evidenceOf(tight(7, 0)).tier).toBe("limited");
    const wide = synthetic(Array.from({ length: 25 }, (_, i): [number, number, number] => [i < 1 ? 5 : 120 + i, 1000, 600_000 + i * 40_000]));
    expect(evidenceOf(wide)).toMatchObject({ tier: "limited", baseTier: "strong", fewRecent: true, wideSpread: true });
    // Below the minimum there is no tier.
    expect(evidenceOf({ ...tight(4, 4), analysis: { ...tight(4, 4).analysis, count: 4 } }).tier).toBeNull();
    expect(quantileOf([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantileOf([1, 2], 0.75)).toBe(1.75);
  });

  it("the evidence popover's Limited floor is the comparison's own minimum, like the tier", () => {
    expect(evidenceDefinitions(AYKON)).toContain("Limited evidence: 5 to 9 sales. One or two new sales can move the median.");
    const three: CheckView = { ...AYKON, rules: { ...AYKON.rules, minSales: 3 } };
    expect(evidenceDefinitions(three)).toContain("Limited evidence: 3 to 9 sales. One or two new sales can move the median.");
  });

  it("the premium line shows from 3 sales at 1.15 x the median", () => {
    const two = synthetic([...Array.from({ length: 10 }, (_, i): [number, number, number] => [120 + i, 1000, 1_000_000]), [130, 1000, 1_200_000], [131, 1000, 1_160_000]]);
    expect(model(two, 358).premium).toMatchObject({ count: 2, lowestPsf: 1160, show: false });
  });

  it("more than 80 sales draw 40 quantile dots; each is about k sales; sentences keep the full counts", () => {
    const many = synthetic(Array.from({ length: 100 }, (_, i): [number, number, number] => [i * 3, 1000, 800_000 + i * 4_000]), 1_000_000);
    const m = model(many, 358);
    expect(m.geometry.dots).toHaveLength(QUANTILE_DOTS);
    expect(m.geometry.quantile).toEqual({ k: 3 });
    expect(m.geometry.dots.reduce((n, d) => n + d.sales.length, 0)).toBe(100);
    expect(m.n).toBe(100);
    expect(m.k).toBe(m.below);
    // A quantile dot is filled when half or more of its sales are recent. The 31 recent sales are the
    // cheapest here: 12 whole quantiles, and the 13th holds one recent sale of its two.
    expect(m.geometry.dots.filter((d) => d.recent).length).toBe(13);
  });

  it("the chart summary and the card caption say what a dot is in quantile mode, and leave out 'filled' when no dot is", () => {
    const many = synthetic(Array.from({ length: 100 }, (_, i): [number, number, number] => [i * 3, 1000, 800_000 + i * 4_000]), 1_000_000);
    const m = model(many, 358);
    const summary = scaleSummary(many, m);
    expect(summary).toMatch(/^Each dot is about 3 registered sales of a ready 2-bed in Aykon City \(2\) -Tower C, 16 Nov 2025 to 16 Nov 2026\. /);
    expect(summary).toContain(`This asking price, AED 1,000, is higher than ${m.k} of the 100 sales.`);
    expect(summary).toContain("A dot is filled when at least half of its sales are since 18 Aug.");
    expect(summary).not.toMatch(/Each dot is a registered sale/);
    expect(cardDotsText(m)).toBe("Each dot is about 3 registered sales. Filled: at least half since 18 Aug.");
    // One dot a sale, none in the last 90 days: no "Filled" claim on the card.
    const old = synthetic(Array.from({ length: 8 }, (_, i): [number, number, number] => [120 + i * 10, 1000, 1_000_000 + i * 5_000]));
    const mo = model(old, 358);
    expect(mo.geometry.dots.some((d) => d.recent)).toBe(false);
    expect(cardDotsText(mo)).toBe("Each dot is one registered sale.");
    expect(scaleSummary(old, mo)).not.toMatch(/filled/i);
    expect(cardDotsText(model(AYKON, 952))).toBe("Each dot is one registered sale. Filled: since 18 Aug.");
  });

  it("in line with every sale on one side still prints the exact % (section 4.8, E4)", () => {
    // 5 sales at 1,000 to 1,004 per sq ft, asking 1,030: in line (+2.8%), higher than all 5.
    const side = synthetic(Array.from({ length: 5 }, (_, i): [number, number, number] => [120 + i * 10, 1000, 1_000_000 + i * 1_000]), 1_030_000);
    expect(side.analysis.band).toBe("inline");
    const m = model(side, 358);
    expect(m.gap).toMatchObject({ kind: "aboveAll", withPct: true });
    expect(gapText(m)).toBe(
      "The asking price is AED 28 per sq ft above the median (2.8%), and higher than all 5 sales. The highest was AED 1,004 per sq ft, on 9 Jun 2026.",
    );
    // Above every sale (not in line) the headline carries the figure: no %.
    expect(gapText(model(asking(2_400_000), 358))).toBe(
      "The asking price is AED 1,195 per sq ft above the median, and higher than all 43 sales. The highest was AED 2,899 per sq ft, on 9 Apr 2026.",
    );
  });

  it("the card's maxHeight shrinks its dots until the scale fits the room above the footer", () => {
    // 70 older sales at 7 prices 10 apart (one column each), 10 a column: 262.5 tall on the card.
    const packed = synthetic(Array.from({ length: 70 }, (_, i): [number, number, number] => [120 + i, 1000, 960_000 + (i % 7) * 10_000]), 1_100_000);
    const free = scaleModel(packed, 952, { variant: "card" }) as ScaleModel;
    expect(free.geometry.exactHeight).toBeGreaterThan(168);
    const fit = scaleModel(packed, 952, { variant: "card", maxHeight: 168 }) as ScaleModel;
    expect(fit.geometry.exactHeight).toBeLessThanOrEqual(168);
    expect(fit.geometry.dot.d).toBeLessThan(16);
    expect(fit.geometry.dot.d).toBeGreaterThanOrEqual(SMALL_DOT);
    expect(fit.geometry.dots).toHaveLength(70);
    // Room enough: nothing changes.
    expect((scaleModel(AYKON, 952, { variant: "card", maxHeight: 208 }) as ScaleModel).geometry.dot.d).toBe(16);
  });

  it("a column taller than 10 dots switches to 5px dots", () => {
    const stack = synthetic(Array.from({ length: 30 }, (_, i): [number, number, number] => [120 + i, 1000, 1_000_000]), 1_020_000);
    const g = model(stack, 358).geometry;
    expect(g.tallest).toBeGreaterThan(COLUMN_MAX);
    expect(g.dot.d).toBe(SMALL_DOT);
  });

  it("tap or drag selects the nearest dot by x, ties to the newest; arrow order is by price per sq ft", () => {
    const g = model(AYKON, 358).geometry;
    const at = nearestDot(g, g.ask.x - 1);
    expect(at).not.toBeNull();
    const dot = g.dots[at as number];
    const same = g.dots.filter((d) => Math.abs(d.cx - dot.cx) < 0.01);
    expect(dot.newest).toBe(same.map((d) => d.newest).sort().at(-1));
    expect(nearestDot({ dots: [] }, 10)).toBeNull();
    const psfs = g.order.map((i) => g.dots[i].psf);
    expect(psfs).toEqual([...psfs].sort((a, b) => a - b));
    expect(g.order).toHaveLength(43);
  });

  it("domain and ticks for other ranges", () => {
    expect(scaleDomain([1000])).toEqual([900, 1100]);
    expect(tickValues([900, 1100])).toEqual([900, 1000, 1100]);
    expect(tickValues([4800, 6200])).toEqual([5000, 5250, 5500, 5750, 6000]);
    expect(tickValues([200, 400])).toEqual([200, 300, 400]);
    expect(tickValues([0, 100_000]).length).toBeGreaterThan(0);
  });

  it("size clusters: fewer than 3 sales make no button; at most 3, ordered by size", () => {
    expect(sizeClusters([800, 805, 1200, 1210])).toEqual([]);
    expect(sizeClusters([])).toEqual([]);
    const four = sizeClusters([500, 502, 504, 700, 702, 704, 706, 900, 905, 910, 1300, 1301, 1302, 1303, 1304, Number.NaN, -5]);
    // Four clusters of 3, 4, 3 and 5: the two of 3 tie and the smaller sizes win. 703 rounds to 705.
    expect(four.map((c) => [c.sqft, c.sales])).toEqual([
      [500, 3],
      [705, 4],
      [1300, 5],
    ]);
  });
});
