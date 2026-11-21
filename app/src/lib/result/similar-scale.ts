/**
 * The range scale of the second tier (DESIGN.md section 6.16, REAL_DATA.md section 15): the market
 * scale's axis in a weaker form, for a comparison that has no same-building verdict. Pure and
 * client-safe; the page (range-scale.tsx) and the share card (card-canvas.ts) draw what it returns.
 *
 * - The shaded zone is the stored range (`similar.rangeLowPsf` to `similar.rangeHighPsf`), with its
 *   two ends labelled. There is no median mark and no fulcrum: the range has no middle figure.
 * - A hollow ring is one other building at the median of its registered sales (`similar.comparables`);
 *   when a column would grow past the lane, one ring stands for up to `per` buildings (a column of
 *   n buildings draws ceil(n / per) rings, so a ring can stand for fewer: the legend says "up to").
 * - A filled dot is one registered sale of this building (`check.sales`, 1 to 4 of them).
 * - The asking price is a plain pin with a diamond on the axis. No stamp.
 * A similar building far from the range (under 1/1.6 of its low end or over 1.6 times its high end)
 * is not drawn, so the range keeps its width on a phone; `offScale` counts those, and the legend says so.
 */
import type { IsoDate } from "@/lib/domain/dates";
import { shownSimilar } from "@/lib/similar/shown";
import type { CheckView } from "@/lib/types";
import { PLOT_INSET, scaleDomain, scaleX, tickValues } from "./scale-model";

export type RangeVariant = "phone" | "desktop" | "card";

export const RANGE_METRICS: Readonly<Record<RangeVariant, { width: number; dot: number; askLane: number; maxLevels: number; minLevels: number; axis: number; labelLane: number; endLabel: number; tickLabel: number; diamond: number }>> =
  Object.freeze({
    phone: { width: 358, dot: 7, askLane: 26, maxLevels: 6, minLevels: 3, axis: 1, labelLane: 26, endLabel: 46, tickLabel: 36, diamond: 6 },
    desktop: { width: 576, dot: 9, askLane: 28, maxLevels: 6, minLevels: 3, axis: 1, labelLane: 28, endLabel: 52, tickLabel: 36, diamond: 6 },
    card: { width: 952, dot: 16, askLane: 48, maxLevels: 5, minLevels: 3, axis: 2, labelLane: 44, endLabel: 96, tickLabel: 70, diamond: 12 },
  });

/** A similar building further than this factor from the range's ends is left off the scale. */
export const RANGE_REACH = 1.6;
const GAP = 4;
const CLEARANCE = 8;

export type RangeScaleCheck = Pick<CheckView, "similar" | "analysis" | "sales">;

export interface RangeMark {
  cx: number;
  cy: number;
  r: number;
  /** "own": one registered sale of this building (filled). "other": similar buildings at their median (a ring). */
  kind: "own" | "other";
  /** AED per sq ft: the sale's, or the median of the ring's buildings. */
  psf: number;
  /** Indices into `check.sales` ("own") or `similar.comparables` ("other"). */
  items: number[];
}

export interface RangeLabel {
  value: number;
  x: number;
  left: number;
  width: number;
  visible: boolean;
}

export interface RangeScaleModel {
  variant: RangeVariant;
  width: number;
  height: number;
  low: number;
  high: number;
  ask: number;
  verdict: "above" | "within" | "below";
  domain: [number, number];
  /** The top of the axis line. */
  axisY: number;
  zone: { x0: number; x1: number; y0: number; y1: number };
  pin: { x: number; y0: number; y1: number };
  /** The "Asking 1,890" label: on the pin's right, or on its left when the pin is far right. */
  askLabel: { side: "left" | "right"; x: number };
  labelTop: number;
  /** The range's two end labels; `joined` when they would touch (one label "1,720 to 1,980" at `mid`). */
  ends: { low: RangeLabel; high: RangeLabel; joined: { left: number; width: number } | null };
  ticks: RangeLabel[];
  dot: { d: number; r: number; pitch: number };
  marks: RangeMark[];
  /** Mark indices in price order (the keyboard's order). */
  order: number[];
  /** How many similar buildings one ring stands for at most (1: one ring, one building). */
  per: number;
  /** Similar buildings drawn, and those left off the scale. */
  others: number;
  offScale: number;
  /** Set when fewer buildings are stored than the range read: how many are stored (`shown`) of how many (`of`). */
  capped: { shown: number; of: number } | null;
  own: number;
  /** The lowest and highest median among the similar buildings drawn; null with none. */
  othersSpan: { lo: number; hi: number } | null;
  /** The newest own sale's date, for nothing but tests and summaries. */
  ownNewest: IsoDate | null;
}

const middle = (sorted: readonly number[]) => (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;

/** The range scale of a comparison's second tier, or null when no range shows. */
export function similarScale(check: RangeScaleCheck, width?: number, opts: { variant?: RangeVariant } = {}): RangeScaleModel | null {
  const s = shownSimilar(check.similar);
  if (!s) return null;
  const low = s.rangeLowPsf;
  const high = s.rangeHighPsf;
  const own = s.scenario === "building" && s.evidence.ownSales > 0 ? check.sales.map((x, i) => ({ psf: x.psf, i })) : [];
  const near = s.comparables.map((c, i) => ({ psf: c.medianPsf, i })).filter((c) => c.psf >= low / RANGE_REACH && c.psf <= high * RANGE_REACH);
  return rangeScaleOf(
    {
      low,
      high,
      ask: check.analysis.askingPsf,
      verdict: s.verdict,
      own,
      near,
      offScale: s.comparables.length - near.length,
      capped: s.comparables.length > 0 && s.comparables.length < s.comparableBuildings ? { shown: s.comparables.length, of: s.comparableBuildings } : null,
      groupOwn: false,
      ownNewest: own.length ? check.sales.reduce<IsoDate>((latest, x) => (x.saleDate > latest ? x.saleDate : latest), check.sales[0].saleDate) : null,
    },
    width,
    opts.variant,
  );
}

/** What a range scale draws: the range, the asking price and two kinds of mark, each at an AED per sq ft with its index. */
export interface RangeScaleInput {
  low: number;
  high: number;
  ask: number;
  verdict: "above" | "within" | "below";
  /** Filled dots. */
  own: { psf: number; i: number }[];
  /** Hollow rings. */
  near: { psf: number; i: number }[];
  offScale: number;
  capped: { shown: number; of: number } | null;
  /** True when a filled dot may stand for several items too (many sales); false keeps one dot per item. */
  groupOwn: boolean;
  ownNewest: IsoDate | null;
}

/** The geometry of a range scale (the second tier's, and the one of adjusted registered sales: acs-scale.ts). */
export function rangeScaleOf(input: RangeScaleInput, width?: number, variantIn?: RangeVariant): RangeScaleModel {
  const variant = variantIn ?? "phone";
  const m = RANGE_METRICS[variant];
  const W = Math.max(200, Math.round(width ?? m.width));
  const { low, high, ask, own, near, offScale } = input;
  const domain = scaleDomain([low, high, ask, ...own.map((x) => x.psf), ...near.map((x) => x.psf)]);
  const x = (v: number) => scaleX(domain, W, v);

  // Columns: a mark sits on the nearest multiple of the pitch, own sales first (at the bottom).
  const d = m.dot;
  const pitch = d + (variant === "card" ? 3 : 1.5);
  const bins = new Map<number, { own: typeof own; other: typeof near }>();
  const binOf = (v: number) => Math.round((x(v) - PLOT_INSET) / pitch);
  for (const o of own) {
    const b = bins.get(binOf(o.psf)) ?? { own: [], other: [] };
    b.own.push(o);
    bins.set(binOf(o.psf), b);
  }
  for (const o of near) {
    const b = bins.get(binOf(o.psf)) ?? { own: [], other: [] };
    b.other.push(o);
    bins.set(binOf(o.psf), b);
  }
  // One ring stands for `per` buildings at most: the smallest count that keeps every column in the lane.
  let per = 1;
  const ownRings = (n: number, k: number) => (input.groupOwn ? Math.ceil(n / k) : n);
  const tallestWith = (k: number) => Math.max(0, ...[...bins.values()].map((b) => ownRings(b.own.length, k) + Math.ceil(b.other.length / k)));
  while (tallestWith(per) > m.maxLevels && per < 1000) per++;
  const levels = Math.max(m.minLevels, Math.min(m.maxLevels, tallestWith(per)));

  const dotArea = levels * pitch;
  const axisY = m.askLane + dotArea + GAP;
  const labelTop = axisY + m.axis + (variant === "card" ? 12 : 6);
  const height = labelTop + m.labelLane;
  const r = d / 2;
  const marks: RangeMark[] = [];
  for (const [bin, b] of [...bins.entries()].sort((p, q) => p[0] - q[0])) {
    const cx = PLOT_INSET + bin * pitch;
    let level = 0;
    const cyOf = (lv: number) => axisY - GAP - r - lv * pitch;
    const owns = [...b.own].sort((p, q) => p.psf - q.psf);
    const dots = ownRings(owns.length, per);
    for (let g = 0; g < dots; g++) {
      const group = owns.slice(Math.floor((g * owns.length) / dots), Math.floor(((g + 1) * owns.length) / dots));
      marks.push({ cx, cy: cyOf(level++), r, kind: "own", psf: middle(group.map((o) => o.psf)), items: group.map((o) => o.i) });
    }
    const others = [...b.other].sort((p, q) => p.psf - q.psf);
    const rings = Math.ceil(others.length / per);
    for (let g = 0; g < rings; g++) {
      // Evenly sized groups in price order.
      const group = others.slice(Math.floor((g * others.length) / rings), Math.floor(((g + 1) * others.length) / rings));
      marks.push({ cx, cy: cyOf(level++), r, kind: "other", psf: middle(group.map((o) => o.psf)), items: group.map((o) => o.i) });
    }
  }
  const order = marks.map((_, i) => i).sort((p, q) => marks[p].cx - marks[q].cx || marks[q].cy - marks[p].cy);

  const zone = { x0: x(low), x1: x(high), y0: m.askLane - (variant === "card" ? 8 : 4), y1: axisY };
  const pinX = x(ask);
  const label = (value: number, w: number): RangeLabel => {
    const cx = x(value);
    return { value, x: cx, left: Math.max(0, Math.min(W - w, cx - w / 2)), width: w, visible: true };
  };
  const lowLabel = label(low, m.endLabel);
  const highLabel = label(high, m.endLabel);
  const touching = highLabel.left < lowLabel.left + lowLabel.width + CLEARANCE;
  const joinedW = m.endLabel * 2 + (variant === "card" ? 60 : 30);
  const mid = (zone.x0 + zone.x1) / 2;
  const joined = touching ? { left: Math.max(0, Math.min(W - joinedW, mid - joinedW / 2)), width: joinedW } : null;
  const taken: Array<[number, number]> = joined ? [[joined.left, joined.left + joined.width]] : [[lowLabel.left, lowLabel.left + lowLabel.width], [highLabel.left, highLabel.left + highLabel.width]];
  const ticks = tickValues(domain).map((v) => {
    const t = label(v, m.tickLabel);
    const free = taken.every(([a, b]) => t.left + t.width + CLEARANCE <= a || t.left >= b + CLEARANCE);
    if (free) taken.push([t.left, t.left + t.width]);
    return { ...t, visible: free && v !== low && v !== high };
  });

  const medians = near.map((o) => o.psf);
  return {
    variant,
    width: W,
    height,
    low,
    high,
    ask,
    verdict: input.verdict,
    domain,
    axisY,
    zone,
    pin: { x: pinX, y0: variant === "card" ? 8 : 4, y1: axisY },
    askLabel: pinX > W * 0.62 ? { side: "left", x: pinX - (variant === "card" ? 12 : 7) } : { side: "right", x: pinX + (variant === "card" ? 12 : 7) },
    labelTop,
    ends: { low: lowLabel, high: highLabel, joined },
    ticks,
    dot: { d, r, pitch },
    marks,
    order,
    per,
    others: near.length,
    offScale,
    capped: input.capped,
    own: own.length,
    othersSpan: medians.length ? { lo: Math.min(...medians), hi: Math.max(...medians) } : null,
    ownNewest: input.ownNewest,
  };
}

/** The mark nearest to `x` (ties: the lower one in its column), or null with no marks. */
export function nearestMark(model: Pick<RangeScaleModel, "marks">, x: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  model.marks.forEach((mk, i) => {
    const dist = Math.abs(mk.cx - x);
    if (dist < bestD - 1e-9 || (Math.abs(dist - bestD) <= 1e-9 && best !== null && mk.cy > model.marks[best].cy)) {
      best = i;
      bestD = dist;
    }
  });
  return best;
}
