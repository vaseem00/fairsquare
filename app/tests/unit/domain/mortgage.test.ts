import { describe, expect, it } from "vitest";
import { AGENCY_FEE, DLD_FEE, MORTGAGE_REG, VAT, estimateMortgage, minDownPct } from "@/lib/domain";
import { formatAed } from "@/lib/format";

describe("estimateMortgage", () => {
  it("2,450,000 at 20% down, 4.25%, 25 years", () => {
    const e = estimateMortgage({ priceAed: 2_450_000, downPct: 20, ratePct: 4.25, years: 25 });
    expect(e.loanAed).toBe(1_960_000);
    expect(e.monthlyAed).toBeCloseTo(10_618.07, 2);
    expect(formatAed(e.monthlyAed)).toBe("AED 10,618");
    expect(e.upfrontAed).toBeCloseTo(644_350, 6);
    expect(e.upfront.down).toBe(490_000);
    expect(e.upfront.dldFee).toBe(98_000);
    expect(e.upfront.mortgageRegistration).toBe(4_900);
    expect(e.upfront.agencyFee).toBe(49_000);
    expect(e.upfront.agencyVat).toBeCloseTo(2_450, 6);
    expect(e.downAed).toBe(490_000);
    expect({ p: e.priceAed, d: e.downPct, r: e.ratePct, y: e.years }).toEqual({ p: 2_450_000, d: 20, r: 4.25, y: 25 });
  });

  it("865,000 at 20/4.25/25", () => {
    expect(estimateMortgage({ priceAed: 865_000, downPct: 20, ratePct: 4.25, years: 25 }).monthlyAed).toBeCloseTo(3_748.83, 2);
  });

  it("0% interest divides evenly", () => {
    expect(estimateMortgage({ priceAed: 1_000_000, downPct: 20, ratePct: 0, years: 25 }).monthlyAed).toBeCloseTo(2_666.67, 2);
  });

  it("minimum down payment follows the price", () => {
    expect(minDownPct(5_000_000)).toBe(20);
    expect(minDownPct(5_000_001)).toBe(30);
  });

  it("fee constants", () => {
    expect([DLD_FEE, MORTGAGE_REG, AGENCY_FEE, VAT]).toEqual([0.04, 0.0025, 0.02, 0.05]);
  });
});
