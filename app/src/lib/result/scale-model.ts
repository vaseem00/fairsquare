/**
 * The market scale and every number the result says around it (RESULT_SPEC sections 3 to 6,
 * Appendix A and B): the domain and x(), the ticks and which of their labels stay clear of the median
 * label, the bins anchored at the asking pin and their stacks, the in-line zone, the recent sales and
 * their median, the count framing ("higher than 25 of the 43 sales"), the recent-sales trigger, the
 * evidence tier, the same-size sales, the premium count and the size clusters behind the size buttons.
 *
 * Pure and isomorphic: the result, the /c page, the share card and the OG image all call it, and the
 * match service uses `sizeClusters`. The model is plain data (no functions), so a server component can
 * hand it to a client component. One SVG unit is one CSS px.
 *
 * The rules below are the spec's first guesses (RESULT_SPEC section 13, item 7): tune them on the
 * full sales data, not here by feel.
 */
import { median } from "@/lib/domain/analyse";
import { addDays, type IsoDate } from "@/lib/domain/dates";
import type { CheckView, SaleView } from "@/lib/types";

// ---------- rules ----------

/** "Recent" is the last 90 days up to the data's last date. */
export const RECENT_DAYS = 90;
/** The recent-sales line needs this many recent sales... */
export const RECENT_MIN_SALES = 5;
/** ...whose median differs from the 12-month median by more than this (fraction). */
export const RECENT_DRIFT = 0.05;
/** Evidence tiers start from the count: 20 or more Strong, 10 or more Moderate, else Limited. */
export const EVIDENCE_STRONG_SALES = 20;
export const EVIDENCE_MODERATE_SALES = 10;
/** One tier down with fewer recent sales than this... */
export const EVIDENCE_RECENT_SALES = 3;
/** ...and one more when the middle half spans more than this fraction of the median. */
export const EVIDENCE_SPREAD_MAX = 0.2;
/** "Same size": within 3% of the listing's size either way. */
export const SAME_SIZE_TOLERANCE = 0.03;
/** The list sentence names this many of the newest same-size sales. */
export const SAME_SIZE_NEWEST = 3;
/** A premium sale is at 1.15 times the median or more... */
export const PREMIUM_FACTOR = 1.15;
/** ...and the premium line shows from this many of them. */
export const PREMIUM_MIN_SALES = 3;
/** Size clusters: a new cluster starts where neighbouring sizes differ by more than 3%. */
export const CLUSTER_GAP = 0.03;
/** A size button needs a cluster of at least 3 sales; at most 3 buttons show. */
export const CLUSTER_MIN_SALES = 3;
export const CLUSTER_MAX = 3;
/** A size button reads the cluster's median size rounded to the nearest 5 sq ft. */
export const CLUSTER_ROUND_TO = 5;
/** More sales than this are drawn as QUANTILE_DOTS quantile dots (at most 80 circles). */
export const QUANTILE_FROM = 80;
export const QUANTILE_DOTS = 40;
/** A column taller than this many dots switches to SMALL_DOT. */
export const COLUMN_MAX = 10;
export const SMALL_DOT = 5;

/** What the model reads from a comparison. `sales` are the sales compared (set-aside ones excluded). */
export type ScaleCheck = Pick<CheckView, "sales" | "analysis" | "rules" | "sizeSqft">;

const EPS = 1e-9;

/** Newest first; sales of the same day keep their order (stable sort). */
function newestFirst<T extends { saleDate: IsoDate }>(sales: readonly T[]): T[] {
  return [...sales].sort((a, b) => (a.saleDate < b.saleDate ? 1 : a.saleDate > b.saleDate ? -1 : 0));
}

/** Quartile by linear interpolation between order statistics (p in 0..1, `sorted` ascending, not empty). */
export function quantileOf(sorted: readonly number[], p: number): number {
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// ---------- recent sales (sections 4.2 and 6.1) ----------

export interface RecentSet {
  /** The first day counted: `through` minus RECENT_DAYS. */
  since: IsoDate;
  /** The data's last date (the comparison's data_through, else its window end). */
  through: IsoDate;
  /** The recent sales, newest first. */
  sales: SaleView[];
  count: number;
  medianPsf: number | null;
  /** Recent median against the 12-month median: −0.0905 is 9.05% lower. Null without either. */
  drift: number | null;
  /** The recent-sales line shows: RECENT_MIN_SALES or more recent sales and |drift| > RECENT_DRIFT. */
  trigger: boolean;
  /** Recent sales against the 12-month median ("Recent sales are lower"); null without a drift. */
  direction: "lower" | "higher" | null;
  /**
   * The asking price among the recent sales: "higher" than `askK` of them when it is at or above their
   * median, else "lower" than `askK` of them. Null when there are no recent sales.
   */
  askDirection: "higher" | "lower" | null;
  askK: number;
}

/** The sales of the last RECENT_DAYS up to the data's last date, their median and the trigger. */
export function recentSet(check: Pick<ScaleCheck, "sales" | "analysis">): RecentSet {
  const a = check.analysis;
  const through = a.dataThrough ?? a.windowEnd;
  const since = addDays(through, -RECENT_DAYS);
  const sales = newestFirst(check.sales.filter((s) => s.saleDate >= since && s.saleDate <= through));
  const medianPsf = median(sales.map((s) => s.psf));
  const drift = medianPsf !== null && a.medianPsf !== null && a.medianPsf > 0 ? medianPsf / a.medianPsf - 1 : null;
  const trigger = sales.length >= RECENT_MIN_SALES && drift !== null && Math.abs(drift) > RECENT_DRIFT;
  const direction = drift === null || drift === 0 ? null : drift < 0 ? "lower" : "higher";
  const ask = a.askingPsf;
  let askDirection: RecentSet["askDirection"] = null;
  let askK = 0;
  if (medianPsf !== null) {
    askDirection = ask >= medianPsf ? "higher" : "lower";
    askK = sales.filter((s) => (askDirection === "higher" ? s.psf < ask : s.psf > ask)).length;
  }
  return { since, through, sales, count: sales.length, medianPsf, drift, trigger, direction, askDirection, askK };
}

// ---------- evidence (section 3.1) ----------

export type EvidenceTier = "strong" | "moderate" | "limited";
const TIERS: readonly EvidenceTier[] = ["limited", "moderate", "strong"];

export interface Evidence {
  /** Null below the comparison's minimum (too few sales: no tier is shown). */
  tier: EvidenceTier | null;
  /** The tier from the count alone, before the downgrades. */
  baseTier: EvidenceTier | null;
  count: number;
  recentCount: number;
  /** The middle half of prices per sq ft (lower and upper quartile); null without sales. */
  q1: number | null;
  q3: number | null;
  /** (q3 − q1) / median; null without a median. */
  spread: number | null;
  /** Which downgrades applied. */
  fewRecent: boolean;
  wideSpread: boolean;
}

/**
 * Strong (20+), Moderate (10 to 19) or Limited (from the minimum to 9), one tier down for fewer than 3
 * sales in the last 90 days and one more for a middle half wider than 20% of the median, never below
 * Limited.
 */
export function evidenceOf(check: Pick<ScaleCheck, "sales" | "analysis" | "rules">, recent: RecentSet = recentSet(check)): Evidence {
  const a = check.analysis;
  const count = a.count;
  const sorted = check.sales.map((s) => s.psf).sort((x, y) => x - y);
  const q1 = sorted.length ? quantileOf(sorted, 0.25) : null;
  const q3 = sorted.length ? quantileOf(sorted, 0.75) : null;
  const spread = q1 !== null && q3 !== null && a.medianPsf !== null && a.medianPsf > 0 ? (q3 - q1) / a.medianPsf : null;
  const fewRecent = recent.count < EVIDENCE_RECENT_SALES;
  const wideSpread = spread !== null && spread > EVIDENCE_SPREAD_MAX;
  let baseTier: EvidenceTier | null = null;
  if (count >= EVIDENCE_STRONG_SALES) baseTier = "strong";
  else if (count >= EVIDENCE_MODERATE_SALES) baseTier = "moderate";
  else if (count >= check.rules.minSales) baseTier = "limited";
  let tier: EvidenceTier | null = null;
  if (baseTier) {
    const level = Math.max(0, TIERS.indexOf(baseTier) - (fewRecent ? 1 : 0) - (wideSpread ? 1 : 0));
    tier = TIERS[level];
  }
  return { tier, baseTier, count, recentCount: recent.count, q1, q3, spread, fewRecent, wideSpread };
}

// ---------- same size (section 5) ----------

/** True when a sale's size is within SAME_SIZE_TOLERANCE of the listing's. */
export function isSameSize(saleSqft: number, listingSqft: number): boolean {
  return listingSqft > 0 && Math.abs(saleSqft / listingSqft - 1) <= SAME_SIZE_TOLERANCE + EPS;
}

export interface SameSize {
  /** The listing size the tolerance is taken from. */
  sizeSqft: number;
  count: number;
  /** Every same-size sale, newest first. */
  sales: SaleView[];
  /** The SAME_SIZE_NEWEST newest of them (by date only, never by closeness to the asking price). */
  newest: SaleView[];
  /** The lowest and highest price of `newest`; null when there are none. */
  newestPriceRange: { lo: number; hi: number } | null;
}

export function sameSizeOf(check: Pick<ScaleCheck, "sales" | "sizeSqft">): SameSize {
  const sales = newestFirst(check.sales.filter((s) => isSameSize(s.sizeSqft, check.sizeSqft)));
  const newest = sales.slice(0, SAME_SIZE_NEWEST);
  const prices = newest.map((s) => s.priceAed);
  return {
    sizeSqft: check.sizeSqft,
    count: sales.length,
    sales,
    newest,
    newestPriceRange: prices.length ? { lo: Math.min(...prices), hi: Math.max(...prices) } : null,
  };
}

// ---------- premium ("Before you make an offer", section 5) ----------

export interface Premium {
  /** PREMIUM_FACTOR times the median. */
  threshold: number;
  count: number;
  /** The lowest price per sq ft among them (the copy says "at AED {lo} per sq ft or more"). */
  lowestPsf: number | null;
  /** The premium line shows from PREMIUM_MIN_SALES sales. */
  show: boolean;
}

export function premiumOf(check: Pick<ScaleCheck, "sales" | "analysis">): Premium {
  const m = check.analysis.medianPsf;
  if (m === null) return { threshold: NaN, count: 0, lowestPsf: null, show: false };
  const threshold = PREMIUM_FACTOR * m;
  const psfs = check.sales.map((s) => s.psf).filter((v) => v >= threshold);
  return {
    threshold,
    count: psfs.length,
    lowestPsf: psfs.length ? Math.min(...psfs) : null,
    show: psfs.length >= PREMIUM_MIN_SALES,
  };
}

// ---------- size clusters (section 2.5) ----------

export interface SizeCluster {
  /** The cluster's median size rounded to the nearest CLUSTER_ROUND_TO sq ft (the button label). */
  sqft: number;
  /** How many sales it holds. */
  sales: number;
  min: number;
  max: number;
}

/**
 * The size buttons: sort the sizes, start a new cluster wherever neighbours differ by more than 3%,
 * keep clusters of 3 or more sales, take the 3 largest (ties: the smaller sizes) and order them by
 * size. Aykon's 43 ready 2-beds: 815 (31), 895 (6) and 945 (6).
 */
export function sizeClusters(sizes: readonly number[]): SizeCluster[] {
  const sorted = sizes.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const groups: number[][] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i] / sorted[i - 1] - 1 > CLUSTER_GAP) groups.push([sorted[i]]);
    else groups[groups.length - 1].push(sorted[i]);
  }
  return groups
    .filter((g) => g.length >= CLUSTER_MIN_SALES)
    .sort((a, b) => b.length - a.length)
    .slice(0, CLUSTER_MAX)
    .map((g) => ({
      sqft: Math.round((median(g) as number) / CLUSTER_ROUND_TO) * CLUSTER_ROUND_TO,
      sales: g.length,
      min: g[0],
      max: g[g.length - 1],
    }))
    .sort((a, b) => a.sqft - b.sqft || a.min - b.min);
}

// ---------- geometry (section 4.3) ----------

export type ScaleVariant = "phone" | "desktop" | "card";

export interface ScaleMetrics {
  /** The chart width the spec draws at (358 phone, 576 desktop, 952 card). */
  width: number;
  /** Dot diameter. The pitch is dot + 0.5. */
  dot: number;
  /** Height above the dots: the stamp lane (the asking label lane on the card). */
  stampLane: number;
  /** Gap between the stamp lane and the dot area. */
  gapAbove: number;
  /** Axis line thickness. */
  axis: number;
  fulcrum: { w: number; h: number };
  /** Gap between the fulcrum and the label lane. */
  gapBelow: number;
  labelLane: number;
  /** The compact ASKING stamp; null on the card, which marks the asking price with a label instead. */
  stamp: { w: number; h: number; rotate: number } | null;
  /** The indigo diamond where the pin meets the axis (its width). */
  diamond: number;
  /** Estimated label widths for the collision rule ("Median 1,761" and a tick label). */
  medianLabelWidth: number;
  tickLabelWidth: number;
}

export const SCALE_METRICS: Readonly<Record<ScaleVariant, ScaleMetrics>> = Object.freeze({
  phone: {
    width: 358,
    dot: 7,
    stampLane: 60,
    gapAbove: 4,
    axis: 1,
    fulcrum: { w: 10, h: 7 },
    gapBelow: 4,
    labelLane: 28,
    stamp: { w: 92, h: 52, rotate: -4 },
    diamond: 6,
    medianLabelWidth: 114,
    tickLabelWidth: 36,
  },
  desktop: {
    width: 576,
    dot: 9,
    stampLane: 74,
    gapAbove: 4,
    axis: 1,
    fulcrum: { w: 10, h: 7 },
    gapBelow: 4,
    labelLane: 32,
    stamp: { w: 116, h: 65, rotate: -4 },
    diamond: 6,
    medianLabelWidth: 120,
    tickLabelWidth: 36,
  },
  card: {
    width: 952,
    dot: 16,
    stampLane: 44,
    gapAbove: 4,
    axis: 2,
    fulcrum: { w: 18, h: 12 },
    gapBelow: 0.5,
    labelLane: 35,
    stamp: null,
    diamond: 12,
    medianLabelWidth: 170,
    tickLabelWidth: 60,
  },
});

/** The plot runs from x = PLOT_INSET to W − PLOT_INSET. */
export const PLOT_INSET = 16;
/** Tick steps, tried in order: the first giving 3 to 5 ticks wins. */
export const TICK_STEPS = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000] as const;
/** A tick label within this many px of the median label is hidden. */
export const LABEL_CLEARANCE = 8;
/** Where the pin starts on the card (no stamp): just under the asking label's top. */
const CARD_PIN_TOP = 4;

/** The variant a width implies when none is given: 900 and wider the card, 576 and wider desktop. */
export function variantForWidth(width: number): ScaleVariant {
  if (width >= 900) return "card";
  return width >= SCALE_METRICS.desktop.width ? "desktop" : "phone";
}

/** lo = floor to 100 of 0.97 x the lowest value; hi = ceil to 100 of 1.03 x the highest. */
export function scaleDomain(values: readonly number[]): [number, number] {
  const lo = Math.floor((0.97 * Math.min(...values)) / 100) * 100;
  const hi = Math.ceil((1.03 * Math.max(...values)) / 100) * 100;
  return [lo, hi > lo ? hi : lo + 100];
}

/** x() of the scale: the plot runs from PLOT_INSET to width − PLOT_INSET. */
export function scaleX(domain: readonly [number, number], width: number, value: number): number {
  const [lo, hi] = domain;
  return PLOT_INSET + ((value - lo) * (width - 2 * PLOT_INSET)) / (hi - lo);
}

/** The ticks: multiples of the first step in TICK_STEPS that gives 3 to 5 inside the domain. */
export function tickValues(domain: readonly [number, number]): number[] {
  const [lo, hi] = domain;
  const of = (step: number) => {
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + EPS; v += step) out.push(v);
    return out;
  };
  for (const step of TICK_STEPS) {
    const t = of(step);
    if (t.length >= 3 && t.length <= 5) return t;
  }
  // Nothing gives 3 to 5: the step whose count is nearest 4.
  let best = of(TICK_STEPS[0]);
  for (const step of TICK_STEPS) {
    const t = of(step);
    if (t.length > 0 && Math.abs(t.length - 4) < Math.abs(best.length - 4)) best = t;
  }
  return best;
}

export interface ScaleDot {
  cx: number;
  cy: number;
  r: number;
  /** 0 at the axis. */
  level: number;
  /** Index into `columns`. */
  column: number;
  /** Filled: a recent sale (in quantile mode, half or more of its sales are recent). */
  recent: boolean;
  /** The price per sq ft it stands for (a quantile's median in quantile mode). */
  psf: number;
  /** Indexes into `check.sales`: one sale, or the sales of its quantile. */
  sales: number[];
  /** The newest sale date it stands for (ties when picking a dot go to the newest). */
  newest: IsoDate;
}

export interface ScaleColumn {
  /** Column centre: x(ask) ± (k + 0.5) x pitch. */
  cx: number;
  /** Left of the pin: sales strictly below the asking price; right: at or above it. */
  side: "left" | "right";
  /** k, counted outward from the pin (0 is the column touching it). */
  k: number;
  /** Indexes into `dots`, bottom first. */
  dots: number[];
}

export interface ScaleTick {
  value: number;
  x: number;
  /** The HTML label's box; the last tick at the plot's right end is right-aligned at W − 16. */
  label: { left: number; width: number; align: "center" | "right" };
  /** False when the label would sit within LABEL_CLEARANCE px of the median label. */
  visible: boolean;
}

export interface ScaleGeometry {
  variant: ScaleVariant;
  width: number;
  /** The laid-out height (rounded up to whole px) and the exact one. */
  height: number;
  exactHeight: number;
  domain: [number, number];
  /** Px per AED per sq ft. */
  pxPerAed: number;
  dot: { d: number; r: number; pitch: number };
  /** Quantile mode (more than QUANTILE_FROM sales): each dot is about `k` sales. */
  quantile: { k: number } | null;
  tallest: number;
  /** Top of the axis line; a dot at level L has its centre at axisY − r − L x pitch. */
  axisY: number;
  dotArea: number;
  ask: { x: number };
  median: { x: number };
  /** The in-line zone rect: from the axis up to the top of the dot area. */
  zone: { x0: number; x1: number; y0: number; y1: number };
  pin: { x: number; y0: number; y1: number };
  diamond: { x: number; y: number; size: number };
  /** Apex at (x, y), pointing up at the axis; base y + h. */
  fulcrum: { x: number; y: number; w: number; h: number };
  /** Centred on x(ask) above the dots, slid inward near an edge (the pin stays exact). */
  stamp: { cx: number; cy: number; w: number; h: number; rotate: number } | null;
  labelTop: number;
  medianLabel: { left: number; width: number };
  ticks: ScaleTick[];
  dots: ScaleDot[];
  columns: ScaleColumn[];
  /** Sales drawn left of the pin (exactly the "higher than k" count outside quantile mode). */
  leftOfPin: number;
  rightOfPin: number;
  /** Dot indexes in price per sq ft order (the arrow keys), ties newest first. */
  order: number[];
}

interface Point {
  psf: number;
  recent: boolean;
  newest: IsoDate;
  sales: number[];
}

/** One point per sale, or QUANTILE_DOTS quantile points above QUANTILE_FROM sales. */
function pointsOf(sales: readonly SaleView[], since: IsoDate): { points: Point[]; quantileK: number | null } {
  const isRecent = (s: SaleView) => s.saleDate >= since;
  if (sales.length <= QUANTILE_FROM) {
    return {
      points: sales.map((s, i) => ({ psf: s.psf, recent: isRecent(s), newest: s.saleDate, sales: [i] })),
      quantileK: null,
    };
  }
  const idx = sales.map((_, i) => i).sort((a, b) => sales[a].psf - sales[b].psf);
  const n = sales.length;
  const points: Point[] = [];
  for (let q = 0; q < QUANTILE_DOTS; q++) {
    const group = idx.slice(Math.floor((q * n) / QUANTILE_DOTS), Math.floor(((q + 1) * n) / QUANTILE_DOTS));
    if (group.length === 0) continue;
    const recent = group.filter((i) => isRecent(sales[i])).length;
    points.push({
      psf: median(group.map((i) => sales[i].psf)) as number,
      recent: recent * 2 >= group.length,
      newest: group.map((i) => sales[i].saleDate).sort().at(-1) as IsoDate,
      sales: group,
    });
  }
  return { points, quantileK: Math.round(n / QUANTILE_DOTS) };
}

/** Pin-anchored bins: column edges at x(ask) + n x pitch; below the ask to the left, at or above to the right. */
function binPoints(points: readonly Point[], ask: number, xAsk: number, x: (v: number) => number, pitch: number) {
  const byKey = new Map<string, { cx: number; side: "left" | "right"; k: number; points: Point[] }>();
  for (const p of points) {
    const xs = x(p.psf);
    const left = p.psf < ask;
    const k = Math.max(0, Math.floor((left ? xAsk - xs : xs - xAsk) / pitch));
    const key = `${left ? "L" : "R"}${k}`;
    let col = byKey.get(key);
    if (!col) {
      col = { cx: left ? xAsk - (k + 0.5) * pitch : xAsk + (k + 0.5) * pitch, side: left ? "left" : "right", k, points: [] };
      byKey.set(key, col);
    }
    col.points.push(p);
  }
  const cols = [...byKey.values()].sort((a, b) => a.cx - b.cx);
  // Inside a column: recent dots at the bottom, then older ones; within each, newest lower.
  for (const c of cols) c.points.sort((a, b) => Number(b.recent) - Number(a.recent) || (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : 0));
  return { cols, tallest: cols.reduce((m, c) => Math.max(m, c.points.length), 0) };
}

/**
 * The geometry of the market scale for a width (one SVG unit = one CSS px). `maxHeight` (the share
 * card, whose footer must stay on its 1350px canvas) shrinks the dots 1px at a time, down to SMALL_DOT,
 * until the laid-out height fits.
 */
export function scaleGeometry(
  check: ScaleCheck,
  width: number,
  variant: ScaleVariant,
  recent: Pick<RecentSet, "since"> = recentSet(check),
  maxHeight?: number,
): ScaleGeometry | null {
  const a = check.analysis;
  if (a.medianPsf === null || check.sales.length === 0) return null;
  const m = SCALE_METRICS[variant];
  const W = width;
  const ask = a.askingPsf;
  const med = a.medianPsf;
  const b = check.rules.bandPct / 100;
  const zoneLo = med * (1 - b);
  const zoneHi = med * (1 + b);
  const psfs = check.sales.map((s) => s.psf);
  const domain = scaleDomain([...psfs, ask, zoneLo, zoneHi]);
  const pxPerAed = (W - 2 * PLOT_INSET) / (domain[1] - domain[0]);
  const x = (v: number) => scaleX(domain, W, v);
  const xAsk = x(ask);
  const xMed = x(med);

  const { points, quantileK } = pointsOf(check.sales, recent.since);
  let d = m.dot;
  let binned = binPoints(points, ask, xAsk, x, d + 0.5);
  if (binned.tallest > COLUMN_MAX && d > SMALL_DOT) {
    d = SMALL_DOT;
    binned = binPoints(points, ask, xAsk, x, d + 0.5);
  }
  // Everything but the dot area: the lanes, the gaps, the axis and the fulcrum.
  const fixedHeight = m.stampLane + m.gapAbove + m.axis + m.fulcrum.h + m.gapBelow + m.labelLane;
  if (maxHeight !== undefined) {
    while (d > SMALL_DOT && fixedHeight + Math.max(2, binned.tallest) * (d + 0.5) > maxHeight + EPS) {
      d -= 1;
      binned = binPoints(points, ask, xAsk, x, d + 0.5);
    }
  }
  const pitch = d + 0.5;
  const r = d / 2;
  const { cols, tallest } = binned;

  const dotArea = Math.max(2, tallest) * pitch;
  const axisY = m.stampLane + m.gapAbove + dotArea;
  const labelTop = axisY + m.axis + m.fulcrum.h + m.gapBelow;
  const exactHeight = labelTop + m.labelLane;

  const dots: ScaleDot[] = [];
  const columns: ScaleColumn[] = cols.map((c, ci) => {
    const ids = c.points.map((p, level) => {
      dots.push({ cx: c.cx, cy: axisY - r - level * pitch, r, level, column: ci, recent: p.recent, psf: p.psf, sales: p.sales, newest: p.newest });
      return dots.length - 1;
    });
    return { cx: c.cx, side: c.side, k: c.k, dots: ids };
  });
  const countSide = (side: "left" | "right") =>
    columns.filter((c) => c.side === side).reduce((n, c) => n + c.dots.reduce((k, i) => k + dots[i].sales.length, 0), 0);
  const order = dots
    .map((_, i) => i)
    .sort((i, j) => dots[i].psf - dots[j].psf || (dots[i].newest < dots[j].newest ? 1 : dots[i].newest > dots[j].newest ? -1 : 0));

  const stamp = m.stamp
    ? {
        cx: Math.max(m.stamp.w / 2, Math.min(W - m.stamp.w / 2, xAsk)),
        cy: m.stampLane / 2,
        w: m.stamp.w,
        h: m.stamp.h,
        rotate: m.stamp.rotate,
      }
    : null;
  const pinTop = stamp ? stamp.cy + stamp.h / 2 - 4 : CARD_PIN_TOP;

  const mw = m.medianLabelWidth;
  const medianLeft = Math.max(0, Math.min(W - mw, xMed - mw / 2));
  const ticks: ScaleTick[] = tickValues(domain).map((value) => {
    const tx = x(value);
    const last = Math.abs(tx - (W - PLOT_INSET)) < 1;
    const tw = m.tickLabelWidth;
    const left = last ? W - PLOT_INSET - tw : tx - tw / 2;
    const clear = left + tw <= medianLeft - LABEL_CLEARANCE || left >= medianLeft + mw + LABEL_CLEARANCE;
    return { value, x: tx, label: { left, width: tw, align: last ? "right" : "center" }, visible: clear };
  });

  return {
    variant,
    width: W,
    height: Math.ceil(exactHeight - EPS),
    exactHeight,
    domain,
    pxPerAed,
    dot: { d, r, pitch },
    quantile: quantileK === null ? null : { k: quantileK },
    tallest,
    axisY,
    dotArea,
    ask: { x: xAsk },
    median: { x: xMed },
    zone: { x0: x(zoneLo), x1: x(zoneHi), y0: axisY - dotArea, y1: axisY },
    pin: { x: xAsk, y0: pinTop, y1: axisY },
    diamond: { x: xAsk, y: axisY + m.axis / 2, size: m.diamond },
    fulcrum: { x: xMed, y: axisY + m.axis, w: m.fulcrum.w, h: m.fulcrum.h },
    stamp,
    labelTop,
    medianLabel: { left: medianLeft, width: mw },
    ticks,
    dots,
    columns,
    leftOfPin: countSide("left"),
    rightOfPin: countSide("right"),
    order,
  };
}

/**
 * The dot a pointer at chart x selects (section 4.5): the nearest by x, ties to the newest. Null when
 * nothing is drawn.
 */
export function nearestDot(geometry: Pick<ScaleGeometry, "dots">, x: number): number | null {
  const dots = geometry.dots;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < dots.length; i++) {
    const dist = Math.abs(dots[i].cx - x);
    if (best < 0 || dist < bestDist - 0.01 || (Math.abs(dist - bestDist) <= 0.01 && dots[i].newest > dots[best].newest)) {
      best = i;
      bestDist = dist;
    }
  }
  return best < 0 ? null : best;
}

// ---------- the whole model ----------

export type GapKind = "zero" | "above" | "below" | "aboveAll" | "belowAll";

export interface GapSentence {
  kind: GapKind;
  /** |ask − median| in AED per sq ft, rounded (the sentence's figure). */
  aed: number;
  /** |diff| as a fraction; the sentence prints it only in line (`withPct`), the headline carries it otherwise. */
  pct: number;
  withPct: boolean;
  /** "higher than {k}" (diff ≥ 0) or "lower than {k}" (diff < 0) of `n`. */
  k: number;
  n: number;
  /** aboveAll: the highest sale; belowAll: the lowest. */
  extreme: SaleView | null;
}

export interface ScaleModel {
  /** Sales drawn and counted in sentences (the sales compared, set-aside ones excluded). */
  n: number;
  /** The comparison's count (analysis.count). */
  count: number;
  ask: number;
  median: number;
  /** ask / median − 1. */
  diff: number;
  band: "above" | "inline" | "below";
  /** Sales strictly below, strictly above and exactly at the asking price per sq ft. */
  below: number;
  above: number;
  /** The count framing: `below` when diff ≥ 0 ("higher than"), else `above` ("lower than"). */
  k: number;
  direction: "higher" | "lower";
  zone: { lo: number; hi: number; bandPct: number; count: number };
  gap: GapSentence;
  lowest: SaleView;
  highest: SaleView;
  recent: RecentSet;
  evidence: Evidence;
  sameSize: SameSize;
  premium: Premium;
  geometry: ScaleGeometry;
}

const isVerdict = (band: string): band is "above" | "inline" | "below" => band === "above" || band === "inline" || band === "below";

/**
 * Everything the result draws and says for a comparison with a verdict, at a chart width. Null for too
 * few sales, not covered, or no sales stored: those states draw no scale (section 4.4). `variant`
 * defaults to the one the width implies (`variantForWidth`); pass it when the viewport decides.
 */
export function scaleModel(check: ScaleCheck, width?: number, opts: { variant?: ScaleVariant; maxHeight?: number } = {}): ScaleModel | null {
  const a = check.analysis;
  if (!isVerdict(a.band) || a.medianPsf === null || check.sales.length === 0) return null;
  const variant = opts.variant ?? (width === undefined ? "phone" : variantForWidth(width));
  const W = width ?? SCALE_METRICS[variant].width;
  const recent = recentSet(check);
  const geometry = scaleGeometry(check, W, variant, recent, opts.maxHeight) as ScaleGeometry;

  const ask = a.askingPsf;
  const med = a.medianPsf;
  const diff = ask / med - 1;
  const n = check.sales.length;
  const below = check.sales.filter((s) => s.psf < ask).length;
  const above = check.sales.filter((s) => s.psf > ask).length;
  const k = diff >= 0 ? below : above;
  const b = check.rules.bandPct / 100;
  const zone = { lo: med * (1 - b), hi: med * (1 + b), bandPct: check.rules.bandPct, count: 0 };
  zone.count = check.sales.filter((s) => s.psf >= zone.lo - EPS && s.psf <= zone.hi + EPS).length;

  // Ties: the newest of equal prices per sq ft.
  const byPsf = [...newestFirst(check.sales)].sort((x, y) => x.psf - y.psf);
  const lowest = byPsf[0];
  const highest = byPsf.reduce((h, s) => (s.psf > h.psf ? s : h), byPsf[0]);

  const aed = Math.round(Math.abs(ask - med));
  let kind: GapKind;
  if (aed === 0) kind = "zero";
  else if (diff > 0 && below === n) kind = "aboveAll";
  else if (diff < 0 && above === n) kind = "belowAll";
  else kind = diff > 0 ? "above" : "below";
  const gap: GapSentence = {
    kind,
    aed,
    pct: Math.abs(diff),
    // In line the headline carries no figure, so the sentence always prints the exact % (section 4.8,
    // E4), also when every sale is on one side.
    withPct: a.band === "inline" && kind !== "zero",
    k: kind === "zero" ? below : k,
    n,
    extreme: kind === "aboveAll" ? highest : kind === "belowAll" ? lowest : null,
  };

  return {
    n,
    count: a.count,
    ask,
    median: med,
    diff,
    band: a.band,
    below,
    above,
    k,
    direction: diff >= 0 ? "higher" : "lower",
    zone,
    gap,
    lowest,
    highest,
    recent,
    evidence: evidenceOf(check, recent),
    sameSize: sameSizeOf(check),
    premium: premiumOf(check),
    geometry,
  };
}
