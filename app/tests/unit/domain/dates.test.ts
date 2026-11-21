import { describe, expect, it } from "vitest";
import { addDays, diffDays, dubaiToday, isIsoDate } from "@/lib/domain";

describe("dates", () => {
  it("dubaiToday uses the Dubai calendar day (UTC+4)", () => {
    expect(dubaiToday(new Date("2026-11-16T21:30:00Z"))).toBe("2026-11-17");
    expect(dubaiToday(new Date("2026-11-16T19:59:59Z"))).toBe("2026-11-16");
    expect(isIsoDate(dubaiToday())).toBe(true);
  });

  it("addDays does UTC arithmetic on the date only", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-17", -365)).toBe("2025-11-17");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("isIsoDate accepts only real YYYY-MM-DD dates", () => {
    expect(isIsoDate("2026-11-17")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-1-7")).toBe(false);
    expect(isIsoDate("17 Nov 2026")).toBe(false);
  });

  it("diffDays counts whole days", () => {
    expect(diffDays("2026-11-17", "2026-11-20")).toBe(3);
    expect(diffDays("2026-11-20", "2026-11-17")).toBe(-3);
  });

  it("rejects malformed dates", () => {
    expect(() => addDays("nope", 1)).toThrow(RangeError);
  });
});
