import { describe, expect, it } from "vitest";
import { testSalesFor } from "../../fixtures/api-fixtures";
import {
  DEFAULT_RULES,
  OUTLIER_MIN_SALES,
  STALE_AFTER_DAYS,
  addDays,
  analyse,
  analyseWith,
  bandFor,
  comparisonWindow,
  completionBasis,
  inWindow,
  isStale,
  median,
  sizeDifference,
  summariseSales,
  trimOutliers,
  windowBounds,
  windowEndFor,
  type SaleInput,
} from "@/lib/domain";
import { formatPct } from "@/lib/format";

const TODAY = "2026-11-17";

const sale = (daysAgo: number, sizeSqft: number, priceAed: number): SaleInput => ({
  saleDate: addDays(TODAY, -daysAgo),
  sizeSqft,
  priceAed,
});

describe("median", () => {
  it("handles empty, odd and even inputs", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("window", () => {
  it("windowBounds starts windowDays before the end day, inclusive", () => {
    expect(windowBounds(TODAY, 365)).toEqual({ start: "2025-11-17", end: TODAY });
  });

  it("inWindow keeps start ≤ d ≤ end", () => {
    const sales = [
      { saleDate: addDays(TODAY, -365), id: "kept" },
      { saleDate: addDays(TODAY, -366), id: "too old" },
      { saleDate: addDays(TODAY, 1), id: "future" },
      { saleDate: TODAY, id: "today" },
    ];
    expect(inWindow(sales, TODAY, 365).map((s) => s.id)).toEqual(["kept", "today"]);
  });

  it("the comparison window ends at min(today, data_through) (REAL_DATA.md section 7)", () => {
    expect(windowEndFor(TODAY, null)).toBeNull();
    expect(windowEndFor(TODAY, "2026-09-30")).toBe("2026-09-30");
    expect(windowEndFor(TODAY, TODAY)).toBe(TODAY);
    // A data_through after today (clock skew, a test) never moves the window into the future.
    expect(windowEndFor(TODAY, "2026-12-01")).toBe(TODAY);
    expect(comparisonWindow(TODAY, null, 365)).toBeNull();
    expect(comparisonWindow(TODAY, "2026-09-30", 365)).toEqual({ start: "2025-09-30", end: "2026-09-30" });
  });

  it("data is stale when data_through is more than 45 days before today", () => {
    expect(STALE_AFTER_DAYS).toBe(45);
    expect(isStale(TODAY, null)).toBe(false);
    expect(isStale(TODAY, addDays(TODAY, -45))).toBe(false);
    expect(isStale(TODAY, addDays(TODAY, -46))).toBe(true);
    expect(isStale(TODAY, addDays(TODAY, -10), 7)).toBe(true);
  });
});

describe("completionBasis", () => {
  it("compares off-plan with off-plan and everything else with ready sales", () => {
    expect(completionBasis("off_plan")).toBe("off_plan");
    expect(completionBasis("ready")).toBe("ready");
    expect(completionBasis("unknown")).toBe("ready");
    expect(completionBasis(undefined)).toBe("ready");
    expect(completionBasis(null)).toBe("ready");
  });
});

describe("bandFor", () => {
  it("is inclusive at the band edge", () => {
    expect(bandFor(0.05, 5)).toBe("above");
    expect(bandFor(-0.05, 5)).toBe("below");
    expect(bandFor(0.049, 5)).toBe("inline");
  });
});

describe("analyse (synthetic test sales, today = seed day)", () => {
  it("Mockup Crest Tower 2-bed, AED 2,450,000 / 1,284: above, +14.0% vs 11", () => {
    const a = analyse(2_450_000, 1284, testSalesFor("Mockup Crest Tower", 2, TODAY));
    expect(a.count).toBe(11);
    expect(a.askingPsf).toBeCloseTo(1908.1, 1);
    expect(a.medianPsf).toBeCloseTo(1674.45, 2);
    expect(a.diff).toBeCloseTo(0.13953, 4);
    expect(formatPct(a.diff!)).toBe("+14.0%");
    expect(a.band).toBe("above");
    expect(a.medianPriceAed).toBe(2_140_000);
    expect(a.outliersDropped).toBe(0);
    expect(a.medianSizeSqft).toBe(1284);
  });

  it("Fake Vista Residences 1-bed, 865,000 / 742: inline, −1.7% vs 9", () => {
    const a = analyse(865_000, 742, testSalesFor("Fake Vista Residences", 1, TODAY));
    expect(a.count).toBe(9);
    expect(a.askingPsf).toBeCloseTo(1165.77, 2);
    expect(a.medianPsf).toBeCloseTo(1185.98, 2);
    expect(a.diff).toBeCloseTo(-0.01705, 4);
    expect(formatPct(a.diff!)).toBe("−1.7%");
    expect(a.band).toBe("inline");
  });

  it("Dummyside Heights 2 3-bed: 2 sales, thin, no diff", () => {
    const a = analyse(3_600_000, 1905, testSalesFor("Dummyside Heights 2", 3, TODAY));
    expect(a.count).toBe(2);
    expect(a.band).toBe("thin");
    expect(a.diff).toBeNull();
    expect(a.medianPriceAed).toBeNull();
    expect(a.medianPsf).toBeCloseTo(1688.16, 2);
  });

  it("Mockup Crest Tower 2 2-bed: 4 sales are one short of MIN_SALES 5", () => {
    const sales = testSalesFor("Mockup Crest Tower 2", 2, TODAY);
    expect(sales).toHaveLength(4);
    const a = analyse(2_050_000, 1250, sales);
    expect(a).toMatchObject({ count: 4, band: "thin", diff: null });
    // With the old minimum of 3 the same sales gave a verdict.
    expect(analyse(2_050_000, 1250, sales, { ...DEFAULT_RULES, minSales: 3 }).band).toBe("inline");
  });

  it("Mockup Crest Tower 1-bed: no sales", () => {
    const a = analyse(1_200_000, 800, testSalesFor("Mockup Crest Tower", 1, TODAY));
    expect(a.count).toBe(0);
    expect(a.band).toBe("thin");
    expect(a.medianPsf).toBeNull();
    expect(a.medianSizeSqft).toBeNull();
  });
});

describe("analyse (synthetic)", () => {
  const five: SaleInput[] = [1, 2, 3, 4, 5].map((i) => sale(i, 1000, 1_000_000));

  it.each([
    [1050, "above"],
    [1049.99, "inline"],
    [950.01, "inline"],
    [950, "below"],
  ])("asking %d/sq ft → %s", (psf, band) => {
    expect(analyse(psf * 1000, 1000, five).band).toBe(band);
  });

  it("drops non-positive sales and uses the default rules (MIN_SALES 5)", () => {
    const withBad = [...five, sale(0, 0, 1), sale(0, 10, -1)];
    expect(analyse(1_000_000, 1000, withBad).count).toBe(5);
    expect(DEFAULT_RULES).toEqual({ minSales: 5, windowDays: 365, bandPct: 5 });
    expect(analyse(1_000_000, 1000, five.slice(0, 4)).band).toBe("thin");
  });

  it("honours custom rules, including minSales 0 with no sales", () => {
    expect(analyse(1_000_000, 1000, five, { minSales: 6, windowDays: 365, bandPct: 5 }).band).toBe("thin");
    expect(analyse(1_000_000, 1000, [], { minSales: 0, windowDays: 365, bandPct: 5 }).band).toBe("thin");
  });

  it("throws RangeError for a non-positive size", () => {
    expect(() => analyse(1_000_000, 0, five)).toThrow(RangeError);
  });
});

describe("outliers (REAL_DATA.md section 7)", () => {
  // Median AED 1,000 per sq ft; 499 is under half of it, 2,001 over twice.
  const base = [sale(1, 1000, 1_000_000), sale(2, 1000, 1_000_000), sale(3, 1000, 1_010_000), sale(4, 1000, 990_000)];

  it("drops sales under 0.5× or over 2× the median when there are 5 or more, once", () => {
    expect(OUTLIER_MIN_SALES).toBe(5);
    const low = sale(5, 1000, 499_000);
    const high = sale(6, 1000, 2_001_000);
    const r = trimOutliers([...base, low, high]);
    expect(r.dropped).toBe(2);
    expect(r.kept).toEqual(base);
    // Exactly 0.5× and 2× stay.
    const edges = [...base, sale(7, 1000, 500_000), sale(8, 1000, 2_000_000)];
    expect(trimOutliers(edges).dropped).toBe(0);
  });

  it("keeps everything below 5 sales", () => {
    const four = [base[0], base[1], base[2], sale(9, 1000, 100_000)];
    expect(trimOutliers(four)).toEqual({ kept: four, dropped: 0 });
  });

  it("recomputes the median without them and reports how many were left out", () => {
    const sales = [...base, sale(5, 1000, 1_005_000), sale(6, 1000, 4_000_000)];
    const { analysis, used, setAside } = analyseWith(1_000_000, 1000, sales);
    expect(analysis).toMatchObject({ count: 5, outliersDropped: 1, medianPsf: 1000, band: "inline" });
    expect(used).toHaveLength(5);
    expect(used.some((s) => s.priceAed === 4_000_000)).toBe(false);
    // The sales left out are returned too (the list shows them "set aside", RESULT_SPEC section 12.2).
    expect(setAside).toEqual([sales[5]]);
    expect(analyseWith(1_000_000, 1000, base).setAside).toEqual([]);
  });

  it("can leave too few sales to compare", () => {
    const sales = [...base, sale(5, 1000, 100_000)];
    const a = analyse(1_000_000, 1000, sales);
    expect(a).toMatchObject({ count: 4, outliersDropped: 1, band: "thin", diff: null });
  });
});

describe("size check (REAL_DATA.md section 7)", () => {
  it("reports the difference only when it is more than 20% either way", () => {
    expect(sizeDifference(1240, 1000)).toBeCloseTo(0.24, 6);
    expect(sizeDifference(700, 1000)).toBeCloseTo(-0.3, 6);
    expect(sizeDifference(1200, 1000)).toBeNull();
    expect(sizeDifference(800, 1000)).toBeNull();
    expect(sizeDifference(1500, null)).toBeNull();
    expect(sizeDifference(1500, 0)).toBeNull();
    expect(sizeDifference(0, 1000)).toBeNull();
  });

  it("the analysis carries the median size of the sales it used", () => {
    const sales = [sale(1, 900, 900_000), sale(2, 1000, 1_000_000), sale(3, 1100, 1_100_000), sale(4, 1000, 1_000_000), sale(5, 1000, 1_000_000)];
    expect(analyse(1_240_000, 1240, sales).medianSizeSqft).toBe(1000);
  });
});

describe("summariseSales (From the data, REAL_DATA.md section 10)", () => {
  it("counts, takes the median per sq ft and the date range of the sales kept", () => {
    const sales = [sale(10, 1000, 1_000_000), sale(30, 1000, 1_100_000), sale(20, 1000, 900_000), sale(5, 1000, 1_000_000), sale(1, 1000, 9_000_000)];
    expect(summariseSales(sales)).toEqual({
      count: 4,
      medianPsf: 1000,
      outliersDropped: 1,
      firstSaleDate: addDays(TODAY, -30),
      lastSaleDate: addDays(TODAY, -5),
    });
  });

  it("is empty for no valid sales", () => {
    expect(summariseSales([sale(1, 0, 1)])).toEqual({
      count: 0,
      medianPsf: null,
      outliersDropped: 0,
      firstSaleDate: null,
      lastSaleDate: null,
    });
  });
});
