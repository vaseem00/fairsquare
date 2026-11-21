import { describe, expect, it } from "vitest";
import { FIXTURE_CHECK_JVC, FIXTURE_CHECK_MARINA, FIXTURE_CHECK_OFFPLAN, FIXTURE_CHECK_THIN } from "../../fixtures/api-fixtures";
import { stampProps } from "@/lib/copy";
import {
  COMPACT_STAMP,
  grainTable,
  layoutCompactStamp,
  layoutStamp,
  mulberry32,
  rotatedBox,
  stampBox,
  stampSpecks,
  STAMP_WIDTH,
  type StampLayout,
} from "@/lib/stamp/geometry";
import { measureStampText } from "@/lib/stamp/metrics";

function textOf(layout: StampLayout, id: string): string[] {
  const row = layout.rows.find((r) => r.id === id);
  return (row?.items ?? []).flatMap((i) => (i.kind === "text" ? [i.text] : []));
}

/** Every item of every row lies inside the inner border. */
function insideInner(layout: StampLayout): boolean {
  const { inner } = layout;
  return layout.rows.every((row) =>
    row.items.every((item) => {
      const [x0, x1] =
        item.kind === "text"
          ? [item.x, item.x + item.width]
          : item.kind === "glyph"
            ? [item.x, item.x + item.size]
            : [item.cx - item.r, item.cx + item.r];
      const top = row.cy - row.size / 2;
      const bottom = row.cy + row.size / 2;
      return x0 >= inner.x && x1 <= inner.x + inner.width && top >= inner.y && bottom <= inner.y + inner.height;
    }),
  );
}

describe("stamp geometry (D§8.1)", () => {
  it("follows the spec proportions at every width", () => {
    for (const w of [STAMP_WIDTH.svg, STAMP_WIDTH.card, STAMP_WIDTH.og]) {
      const l = layoutStamp(stampProps(FIXTURE_CHECK_MARINA), w);
      expect(l.h).toBeCloseTo(0.56 * w, 6);
      expect(l.outer.stroke).toBeCloseTo(Math.max(4, w / 50), 6);
      expect(l.outer.r).toBeCloseTo(w / 18, 6);
      expect(l.inner.x).toBeCloseTo(0.045 * w, 6);
      expect(l.inner.stroke).toBeCloseTo(Math.max(2, w / 160), 6);
      expect(l.inner.r).toBeCloseTo(w / 30, 6);
      expect(l.rule.y).toBeCloseTo(0.655 * l.h, 6);
      expect(l.rule.x1).toBeCloseTo(0.105 * w, 6);
      expect(l.rule.stroke).toBeCloseTo(Math.max(2, w / 200), 6);
      const cy = Object.fromEntries(l.rows.map((r) => [r.id, r.cy / l.h]));
      expect(cy).toEqual({ a: expect.closeTo(0.19, 6), b: expect.closeTo(0.47, 6), c: expect.closeTo(0.765, 6), d: expect.closeTo(0.865, 6) });
      expect(l.rotation).toBe(-9);
      expect(insideInner(l)).toBe(true);
    }
  });

  it("the figure starts at 0.38h, shrinks to fit 0.77w, never below 0.2h", () => {
    const w = 1000;
    const marina = layoutStamp(stampProps(FIXTURE_CHECK_MARINA), w).rows.find((r) => r.id === "b")!;
    expect(marina.size).toBeCloseTo(0.38 * 560, 6); // "+14.0%" fits at full size
    const long = layoutStamp({ header: "ABOVE", figure: "+1234.5%", lines: { c: "", d: ["2-BED"] } }, w).rows.find((r) => r.id === "b")!;
    expect(long.size).toBeLessThan(0.38 * 560);
    expect(long.width).toBeLessThanOrEqual(0.77 * w + 1e-6);
    const absurd = layoutStamp({ header: "ABOVE", figure: "+123456789012345678.0%", lines: { c: "", d: [] } }, w).rows.find((r) => r.id === "b")!;
    expect(absurd.size).toBeCloseTo(0.2 * 560, 6);
  });

  it("rows C and D fit to the content width; row D separators are drawn diamonds of 0.012w", () => {
    const l = layoutStamp(stampProps(FIXTURE_CHECK_OFFPLAN), 1000);
    for (const id of ["c", "d"]) {
      expect(l.rows.find((r) => r.id === id)!.width).toBeLessThanOrEqual(0.77 * 1000 + 1e-6);
    }
    // Row A (the header) is fitted to the rule's span instead: 0.79w.
    expect(l.rows.find((r) => r.id === "a")!.width).toBeLessThanOrEqual(0.79 * 1000 + 1e-6);
    const d = l.rows.find((r) => r.id === "d")!;
    const diamonds = d.items.filter((i) => i.kind === "diamond");
    expect(diamonds).toHaveLength(2);
    expect(textOf(l, "d")).toEqual(["2-BED", "12 MONTHS TO 17 NOV 2026", "OFF-PLAN"]);
    expect(textOf(l, "d").join(" ")).not.toMatch(/[<>◇◆]/);
    const r = (diamonds[0] as { r: number }).r;
    expect(r).toBeLessThanOrEqual(12 + 1e-6);
  });

  it("row A prints the verdict word inside the border (RESULT_SPEC section 8.1); never COMPARED or CHECKED", () => {
    const l = layoutStamp(stampProps(FIXTURE_CHECK_MARINA), 1000);
    expect(textOf(l, "a")).toEqual(["FAIRSQUARE", "ABOVE"]);
    expect(l.rows.find((r) => r.id === "a")!.items.some((i) => i.kind === "glyph")).toBe(true);
    expect(insideInner(l)).toBe(true);
    expect(textOf(l, "c")).toEqual(["VS MEDIAN OF 11 REGISTERED SALES"]);
    // Row D: the bed type and the window; OFF-PLAN only for an off-plan comparison, never READY.
    expect(textOf(l, "d")).toEqual(["2-BED", "12 MONTHS TO 17 NOV 2026"]);
    expect(textOf(layoutStamp(stampProps(FIXTURE_CHECK_JVC), 1000), "a")).toEqual(["FAIRSQUARE", "IN LINE"]);
    expect(textOf(layoutStamp(stampProps(FIXTURE_CHECK_THIN), 1000), "a")).toEqual(["FAIRSQUARE", "TOO FEW"]);
    const below = { ...FIXTURE_CHECK_JVC, analysis: { ...FIXTURE_CHECK_JVC.analysis, band: "below" as const, diff: -0.091 } };
    expect(textOf(layoutStamp(stampProps(below), 1000), "a")).toEqual(["FAIRSQUARE", "BELOW"]);
    const all = l.rows.flatMap((r) => textOf(l, r.id)).join(" ");
    expect(all).not.toMatch(/DEMO|CHECKED|COMPARED|READY/);
  });

  it("row A fits FAIRSQUARE, the scale glyph and the verdict word on one line, 0.06w clear of the inner border, at every width", () => {
    for (const w of [STAMP_WIDTH.svg, STAMP_WIDTH.card, STAMP_WIDTH.og, 210]) {
      for (const c of [FIXTURE_CHECK_MARINA, FIXTURE_CHECK_JVC, FIXTURE_CHECK_THIN, FIXTURE_CHECK_OFFPLAN]) {
        const l = layoutStamp(stampProps(c), w);
        const a = l.rows.find((r) => r.id === "a")!;
        expect(a.items.map((i) => i.kind)).toEqual(["text", "glyph", "text"]);
        const left = a.items[0] as { x: number };
        const last = a.items[2] as { x: number; width: number };
        // Within the rule's span: 0.06w in from the inner border on both sides.
        expect(left.x - l.inner.x).toBeGreaterThanOrEqual(0.06 * w - 1e-6);
        expect(l.inner.x + l.inner.width - (last.x + last.width)).toBeGreaterThanOrEqual(0.06 * w - 1e-6);
        expect(left.x).toBeGreaterThanOrEqual(l.rule.x1 - 1e-6);
        expect(last.x + last.width).toBeLessThanOrEqual(l.rule.x2 + 1e-6);
        expect(a.width).toBeLessThanOrEqual(0.79 * w + 1e-6);
        // Tracking 0.1em; 0.04w (17.6px on the card's 440px stamp, as the ShareCard mockup's 17px), above row D.
        expect(a.letterSpacing).toBeCloseTo(0.1 * a.size, 6);
        expect(a.size / w).toBeCloseTo(0.04, 6);
        const d = l.rows.find((r) => r.id === "d")!;
        expect(a.size).toBeGreaterThan(d.size);
        // The glyph is as tall as the capitals' em box and keeps a visible stroke.
        const glyph = a.items[1] as { size: number; stroke: number };
        expect(glyph.size).toBeCloseTo(a.size, 6);
        expect(glyph.stroke).toBeGreaterThan(0.1 * glyph.size);
        expect(insideInner(l)).toBe(true);
      }
    }
  });

  it("thin: 2 OF 5 and SALES NEEDED TO COMPARE", () => {
    const l = layoutStamp(stampProps(FIXTURE_CHECK_THIN), 1000);
    expect(textOf(l, "b")).toEqual(["2 OF 5"]);
    expect(textOf(l, "c")).toEqual(["SALES NEEDED TO COMPARE"]);
  });

  it("text metrics come from the WOFF advance widths", () => {
    expect(measureStampText("FAIRSQUARE", "wide", 100)).toBeCloseTo(852.8, 1);
    expect(measureStampText("FAIRSQUARE", "wide", 100, 10)).toBeCloseTo(942.8, 1);
    expect(measureStampText("+14.0%", "condensed", 100)).toBeCloseTo(286.2, 1);
  });

  it("the box is the rotated label rectangle", () => {
    const w = 691;
    const box = stampBox(w);
    const expected = rotatedBox(w * 1.06, 0.56 * w + 0.06 * w);
    expect(box.width).toBeCloseTo(expected.width, 6);
    expect(box.height).toBeCloseTo(expected.height, 6);
    expect(box.width).toBeGreaterThan(w);
  });
});

describe("texture (D§8.2)", () => {
  it("is deterministic per seed and has the specified density", () => {
    const a = stampSpecks(1234, 691);
    const b = stampSpecks(1234, 691);
    const c = stampSpecks(1235, 691);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.specks).toHaveLength(Math.round((691 * 0.56 * 691) / 260));
    expect(a.specks.every((s) => s.r >= 0.6 && s.r <= 2.2 && s.a >= 0.35 && s.a <= 1)).toBe(true);
    expect(a.wear).toHaveLength(24);
    const band = 0.06 * 691;
    const h = 0.56 * 691;
    for (const v of a.wear) {
      const edge = Math.min(v.x, v.y, 691 - v.x, h - v.y);
      expect(edge).toBeLessThanOrEqual(band + 1e-6);
      expect(v.r).toBeGreaterThanOrEqual(2);
      expect(v.r).toBeLessThanOrEqual(5);
    }
  });

  it("mulberry32 is stable", () => {
    const r = mulberry32(42);
    expect([r(), r()]).toEqual([expect.closeTo(0.6011, 3), expect.closeTo(0.4483, 3)]);
  });

  it("grain threshold table", () => {
    const t = grainTable(0.3, 10).split(" ");
    expect(t).toEqual(["0", "0", "0", "1", "1", "1", "1", "1", "1", "1"]);
  });
});

describe("the compact ASKING stamp (RESULT_SPEC section 4.3 item 9)", () => {
  it("92 x 52 on phones and 116 x 65 from 768px: double border, ASKING over the figure, -4deg", () => {
    const p = layoutCompactStamp("1,786", "phone");
    expect([p.w, p.h, p.rotation]).toEqual([92, 52, -4]);
    expect(p.outer).toMatchObject({ stroke: 2, r: 4 });
    expect(p.inner).toMatchObject({ stroke: 1 });
    expect(p.inner.x - p.outer.x).toBeCloseTo(2.5, 6);
    expect(p.rowA).toMatchObject({ text: "ASKING", size: 11, letterSpacingEm: 0.14, x: 46 });
    expect(p.rowB).toMatchObject({ text: "1,786", size: 20, x: 46 });
    expect(p.rowA.baseline).toBeLessThan(p.rowB.baseline);
    expect(p.rowB.baseline).toBeLessThan(p.h - 4);
    const d = layoutCompactStamp("1,786", "desktop");
    expect([d.w, d.h, d.rowA.size, d.rowB.size]).toEqual([116, 65, 13, 26]);
    expect(COMPACT_STAMP.desktop.w).toBe(116);
  });
});
