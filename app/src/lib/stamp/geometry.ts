/**
 * The stamp geometry (DESIGN.md section 8.1, RESULT_SPEC section 8): one layout, in stamp pixels
 * relative to the stamp width `w`, drawn by the share card (`renderCard`, w = 440) and the OG image
 * (next/og, w = 470); and the compact ASKING stamp the market scale lands on its pin. Also the texture
 * (8.2). Pure and client-safe: no DOM, no server imports.
 *
 *   w x h (h = 0.56w), rotated -9 degrees about the centre.
 *   outer border  stroke max(4, w/50), radius w/18
 *   inner border  inset 0.045w, stroke max(2, w/160), radius w/30
 *   row A centre 0.19h   FAIRSQUARE [scale] IN LINE          (wide, tracking 0.1em, 0.04w, fitted to the
 *                        rule's span 0.79w when longer, 0.06w clear of the inner border)
 *   row B centre 0.47h   +1.4%                               (condensed, from 0.38h, min 0.2h)
 *   rule  y 0.655h, 0.06w in from the inner border, stroke max(2, w/200)
 *   row C centre 0.765h  VS MEDIAN OF 43 REGISTERED SALES    (wide, 0.046w, tracking 0.06em)
 *   row D centre 0.865h  2-BED <> 12 MONTHS TO 16 NOV 2026   (wide, 0.038w, diamonds 0.012w; <> OFF-PLAN added
 *                        for an off-plan comparison)
 *
 * The verdict word in row A is IN LINE, ABOVE, BELOW or TOO FEW (`stampProps`). The stamp stays indigo
 * in every state: direction is in the words, the sign and the position.
 */
import { COPY, type StampProps } from "@/lib/copy";
import { measureStampText, STAMP_FONT_METRICS, type StampFace } from "./metrics";

export type { StampFace } from "./metrics";

// ---------- constants ----------

/** Ink #3A37C9 at alpha 0.9, in both themes (the stamp is printed on paper, not on the UI). */
export const STAMP_INK = "#3A37C9";
export const STAMP_INK_ALPHA = 0.9;
export const STAMP_ROTATION_DEG = -9;
export const STAMP_ASPECT = 0.56;
/** Paper: the share card and the OG image. */
export const PAPER = "#F6F7F4";
/** The stamp width in each medium: the share card (8.1) and the OG image (8.3); 1000 for tests. */
export const STAMP_WIDTH = { svg: 1000, card: 440, og: 470 } as const;
/** The texture's reference width: speck sizes scale with w / 691 (DESIGN.md section 8.2). */
export const TEXTURE_WIDTH = 691;
/** Font family names of the static stamp instances (globals.css @font-face, FontFace, next/og). */
export const STAMP_FONTS: Record<StampFace, string> = {
  wide: "Mizan Stamp Wide",
  condensed: "Mizan Stamp Condensed",
};
export const STAMP_FONT_WEIGHT: Record<StampFace, number> = { wide: 700, condensed: 780 };

const CONTENT_INSET = 0.045; // inner border inset, x w
const CONTENT_SIDE = 0.07; // extra side room for text, x w (0.14w in total)
const RULE_SIDE = 0.06; // the rule's inset from the inner border, x w
/**
 * Row A, the header "FAIRSQUARE [scale] IN LINE": 0.04w with 0.1em tracking, fitted to the rule's span
 * (0.06w in from the inner border on each side, 0.79w) when longer, so the brand, the glyph and the
 * verdict word stay one clear line, never touching the frame.
 */
export const ROW_A = { baseSize: 0.04, lsEm: 0.1, side: RULE_SIDE } as const;
const LABEL_PAD = 0.03; // paper label padding, x w
const GAP_EM = 0.45; // gap between row A items
const DIAMOND_GAP_EM = 0.55; // gap either side of a row D diamond

// ---------- types ----------

export interface RoundRect {
  x: number;
  y: number;
  width: number;
  height: number;
  r: number;
  stroke: number;
}

export type RowItem =
  | { kind: "text"; text: string; x: number; width: number }
  /** The balance-scale glyph: a `size` x `size` box whose left edge is `x`, centred on the row. */
  | { kind: "glyph"; x: number; size: number; stroke: number }
  | { kind: "diamond"; cx: number; r: number };

export interface StampRow {
  id: "a" | "b" | "c" | "d";
  face: StampFace;
  /** Font size in stamp px. */
  size: number;
  /** Letter spacing in stamp px (after every character). */
  letterSpacing: number;
  /** Optical centre of the capitals. */
  cy: number;
  /** Alphabetic baseline: cy + capHeight / 2. */
  baseline: number;
  /** Total ink width of the row. */
  width: number;
  items: RowItem[];
}

export interface StampLayout {
  w: number;
  h: number;
  rotation: number;
  outer: RoundRect;
  inner: RoundRect;
  rule: { x1: number; x2: number; y: number; stroke: number };
  /** The paper label (dark-area rule), in stamp coordinates (it extends past 0..w). */
  label: RoundRect;
  rows: StampRow[];
  /** Rotated bounding box of the label: the size an SVG, canvas or OG container needs. */
  box: { width: number; height: number };
}

/** Text measurement: width of `text` at `size` px with `letterSpacing` px between characters. */
export type Measure = (text: string, face: StampFace, size: number, letterSpacing: number) => number;

export const metricsMeasure: Measure = (text, face, size, ls) => measureStampText(text, face, size, ls);

// ---------- layout ----------

/** The capitals' half height in em, for centring a row on its cy. */
export const CAP_HALF_EM = STAMP_FONT_METRICS.capHeight / STAMP_FONT_METRICS.unitsPerEm / 2;
/** Ascent in em (next/og positions text boxes by their top edge). */
export const ASCENT_EM = STAMP_FONT_METRICS.ascender / STAMP_FONT_METRICS.unitsPerEm;
/** The font's natural line height in em (ascender − descender). */
export const LINE_EM = (STAMP_FONT_METRICS.ascender - STAMP_FONT_METRICS.descender) / STAMP_FONT_METRICS.unitsPerEm;

/** Rotated bounding box of a `width` x `height` rectangle. */
export function rotatedBox(width: number, height: number, deg = STAMP_ROTATION_DEG): { width: number; height: number } {
  const a = (Math.abs(deg) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { width: width * c + height * s, height: width * s + height * c };
}

/** The container size a stamp of width `w` needs (rotated label box). Text-independent. */
export function stampBox(w: number): { width: number; height: number } {
  const p = LABEL_PAD * w;
  return rotatedBox(w + 2 * p, STAMP_ASPECT * w + 2 * p);
}

function contentWidth(w: number): number {
  return w - 2 * CONTENT_INSET * w - 2 * CONTENT_SIDE * w;
}

type Piece =
  | { kind: "text"; text: string }
  | { kind: "glyph" }
  | { kind: "diamond" };

/**
 * Lays out pieces centred on `w / 2`. Sizes scale together with the font size, so a row that is too
 * wide is fitted by one factor (no minimum unless `minSize` is given).
 */
function layoutRow(
  id: StampRow["id"],
  pieces: Piece[],
  opts: {
    w: number;
    face: StampFace;
    baseSize: number;
    minSize?: number;
    lsEm: number;
    cy: number;
    glyphStroke?: number;
    diamondR?: number;
    /** The widest the row may be (default: the content width, 0.77w). */
    maxWidth?: number;
    measure: Measure;
  },
): StampRow {
  const { w, face, lsEm, cy, measure } = opts;
  const maxWidth = opts.maxWidth ?? contentWidth(w);

  const widthAt = (size: number) => {
    const ls = lsEm * size;
    let total = 0;
    pieces.forEach((p, i) => {
      if (p.kind === "text") total += measure(p.text, face, size, ls);
      else if (p.kind === "glyph") total += size;
      else total += 2 * (opts.diamondR ?? 0) * (size / opts.baseSize);
      if (i < pieces.length - 1) {
        const next = pieces[i + 1];
        const gapEm = p.kind === "diamond" || next.kind === "diamond" ? DIAMOND_GAP_EM : GAP_EM;
        total += gapEm * size;
      }
    });
    return total;
  };

  let size = opts.baseSize;
  const natural = widthAt(size);
  if (natural > maxWidth) size = Math.max(opts.minSize ?? 0, (size * maxWidth) / natural);
  const width = widthAt(size);
  const ls = lsEm * size;
  const scale = size / opts.baseSize;

  const items: RowItem[] = [];
  let x = w / 2 - width / 2;
  pieces.forEach((p, i) => {
    if (p.kind === "text") {
      const tw = measure(p.text, face, size, ls);
      items.push({ kind: "text", text: p.text, x, width: tw });
      x += tw;
    } else if (p.kind === "glyph") {
      items.push({ kind: "glyph", x, size, stroke: (opts.glyphStroke ?? 2) * Math.min(1, scale) });
      x += size;
    } else {
      const r = (opts.diamondR ?? 0) * scale;
      items.push({ kind: "diamond", cx: x + r, r });
      x += 2 * r;
    }
    if (i < pieces.length - 1) {
      const next = pieces[i + 1];
      const gapEm = p.kind === "diamond" || next.kind === "diamond" ? DIAMOND_GAP_EM : GAP_EM;
      x += gapEm * size;
    }
  });

  return { id, face, size, letterSpacing: ls, cy, baseline: cy + CAP_HALF_EM * size, width, items };
}

export type StampContent = Pick<StampProps, "header" | "figure" | "lines">;

/** The full stamp layout for a stamp `w` px wide. `measure` defaults to the WOFF metrics. */
export function layoutStamp(content: StampContent, w: number, measure: Measure = metricsMeasure): StampLayout {
  const h = STAMP_ASPECT * w;
  const outerStroke = Math.max(4, w / 50);
  const innerStroke = Math.max(2, w / 160);
  const inset = CONTENT_INSET * w;
  const outer: RoundRect = {
    x: outerStroke / 2,
    y: outerStroke / 2,
    width: w - outerStroke,
    height: h - outerStroke,
    r: w / 18,
    stroke: outerStroke,
  };
  const inner: RoundRect = { x: inset, y: inset, width: w - 2 * inset, height: h - 2 * inset, r: w / 30, stroke: innerStroke };
  const ruleInset = inset + RULE_SIDE * w;
  const rule = { x1: ruleInset, x2: w - ruleInset, y: 0.655 * h, stroke: Math.max(2, w / 200) };
  const p = LABEL_PAD * w;
  const label: RoundRect = { x: -p, y: -p, width: w + 2 * p, height: h + 2 * p, r: w / 18, stroke: 0 };

  const rows: StampRow[] = [];
  rows.push(
    layoutRow(
      "a",
      [{ kind: "text", text: COPY["stamp.brand"] }, { kind: "glyph" }, ...(content.header ? [{ kind: "text" as const, text: content.header }] : [])],
      {
        w,
        face: "wide",
        baseSize: ROW_A.baseSize * w,
        lsEm: ROW_A.lsEm,
        cy: 0.19 * h,
        glyphStroke: innerStroke,
        maxWidth: rule.x2 - rule.x1,
        measure,
      },
    ),
  );
  rows.push(
    layoutRow("b", [{ kind: "text", text: content.figure }], {
      w,
      face: "condensed",
      baseSize: 0.38 * h,
      minSize: 0.2 * h,
      lsEm: 0,
      cy: 0.47 * h,
      measure,
    }),
  );
  if (content.lines.c) {
    rows.push(
      layoutRow("c", [{ kind: "text", text: content.lines.c }], {
        w,
        face: "wide",
        baseSize: 0.046 * w,
        lsEm: 0.06,
        cy: 0.765 * h,
        measure,
      }),
    );
  }
  const dPieces: Piece[] = [];
  content.lines.d.forEach((text, i) => {
    if (i > 0) dPieces.push({ kind: "diamond" });
    dPieces.push({ kind: "text", text });
  });
  rows.push(
    layoutRow("d", dPieces, {
      w,
      face: "wide",
      baseSize: 0.038 * w,
      lsEm: 0.06,
      cy: 0.865 * h,
      diamondR: 0.012 * w,
      measure,
    }),
  );

  return { w, h, rotation: STAMP_ROTATION_DEG, outer, inner, rule, label, rows, box: stampBox(w) };
}

// ---------- shapes as path data (SVG <path d>, canvas Path2D, next/og <svg>) ----------

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The balance-scale glyph in a `size` x `size` box at (x, top). Stroke only. */
export function glyphPath(x: number, top: number, size: number): string {
  const k = size / 20;
  const P = (px: number, py: number) => `${r2(x + px * k)} ${r2(top + py * k)}`;
  return [
    `M${P(10, 1.5)}L${P(10, 18.5)}`, // post
    `M${P(6, 18.5)}L${P(14, 18.5)}`, // foot
    `M${P(2.5, 4.5)}L${P(17.5, 4.5)}`, // beam
    `M${P(2.5, 4.5)}L${P(0.4, 11.5)}M${P(2.5, 4.5)}L${P(4.6, 11.5)}`, // left strings
    `M${P(0, 11.5)}L${P(5, 11.5)}Q${P(2.5, 16)} ${P(0, 11.5)}Z`, // left pan
    `M${P(17.5, 4.5)}L${P(15.4, 11.5)}M${P(17.5, 4.5)}L${P(19.6, 11.5)}`, // right strings
    `M${P(15, 11.5)}L${P(20, 11.5)}Q${P(17.5, 16)} ${P(15, 11.5)}Z`, // right pan
  ].join("");
}

/** A filled diamond separator. */
export function diamondPath(cx: number, cy: number, r: number): string {
  return `M${r2(cx)} ${r2(cy - r)}L${r2(cx + r)} ${r2(cy)}L${r2(cx)} ${r2(cy + r)}L${r2(cx - r)} ${r2(cy)}Z`;
}

/** A rounded rectangle outline. */
export function roundRectPath(rr: Pick<RoundRect, "x" | "y" | "width" | "height" | "r">): string {
  const { x, y, width: w, height: h } = rr;
  const r = Math.min(rr.r, w / 2, h / 2);
  return (
    `M${r2(x + r)} ${r2(y)}H${r2(x + w - r)}A${r2(r)} ${r2(r)} 0 0 1 ${r2(x + w)} ${r2(y + r)}` +
    `V${r2(y + h - r)}A${r2(r)} ${r2(r)} 0 0 1 ${r2(x + w - r)} ${r2(y + h)}` +
    `H${r2(x + r)}A${r2(r)} ${r2(r)} 0 0 1 ${r2(x)} ${r2(y + h - r)}` +
    `V${r2(y + r)}A${r2(r)} ${r2(r)} 0 0 1 ${r2(x + r)} ${r2(y)}Z`
  );
}

/**
 * The transform from stamp coordinates into its box: translate to the box centre, rotate, then
 * move the stamp centre to the origin. SVG `transform` syntax.
 */
export function stampTransform(layout: Pick<StampLayout, "w" | "h" | "box" | "rotation">): string {
  const { w, h, box, rotation } = layout;
  return `translate(${r2(box.width / 2)} ${r2(box.height / 2)}) rotate(${rotation}) translate(${r2(-w / 2)} ${r2(-h / 2)})`;
}

// ---------- texture (8.2) ----------

/** mulberry32: a small seeded PRNG, so the same code always draws the same stamp. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Speck {
  x: number;
  y: number;
  r: number;
  /** Knock-out strength, 0..1. */
  a: number;
}

/**
 * Speckle knock-outs for a stamp `w` wide: w x h / 260 dots (radius 0.6–2.2, alpha 0.35–1, scaled
 * by w/691) and 24 edge-wear voids (radius 2–5) within 0.06w of the outer border.
 */
export function stampSpecks(seed: number, w: number): { specks: Speck[]; wear: Speck[] } {
  const h = STAMP_ASPECT * w;
  const k = w / TEXTURE_WIDTH;
  const rand = mulberry32(seed);
  const count = Math.round((w * h) / 260);
  const specks: Speck[] = [];
  for (let i = 0; i < count; i++) {
    specks.push({ x: rand() * w, y: rand() * h, r: (0.6 + rand() * 1.6) * k, a: 0.35 + rand() * 0.65 });
  }
  return { specks, wear: edgeWear(rand, w, h, k) };
}

/** The 24 edge-wear voids only (the SVG pairs them with its feTurbulence grain). */
export function stampWear(seed: number, w: number): Speck[] {
  return stampSpecks(seed, w).wear;
}

function edgeWear(rand: () => number, w: number, h: number, k: number): Speck[] {
  const band = 0.06 * w;
  const perimeter = 2 * (w + h);
  const out: Speck[] = [];
  for (let i = 0; i < 24; i++) {
    let d = rand() * perimeter;
    const inward = rand() * band;
    const r = (2 + rand() * 3) * k;
    let x: number;
    let y: number;
    if (d < w) {
      x = d;
      y = inward;
    } else if ((d -= w) < h) {
      x = w - inward;
      y = d;
    } else if ((d -= h) < w) {
      x = w - d;
      y = h - inward;
    } else {
      d -= w;
      x = inward;
      y = h - d;
    }
    out.push({ x, y, r, a: 1 });
  }
  return out;
}

/**
 * The SVG grain (8.2): `feTurbulence` fractal noise (baseFrequency 0.9, 2 octaves) thresholded with
 * `feComponentTransfer` to about the canvas speckle density. The noise is generated at
 * 1/`scale` of the 1000-unit viewBox, so one noise cell is about one screen pixel at phone size.
 */
export const SVG_GRAIN = { baseFrequency: 0.9, numOctaves: 2, scale: 6, threshold: 0.3 } as const;

/** feFuncA tableValues for a hard threshold: alpha below `threshold` → 0 (knocked out), else 1. */
export function grainTable(threshold: number = SVG_GRAIN.threshold, steps = 50): string {
  const cut = Math.round(threshold * steps);
  return Array.from({ length: steps }, (_, i) => (i < cut ? "0" : "1")).join(" ");
}

/** feTurbulence seeds are integers; keep them small and positive. */
export function turbulenceSeed(seed: number): number {
  return (seed % 9973) + 1;
}

// ---------- the logo mark on the card and the OG image ----------

/** The mark (`LogoMark`) on its 32-unit grid: the stamp miniature with the balance, stroked in stamp ink. */
export const MARK = {
  size: 32,
  outer: { x: 1, y: 1, width: 30, height: 30, r: 6, stroke: 2 },
  inner: { x: 4, y: 4, width: 24, height: 24, r: 4, stroke: 1 },
  glyph: ["M16 8.5v14", "M12 22.5h8", "M9 11h14", "M9 11l-2.5 6M9 11l2.5 6M23 11l-2.5 6M23 11l2.5 6", "M6 17a3 3 0 0 0 6 0zM20 17a3 3 0 0 0 6 0z"],
  glyphStroke: 1.75,
} as const;

// ---------- the compact ASKING stamp (RESULT_SPEC section 4.3 item 9) ----------

/**
 * The compact stamp the market scale lands on its pin: 92 x 52 on phones, 116 x 65 from 768px; a 2px
 * outer border and a 1px inner one inset 3, radius 4; row A "ASKING" (wide 700, 11px or 13px, tracking
 * 0.14em) over row B, the asking price per sq ft (condensed 780, 20px or 26px, tabular). Rotated -4deg.
 */
export const COMPACT_STAMP = {
  phone: { w: 92, h: 52, a: 11, b: 20, gap: 2 },
  desktop: { w: 116, h: 65, a: 13, b: 26, gap: 3 },
} as const;
export const COMPACT_STAMP_ROTATION_DEG = -4;

export interface CompactStampLayout {
  w: number;
  h: number;
  rotation: number;
  outer: Omit<RoundRect, "stroke"> & { stroke: number };
  inner: Omit<RoundRect, "stroke"> & { stroke: number };
  /** Row A ("ASKING") and row B (the figure), centred on x = w / 2, by alphabetic baseline. */
  rowA: { text: string; size: number; letterSpacingEm: number; baseline: number; x: number };
  rowB: { text: string; size: number; baseline: number; x: number };
}

export function layoutCompactStamp(figure: string, variant: keyof typeof COMPACT_STAMP): CompactStampLayout {
  const s = COMPACT_STAMP[variant];
  return {
    w: s.w,
    h: s.h,
    rotation: COMPACT_STAMP_ROTATION_DEG,
    outer: { x: 1, y: 1, width: s.w - 2, height: s.h - 2, r: 4, stroke: 2 },
    inner: { x: 3.5, y: 3.5, width: s.w - 7, height: s.h - 7, r: 2, stroke: 1 },
    rowA: { text: COPY["scale.stampAsking"], size: s.a, letterSpacingEm: 0.14, baseline: s.h / 2 - s.gap / 2 - s.b * 0.38, x: s.w / 2 },
    rowB: { text: figure, size: s.b, baseline: s.h / 2 + s.gap / 2 + s.b * 0.42, x: s.w / 2 },
  };
}

/** "#3A37C9" + alpha → "rgba(58, 55, 201, 0.9)". */
export function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
