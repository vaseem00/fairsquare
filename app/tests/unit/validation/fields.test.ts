import { describe, expect, it } from "vitest";
import { FIELD_ERRORS } from "@/lib/copy";
import { CodeSchema, IdSchema, IsoDateSchema, LIMITS, ListingFieldsSchema, toNumberOrUndefined } from "@/lib/validation";

const ok = { buildingText: "Mockup Crest", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 };

function issues(input: unknown): Record<string, string[]> {
  const r = ListingFieldsSchema.safeParse(input);
  if (r.success) return {};
  const out: Record<string, string[]> = {};
  for (const i of r.error.issues) (out[i.path.join(".")] ??= []).push(i.message);
  return out;
}

describe("ListingFieldsSchema", () => {
  it("accepts a valid listing and trims text", () => {
    const r = ListingFieldsSchema.parse({ ...ok, buildingText: "  Mockup Crest  " });
    expect(r.buildingText).toBe("Mockup Crest");
    expect(ListingFieldsSchema.parse({ ...ok, bedrooms: 0, areaText: null }).bedrooms).toBe(0);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ['"" via toNumberOrUndefined', toNumberOrUndefined("")],
    ["NaN", Number.NaN],
    ["8", 8],
    ["1.5", 1.5],
    ["-1", -1],
    ['"2" (a string)', "2"],
  ])("rejects bedrooms %s with the bedrooms message", (_label, bedrooms) => {
    expect(issues({ ...ok, bedrooms }).bedrooms).toEqual([FIELD_ERRORS.bedrooms]);
  });

  it("rejects size 150 and price 50,000 (strictly greater than the minimum)", () => {
    expect(issues({ ...ok, sizeSqft: 150, priceAed: 100_000 }).sizeSqft).toContain(FIELD_ERRORS.sizeSqft);
    expect(issues({ ...ok, priceAed: 50_000, sizeSqft: 160 }).priceAed).toContain(FIELD_ERRORS.priceAed);
    expect(issues({ ...ok, sizeSqft: LIMITS.sizeMax + 1 }).sizeSqft).toContain(FIELD_ERRORS.sizeSqft);
  });

  it.each([299.9, 6000.1, 7000])("psf %d puts the psf issue on both size and price", (psf) => {
    const sizeSqft = 1000;
    const e = issues({ ...ok, sizeSqft, priceAed: psf * sizeSqft });
    const message = FIELD_ERRORS.psf(psf);
    expect(e.sizeSqft).toEqual([message]);
    expect(e.priceAed).toEqual([message]);
  });

  it("accepts psf at the bounds", () => {
    expect(issues({ ...ok, sizeSqft: 1000, priceAed: 300_000 })).toEqual({});
    expect(issues({ ...ok, sizeSqft: 1000, priceAed: 6_000_000 })).toEqual({});
  });

  it("requires a building name of 2 to 120 characters", () => {
    expect(issues({ ...ok, buildingText: " a " }).buildingText).toEqual([FIELD_ERRORS.buildingText]);
    expect(issues({ ...ok, buildingText: "x".repeat(121) }).buildingText).toEqual([FIELD_ERRORS.buildingText]);
    expect(issues({ ...ok, buildingText: undefined }).buildingText).toEqual([FIELD_ERRORS.buildingText]);
  });

  it("limits the area", () => {
    expect(issues({ ...ok, areaText: "x".repeat(81) }).areaText).toHaveLength(1);
  });

  it("rounds a price with fils to whole dirhams (prices are stored as bigint)", () => {
    expect(ListingFieldsSchema.parse({ ...ok, priceAed: 2_450_000.5 }).priceAed).toBe(2_450_001);
    expect(ListingFieldsSchema.parse({ ...ok, priceAed: 2_450_000.49 }).priceAed).toBe(2_450_000);
    expect(Number.isInteger(ListingFieldsSchema.parse({ ...ok, priceAed: toNumberOrUndefined("2,450,000.50") }).priceAed)).toBe(true);
  });
});

describe("toNumberOrUndefined", () => {
  it.each([
    ["", undefined],
    ["   ", undefined],
    ["abc", undefined],
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
    [null, undefined],
    [undefined, undefined],
    ["1,284", 1284],
    [" 2450000 ", 2_450_000],
    ["0", 0],
    [3, 3],
  ])("%s → %s", (input, out) => {
    expect(toNumberOrUndefined(input)).toBe(out);
  });
});

describe("small schemas", () => {
  it("CodeSchema normalises and validates", () => {
    expect(CodeSchema.parse(" k7q2mx ")).toBe("K7Q2MX");
    expect(CodeSchema.safeParse("K7Q2M0").success).toBe(false);
  });

  it("IsoDateSchema", () => {
    expect(IsoDateSchema.safeParse("2026-11-17").success).toBe(true);
    expect(IsoDateSchema.safeParse("2026-02-30").success).toBe(false);
  });

  it("IdSchema", () => {
    expect(IdSchema.parse("12")).toBe(12);
    expect(IdSchema.safeParse("0").success).toBe(false);
    expect(IdSchema.safeParse("").success).toBe(false);
  });
});
