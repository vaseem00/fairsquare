import { describe, expect, it } from "vitest";
import { parseFields } from "@/lib/domain";

describe("parseFields", () => {
  it.each([
    ["2 bed, 1284 sqft, 2.45m", { bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 }],
    ["Studio 450 sq ft AED 650k", { bedrooms: 0, sizeSqft: 450, priceAed: 650_000 }],
    ["3BR 160 sqm 3.6 million", { bedrooms: 3, sizeSqft: 1722.2, priceAed: 3_600_000 }],
    ["1 bedroom 742 sqft 865000", { bedrooms: 1, sizeSqft: 742, priceAed: 865_000 }],
    ["AED 2,450,000 2 beds 1,284 sq. ft", { bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 }],
    ["hello", {}],
    ["2BR Mockup Crest, 1284 sqft, AED 2.45M, call Sara", { bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 }],
    ["Dhs 1250000, 1 bhk", { bedrooms: 1, priceAed: 1_250_000 }],
    ["1100000 or 1150000", { priceAed: 1_150_000 }],
  ])("%s", (text, expected) => {
    expect(parseFields(text)).toEqual(expected);
  });

  it("tolerates non-string input", () => {
    expect(parseFields(undefined as unknown as string)).toEqual({});
  });
});
