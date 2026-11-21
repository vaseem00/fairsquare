import { describe, expect, it } from "vitest";
import { addMonths, cleanLatin, cleanLatinOrNull, cleanOrNull, parseFlag, parseProjectNumber, cleanText, parseAmount, parseRooms, parseSourceDate, round2, stripBom } from "@/lib/ingest/fields";

describe("text clean-up", () => {
  it("trims and collapses whitespace (tabs, non-breaking spaces, doubles)", () => {
    expect(cleanText("  TEST   TOWER\tA  ")).toBe("TEST TOWER A");
    expect(cleanText(null)).toBe("");
    expect(cleanText(undefined)).toBe("");
    expect(cleanOrNull("   ")).toBeNull();
    expect(cleanOrNull(" x ")).toBe("x");
  });

  it("removes a leading BOM only", () => {
    expect(stripBom("﻿transaction_id")).toBe("transaction_id");
    expect(stripBom("a﻿")).toBe("a﻿");
  });
});

describe("parseSourceDate (REAL_DATA.md section 1)", () => {
  it.each([
    ["2026-10-15", "2026-10-15"],
    ["2026-10-15 00:00:00", "2026-10-15"],
    ["2026-10-15T13:45:10", "2026-10-15"],
    ["2026-1-5", "2026-01-05"],
    ["15-09-2026", "2026-09-15"],
    ["05/08/2026", "2026-08-05"],
    ["5/8/2026", "2026-08-05"],
    ["20-07-26", "2026-07-20"],
    ["01-01-08", "2008-01-01"],
    ["15-09-2026 10:30", "2026-09-15"],
    ["  2026-10-15  ", "2026-10-15"],
  ])("reads %s as %s (day first in every non-ISO form; two-digit years are 20YY)", (raw, iso) => {
    expect(parseSourceDate(raw)).toBe(iso);
  });

  it.each(["", "   ", "yesterday", "2026-13-01", "31-02-2026", "29-02-2025", "2026/10/15", "15.09.2026", "10-15", "2026-10-15x"])(
    "rejects %j",
    (raw) => {
      expect(parseSourceDate(raw)).toBeNull();
    },
  );

  it("accepts 29 February in a leap year", () => {
    expect(parseSourceDate("29-02-2024")).toBe("2024-02-29");
    expect(parseSourceDate(null)).toBeNull();
  });
});

describe("addMonths", () => {
  it("moves by calendar months and clamps to the last day", () => {
    expect(addMonths("2026-10-15", -36)).toBe("2023-10-15");
    expect(addMonths("2024-02-29", -12)).toBe("2023-02-28");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2025-12-15", 1)).toBe("2026-01-15");
  });
});

describe("parseRooms (REAL_DATA.md section 2, rule 4)", () => {
  it.each([
    ["Studio", 0],
    ["studio", 0],
    [" STUDIO ", 0],
    ["1 B/R", 1],
    ["2 b/r", 2],
    ["3 BR", 3],
    ["4BR", 4],
    ["5", 5],
    ["6 B / R", 6],
    ["7 B/R", 7],
  ])("%j → %d", (raw, n) => {
    expect(parseRooms(raw)).toBe(n);
  });

  it.each(["PENTHOUSE", "Single Room", "Office", "Shop", "Store", "GYM", "", "8 B/R", "10", "0", "0 B/R", "2.5", "-1", "Hotel"])(
    "excludes %j",
    (raw) => {
      expect(parseRooms(raw)).toBeNull();
    },
  );
});

describe("parseAmount", () => {
  it("reads plain and comma-grouped numbers; NaN otherwise", () => {
    expect(parseAmount("1250000")).toBe(1_250_000);
    expect(parseAmount(" 1,250,000.50 ")).toBe(1_250_000.5);
    expect(parseAmount("85.3")).toBe(85.3);
    expect(parseAmount(".5")).toBe(0.5);
    expect(parseAmount("1e3")).toBe(1000);
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount("12abc")).toBeNaN();
    expect(parseAmount(undefined)).toBeNaN();
  });

  it("round2 keeps 2 decimals", () => {
    expect(round2(110.5 * 10.7639)).toBe(1189.41);
  });
});

describe("English name columns, project numbers and flags", () => {
  it("cleanLatin removes Arabic-script characters and then cleans the spaces", () => {
    expect(cleanLatin("\u0650\u0650Azizi Riviera 60")).toBe("Azizi Riviera 60");
    expect(cleanLatin("  TEST \u0628\u0631\u062C  TOWER ")).toBe("TEST TOWER");
    expect(cleanLatin("Me'Aisem First")).toBe("Me'Aisem First");
    expect(cleanLatin("Caf\u00e9 Tower \u2013 A")).toBe("Caf\u00e9 Tower \u2013 A"); // other scripts stay
    expect(cleanLatin(null)).toBe("");
    expect(cleanLatinOrNull("\u0623\u062E\u0631\u0649")).toBeNull();
    expect(cleanLatinOrNull(" A ")).toBe("A");
  });

  it("parseProjectNumber reads DLD's decimal form as a whole number", () => {
    expect(parseProjectNumber("2977.00")).toBe(2977);
    expect(parseProjectNumber(" 12 ")).toBe(12);
    for (const bad of ["", "0", "-3", "12.5", "abc", null, undefined]) expect(parseProjectNumber(bad), String(bad)).toBeNull();
  });

  it("parseFlag reads 1 and 0 only", () => {
    expect(parseFlag("1")).toBe(true);
    expect(parseFlag(" 0 ")).toBe(false);
    for (const other of ["", "yes", "2", null, undefined]) expect(parseFlag(other), String(other)).toBeNull();
  });
});
