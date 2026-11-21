/** docs/REDESIGN.md section 7.2: the balance's geometry, pure numbers. */
import { describe, expect, it } from "vitest";
import { ARM, DOT, MAX_TILT, PAN, angleFor, dotLayout, loadBox, panOffsets, trayPath } from "@/components/scene/balance-geometry";

describe("angleFor", () => {
  it("tips the listing (left) pan down for a price above the median: negative degrees", () => {
    expect(angleFor(0.143)).toBeLessThan(0);
    expect(angleFor(-0.062)).toBeGreaterThan(0);
    expect(Math.abs(angleFor(0))).toBe(0);
    expect(angleFor(null)).toBe(0);
  });

  it("clamps at ±30% to ±9°", () => {
    expect(angleFor(0.3)).toBeCloseTo(-MAX_TILT, 10);
    expect(angleFor(0.9)).toBeCloseTo(-MAX_TILT, 10);
    expect(angleFor(-2)).toBeCloseTo(MAX_TILT, 10);
  });

  it("reads level within the ±5% band: 1.5° or less", () => {
    expect(Math.abs(angleFor(0.05))).toBeCloseTo(1.5, 9);
    expect(Math.abs(angleFor(-0.05))).toBeLessThanOrEqual(1.5 + 1e-9);
  });
});

describe("panOffsets", () => {
  it("is zero at rest", () => {
    const p = panOffsets(0);
    expect(p.left.x).toBeCloseTo(0, 10);
    expect(p.left.y).toBeCloseTo(0, 10);
    expect(p.right.x).toBeCloseTo(0, 10);
    expect(p.right.y).toBeCloseTo(0, 10);
  });

  it("at -9° the left end drops and the right end rises by the same amount, both moving inward", () => {
    const p = panOffsets(-9);
    const dy = ARM * Math.sin((9 * Math.PI) / 180);
    expect(p.left.y).toBeCloseTo(dy, 6);
    expect(p.right.y).toBeCloseTo(-dy, 6);
    expect(p.left.x).toBeGreaterThan(0);
    expect(p.right.x).toBeLessThan(0);
    expect(p.left.x).toBeCloseTo(-p.right.x, 10);
  });
});

describe("dotLayout", () => {
  it("caps at 24 dots in rows of 9, 8 and 7, filled from the bottom row", () => {
    expect(dotLayout(100)).toHaveLength(DOT.max);
    expect(dotLayout(0)).toEqual([]);
    const five = dotLayout(5);
    expect(new Set(five.map((d) => d.y))).toEqual(new Set([PAN.dotsBottom]));
    const eleven = dotLayout(11);
    expect(eleven.filter((d) => d.y === PAN.dotsBottom)).toHaveLength(9);
    expect(eleven.filter((d) => d.y < PAN.dotsBottom)).toHaveLength(2);
  });

  it("centres each row on the pan", () => {
    const row = dotLayout(9);
    expect(row[0].x).toBeCloseTo(-row[8].x, 10);
    const two = dotLayout(11).slice(9);
    expect(two[0].x).toBeCloseTo(-two[1].x, 10);
  });
});

describe("loadBox and trayPath", () => {
  it("stands the screenshot on the tray: 60 wide, at most 110 tall", () => {
    expect(loadBox({ width: 1080, height: 2160 })).toEqual({ x: -30, y: PAN.loadBottom - 110, width: 60, height: 110 });
    expect(loadBox({ width: 1200, height: 900 })).toEqual({ x: -30, y: PAN.loadBottom - 45, width: 60, height: 45 });
  });

  it("draws the tray as a quadratic arc under the beam end", () => {
    expect(trayPath(60, 132)).toBe("M 12 282 Q 60 298 108 282");
  });
});
