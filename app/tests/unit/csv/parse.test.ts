import { describe, expect, it } from "vitest";
import {
  checkAliasRow,
  checkBuildingRow,
  checkSaleRow,
  countDataLines,
  CsvFormatError,
  CSV_COLUMNS,
  parseCsvBedrooms,
  parseCsvBool,
  parseCsvCompletion,
  parseCsvText,
  SQFT_PER_SQM,
  templateCsv,
  templateFileName,
} from "@/lib/csv/parse";
import { parseArgs } from "../../../scripts/import-csv";

const TODAY = "2026-11-17";

describe("CSV_COLUMNS and the template", () => {
  it("has the A§4.4 columns for each kind", () => {
    expect(CSV_COLUMNS.sales).toEqual(["building_name", "sale_date", "bedrooms", "size_sqft", "price_aed", "external_ref", "completion"]);
    expect(CSV_COLUMNS.buildings).toEqual(["name", "area", "project", "master_project"]);
    expect(CSV_COLUMNS.aliases).toEqual(["building_name", "alias"]);
  });

  it("Download template is exactly the header row of CSV_COLUMNS[kind]", () => {
    for (const kind of ["sales", "buildings", "aliases"] as const) {
      const text = templateCsv(kind);
      expect(text).toBe(`${CSV_COLUMNS[kind].join(",")}\n`);
      const parsedHeader = text.trim().split(",");
      expect(parsedHeader).toEqual([...CSV_COLUMNS[kind]]);
    }
    expect(templateFileName("sales")).toBe("fairsquare-sales-template.csv");
  });
});

describe("parseCsvText", () => {
  it("reads a BOM, case-insensitive headers, quoted cells, and keeps physical line numbers", () => {
    const text = '﻿Building_Name,Alias\r\n"Mockup Crest Tower","Crest, the"\r\n\r\nFake Vista Residences,PV\r\n';
    const p = parseCsvText(text, "aliases");
    expect(p.columns).toEqual(["building_name", "alias"]);
    expect(p.rows).toEqual([
      { line: 2, values: { building_name: "Mockup Crest Tower", alias: "Crest, the" } },
      { line: 4, values: { building_name: "Fake Vista Residences", alias: "PV" } },
    ]);
  });

  it("rejects a missing column, an empty file and too many rows", () => {
    expect(() => parseCsvText("building_name\nX\n", "aliases")).toThrow(CsvFormatError);
    expect(() => parseCsvText("building_name\nX\n", "aliases")).toThrow("Missing column: alias");
    expect(() => parseCsvText("building_name,sale_date,bedrooms,price_aed\nX,2026-01-01,1,1\n", "sales")).toThrow(
      "Missing column: size_sqft",
    );
    expect(() => parseCsvText("", "sales")).toThrow("The file has no rows.");
    expect(() => parseCsvText("name,area\n\n\n", "buildings")).toThrow("The file has no rows.");
    expect(() => parseCsvText("name,area\na1,b\na2,b\na3,b\n", "buildings", 2)).toThrow("The file has more than 2 rows.");
  });

  it("countDataLines counts non-blank lines after the header", () => {
    expect(countDataLines("a,b\n1,2\n\n3,4\r\n")).toBe(2);
    expect(countDataLines("")).toBe(0);
  });
});

describe("cell parsers", () => {
  it("bedrooms: studio, 0–7, and common spellings", () => {
    expect(parseCsvBedrooms("studio")).toBe(0);
    expect(parseCsvBedrooms("Studio")).toBe(0);
    expect(parseCsvBedrooms("0")).toBe(0);
    expect(parseCsvBedrooms("2")).toBe(2);
    expect(parseCsvBedrooms("2BR")).toBe(2);
    expect(parseCsvBedrooms("3 bed")).toBe(3);
    expect(parseCsvBedrooms("8")).toBeNull();
    expect(parseCsvBedrooms("1.5")).toBeNull();
    expect(parseCsvBedrooms("")).toBeNull();
    expect(parseCsvBedrooms(undefined)).toBeNull();
  });

  it("booleans", () => {
    expect(parseCsvBool("true")).toBe(true);
    expect(parseCsvBool("TRUE")).toBe(true);
    expect(parseCsvBool("1")).toBe(true);
    expect(parseCsvBool("false")).toBe(false);
    expect(parseCsvBool("")).toBe(false);
    expect(parseCsvBool(undefined)).toBe(false);
    expect(parseCsvBool("maybe")).toBeNull();
  });
});

describe("checkSaleRow", () => {
  const ok = { building_name: "Mockup Crest Tower", sale_date: "2026-10-01", bedrooms: "2", size_sqft: "1,284", price_aed: "2,236,000" };

  it("accepts a valid row and normalises numbers", () => {
    expect(checkSaleRow(ok, TODAY)).toEqual({
      ok: true,
      value: {
        buildingName: "Mockup Crest Tower",
        area: null,
        saleDate: "2026-10-01",
        bedrooms: 2,
        sizeSqft: 1284,
        priceAed: 2_236_000,
        externalRef: null,
        completion: "ready",
      },
    });
    // An old file's is_demo column is ignored (the demo flag is gone, REAL_DATA.md section 8).
    const today = checkSaleRow({ ...ok, sale_date: TODAY, external_ref: "DLD-1", is_demo: "true" }, TODAY);
    expect(today).toEqual({ ok: true, value: { ...(checkSaleRow(ok, TODAY) as { value: object }).value, saleDate: TODAY, externalRef: "DLD-1" } });
  });

  it("reads the completion column (blank = ready) and the area column (REAL_DATA.md section 12)", () => {
    const value = (over: Record<string, string>) => {
      const r = checkSaleRow({ ...ok, ...over }, TODAY);
      return r.ok ? r.value : r.reason;
    };
    for (const v of ["", "ready", "Ready", "existing"]) expect(value({ completion: v })).toMatchObject({ completion: "ready" });
    for (const v of ["off_plan", "off-plan", "Off Plan", "OFFPLAN"]) expect(value({ completion: v })).toMatchObject({ completion: "off_plan" });
    expect(value({ completion: "soon" })).toBe("Completion must be ready or off_plan");
    expect(value({ area: "Marsa Dubai" })).toMatchObject({ area: "Marsa Dubai" });
    expect(value({ area: "x".repeat(81) })).toBe("area is too long");
    expect(parseCsvCompletion(undefined)).toBe("ready");
  });

  it("converts size_sqm to sq ft", () => {
    const { size_sqft: _drop, ...rest } = ok;
    void _drop;
    const r = checkSaleRow({ ...rest, size_sqm: "119.29" }, TODAY);
    expect(r.ok && r.value.sizeSqft).toBeCloseTo(119.29 * SQFT_PER_SQM, 2);
  });

  it("gives plain-word reasons", () => {
    const reason = (over: Record<string, string>) => {
      const r = checkSaleRow({ ...ok, ...over }, TODAY);
      return r.ok ? null : r.reason;
    };
    expect(reason({ building_name: "" })).toBe("Building name is missing");
    expect(reason({ sale_date: "" })).toBe("Date is missing");
    expect(reason({ sale_date: "2026-02-30" })).toBe("Date must look like 2026-11-17");
    expect(reason({ sale_date: "2026-11-18" })).toBe("Date is in the future");
    expect(reason({ bedrooms: "ten" })).toBe("Bedrooms must be 0 to 7, or studio");
    expect(reason({ size_sqft: "" })).toBe("Size is missing");
    expect(reason({ size_sqft: "150" })).toBe("Size is out of range");
    expect(reason({ size_sqft: "abc" })).toBe("Size is out of range");
    expect(reason({ price_aed: "" })).toBe("Price is missing");
    expect(reason({ price_aed: "50000" })).toBe("Price is out of range");
    expect(reason({ price_aed: "1000000.5" })).toBe("Price is out of range");
    expect(reason({ price_aed: "9000000" })).toBe("Price per sq ft looks wrong");
    expect(reason({ price_aed: "380000" })).toBe("Price per sq ft looks wrong");
    expect(reason({ external_ref: "x".repeat(65) })).toBe("Reference is longer than 64 characters");
    expect(reason({ is_demo: "perhaps" })).toBeNull();
  });
});

describe("checkBuildingRow and checkAliasRow", () => {
  it("buildings: required name and area; blanks are null", () => {
    expect(checkBuildingRow({ name: "Nowhere Point Tower", area: "Dubai Creek Harbour" })).toEqual({
      ok: true,
      value: { name: "Nowhere Point Tower", area: "Dubai Creek Harbour", project: null, masterProject: null },
    });
    expect(checkBuildingRow({ name: "H", area: "Dubai" })).toEqual({ ok: false, reason: "Name is missing" });
    expect(checkBuildingRow({ name: "Nowhere", area: "" })).toEqual({ ok: false, reason: "Area is missing" });
    expect(checkBuildingRow({ name: "Nowhere", area: "Creek", is_demo: "x" })).toMatchObject({ ok: true });
    expect(checkBuildingRow({ name: "x".repeat(121), area: "Creek" })).toEqual({ ok: false, reason: "name is too long" });
  });

  it("aliases: building and alias required", () => {
    expect(checkAliasRow({ building_name: "Mockup Crest Tower", alias: "MCT" })).toEqual({
      ok: true,
      value: { buildingName: "Mockup Crest Tower", alias: "MCT" },
    });
    expect(checkAliasRow({ building_name: "", alias: "MCT" })).toEqual({ ok: false, reason: "Building name is missing" });
    expect(checkAliasRow({ building_name: "Marina", alias: "M" })).toEqual({ ok: false, reason: "Alias is missing" });
  });
});

describe("npm run import:csv arguments", () => {
  it("is a dry run unless --commit is passed", () => {
    expect(parseArgs(["--kind", "sales", "--file", "x.csv"])).toEqual({ kind: "sales", file: "x.csv", commit: false });
    expect(parseArgs(["--kind=aliases", "--file=a.csv", "--commit"])).toEqual({ kind: "aliases", file: "a.csv", commit: true });
  });

  it("rejects a missing or unknown kind and a missing file", () => {
    expect(() => parseArgs(["--file", "x.csv"])).toThrow(/--kind/);
    expect(() => parseArgs(["--kind", "cats", "--file", "x.csv"])).toThrow(/--kind/);
    expect(() => parseArgs(["--kind", "sales"])).toThrow(/--file/);
    expect(() => parseArgs(["--kind", "sales", "--file", "--commit"])).toThrow(/--file/);
  });
});
