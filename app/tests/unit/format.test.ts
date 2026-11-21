import { describe, expect, it } from "vitest";
import {
  bedsLabel,
  bedsLabelPlural,
  bedsOption,
  formatAed,
  formatDate,
  formatInt,
  formatPct,
  formatPctAbs,
  formatPctNumber,
  formatTime,
  formatTimestampDate,
  slugify,
} from "@/lib/format";

describe("format", () => {
  it("formatAed rounds and groups", () => {
    expect(formatAed(1908.1)).toBe("AED 1,908");
    expect(formatAed(2_450_000)).toBe("AED 2,450,000");
    expect(formatAed(10_618.07)).toBe("AED 10,618");
    expect(formatInt(1284.5)).toBe("1,285");
  });

  it("formatPct signs with + and the true minus", () => {
    expect(formatPct(0.13953)).toBe("+14.0%");
    expect(formatPct(-0.01705)).toBe("−1.7%");
    expect(formatPct(0.0004)).toBe("0.0%");
    expect(formatPct(-0.0004)).toBe("0.0%");
    expect(formatPct(0)).toBe("0.0%");
    expect(formatPctAbs(-0.01705)).toBe("1.7%");
    expect(formatPctAbs(0.13953)).toBe("14.0%");
    expect(formatPctNumber(0.13953)).toBe("14.0");
  });

  it("formatDate is en-GB with fixed month names", () => {
    expect(formatDate("2026-11-17")).toBe("17 Nov 2026");
    expect(formatDate("2025-09-03")).toBe("3 Sep 2025");
    expect(formatDate("2026-11-17T10:00:00Z")).toBe("17 Nov 2026");
  });

  it("timestamps use Dubai time", () => {
    expect(formatTimestampDate("2026-11-16T21:30:00Z")).toBe("17 Nov 2026");
    expect(formatTime("2026-11-17T10:05:00Z")).toBe("14:05");
    expect(formatTime(new Date("2026-11-17T20:00:00Z"))).toBe("00:00");
  });

  it("bedroom labels", () => {
    expect(bedsLabel(0)).toBe("studio");
    expect(bedsLabel(2)).toBe("2-bed");
    expect(bedsLabelPlural(0)).toBe("studios");
    expect(bedsLabelPlural(2)).toBe("2-beds");
    expect(bedsOption(0)).toBe("Studio");
    expect(bedsOption(1)).toBe("1 bedroom");
    expect(bedsOption(2)).toBe("2 bedrooms");
  });

  it("slugify", () => {
    expect(slugify("Mockup Crest Tower")).toBe("mockup-crest-tower");
    expect(slugify("  ")).toBe("listing");
  });
});
