import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";
import {
  classifyRow,
  completionOf,
  DATA_DUBAI_OPTIONAL,
  DATA_DUBAI_REQUIRED,
  DataDubaiCollector,
  headerName,
  isDubailandExport,
  mapColumns,
  procedureKey,
  SourceFormatError,
  type ColumnIndex,
} from "@/lib/ingest/data-dubai";

const COLS = [...DATA_DUBAI_REQUIRED, ...DATA_DUBAI_OPTIONAL];
type Row = Partial<Record<(typeof COLS)[number], string>>;

const BASE: Row = {
  transaction_id: "1-11-2026-1",
  trans_group_en: "Sales",
  procedure_name_en: "Sell",
  instance_date: "2026-06-01",
  property_sub_type_en: "Flat",
  property_usage_en: "Residential",
  reg_type_en: "Existing Properties",
  area_name_en: "Marsa Dubai",
  building_name_en: "TEST TOWER A",
  project_name_en: "TEST PROJECT A",
  master_project_en: "TEST MASTER",
  rooms_en: "2 B/R",
  procedure_area: "100",
  actual_worth: "2000000",
};

/** A header (in a shuffled order with an extra column) and a record builder for it. */
function sheet(cols: readonly string[] = ["extra_col", ...[...COLS].reverse()]) {
  const header = cols.map((c) => c.toUpperCase());
  const index = mapColumns(header);
  const record = (r: Row) => cols.map((c) => (c === "extra_col" ? "ignored" : (r[c as keyof Row] ?? "")));
  return { index, record };
}

describe("mapColumns (REAL_DATA.md section 1)", () => {
  it("matches headers case-insensitively after trimming and a BOM; order does not matter; extras are ignored", () => {
    const header = ["﻿ Transaction_ID ", ...DATA_DUBAI_REQUIRED.slice(1).map((c) => ` ${c.toUpperCase()} `), "area_id"];
    const idx = mapColumns(header);
    expect(idx.transaction_id).toBe(0);
    expect(idx.actual_worth).toBe(DATA_DUBAI_REQUIRED.length - 1);
    for (const opt of DATA_DUBAI_OPTIONAL) expect(idx[opt]).toBe(-1);
    expect(headerName("﻿  Rooms_EN ")).toBe("rooms_en");
  });

  it("lists the missing required columns", () => {
    const header = DATA_DUBAI_REQUIRED.filter((c) => c !== "rooms_en" && c !== "actual_worth");
    expect(() => mapColumns(header)).toThrow(SourceFormatError);
    try {
      mapColumns(header);
    } catch (err) {
      expect(err).toMatchObject({ code: "missing_columns" });
      expect((err as Error).message).toBe("This file is not the Data.Dubai Transactions dataset. Missing columns: rooms_en, actual_worth.");
    }
  });

  it("refuses the dubailand.gov.ae website export with the exact message", () => {
    const website = ["Transaction Number", "Transaction Date", "Property ID", "Transaction Type", "Area", "Room(s)", "Master Project", "Project"];
    expect(isDubailandExport(website)).toBe(true);
    expect(() => mapColumns(website)).toThrow(COPY["adminUi.ingest.dubailandExport"]);
    try {
      mapColumns(website);
    } catch (err) {
      expect(err).toMatchObject({ name: "SourceFormatError", code: "dubailand_export" });
    }
    expect(COPY["adminUi.ingest.dubailandExport"]).toBe(
      "This is the dubailand.gov.ae website export. Its terms allow personal, non-commercial use only and it has no building names. Download the Transactions dataset from data.dubai instead.",
    );
    // A file with a building column is never mistaken for the website export.
    expect(isDubailandExport([...website, "building_name_en"])).toBe(false);
    expect(isDubailandExport(["Master Project", "Project", "Amount", "Room(s)"])).toBe(true);
    expect(isDubailandExport(["foo", "bar"])).toBe(false);
  });

  it("refuses an empty header", () => {
    expect(() => mapColumns([])).toThrow(expect.objectContaining({ code: "empty_file" }));
    expect(() => mapColumns(["", " "])).toThrow(expect.objectContaining({ code: "empty_file" }));
  });
});

describe("classifyRow: rules 1 to 8 in order, the date, the id and the completion", () => {
  const { index, record } = sheet();
  const run = (over: Row) => classifyRow(record({ ...BASE, ...over }), index);
  const reason = (over: Row) => {
    const r = run(over);
    return r.ok ? "kept" : r.reason;
  };

  it("keeps a plain sale and normalises it", () => {
    const r = run({ building_name_en: "  TEST   TOWER A ", project_name_en: " ", actual_worth: "2000000.4" });
    expect(r).toEqual({
      ok: true,
      sale: {
        txid: "1-11-2026-1",
        date: "2026-06-01",
        building: "TEST TOWER A",
        areaDld: "Marsa Dubai",
        project: null,
        masterProject: "TEST MASTER",
        bedrooms: 2,
        sizeSqft: 1076.39,
        priceAed: 2_000_000,
        completion: "ready",
        projectNumber: null,
        parking: null,
        nearestMetro: null,
        nearestMall: null,
        nearestLandmark: null,
      },
    });
  });

  it("reads the project number, the parking flag and the nearest places", () => {
    const r = run({ project_number: "2977.00", has_parking: "1", nearest_metro_en: " Test  Metro Station ", nearest_mall_en: "Test Mall", nearest_landmark_en: "" });
    expect(r).toMatchObject({ ok: true, sale: { projectNumber: 2977, parking: true, nearestMetro: "Test Metro Station", nearestMall: "Test Mall", nearestLandmark: null } });
    expect(run({ project_number: "12.5", has_parking: "0" })).toMatchObject({ sale: { projectNumber: null, parking: false } });
    expect(run({ project_number: "0", has_parking: "yes" })).toMatchObject({ sale: { projectNumber: null, parking: null } });
  });

  it("removes stray Arabic-script characters from the English name columns", () => {
    // 45 project names in the Nov 2026 files start with Arabic vowel marks (U+0650).
    const r = run({ project_name_en: "\u0650\u0650TEST PROJECT 60", building_name_en: "TEST \u0628\u0631\u062C TOWER A", master_project_en: "\u0623\u062E\u0631\u0649" });
    expect(r).toMatchObject({ ok: true, sale: { project: "TEST PROJECT 60", building: "TEST TOWER A", masterProject: null } });
    expect(reason({ building_name_en: "\u0628\u0631\u062C" })).toBe("no_building_name");
  });

  it("rule 1: trans_group_en must be Sales", () => {
    expect(reason({ trans_group_en: "Mortgages" })).toBe("not_sales");
    expect(reason({ trans_group_en: "" })).toBe("not_sales");
    expect(reason({ trans_group_en: " SALES " })).toBe("kept");
  });

  it("rule 2: only Sell, Sale, Sell - Pre registration and Delayed Sell (case- and space-insensitive)", () => {
    for (const p of ["Sell", "sale", "SELL - PRE REGISTRATION", "Sell-Pre registration", "Delayed Sell", "delayed  sell"]) {
      expect(reason({ procedure_name_en: p }), p).toBe("kept");
    }
    for (const p of ["Development", "Lease to Own Registration", "Lease Finance Registration", "Mortgage Registration", "Grant", "Portfolio Mortgage Registration", "Adding Land By Sell", ""]) {
      expect(reason({ procedure_name_en: p }), p).toBe("procedure_excluded");
    }
    expect(procedureKey(" Sell -  Pre Registration ")).toBe("sell-preregistration");
  });

  it("rule 3: Flat only; a non-empty usage must be Residential", () => {
    expect(reason({ property_sub_type_en: "Villa" })).toBe("not_flat");
    expect(reason({ property_sub_type_en: "Hotel Apartment" })).toBe("not_flat");
    expect(reason({ property_sub_type_en: " flat " })).toBe("kept");
    expect(reason({ property_usage_en: "Commercial" })).toBe("not_residential");
    expect(reason({ property_usage_en: "" })).toBe("kept");
    expect(reason({ property_usage_en: "RESIDENTIAL" })).toBe("kept");
  });

  it("rule 4: rooms (Studio → 0, N B/R → N up to 7); everything else is out", () => {
    expect(run({ rooms_en: "Studio", procedure_area: "40", actual_worth: "600000" })).toMatchObject({ ok: true, sale: { bedrooms: 0 } });
    for (const r of ["PENTHOUSE", "Single Room", "Office", "Shop", "Store", "GYM", "", "8 B/R"]) expect(reason({ rooms_en: r }), r).toBe("rooms_excluded");
  });

  it("rule 5: a building name", () => {
    expect(reason({ building_name_en: "  " })).toBe("no_building_name");
  });

  it("rule 6: area and worth above zero", () => {
    expect(reason({ procedure_area: "0" })).toBe("no_size_or_price");
    expect(reason({ procedure_area: "-5" })).toBe("no_size_or_price");
    expect(reason({ actual_worth: "" })).toBe("no_size_or_price");
    expect(reason({ actual_worth: "n/a" })).toBe("no_size_or_price");
  });

  it("rule 7: size in sq ft = area × 10.7639 (2 decimals), from 150 to 15,000", () => {
    expect(run({ procedure_area: "110.5", actual_worth: "2200000" })).toMatchObject({ sale: { sizeSqft: 1189.41 } });
    expect(reason({ procedure_area: "13.93", actual_worth: "400000" })).toBe("size_out_of_range"); // 149.94
    expect(reason({ procedure_area: "13.94", actual_worth: "400000" })).toBe("kept"); // 150.05
    expect(reason({ procedure_area: "18.5", actual_worth: "400000" })).toBe("kept"); // 199.13: a small studio
    expect(reason({ procedure_area: "1393.5", actual_worth: "30000000" })).toBe("kept"); // 14999.49
    expect(reason({ procedure_area: "1394", actual_worth: "30000000" })).toBe("size_out_of_range"); // 15004.88
    expect(reason({ procedure_area: "1393", actual_worth: "30000000" })).toBe("kept"); // 14994.11
  });

  it("rule 8: AED per sq ft recomputed (meter_sale_price ignored), from 279 to 20,000", () => {
    // 100 sqm = 1076.39 sq ft
    expect(reason({ actual_worth: String(Math.ceil(279 * 1076.39)) })).toBe("kept");
    expect(reason({ actual_worth: String(Math.floor(279 * 1076.39) - 1) })).toBe("psf_out_of_range");
    expect(reason({ actual_worth: String(Math.ceil(11_148 * 1076.39) + 1) })).toBe("kept"); // the old ceiling
    expect(reason({ actual_worth: String(Math.floor(20_000 * 1076.39)) })).toBe("kept");
    expect(reason({ actual_worth: String(Math.ceil(20_000 * 1076.39) + 1) })).toBe("psf_out_of_range");
  });

  it("an unreadable date and a missing transaction id are excluded and counted", () => {
    expect(reason({ instance_date: "2026-02-30" })).toBe("bad_date");
    expect(reason({ instance_date: "" })).toBe("bad_date");
    expect(reason({ transaction_id: " " })).toBe("no_transaction_id");
  });

  it("rule 11: reg_type Off-Plan / Existing; without it a pre-registration sale is off-plan", () => {
    expect(run({ reg_type_en: "Off-Plan Properties" })).toMatchObject({ sale: { completion: "off_plan" } });
    expect(run({ reg_type_en: "Existing Properties", procedure_name_en: "Sell - Pre registration" })).toMatchObject({ sale: { completion: "ready" } });
    expect(run({ reg_type_en: "", procedure_name_en: "Sell - Pre registration" })).toMatchObject({ sale: { completion: "off_plan" } });
    expect(run({ reg_type_en: "", procedure_name_en: "Delayed Sell" })).toMatchObject({ sale: { completion: "ready" } });
    expect(completionOf(null, "Sell - Pre registration")).toBe("off_plan");
    expect(completionOf("off plan", "Sell")).toBe("off_plan");
    expect(completionOf("Unknown", "Sell")).toBe("ready");
  });

  it("works without the optional columns", () => {
    const { index: idx, record: rec } = sheet(DATA_DUBAI_REQUIRED);
    const r = classifyRow(rec({ ...BASE, procedure_name_en: "Sell - Pre registration" }), idx);
    expect(r).toMatchObject({ ok: true, sale: { project: null, masterProject: null, completion: "off_plan" } });
  });
});

describe("DataDubaiCollector: rules 9, 10, 10b and 12, the building facts and the counts", () => {
  const { index, record } = sheet();

  function collect(rows: Array<[Row, number?]>) {
    const c = new DataDubaiCollector();
    for (const [r, file] of rows) c.add(record({ ...BASE, ...r }), index as ColumnIndex, file ?? 0);
    return c.finish();
  }

  it("rule 9: a transaction id kept twice in one file is a multi-unit deal (every row goes)", () => {
    const r = collect([[{ transaction_id: "T-1" }], [{ transaction_id: "T-1", actual_worth: "2100000" }], [{ transaction_id: "T-2" }]]);
    expect(r.sales.map((s) => s.ref)).toEqual(["dld:T-2"]);
    expect(r.excluded.multi_unit_deal).toBe(2);
  });

  it("a transaction repeated in a later file (overlapping downloads) is kept once", () => {
    const r = collect([[{ transaction_id: "T-1" }, 0], [{ transaction_id: "T-1" }, 1], [{ transaction_id: "T-2" }, 1]]);
    expect(r.sales.map((s) => s.ref)).toEqual(["dld:T-1", "dld:T-2"]);
    expect(r.excluded.repeated_in_other_file).toBe(1);
    expect(r.excluded.multi_unit_deal).toBe(0);
  });

  it("rule 10: 3 or more rows with the same building, date and price whose sizes are more than 5% apart are a block", () => {
    const same = { instance_date: "2026-06-02", actual_worth: "1800000" };
    const r = collect([
      [{ ...same, transaction_id: "P-1" }], // 100 sq m
      [{ ...same, transaction_id: "P-2", building_name_en: "test  tower a", procedure_area: "104" }], // same building once normalised
      [{ ...same, transaction_id: "P-3", procedure_area: "106" }], // 6% above the smallest
      [{ ...same, transaction_id: "P-4", area_name_en: "Business Bay" }], // another building
      [{ ...same, transaction_id: "P-5", instance_date: "2026-06-03" }],
      [{ ...same, transaction_id: "P-6", actual_worth: "1800001" }],
    ]);
    expect(r.sales.map((s) => s.ref)).toEqual(["dld:P-4", "dld:P-5", "dld:P-6"]);
    expect(r.excluded.portfolio_deal).toBe(3);
  });

  it("rule 10: identical units at one price on one day stay; other bedrooms make it a block; two rows never do", () => {
    const same = { instance_date: "2026-06-02", actual_worth: "1800000" };
    // Three like units (sizes within 5%): ordinary sales at a list price.
    const like = collect([
      [{ ...same, transaction_id: "L-1" }],
      [{ ...same, transaction_id: "L-2", procedure_area: "103" }],
      [{ ...same, transaction_id: "L-3", procedure_area: "104.9" }],
    ]);
    expect(like.sales.map((s) => s.ref)).toEqual(["dld:L-1", "dld:L-2", "dld:L-3"]);
    expect(like.excluded.portfolio_deal).toBe(0);
    // The same sizes, but one row has other bedrooms.
    const mixed = collect([
      [{ ...same, transaction_id: "M-1" }],
      [{ ...same, transaction_id: "M-2" }],
      [{ ...same, transaction_id: "M-3", rooms_en: "3 B/R" }],
    ]);
    expect(mixed.kept).toBe(0);
    expect(mixed.excluded.portfolio_deal).toBe(3);
    // Two unlike rows at one price are below the block size.
    const pair = collect([
      [{ ...same, transaction_id: "T-1" }],
      [{ ...same, transaction_id: "T-2", procedure_area: "150" }],
    ]);
    expect(pair.kept).toBe(2);
  });

  it("rule 10a: a block of like units priced far from the building's other sales is left out (5 or more to compare with)", () => {
    // Five ordinary sales of 100 sq m at about AED 2,000,000, one a month.
    const singles = (prefix: string, year = "2026", extra: Row = {}): Array<[Row]> =>
      [0, 1, 2, 3, 4].map((i) => [{ transaction_id: `${prefix}-${i}`, instance_date: `${year}-0${i + 1}-10`, actual_worth: String(2_000_000 + i), ...extra }]);
    const block = (prefix: string, date: string, price: string, extra: Row = {}): Array<[Row]> =>
      [1, 2, 3].map((i) => [{ transaction_id: `${prefix}-${i}`, instance_date: date, actual_worth: price, ...extra }]);
    const r = collect([
      ...singles("S"),
      ...block("LOW", "2026-06-02", "1000000"), // 0.5x: a bulk deal
      ...block("NEAR", "2026-06-03", "1800000"), // 0.9x: a list price
      ...block("HIGH", "2026-06-04", "2600000"), // 1.3x
      ...block("EDGE", "2026-06-05", "1700002"), // just inside 0.85x
      ...block("LIST", "2026-06-06", "1640000"), // 0.82x: inside the old 0.8x band, out now (Hera Tower)
      ...block("TOP", "2026-06-07", "2340000"), // 1.17x: stays
      ...block("OVER", "2026-06-08", "2380000"), // 1.19x: out (was inside 1.25x)
    ]);
    expect(r.excluded.portfolio_deal).toBe(12);
    expect(r.sales.map((s) => s.ref).filter((x) => !x.startsWith("dld:S-"))).toEqual([
      "dld:EDGE-1", "dld:EDGE-2", "dld:EDGE-3", "dld:NEAR-1", "dld:NEAR-2", "dld:NEAR-3", "dld:TOP-1", "dld:TOP-2", "dld:TOP-3",
    ]);
    expect(r.kept + Object.values(r.excluded).reduce((a, b) => a + b, 0)).toBe(r.read);
    // Four ordinary sales are too few to judge a block: it stays.
    const few = collect([...singles("F").slice(0, 4), ...block("B", "2026-06-02", "1000000")]);
    expect(few.excluded.portfolio_deal).toBe(0);
    expect(few.kept).toBe(7);
    // Sales more than 365 days from the block, of other bedrooms or of the other completion do not count.
    const far = collect([...singles("O", "2024"), ...block("B", "2026-06-02", "1000000")]);
    expect(far.excluded.portfolio_deal).toBe(0);
    const beds = collect([...singles("O", "2026", { rooms_en: "3 B/R" }), ...block("B", "2026-06-02", "1000000")]);
    expect(beds.excluded.portfolio_deal).toBe(0);
    const basis = collect([...singles("O", "2026", { reg_type_en: "Off-Plan Properties" }), ...block("B", "2026-06-02", "1000000")]);
    expect(basis.excluded.portfolio_deal).toBe(0);
    // Rows of another block are not "other sales": two blocks do not judge each other.
    const two = collect([...block("A", "2026-06-02", "1000000"), ...block("B", "2026-06-03", "2000000")]);
    expect(two.excluded.portfolio_deal).toBe(0);
    expect(two.kept).toBe(6);
  });

  it("rule 10b: a size under half or over twice the building's median for those bedrooms is left out (5 or more sales)", () => {
    const five = (prefix: string): Array<[Row]> =>
      [0, 1, 2, 3, 4].map((i) => [{ transaction_id: `${prefix}-${i}`, instance_date: `2026-0${i + 1}-10`, actual_worth: String(2_000_000 + i) }]);
    const r = collect([
      ...five("S"), // 100 sq m each: the median
      [{ transaction_id: "S-big", procedure_area: "201", actual_worth: "4000000" }], // 2.01x
      [{ transaction_id: "S-small", procedure_area: "49", actual_worth: "1000000" }], // 0.49x
      [{ transaction_id: "S-edge", procedure_area: "200", actual_worth: "4000000" }], // exactly 2x stays
      [{ transaction_id: "S-old", procedure_area: "30", actual_worth: "600000", instance_date: "2019-01-01" }], // judged before the window
      [{ transaction_id: "S-beds", procedure_area: "250", actual_worth: "5000000", rooms_en: "4 B/R" }], // other bedrooms: own cell
      [{ transaction_id: "S-other", procedure_area: "250", actual_worth: "5000000", building_name_en: "TEST TOWER B" }], // other building
    ]);
    expect(r.excluded.size_unlike_building).toBe(3);
    expect(r.excluded.outside_window).toBe(0);
    expect(r.sales.map((s) => s.ref)).toEqual(["dld:S-0", "dld:S-1", "dld:S-2", "dld:S-3", "dld:S-4", "dld:S-beds", "dld:S-edge", "dld:S-other"]);
    // With 4 sales the building has no usual size yet, so nothing is left out.
    const few = collect([...five("F").slice(0, 3), [{ transaction_id: "F-big", procedure_area: "300", actual_worth: "6000000" }]]);
    expect(few.excluded.size_unlike_building).toBe(0);
    expect(few.kept).toBe(4);
    expect(r.kept + Object.values(r.excluded).reduce((a, b) => a + b, 0)).toBe(r.read);
  });

  it("gathers one row of facts per building: project, nearest places, first and last sale, counts", () => {
    const r = collect([
      [{ transaction_id: "F-1", instance_date: "2026-05-01", project_number: "2977.00", has_parking: "1", nearest_metro_en: "Test Metro Station", nearest_mall_en: "Test Mall", nearest_landmark_en: "Test Landmark" }],
      [{ transaction_id: "F-2", instance_date: "2026-07-01", project_number: "2977.00", has_parking: "0", reg_type_en: "Off-Plan Properties", nearest_metro_en: "Test Metro Station" }],
      [{ transaction_id: "F-3", instance_date: "2026-06-01", building_name_en: "test  tower a", project_number: "2977.00", has_parking: "1" }],
      // Before the window: not a kept sale, but it dates the building.
      [{ transaction_id: "F-4", instance_date: "2015-03-03", reg_type_en: "Off-Plan Properties" }],
      [{ transaction_id: "F-5", instance_date: "2017-09-09" }],
      [{ transaction_id: "F-6", instance_date: "2026-02-02", building_name_en: "TEST TOWER B", reg_type_en: "Off-Plan Properties", project_name_en: "", master_project_en: "" }],
    ]);
    expect(r.buildings).toBe(2);
    expect(r.buildingFacts).toEqual([
      {
        building: "TEST TOWER A",
        areaDld: "Marsa Dubai",
        projectNumber: 2977,
        project: "TEST PROJECT A",
        masterProject: "TEST MASTER",
        nearestMetro: "Test Metro Station",
        nearestMall: "Test Mall",
        nearestLandmark: "Test Landmark",
        firstSale: "2015-03-03",
        firstReadySale: "2017-09-09",
        lastSale: "2026-07-01",
        sales: 3,
        offPlanSales: 1,
        parkingSales: 2,
      },
      {
        building: "TEST TOWER B",
        areaDld: "Marsa Dubai",
        projectNumber: null,
        project: null,
        masterProject: null,
        nearestMetro: null,
        nearestMall: null,
        nearestLandmark: null,
        firstSale: "2026-02-02",
        firstReadySale: null,
        lastSale: "2026-02-02",
        sales: 1,
        offPlanSales: 1,
        parkingSales: 0,
      },
    ]);
    expect(r.sales.find((s) => s.ref === "dld:F-1")).toMatchObject({ projectNumber: 2977, parking: true });
    expect(r.sales.find((s) => s.ref === "dld:F-6")).toMatchObject({ projectNumber: null, parking: null });
  });

  it("rule 12: only the 36 months that end at the latest kept date; counts add up to the rows read", () => {
    const r = collect([
      [{ transaction_id: "W-1", instance_date: "2026-10-15" }],
      [{ transaction_id: "W-2", instance_date: "2023-10-16" }],
      [{ transaction_id: "W-3", instance_date: "2023-10-15" }],
      [{ transaction_id: "W-4", rooms_en: "PENTHOUSE", instance_date: "2027-01-01" }],
    ]);
    expect(r.sales.map((s) => s.ref)).toEqual(["dld:W-1", "dld:W-2"]);
    expect(r.dataThrough).toBe("2026-10-15");
    expect(r.dataFrom).toBe("2023-10-16");
    expect(r.excluded.outside_window).toBe(1);
    expect(r.read).toBe(4);
    expect(r.kept + Object.values(r.excluded).reduce((a, b) => a + b, 0)).toBe(r.read);
  });

  it("sorts by ref, counts distinct buildings and the most common source values", () => {
    const r = collect([
      [{ transaction_id: "B" }],
      [{ transaction_id: "A", building_name_en: "TEST TOWER B" }],
      [{ transaction_id: "C", area_name_en: "Business Bay" }],
      [{ transaction_id: "D", trans_group_en: "Gifts", procedure_name_en: "Grant", rooms_en: "" }],
    ]);
    expect(r.sales.map((s) => s.ref)).toEqual(["dld:A", "dld:B", "dld:C"]);
    expect(r.buildings).toBe(3);
    expect(r.topValues.procedure_name_en).toEqual([
      { value: "Sell", count: 3 },
      { value: "Grant", count: 1 },
    ]);
    expect(r.topValues.rooms_en).toEqual([
      { value: "2 B/R", count: 3 },
      { value: "(empty)", count: 1 },
    ]);
    expect(r.topValues.area_name_en[0]).toEqual({ value: "Marsa Dubai", count: 3 });
  });

  it("an empty run has no dates and add() after finish() throws", () => {
    const c = new DataDubaiCollector();
    const r = c.finish();
    expect(r).toMatchObject({ read: 0, kept: 0, dataFrom: null, dataThrough: null, buildings: 0, sales: [], buildingFacts: [] });
    expect(() => c.add(record(BASE), index, 0)).toThrow(/after finish/);
  });

  it("a missing optional column gives an empty top list", () => {
    const { index: idx, record: rec } = sheet(DATA_DUBAI_REQUIRED);
    const c = new DataDubaiCollector();
    c.add(rec(BASE), idx, 0);
    expect(c.finish().topValues.reg_type_en).toEqual([]);
  });
});
