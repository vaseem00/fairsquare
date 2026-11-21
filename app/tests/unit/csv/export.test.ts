import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv/export";

describe("csvCell (A§6.5 CSV injection)", () => {
  it("prefixes cells starting with = + - @ tab or CR with '", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+1+cmd")).toBe("'+1+cmd");
    expect(csvCell("+97150 1234567")).toBe("'+97150 1234567");
    expect(csvCell("+SUM(1)")).toBe("'+SUM(1)");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("\rx")).toBe(`"'\rx"`);
  });

  it("writes an E.164 phone without the apostrophe (it cannot hold a formula)", () => {
    expect(csvCell("+971501234567")).toBe("+971501234567");
    expect(csvCell("+12025550123")).toBe("+12025550123");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("Mockup Crest Tower, 2-bed")).toBe('"Mockup Crest Tower, 2-bed"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });

  it("writes numbers, booleans and empty values plainly", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(2_450_000)).toBe("2450000");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("Sara")).toBe("Sara");
  });
});

describe("toCsv", () => {
  it("writes a header and CRLF rows", () => {
    expect(
      toCsv(
        ["id", "name"],
        [
          [1, "Sara"],
          [2, "=cmd"],
        ],
      ),
    ).toBe("id,name\r\n1,Sara\r\n2,'=cmd\r\n");
  });
});
