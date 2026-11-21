/**
 * The build of the model's snapshot statistics (src/lib/acs/build.ts) on small made-up inputs: the
 * linear algebra, the size slopes, the time index, the project family rule and what the collector
 * hands in. The numbers against the Python reference are held by build-parity.test.ts (run on request).
 */
import { describe, expect, it } from "vitest";
import { ACS_INDEX_DAYS, ACS_POOL_DAYS, acsModelFile, buildAcsStatistics, familyGroupName, familyKey, familyNameNorm, solveMinNorm, solveSquare, symmetricEigen, withinGroupSlope, type AcsBuildSale } from "@/lib/acs/build";
import { ACS_CONSTANTS, AcsModelFileSchema } from "@/lib/acs/model";
import { addDays } from "@/lib/domain/dates";
import { DataDubaiCollector, mapColumns } from "@/lib/ingest/data-dubai";

const THROUGH = "2026-11-16";

describe("the linear algebra", () => {
  it("symmetricEigen returns the eigenvalues and vectors of a symmetric matrix", () => {
    const { values, v } = symmetricEigen([
      [2, 1],
      [1, 2],
    ]);
    expect([...values].sort((a, b) => a - b).map((x) => Math.round(x * 1e12) / 1e12)).toEqual([1, 3]);
    for (let j = 0; j < 2; j++) expect(Math.hypot(v[0][j], v[1][j])).toBeCloseTo(1, 12);
  });

  it("solveMinNorm solves a full-rank system, and a singular one with the smallest solution", () => {
    const x = solveMinNorm(
      [
        [4, 1],
        [1, 3],
      ],
      [1, 2],
    );
    expect(x[0]).toBeCloseTo(1 / 11, 12);
    expect(x[1]).toBeCloseTo(7 / 11, 12);
    // A graph Laplacian: levels are free, the smallest solution sums to 0.
    const y = solveMinNorm(
      [
        [2, -1, -1],
        [-1, 2, -1],
        [-1, -1, 2],
      ],
      [1, 0, -1],
    );
    expect(y[0] + y[1] + y[2]).toBeCloseTo(0, 12);
    expect(y[0] - y[2]).toBeCloseTo(2 / 3, 12);
    expect(solveMinNorm([[0, 0], [0, 0]], [1, 1])).toEqual([0, 0]);
  });

  it("solveSquare solves with pivoting and refuses a singular matrix", () => {
    const x = solveSquare(
      [
        [0, 2],
        [3, 1],
      ],
      [4, 5],
    );
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[1]).toBeCloseTo(2, 12);
    expect(() => solveSquare([[1, 2], [2, 4]], [1, 2])).toThrow(/singular/);
  });

  it("withinGroupSlope is the slope inside groups; one far point is dropped; no variation gives NaN", () => {
    const g = Int32Array.from([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
    const x = [1, 2, 3, 1, 2, 3, 4, 5, 6, 7, 8];
    const y = [12, 14, 16, 1, 3, 5, 7, 9, 11, 13, 15].map((v) => v + 0);
    expect(withinGroupSlope(y, x, g, 2)).toBeCloseTo(2, 12);
    const spoiled = [...y];
    spoiled[7] = 900;
    expect(withinGroupSlope(spoiled, x, g, 2)).toBeCloseTo(2, 9);
    expect(withinGroupSlope([1, 2, 3], [5, 5, 5], Int32Array.from([0, 0, 0]), 1)).toBeNaN();
  });
});

describe("the project family of a building", () => {
  it("numbered or lettered phases of one project name are one family in one area; otherwise the project number", () => {
    expect(familyNameNorm("  Azizi  Venice-12 & Co ")).toBe("azizi venice 12 and co");
    expect(familyGroupName("AZIZI VENICE 12")).toBe("azizi venice");
    expect(familyGroupName("Test Park Phase 2")).toBe("test park");
    expect(familyGroupName("Creek Gate B")).toBe("creek gate");
    expect(familyGroupName("Marina Heights III")).toBe("marina heights");
    // One word left, a stop word only, or no number at the end: no group.
    expect(familyGroupName("Venice 2")).toBeNull();
    expect(familyGroupName("The Park 2")).toBeNull();
    expect(familyGroupName("Test Park")).toBeNull();
    expect(familyGroupName("Solo")).toBeNull();
    expect(familyKey("9305", "TEST PARK 2", "Marsa Dubai")).toBe("test park|Marsa Dubai");
    expect(familyKey("9305", "TEST PARK 1", "Marsa Dubai")).toBe(familyKey("9304", "TEST PARK 2", "Marsa Dubai"));
    expect(familyKey("9305", "TEST PARK 2", "Al Barsha South Fourth")).not.toBe(familyKey("9305", "TEST PARK 2", "Marsa Dubai"));
    expect(familyKey("9301", "Test Rich Project", "Marsa Dubai")).toBe("#9301");
    expect(familyKey("", "TEST PARK 2", "Marsa Dubai")).toBeNull();
  });
});

function sales(): AcsBuildSale[] {
  const out: AcsBuildSale[] = [];
  let n = 0;
  for (let b = 0; b < 6; b++) {
    for (let d = 0; d < 1500; d += 17 + b) {
      const size = 700 + ((d * 7 + b * 31) % 200);
      out.push({
        ref: `dld:${String(n++).padStart(5, "0")}`,
        building: `tower ${b}`,
        area: b < 3 ? "Area A" : "Area B",
        date: addDays(THROUGH, -d),
        bedrooms: 1 + (d % 2),
        basis: b === 5 ? 1 : 0,
        sizeSqft: size,
        // Prices rose 0.02% a day; larger units cost a little less per sq ft.
        priceAed: Math.round(size * (1500 - d * 0.3 + b * 40 - (size - 800) * 0.2)),
      });
    }
  }
  return out;
}

describe("buildAcsStatistics", () => {
  const input = { dataThrough: THROUGH, sales: sales(), families: new Map([["tower 0", "fam|Area A"], ["tower 1", "fam|Area A"], ["tower 2", "#77"]]) };
  const stats = buildAcsStatistics(input);

  it("reads the 1,461 days to the data date, and pools 1,095 of them", () => {
    expect(ACS_INDEX_DAYS).toBe(1461);
    expect(ACS_POOL_DAYS).toBe(1095);
    expect(stats.indexSales).toBe(input.sales.filter((s) => s.date > addDays(THROUGH, -1461)).length);
    expect(stats.indexSales).toBeLessThan(input.sales.length);
    expect(stats.T).toBe(2511);
    expect(stats.poolFromDay).toBe(2511 - 1094);
  });

  it("names buildings by key in order, with their area and their family when another pool building shares it", () => {
    expect(stats.buildings.key).toEqual(["tower 0", "tower 1", "tower 2", "tower 3", "tower 4", "tower 5"]);
    expect(stats.areas).toEqual(["Area A", "Area B"]);
    expect(stats.buildings.area).toEqual([0, 0, 0, 1, 1, 1]);
    // A family of one building is no family.
    expect(stats.buildings.family).toEqual([1, 1, 0, 0, 0, 0]);
  });

  it("the time index starts at 0 and follows the prices back; each area with sales of a basis has its own", () => {
    expect(Object.keys(stats.theta).sort()).toEqual(["0|0", "1|0", "1|1"]);
    expect(stats.tau[0][0]).toBe(0);
    expect(stats.tau[0].length).toBe(48);
    // Prices were lower in the past: the month effects fall with age.
    expect(stats.tau[0][12]).toBeLessThan(-0.03);
    expect(stats.tau[0][36]).toBeLessThan(stats.tau[0][12]);
    for (const th of Object.values(stats.theta)) expect(th.every(Number.isFinite)).toBe(true);
  });

  it("every building type of the pool with sizes that vary has its size statistics; a thin segment has no slope of its own", () => {
    // Towers 0, 2 and 4 sold 1-beds and 2-beds, towers 1, 3 and 5 one type only.
    expect(stats.cellSlope.length).toBe(9);
    for (const [b, bed, basis, sxx] of stats.cellSlope) {
      expect(b).toBeLessThan(6);
      expect([1, 2]).toContain(bed);
      expect(basis).toBe(b === 5 ? 1 : 0);
      expect(sxx).toBeGreaterThan(1e-12);
    }
    // Ready 1-beds have 200 sales or more: larger units cost less per sq ft here, so their slope is negative.
    expect(stats.seg[0][1]).toBeLessThan(0);
    expect(stats.seg[0][1]).toBeGreaterThan(-1);
    // Under 200 sales in a segment: the slope of the bedroom count below (0 when there is none).
    expect(stats.seg[0][0]).toBe(0);
    expect(stats.seg[0].slice(2)).toEqual([stats.seg[0][1], stats.seg[0][1], stats.seg[0][1]]);
    expect(stats.seg[1]).toEqual([0, 0, 0, 0, 0]);
    expect(stats.prem[0][0]).toBe(0);
    expect(stats.beta2.every(Number.isFinite)).toBe(true);
  });

  it("the model file carries the fit and the snapshot it belongs to, and passes its schema", () => {
    const file = acsModelFile(stats, ACS_CONSTANTS, "a".repeat(64));
    expect(AcsModelFileSchema.safeParse(file).success).toBe(true);
    expect(file).toMatchObject({ constantsVersion: ACS_CONSTANTS.version, snapshotSha256: "a".repeat(64), tested: { heldOf10: 8, heldLaterOf10: 8 }, params: ACS_CONSTANTS.params });
    expect("indexSales" in file).toBe(false);
    // Two buildings with one key, an area index out of range or lists of unequal length are refused.
    expect(AcsModelFileSchema.safeParse({ ...file, buildings: { ...file.buildings, key: file.buildings.key.map(() => "x") } }).success).toBe(false);
    expect(AcsModelFileSchema.safeParse({ ...file, buildings: { ...file.buildings, area: file.buildings.area.map(() => 9) } }).success).toBe(false);
    expect(AcsModelFileSchema.safeParse({ ...file, buildings: { ...file.buildings, family: [] } }).success).toBe(false);
    expect(AcsModelFileSchema.safeParse({ ...file, version: 1 }).success).toBe(false);
  });

  it("is the same whatever order the sales come in, and refuses a snapshot with nothing in the pool", () => {
    const again = buildAcsStatistics({ ...input, sales: [...input.sales].reverse() });
    expect(again.buildings).toEqual(stats.buildings);
    expect(again.cellSlope.length).toBe(stats.cellSlope.length);
    for (let m = 0; m < 48; m++) expect(again.tau[0][m]).toBeCloseTo(stats.tau[0][m], 9);
    expect(() => buildAcsStatistics({ ...input, sales: input.sales.filter((s) => s.date < addDays(THROUGH, -1200)) })).toThrow(/no sale in the pool/);
  });
});

describe("what the collector hands in", () => {
  const HEADER = ["transaction_id", "trans_group_en", "procedure_name_en", "instance_date", "property_sub_type_en", "property_usage_en", "reg_type_en", "area_name_en", "building_name_en", "project_number", "project_name_en", "rooms_en", "procedure_area", "actual_worth"];
  const row = (id: number, date: string, building: string, project: string, number: string) =>
    [`1-11-${id}`, "Sales", "Sell", date, "Flat", "Residential", "Existing Properties", "Marsa Dubai", building, number, project, "2 B/R", "100", "1600000"];

  it("the sales of the 1,461 days to the data date (the window and the 12 months before it), and each building's family from every year", () => {
    const c = new DataDubaiCollector({ latestDate: "2026-11-18" });
    const cols = mapColumns(HEADER);
    const rows = [
      row(1, "2026-11-10", "TEST PARK TOWER 1", "TEST PARK 1", "9304"),
      row(2, "2026-10-01", "TEST PARK TOWER 2", "TEST PARK 2", "9305"),
      // 37 months back: outside the snapshot's window, inside the 48 months of the time index.
      row(3, "2023-10-01", "TEST PARK TOWER 2", "TEST PARK 2", "9305"),
      // 1,461 days back and more: read for the family only.
      row(4, "2022-11-10", "TEST LONE TOWER", "", ""),
      row(5, "2021-01-05", "TEST LONE TOWER", "TEST LONE PROJECT", "9400"),
      row(6, "2020-01-05", "TEST LONE TOWER", "TEST LONE PROJECT", "9400"),
      row(7, "2026-09-01", "TEST LONE TOWER", "", ""),
      row(8, "2022-11-11", "TEST EDGE TOWER", "", ""),
      row(9, "2019-03-03", "TEST EDGE TOWER", "TEST EDGE PROJECT", "9500"),
      row(10, "2019-03-04", "TEST EDGE TOWER", "TEST EDGE PROJECT", "9500"),
    ];
    for (const r of rows) c.add(r, cols, 0);
    const out = c.finish();
    expect(out.dataThrough).toBe("2026-11-10");
    expect(out.sales.map((s) => s.ref)).toEqual(["dld:1-11-1", "dld:1-11-2", "dld:1-11-7"]);
    expect(out.acs!.sales.map((s) => s.ref).sort()).toEqual(["dld:1-11-1", "dld:1-11-2", "dld:1-11-3", "dld:1-11-7", "dld:1-11-8"]);
    expect(out.acs!.sales[0]).toEqual({ ref: "dld:1-11-1", building: "test park tower 1|marsa dubai", area: "Marsa Dubai", date: "2026-11-10", bedrooms: 2, basis: 0, sizeSqft: 1076.39, priceAed: 1_600_000 });
    // The two phases are one family. The edge tower's most common project number is 9500 (two of its three rows, from
    // 2019). The lone tower has two rows without a number and two with 9400: a tie goes to the first seen (none), as in
    // the reference, so it has no family.
    expect(Object.fromEntries(out.acs!.families)).toEqual({
      "test park tower 1|marsa dubai": "test park|Marsa Dubai",
      "test park tower 2|marsa dubai": "test park|Marsa Dubai",
      "test edge tower|marsa dubai": "#9500",
    });
  });

  it("nothing kept: nothing to hand in", () => {
    expect(new DataDubaiCollector().finish().acs).toBeNull();
  });
});
