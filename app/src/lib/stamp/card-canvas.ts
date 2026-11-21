/**
 * The share card (RESULT_SPEC section 8.1), client only: a 1080 x 1350 PNG (4:5) that is a Fairsquare
 * document, never the listing screenshot (owner decision, 18 Nov 2026). No adviser offer, no monthly
 * payment, no logos of DLD or the Government of Dubai, no emoji. Nothing here is ever uploaded.
 *
 *   y 56    [mark 40] Fairsquare                       Compared 18 Nov 2026
 *   y 120   ------------------------------------------------------------ 2px hairline
 *   y 152   Aykon City Tower C                                       Newsreader 560 56/64 (46 if longer)
 *   y 224   Ready 2-bed, 812 sq ft, asking AED 1,450,000              Archivo 32/42 pencil
 *   y 300   In line with / registered sales                          Newsreader 520 72/76, figure words in the verdict hue
 *   y 488   Asking, per sq ft / AED 1,786                            Archivo 500 28/36 pencil, 600 80/84 ink semi-condensed
 *   y 628   Median of 43 sales, per sq ft / AED 1,761                the verdict stamp w 440, centre (790, 618), -9deg, multiply
 *   y 788   | Last 90 days: median AED 1,602 per sq ft (11 sales).   4px ink rule, Archivo 500 30/36 (only when triggered)
 *           | Recent sales are lower.
 *   y 892   the mini scale, 952 x 180 (scaleModel's "card" variant)  (no drift: 104px higher)
 *   y 1084  Each dot is one registered sale. Filled: since 18 Aug.
 *   y 1140  ------------------------------------------------------------
 *   y 1160  Registered sales, 16 Nov 2025 to 16 Nov 2026. DLD open data via Data.Dubai. Not a valuation. ...
 *   y 1252  See all 43 sales: fairsquare.example/c/FYZ79D            Archivo 700 30/38 ink
 *
 * Too few sales: "Too few sales / to compare yet", the asking figure, "Registered sales found / 4 of the
 * 5 needed" with 5 tally dots, the TOO FEW stamp, and "Only 4 registered sales of ready 3-beds in this
 * building in 12 months." in place of the scale. Not covered: no card (`renderCard` refuses).
 * Nearby registered sales (the last resort, DESIGN.md section 6.18), for a too-few or a not-covered
 * comparison alike: "Above the range / of nearby sales", the asking figure, "Nearby sales, per sq ft /
 * AED 990 to 1,770", the stamp (ABOVE, the range, "NEARBY REGISTERED SALES"), then one sentence that
 * the range is from other buildings in a named place and what the building itself has, the scale of
 * rings and its caption. The source line names the other buildings too.
 * Output: `fairsquare-{listing-slug}-{code}.png`.
 */
import { acsDates, acsLead, acsShown, basisWord, cardAlt, COPY, listingType, nearbyDates, nearbyPlace, nearbyShown, plainNotCovered, ruleVars, shareFileName, sizeText, stampProps, t, tPlural, verdictHeadOf } from "@/lib/copy";
import { bedsLabelPlural, formatDate, formatInt, formatTimestampDate } from "@/lib/format";
import { acsScale } from "@/lib/result/acs-scale";
import { scaleModel, type ScaleGeometry } from "@/lib/result/scale-model";
import { similarScale, type RangeScaleModel } from "@/lib/result/similar-scale";
import { nearbyScale } from "@/lib/result/nearby-scale";
import { acsSeveral, cardAcsCaption, cardDotsText, cardNearbyCaption, cardRangeCaption } from "@/lib/result/words";
import type { CheckView } from "@/lib/types";
import { canvasToPng, ctx2d, makeCanvas } from "./canvas";
import {
  diamondPath,
  glyphPath,
  layoutStamp,
  MARK,
  PAPER,
  roundRectPath,
  STAMP_FONT_WEIGHT,
  STAMP_FONTS,
  STAMP_INK,
  STAMP_INK_ALPHA,
  STAMP_ROTATION_DEG,
  STAMP_WIDTH,
  stampSpecks,
  type Measure,
  type StampFace,
  type StampLayout,
} from "./geometry";

export { cardAlt };

export interface RenderCardInput {
  check: CheckView;
}

/** The card's size and its printed colours (paper, never the UI theme). */
export const CARD = {
  width: 1080,
  height: 1350,
  margin: 64,
  content: 952,
  stampCentre: { x: 790, y: 618 },
  /** The scale moves up this much when the recent-sales line does not show. */
  noDriftLift: 104,
  /** The footer's hairline and the link's top in the spec layout (2 source lines). */
  footTop: 1140,
  linkTop: 1252,
  /**
   * The link never ends below this (40px of paper under it at least): under a tall scale the footer
   * slides down this far at most, and the scale's dots shrink to fit what is left.
   */
  footBottomMax: 1310,
} as const;

/** The widest the leading range's figure ("AED 1,550 to 1,970") may be: the room left of the stamp. */
const ACS_VALUE_MAX = 450;

/** The footer's inner spacing: hairline to source, source to link, and the link's line. */
const FOOT_SOURCE_GAP = 20;
const FOOT_LINK_GAP = 28;
const FOOT_LINK_H = 38;

const INK = "#17191E";
const PENCIL = "#53646A";
const HAIRLINE = "#D9DCD6";
const BAND = "#E7E4DC";
const RING = "#7A7D85";
const HUE = { above: "#8F4A0A", below: "#1E5B98", inline: INK } as const;

const FONT_TIMEOUT_MS = 2000;

// ---------- fonts ----------

export interface CardFonts {
  /** CSS font-family for Newsreader (next/font) or the serif fallback. */
  serif: string;
  /** CSS font-family for Archivo (next/font) or the system fallback. */
  sans: string;
  wide: string;
  condensed: string;
}

const FALLBACK_FONTS: CardFonts = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: "system-ui, sans-serif",
  wide: "system-ui, sans-serif",
  condensed: '"Arial Narrow", system-ui, sans-serif',
};

function cssFamily(name: string): string | null {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || null;
  } catch {
    return null;
  }
}

function ensureFace(family: string, file: string, weight: number): Promise<unknown> {
  const fonts = document.fonts;
  const known = [...fonts].some((f) => f.family.replace(/["']/g, "") === family);
  if (!known && typeof FontFace === "function") {
    const face = new FontFace(family, `url(/fonts/${file})`, { weight: String(weight) });
    fonts.add(face);
    return face.load();
  }
  return fonts.load(`${weight} 40px "${family}"`);
}

/**
 * Waits for Newsreader 520/560/600, Archivo 400/500/600/700 and the two stamp faces, at most 2 s. On a
 * timeout (or without the Font Loading API) it draws with Georgia, "Arial Narrow" and system-ui instead
 * of blocking.
 */
export async function loadCardFonts(timeoutMs = FONT_TIMEOUT_MS): Promise<CardFonts> {
  if (typeof document === "undefined" || !document.fonts) return FALLBACK_FONTS;
  const serifVar = cssFamily("--font-newsreader");
  const sansVar = cssFamily("--font-archivo");
  const firstSerif = serifVar?.split(",")[0]?.trim();
  const firstSans = sansVar?.split(",")[0]?.trim();
  const loads: Promise<unknown>[] = [
    ensureFace(STAMP_FONTS.wide, "archivo-stamp-wide.woff", STAMP_FONT_WEIGHT.wide),
    ensureFace(STAMP_FONTS.condensed, "archivo-stamp-condensed.woff", STAMP_FONT_WEIGHT.condensed),
  ];
  if (firstSerif) for (const w of [520, 560, 600]) loads.push(document.fonts.load(`${w} 56px ${firstSerif}`));
  if (firstSans) for (const w of [400, 500, 600, 700]) loads.push(document.fonts.load(`${w} 30px ${firstSans}`));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const result = await Promise.race([Promise.all(loads).then(() => "ok" as const, () => "timeout" as const), timeout]);
  clearTimeout(timer);
  if (result === "timeout") return FALLBACK_FONTS;
  return {
    serif: serifVar ? `${serifVar}, ${FALLBACK_FONTS.serif}` : FALLBACK_FONTS.serif,
    sans: sansVar ? `${sansVar}, system-ui, sans-serif` : FALLBACK_FONTS.sans,
    wide: `"${STAMP_FONTS.wide}", ${FALLBACK_FONTS.wide}`,
    condensed: `"${STAMP_FONTS.condensed}", ${FALLBACK_FONTS.condensed}`,
  };
}

// ---------- text helpers ----------

type Ctx = CanvasRenderingContext2D;

function fontFor(face: StampFace, size: number, fonts: CardFonts): string {
  return `${STAMP_FONT_WEIGHT[face]} ${size}px ${face === "wide" ? fonts.wide : fonts.condensed}`;
}

/** Measures with the font actually in use (exact metrics when loaded, the fallback otherwise). */
function canvasMeasure(ctx: Ctx, fonts: CardFonts): Measure {
  return (text, face, size, ls) => {
    ctx.font = fontFor(face, size, fonts);
    const chars = [...text];
    let width = 0;
    for (const ch of chars) width += ctx.measureText(ch).width;
    return width + ls * Math.max(0, chars.length - 1);
  };
}

/** Draws text character by character so letter spacing matches the layout in every browser. */
function drawSpaced(ctx: Ctx, text: string, x: number, y: number, ls: number): void {
  let cx = x;
  for (const ch of [...text]) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + ls;
  }
}

/** Greedy word wrap to `maxWidth`, at most `maxLines` (the last line is ellipsised if needed). */
export function wrapText(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`;
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

/**
 * The alphabetic baseline of a line of `size` px text set in a `lineHeight` box whose top is `top`, as
 * CSS would place it: `k` is about half the cap height plus the face's own offset (Archivo 0.34,
 * Newsreader 0.24, measured against the ShareCard artboard).
 */
const baselineOf = (top: number, lineHeight: number, size: number, k = 0.34) => top + lineHeight / 2 + size * k;
const SERIF_K = 0.24;

interface TextStyle {
  font: string;
  color: string;
  /** canvas `fontStretch` (Archivo's wdth 88 is "semi-condensed"). */
  stretch?: "normal" | "semi-condensed";
  letterSpacing?: string;
  /** The baseline factor (`baselineOf`): Archivo by default, SERIF_K for Newsreader. */
  k?: number;
}

function setStyle(ctx: Ctx, s: TextStyle): void {
  ctx.font = s.font;
  ctx.fillStyle = s.color;
  const c = ctx as Ctx & { fontStretch?: string; letterSpacing?: string };
  if ("fontStretch" in c) c.fontStretch = s.stretch ?? "normal";
  if ("letterSpacing" in c) c.letterSpacing = s.letterSpacing ?? "0px";
}

/** Lines of text from `top`, each `lineHeight` tall; returns the bottom. */
function drawLines(ctx: Ctx, lines: readonly string[], x: number, top: number, lineHeight: number, size: number, style: TextStyle): number {
  setStyle(ctx, style);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  lines.forEach((line, i) => ctx.fillText(line, x, baselineOf(top + i * lineHeight, lineHeight, size, style.k)));
  return top + lines.length * lineHeight;
}

// ---------- the stamp ----------

function applyStampTransform(ctx: Ctx, layout: StampLayout): void {
  ctx.translate(layout.box.width / 2, layout.box.height / 2);
  ctx.rotate((STAMP_ROTATION_DEG * Math.PI) / 180);
  ctx.translate(-layout.w / 2, -layout.h / 2);
}

function inkCanvas(layout: StampLayout, seed: number, fonts: CardFonts): HTMLCanvasElement {
  const { box, w } = layout;
  const c = makeCanvas(box.width, box.height);
  const ctx = ctx2d(c);
  applyStampTransform(ctx, layout);
  ctx.fillStyle = STAMP_INK;
  ctx.strokeStyle = STAMP_INK;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.lineWidth = layout.outer.stroke;
  ctx.stroke(new Path2D(roundRectPath(layout.outer)));
  ctx.lineWidth = layout.inner.stroke;
  ctx.stroke(new Path2D(roundRectPath(layout.inner)));
  ctx.lineWidth = layout.rule.stroke;
  ctx.beginPath();
  ctx.moveTo(layout.rule.x1, layout.rule.y);
  ctx.lineTo(layout.rule.x2, layout.rule.y);
  ctx.stroke();

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const row of layout.rows) {
    ctx.font = fontFor(row.face, row.size, fonts);
    for (const item of row.items) {
      if (item.kind === "text") drawSpaced(ctx, item.text, item.x, row.baseline, row.letterSpacing);
      else if (item.kind === "glyph") {
        ctx.lineWidth = item.stroke;
        ctx.stroke(new Path2D(glyphPath(item.x, row.cy - item.size / 2, item.size)));
      } else ctx.fill(new Path2D(diamondPath(item.cx, row.cy, item.r)));
    }
  }

  // Speckle knock-out and edge wear (DESIGN.md section 8.2), seeded from the code.
  const { specks, wear } = stampSpecks(seed, w);
  ctx.globalCompositeOperation = "destination-out";
  for (const s of [...specks, ...wear]) {
    ctx.fillStyle = `rgba(0, 0, 0, ${s.a})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  return c;
}

/** The verdict stamp, w 440, centred on `centre`, -9deg, multiplied onto the paper. */
function drawVerdictStamp(ctx: Ctx, check: CheckView, centre: { x: number; y: number }, fonts: CardFonts): void {
  const props = stampProps(check);
  const layout = layoutStamp(props, STAMP_WIDTH.card, canvasMeasure(ctx2d(makeCanvas(1, 1)), fonts));
  const ink = inkCanvas(layout, props.seed, fonts);
  ctx.save();
  ctx.globalAlpha = STAMP_INK_ALPHA;
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(ink, centre.x - layout.box.width / 2, centre.y - layout.box.height / 2);
  ctx.restore();
}

// ---------- parts ----------

function drawMark(ctx: Ctx, x: number, y: number, size: number): void {
  const k = size / MARK.size;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.strokeStyle = STAMP_INK;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = MARK.outer.stroke;
  ctx.stroke(new Path2D(roundRectPath(MARK.outer)));
  ctx.lineWidth = MARK.inner.stroke;
  ctx.stroke(new Path2D(roundRectPath(MARK.inner)));
  ctx.lineWidth = MARK.glyphStroke;
  for (const d of MARK.glyph) ctx.stroke(new Path2D(d));
  ctx.restore();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The headline's two lines: the figure words (with "with" in line) over the rest, or the too-few heading wrapped. */
function headlineLines(check: CheckView): { figure: string | null; line1Rest: string; line2: string } {
  // "Within the range" over "of adjusted sales" when registered sales adjusted to the listing lead.
  const { figure, rest } = verdictHeadOf(check);
  if (figure) {
    const withWord = /^with\s/.exec(rest);
    return { figure, line1Rest: withWord ? " with" : "", line2: withWord ? rest.slice(withWord[0].length) : rest };
  }
  // "Too few sales" / "to compare yet".
  const at = rest.indexOf(" to ");
  return at > 0 ? { figure: null, line1Rest: rest.slice(0, at), line2: rest.slice(at + 1) } : { figure: null, line1Rest: rest, line2: "" };
}

/** The mini scale (section 8.1): 952 x 180 at (x, top), from the card variant of `scaleModel`. */
function drawMiniScale(ctx: Ctx, g: ScaleGeometry, askLabel: string, medianFigure: string, x: number, top: number, fonts: CardFonts): void {
  ctx.save();
  ctx.translate(x, top);
  const W = g.width;

  // The in-line zone, drawn first.
  ctx.fillStyle = BAND;
  ctx.fillRect(g.zone.x0, g.zone.y0, g.zone.x1 - g.zone.x0, g.zone.y1 - g.zone.y0);
  ctx.fillStyle = HAIRLINE;
  ctx.fillRect(g.zone.x0 - 0.75, g.zone.y0, 1.5, g.zone.y1 - g.zone.y0);
  ctx.fillRect(g.zone.x1 - 0.75, g.zone.y0, 1.5, g.zone.y1 - g.zone.y0);

  // The pin, with a paper halo, behind the dots.
  ctx.fillStyle = PAPER;
  ctx.fillRect(g.pin.x - 3.5, g.pin.y0, 7, g.pin.y1 - g.pin.y0);
  ctx.fillStyle = STAMP_INK;
  ctx.fillRect(g.pin.x - 1.25, g.pin.y0, 2.5, g.pin.y1 - g.pin.y0);

  // One dot per sale: filled ink for the last 90 days, a hollow ring for earlier sales.
  for (const d of g.dots) {
    ctx.beginPath();
    if (d.recent) {
      ctx.arc(d.cx, d.cy, d.r, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    } else {
      ctx.arc(d.cx, d.cy, d.r - 1, 0, Math.PI * 2);
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = RING;
      ctx.stroke();
    }
  }

  // The axis (2px), the ticks hanging 8px, the median fulcrum (18 x 12) and the indigo diamond.
  ctx.fillStyle = INK;
  ctx.fillRect(16, g.axisY, W - 32, 2);
  for (const tk of g.ticks) {
    const tx = Math.min(W - 17, Math.max(17, tk.x));
    ctx.fillRect(tx - 1, g.axisY + 2, 2, 8);
  }
  const f = g.fulcrum;
  ctx.beginPath();
  ctx.moveTo(f.x, g.axisY + 2);
  ctx.lineTo(f.x + f.w / 2, g.axisY + 2 + f.h);
  ctx.lineTo(f.x - f.w / 2, g.axisY + 2 + f.h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = STAMP_INK;
  ctx.fill(new Path2D(diamondPath(g.diamond.x, g.axisY + 1, g.diamond.size / 2)));

  // "Asking 1,786" 8px right of the pin (left of it when it would run off the edge).
  setStyle(ctx, { font: `700 30px ${fonts.sans}`, color: STAMP_INK });
  ctx.textBaseline = "alphabetic";
  const askW = ctx.measureText(askLabel).width;
  const right = g.pin.x + 8 + askW <= W;
  ctx.textAlign = right ? "left" : "right";
  ctx.fillText(askLabel, right ? g.pin.x + 8 : g.pin.x - 8, 32);

  // The label lane: "Median 1,761" centred on the fulcrum, the visible tick labels.
  const base = g.labelTop + 27;
  setStyle(ctx, { font: `400 26px ${fonts.sans}`, color: PENCIL });
  const wordW = ctx.measureText(COPY["scale.median"]).width;
  ctx.font = `600 34px ${fonts.sans}`;
  const figW = ctx.measureText(medianFigure).width;
  const total = wordW + 10 + figW;
  const left = Math.max(0, Math.min(W - total, g.median.x - total / 2));
  ctx.textAlign = "left";
  setStyle(ctx, { font: `400 26px ${fonts.sans}`, color: PENCIL });
  ctx.fillText(COPY["scale.median"], left, base);
  setStyle(ctx, { font: `600 34px ${fonts.sans}`, color: INK });
  ctx.fillText(medianFigure, left + wordW + 10, base);
  setStyle(ctx, { font: `400 26px ${fonts.sans}`, color: PENCIL });
  for (const tk of g.ticks) {
    if (!tk.visible) continue;
    const label = formatInt(tk.value);
    if (tk.label.align === "right") {
      ctx.textAlign = "right";
      ctx.fillText(label, W - 16, base);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(label, tk.x, base);
    }
  }
  ctx.restore();
}

/** Five 20px tally dots: filled for each sale found, hollow for each still needed. */
function drawTally(ctx: Ctx, count: number, min: number, x: number, top: number): void {
  for (let i = 0; i < min; i++) {
    ctx.beginPath();
    const cx = x + 10 + i * 32;
    if (i < count) {
      ctx.arc(cx, top + 10, 10, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    } else {
      ctx.arc(cx, top + 10, 9, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = RING;
      ctx.stroke();
    }
  }
}

/**
 * The range scale of the second tier (similar-scale.ts, the "card" variant) at (x, top): the shaded
 * range with dashed ends and its two figures, a ring per similar building, a filled dot per sale of
 * this building, the asking pin. No stamp, no median.
 */
function drawRangeScale(ctx: Ctx, g: RangeScaleModel, askLabel: string, x: number, top: number, fonts: CardFonts): void {
  ctx.save();
  ctx.translate(x, top);
  const W = g.width;

  ctx.fillStyle = BAND;
  ctx.fillRect(g.zone.x0, g.zone.y0, Math.max(2, g.zone.x1 - g.zone.x0), g.zone.y1 - g.zone.y0);
  ctx.fillStyle = RING;
  for (const zx of [g.zone.x0, g.zone.x1]) for (let y = g.zone.y0; y < g.zone.y1; y += 12) ctx.fillRect(zx - 1, y, 2, Math.min(6, g.zone.y1 - y));

  ctx.fillStyle = PAPER;
  ctx.fillRect(g.pin.x - 3.5, g.pin.y0, 7, g.pin.y1 - g.pin.y0);
  ctx.fillStyle = STAMP_INK;
  ctx.fillRect(g.pin.x - 1.25, g.pin.y0, 2.5, g.pin.y1 - g.pin.y0);

  for (const mk of g.marks) {
    ctx.beginPath();
    if (mk.kind === "own") {
      ctx.arc(mk.cx, mk.cy, mk.r, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    } else {
      ctx.arc(mk.cx, mk.cy, mk.r - 1, 0, Math.PI * 2);
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = RING;
      ctx.stroke();
    }
  }

  ctx.fillStyle = INK;
  ctx.fillRect(16, g.axisY, W - 32, 2);
  ctx.fillRect(g.zone.x0 - 1, g.axisY + 2, 2, 8);
  ctx.fillRect(g.zone.x1 - 1, g.axisY + 2, 2, 8);
  ctx.fillStyle = STAMP_INK;
  ctx.fill(new Path2D(diamondPath(g.pin.x, g.axisY + 1, 6)));

  setStyle(ctx, { font: `700 30px ${fonts.sans}`, color: STAMP_INK });
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = g.askLabel.side === "right" ? "left" : "right";
  ctx.fillText(askLabel, g.askLabel.x, 32);

  const base = g.labelTop + 30;
  setStyle(ctx, { font: `600 34px ${fonts.sans}`, color: INK });
  ctx.textAlign = "center";
  if (g.ends.joined) {
    ctx.fillText(t("similar.endsJoined", { low: formatInt(g.low), high: formatInt(g.high) }), g.ends.joined.left + g.ends.joined.width / 2, base);
  } else {
    ctx.fillText(formatInt(g.low), g.ends.low.left + g.ends.low.width / 2, base);
    ctx.fillText(formatInt(g.high), g.ends.high.left + g.ends.high.width / 2, base);
  }
  setStyle(ctx, { font: `400 26px ${fonts.sans}`, color: PENCIL });
  for (const tk of g.ticks) if (tk.visible) ctx.fillText(formatInt(tk.value), tk.left + tk.width / 2, base);
  ctx.restore();
}

/** The most sales a too-few card lists (a too-few comparison has fewer than the minimum, 5 by default). */
const CARD_SALE_ROWS = 4;

/**
 * The too-few card's registered sales, newest first, one row each under a hairline: the date, the
 * size, the price, and AED per sq ft on the right. Returns the bottom.
 */
function drawSaleRows(ctx: Ctx, check: CheckView, x: number, top: number, width: number, fonts: CardFonts): number {
  const rows = check.sales.slice(0, CARD_SALE_ROWS);
  ctx.textBaseline = "alphabetic";
  rows.forEach((s, i) => {
    const y = top + i * 52;
    ctx.fillStyle = HAIRLINE;
    ctx.fillRect(x, y, width, 2);
    const base = baselineOf(y + 2, 50, 28);
    setStyle(ctx, { font: `400 28px ${fonts.sans}`, color: INK });
    ctx.textAlign = "left";
    ctx.fillText(formatDate(s.saleDate), x, base);
    ctx.fillText(`${formatInt(s.sizeSqft)} ${COPY["field.sqft"]}`, x + 250, base);
    ctx.fillText(`${COPY["field.aed"]} ${formatInt(s.priceAed)}`, x + 450, base);
    setStyle(ctx, { font: `600 28px ${fonts.sans}`, color: INK });
    ctx.textAlign = "right";
    ctx.fillText(t("result.rowPsf", { psf: formatInt(s.psf) }), x + width, base);
  });
  ctx.textAlign = "left";
  return top + rows.length * 52;
}

/**
 * The footer link on one line, never cut: the full sentence at 30px or 26px, else the link alone
 * (`card.linkShort`) at 30, 26 or 22px, so the code always shows however long the host name is.
 */
export function fitCardLink(ctx: Ctx, full: string, short: string, maxWidth: number, family: string): { text: string; size: number } {
  const tries: Array<[string, number]> = [[full, 30], [full, 26], [short, 30], [short, 26], [short, 22]];
  for (const [text, size] of tries) {
    ctx.font = `700 ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return { text, size };
  }
  // A host longer than the card: keep its end and the code.
  ctx.font = `700 22px ${family}`;
  let cut = short;
  while (cut.length > 8 && ctx.measureText(`…${cut}`).width > maxWidth) cut = cut.slice(1);
  return { text: `…${cut}`, size: 22 };
}

function drawCard(ctx: Ctx, check: CheckView, fonts: CardFonts): void {
  const a = check.analysis;
  const M = CARD.margin;
  const content = CARD.content;
  // The last resort: a range of nearby registered sales takes the place of the too-few card (and gives a not-covered comparison a card).
  const near = nearbyShown(check);
  const thin = a.band === "thin" && !near;
  const rv = ruleVars(check.rules);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD.width, CARD.height);

  // The header: the mark and the wordmark, the comparison date on the right, the hairline.
  drawMark(ctx, M, 56, 40);
  setStyle(ctx, { font: `600 36px ${fonts.serif}`, color: INK, letterSpacing: "-0.36px" });
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(COPY["og.brand"], M + 54, 76 + 36 * SERIF_K);
  setStyle(ctx, { font: `400 28px ${fonts.sans}`, color: PENCIL });
  ctx.textAlign = "right";
  ctx.fillText(t("card.compared", { date: formatTimestampDate(check.createdAt) }), M + content, 76 + 10);
  ctx.fillStyle = HAIRLINE;
  ctx.fillRect(M, 120, content, 2);

  // The building as the listing names it: 56/64 on one line, 46 when longer (two lines at most).
  let dy = 0;
  setStyle(ctx, { font: `560 56px ${fonts.serif}`, color: INK, letterSpacing: "-0.56px" });
  if (ctx.measureText(check.buildingText).width <= content) {
    drawLines(ctx, [check.buildingText], M, 152, 64, 56, { font: `560 56px ${fonts.serif}`, color: INK, letterSpacing: "-0.56px", k: SERIF_K });
  } else {
    const style: TextStyle = { font: `560 46px ${fonts.serif}`, color: INK, letterSpacing: "-0.46px", k: SERIF_K };
    setStyle(ctx, style);
    const lines = wrapText(ctx, check.buildingText, content, 2);
    drawLines(ctx, lines, M, 152, 52, 46, style);
    dy = lines.length > 1 ? 40 : 0;
  }

  // "Ready 2-bed, 812 sq ft, asking AED 1,450,000" ("2-bed, ..." when the listing didn't say ready or off-plan).
  const listing = t("card.listing", {
    listingType: capitalise(listingType(check)),
    size: sizeText(check),
    price: formatInt(check.priceAed),
  });
  setStyle(ctx, { font: `400 32px ${fonts.sans}`, color: PENCIL });
  drawLines(ctx, wrapText(ctx, listing, content, 1), M, 224 + dy, 42, 32, { font: `400 32px ${fonts.sans}`, color: PENCIL });

  // The verdict, its figure words in the verdict hue.
  const head = headlineLines(check);
  const serif72 = `520 72px ${fonts.serif}`;
  const tone = verdictHeadOf(check).tone;
  const hue = tone === "above" || tone === "below" || tone === "inline" ? HUE[tone] : INK;
  // Registered sales adjusted to this listing (DESIGN.md section 6.17): leading, or under "Too few sales".
  const lead = acsLead(check);
  const acs = acsShown(check);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const l1 = baselineOf(300 + dy, 76, 72, SERIF_K);
  let x = M;
  if (head.figure) {
    setStyle(ctx, { font: serif72, color: hue, letterSpacing: "-1.08px" });
    ctx.fillText(head.figure, x, l1);
    x += ctx.measureText(head.figure).width;
  }
  setStyle(ctx, { font: serif72, color: INK, letterSpacing: "-1.08px" });
  if (head.line1Rest) ctx.fillText(head.line1Rest, x, l1);
  if (head.line2) ctx.fillText(head.line2, M, baselineOf(376 + dy, 76, 72, SERIF_K));

  // The two figures (too few: the asking figure and the sales found, with the tally).
  const label: TextStyle = { font: `500 28px ${fonts.sans}`, color: PENCIL };
  const figure: TextStyle = { font: `600 80px ${fonts.sans}`, color: INK, stretch: "semi-condensed", letterSpacing: "-0.8px" };
  drawLines(ctx, [COPY["card.asking"]], M, 488 + dy, 36, 28, label);
  drawLines(ctx, [`AED ${formatInt(a.askingPsf)}`], M, 524 + dy, 84, 80, figure);
  if (thin) {
    drawLines(ctx, [COPY["card.found"]], M, 628 + dy, 36, 28, label);
    drawLines(ctx, [t("card.foundValue", { count: a.count, minSales: check.rules.minSales })], M, 664 + dy, 52, 44, { ...figure, font: `600 44px ${fonts.sans}`, letterSpacing: "0px" });
    drawTally(ctx, a.count, check.rules.minSales, M, 728 + dy);
  } else if (lead || near) {
    // The range in place of the median, fitted to the room left of the stamp.
    drawLines(ctx, [COPY[near ? "nearby.cardRange" : "acs.cardRange"]], M, 628 + dy, 36, 28, label);
    const shownRange = (near ?? lead) as { rangeLowPsf: number; rangeHighPsf: number };
    const value = t(near ? "nearby.cardRangeValue" : "acs.cardRangeValue", { low: formatInt(shownRange.rangeLowPsf), high: formatInt(shownRange.rangeHighPsf) });
    let size = 80;
    for (const s of [80, 72, 64, 56, 48, 40]) {
      size = s;
      setStyle(ctx, { ...figure, font: `600 ${s}px ${fonts.sans}`, letterSpacing: `${-s / 100}px` });
      if (ctx.measureText(value).width <= ACS_VALUE_MAX) break;
    }
    drawLines(ctx, [value], M, 664 + dy, 84, size, { ...figure, font: `600 ${size}px ${fonts.sans}`, letterSpacing: `${-size / 100}px` });
  } else if (a.medianPsf !== null) {
    drawLines(ctx, [t("card.median", { n: a.count })], M, 628 + dy, 36, 28, label);
    drawLines(ctx, [`AED ${formatInt(a.medianPsf)}`], M, 664 + dy, 84, 80, figure);
  }

  // The verdict stamp, printed (multiply), never animated.
  drawVerdictStamp(ctx, check, { x: CARD.stampCentre.x, y: CARD.stampCentre.y + dy }, fonts);

  // The footer, measured first: the hairline, the source (2 lines, 3 at most) and the link. It sits at
  // y 1140 and slides down under a taller scale, but its link never ends below CARD.footBottomMax: the
  // mini scale shrinks its dots to fit the room above it instead.
  const sourceStyle: TextStyle = { font: `400 26px ${fonts.sans}`, color: PENCIL };
  setStyle(ctx, sourceStyle);
  // A card that draws the adjusted sales (leading, or under "Too few sales") names those sales: the
  // dates they run between as the page gives them, the date they were adjusted to, and the project's
  // other buildings when their sales are used. Any other card names the 12-month window.
  const acsSpan = acs ? acsDates(acs) : null;
  const nearSpan = near ? nearbyDates(near) : null;
  const sourceText =
    near && nearSpan
      ? t("nearby.cardSource", { place: nearbyPlace(near), from: formatDate(nearSpan.from), to: formatDate(nearSpan.last), date: formatDate(near.dataThrough) })
      : acs && acsSpan
      ? t(acs.evidence.projectSales > 0 ? "acs.cardSourceProject" : "acs.cardSource", { from: formatDate(acsSpan.from), to: formatDate(acsSpan.last), date: formatDate(acs.dataThrough) })
      : t("card.source", { from: formatDate(a.windowStart), to: formatDate(a.windowEnd) });
  const source = wrapText(ctx, sourceText, content, 3);
  const footTopMax = CARD.footBottomMax - (FOOT_SOURCE_GAP + source.length * 32 + FOOT_LINK_GAP + FOOT_LINK_H);
  const footTopMin = Math.min(CARD.footTop, footTopMax);

  // The recent-sales line when it triggers, then the mini scale; too few: the count sentence instead.
  let model = thin || lead || near ? null : scaleModel(check, CARD.content, { variant: "card" });
  const recent = model && model.recent.trigger && model.recent.medianPsf !== null && model.recent.direction ? model.recent : null;
  let scaleTop = 892 + dy;
  if (recent) {
    ctx.fillStyle = INK;
    ctx.fillRect(M, 788 + dy, 4, 72);
    const style: TextStyle = { font: `500 30px ${fonts.sans}`, color: INK };
    drawLines(
      ctx,
      [
        t("card.recent", { m: formatInt(recent.medianPsf as number), n: recent.count }),
        COPY[recent.direction === "lower" ? "card.recentLower" : "card.recentHigher"],
      ],
      M + 24,
      788 + dy,
      36,
      30,
      style,
    );
  } else {
    scaleTop -= CARD.noDriftLift;
  }
  let below = scaleTop;
  if (near) {
    // One sentence first: the range is from other buildings, named, and what this building has. Then
    // the scale of rings and its caption (the caption goes when the room is short).
    const range = nearbyScale(check, CARD.content, { variant: "card" });
    const noteStyle: TextStyle = { font: `500 28px ${fonts.sans}`, color: INK };
    setStyle(ctx, noteStyle);
    const note = wrapText(ctx, t(near.kind === "in" ? "nearby.cardNoteIn" : "nearby.cardNoteOut", { place: nearbyPlace(near) }), content, 2);
    let top = drawLines(ctx, note, M, 784 + dy, 36, 28, noteStyle) + 12;
    below = top;
    if (range) {
      const captionStyle: TextStyle = { font: `400 26px ${fonts.sans}`, color: PENCIL };
      setStyle(ctx, captionStyle);
      const caption = wrapText(ctx, cardNearbyCaption(range), content, 1);
      drawRangeScale(ctx, range, t("card.askingLabel", { asking: formatInt(range.ask) }), M, top, fonts);
      top += Math.ceil(range.height);
      below = top + 10 + 32 + 16 <= footTopMax ? drawLines(ctx, caption, M, top + 10, 32, 26, captionStyle) : top;
    }
  } else if (lead) {
    // The leading range: its label, the scale of adjusted registered sales and one caption line.
    const range = acsScale(check, CARD.content, { variant: "card" });
    if (range) {
      const captionStyle: TextStyle = { font: `400 26px ${fonts.sans}`, color: PENCIL };
      setStyle(ctx, captionStyle);
      const caption = wrapText(ctx, cardAcsCaption(range, acsSeveral(lead)), content, 1);
      let top = 796 + dy;
      top = drawLines(ctx, [COPY["acs.cardLabel"]], M, top, 36, 28, { font: `500 28px ${fonts.sans}`, color: PENCIL }) + 8;
      drawRangeScale(ctx, range, t("card.askingLabel", { asking: formatInt(range.ask) }), M, top, fonts);
      below = drawLines(ctx, caption, M, top + Math.ceil(range.height) + 10, 32, 26, captionStyle);
    }
  } else if (model) {
    // The caption ("Each dot is one registered sale. Filled: since 18 Aug.", or its variants).
    const captionStyle: TextStyle = { font: `400 26px ${fonts.sans}`, color: PENCIL };
    setStyle(ctx, captionStyle);
    const caption = wrapText(ctx, cardDotsText(model), content, 2);
    // The most height the scale may take: the caption 12px under it and 16px above the lowest footer.
    const room = footTopMax - 16 - caption.length * 32 - 12 - scaleTop;
    if (model.geometry.exactHeight > room) model = scaleModel(check, CARD.content, { variant: "card", maxHeight: room }) ?? model;
    drawMiniScale(ctx, model.geometry, t("card.askingLabel", { asking: formatInt(model.ask) }), formatInt(model.median), M, scaleTop, fonts);
    // 12px under the scale (180 tall with 5 dots in the tallest column; taller with more, up to the room).
    const captionTop = scaleTop + Math.max(Math.ceil(model.geometry.height) + 12, Math.min(192, Math.floor(room) + 12));
    below = drawLines(ctx, caption, M, captionTop, 32, 26, captionStyle);
  } else if (thin) {
    const style: TextStyle = { font: `400 30px ${fonts.sans}`, color: INK };
    setStyle(ctx, style);
    const vars = { basis: basisWord(a.completionBasis), bedTypePlural: bedsLabelPlural(check.bedrooms), months: rv.months };
    const sentence = wrapText(ctx, a.count === 0 ? t("card.thinZero", vars) : tPlural("card.thinLine", a.count, vars), content, 3);
    // Adjusted registered sales when they give a range, else the second tier's.
    const acsRange = acs ? acsScale(check, CARD.content, { variant: "card" }) : null;
    const range = acsRange ?? similarScale(check, CARD.content, { variant: "card" });
    if (range) {
      // The second tier: its label, the range scale and one caption line. Weaker than a verdict card:
      // no stamp of its own, no percentage. When the building's name took two lines there is no room
      // for the sentence above it; the tally already says it.
      const captionStyle: TextStyle = { font: `400 26px ${fonts.sans}`, color: PENCIL };
      setStyle(ctx, captionStyle);
      const caption = wrapText(ctx, acsRange && acs ? cardAcsCaption(range, acsSeveral(acs)) : cardRangeCaption(check, range), content, 1);
      const need = 20 + 36 + 8 + Math.ceil(range.height) + 10 + 32 + 16;
      const withSentence = 788 + dy + sentence.length * 36 + need <= footTopMax;
      let top = 788 + dy;
      if (withSentence) top = drawLines(ctx, sentence, M, top, 36, 30, style) + 20;
      top = drawLines(ctx, [COPY[acsRange ? "acs.cardLabel" : "similar.cardLabel"]], M, top, 36, 28, { font: `500 28px ${fonts.sans}`, color: PENCIL }) + 8;
      drawRangeScale(ctx, range, t("card.askingLabel", { asking: formatInt(range.ask) }), M, top, fonts);
      below = drawLines(ctx, caption, M, top + Math.ceil(range.height) + 10, 32, 26, captionStyle);
    } else {
      below = drawLines(ctx, sentence, M, 788 + dy, 36, 30, style);
      // No range: the registered sales that were found, so the card's middle is evidence, not paper.
      if (check.sales.length > 0) {
        below = drawSaleRows(ctx, check, M, below + 28, content, fonts);
        ctx.fillStyle = HAIRLINE;
        ctx.fillRect(M, below, content, 2);
      }
    }
  }

  // The footer: never over what is above it, never below CARD.footBottomMax.
  const footTop = Math.min(footTopMax, Math.max(footTopMin, below + 16));
  ctx.fillStyle = HAIRLINE;
  ctx.fillRect(M, footTop, content, 2);
  const sourceBottom = drawLines(ctx, source, M, footTop + FOOT_SOURCE_GAP, 32, 26, sourceStyle);
  const link = near
    ? t("nearby.cardLink", { n: formatInt(near.comparablesTotal), host: hostOf(check.url), code: check.code })
    : acs
    ? t("acs.cardLink", { n: acs.evidence.sales, host: hostOf(check.url), code: check.code })
    : a.count > 0
      ? t("card.link", { n: a.count, host: hostOf(check.url), code: check.code })
      : t("card.linkOnly", { host: hostOf(check.url), code: check.code });
  const fitted = fitCardLink(ctx, link, t("card.linkShort", { host: hostOf(check.url), code: check.code }), content, fonts.sans);
  const linkStyle: TextStyle = { font: `700 ${fitted.size}px ${fonts.sans}`, color: INK };
  drawLines(ctx, [fitted.text], M, Math.max(CARD.linkTop, sourceBottom + FOOT_LINK_GAP), FOOT_LINK_H, fitted.size, linkStyle);
}

// ---------- public ----------

/** Renders the share card PNG. Client only. A not-covered comparison has no card. */
export async function renderCard({ check }: RenderCardInput): Promise<File> {
  if (plainNotCovered(check)) throw new Error("renderCard: a not-covered comparison has no card");
  const fonts = await loadCardFonts();
  const canvas = makeCanvas(CARD.width, CARD.height);
  const ctx = ctx2d(canvas);
  drawCard(ctx, check, fonts);
  const blob = await canvasToPng(canvas);
  return new File([blob], shareFileName(check), { type: "image/png" });
}
