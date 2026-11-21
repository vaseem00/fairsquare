/**
 * Adjusted registered sales (REAL_DATA.md section 16): the first answer for a building that is in the
 * data. The caller hands in the open-data sales of the listing's building (one basis, every bedroom
 * count) and of the other buildings of its project family; this module collapses them into pool rows,
 * moves each row to the data date (time) and to the listing's size, weights it, and returns the range,
 * the position of the asking price and every row used with its adjustments.
 *
 * Pure functions, no I/O. The words here are internal: nothing in this file is page copy.
 *
 * It is the TypeScript side of scripts/model/acs/acs.py (gather, combine, decide) for a building in the
 * data, with rings 1 (own building, same bedrooms), 3 (other buildings of the project, same bedrooms)
 * and 2 (own building, another bedroom count). tests/unit/domain/acs-golden.test.ts holds the two to
 * 1e-9 on the golden cases. Change neither side alone.
 */

export interface AcsParams {
  nmax: number;
  size_lo: number;
  size_hi: number;
  age_half: number;
  size_half: number;
  W0: number;
  r3: number;
  r2: number;
  bed2: number;
  lam: number;
  cap: number;
  slope_lo: number;
  slope_hi: number;
}

export interface AcsRange {
  floor: number;
  d0: number;
  k0: number;
  thinW: number;
  oldAge: number;
  farLsr: number;
  /** Range multipliers [low side, high side] by group "basis|class|thin|old|far" and by every shorter key. */
  q: Record<string, [number, number]>;
  minComps: number;
  minWeight: number;
  minWeightKnown: number;
  minOwn: number;
  maxLsr: number;
  typLo: number;
  typHi: number;
  maxHalfWidth: number;
  maxBedrooms: number;
  refuseClasses: number[];
  rounding: number;
  /** The nominal level the multipliers were fitted at: [ready, off-plan]. */
  nominal?: number[];
}

/** The model of one snapshot (acs-model.json, version 2). The sales are not in it. */
export interface AcsModel {
  version: 2;
  kind: "acs-model";
  dataThrough: string;
  epoch: string;
  /** The data date in days from the epoch. */
  T: number;
  /** The first day of the pool (T - 1094). */
  poolFromDay: number;
  params: AcsParams;
  range: AcsRange;
  /** DLD area names; `buildings.area` and the keys of `theta` index this list. */
  areas: string[];
  /** Month effects of Dubai by basis (the fallback when an area has no index): [basis][48]. */
  tau: number[][];
  /** Month effects by "<area index>|<basis>": 48 numbers each. */
  theta: Record<string, number[]>;
  /** Size slope of the segment: [basis][min(bedrooms, 4)]. */
  seg: number[][];
  /** The other-bedrooms fit: size slope by basis, and the step of each bedroom count. */
  beta2: number[];
  prem: number[][];
  buildings: { key: string[]; area: number[]; family: number[] };
  /** [building index, bedrooms, basis, sxx, sxy] */
  cellSlope: [number, number, number, number, number][];
}

/** One registered sale of the open data, of the basis of the request. `day` counts from the model's epoch. */
export interface AcsSaleRow {
  ref: string;
  buildingKey: string;
  day: number;
  bed: number;
  size: number;
  price: number;
}

/** A pool row: one sale, or several registered at one price (a one-price batch or exact duplicates). */
export interface AcsPoolRow {
  /** The ref of its first sale: the pool order. */
  ord: string;
  buildingKey: string;
  day: number;
  bed: number;
  size: number;
  psf: number;
  /** The price of the sale in AED; null for a one-price batch (its sizes differ). */
  price: number | null;
  count: number;
  batch: boolean;
  refs: string[];
}

export interface AcsRequest {
  buildingKey: string;
  bed: number;
  /** 0 ready, 1 off-plan. */
  basis: 0 | 1;
  size: number;
  askingPsf?: number | null;
}

export interface AcsComparable {
  refs: string[];
  buildingKey: string;
  day: number;
  bed: number;
  size: number;
  psf: number;
  price: number | null;
  count: number;
  batch: boolean;
  ring: 1 | 2 | 3;
  ageMonths: number;
  /** ln factor that moves the sale to the data date. */
  timeLn: number;
  /** ln factor that moves the sale to the listing's size (ring 2: with the step between bedroom counts). */
  sizeLn: number;
  /** The part of sizeLn that is the step between bedroom counts (ring 2 only; 0 otherwise). */
  bedroomLn: number;
  adjustedPsf: number;
  weight: number;
}

export interface AcsFeatures {
  centre: number;
  n: number;
  W: number;
  neff: number;
  disp: number;
  W1: number;
  W2: number;
  W3: number;
  n1: number;
  n2: number;
  n3: number;
  age_w: number;
  lsr_w: number;
  beta1: number;
}

/** Why there is no range, in the order the rule tests them (REAL_DATA.md section 16.3). Stored, never shown as such. */
export const ACS_REASONS = [
  // No registered sale passes the limits (also: a building added by hand, or one the model does not have).
  "no_comparables",
  // More than 3 bedrooms: not tested.
  "bedrooms_not_validated",
  // Sales of other buildings of the project carry the most weight.
  "no_close_comparables",
  // Fewer than 3 rows, too little weight in all, or no sale of the same bedroom count in the building.
  "too_few_comparables",
  // The listing's size is too far from the sizes of the sales.
  "size_too_far",
  // No tested multipliers for this kind of evidence.
  "no_calibration",
  // The range would be wider than 20% either way.
  "range_too_wide",
] as const;
export type AcsReason = (typeof ACS_REASONS)[number];
export type AcsVerdict = "above" | "below" | "within";

export interface AcsResult {
  shown: boolean;
  reason: AcsReason | null;
  features: AcsFeatures | null;
  comps: AcsComparable[];
  /** The median size of all pool rows of the listing's building, bedrooms and basis. */
  typicalSize: number | null;
  evidenceClass?: number;
  group?: string;
  groupUsed?: string | null;
  centrePsf?: number;
  lowPsf?: number;
  highPsf?: number;
  halfWidth?: number;
  rangeLowPsf?: number;
  rangeHighPsf?: number;
  verdict?: AcsVerdict;
}

/** Days in a month, as the model counts them. */
export const ACS_MONTH_DAYS = 30.4375;
/** The months of the time index. */
export const ACS_INDEX_MONTHS = 48;
const EPS = 1e-9;

const DAY_MS = 86_400_000;

/** Whole days from the model's epoch to a YYYY-MM-DD date (UTC). */
export function acsDay(epoch: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${epoch}T00:00:00Z`)) / DAY_MS);
}

/** The YYYY-MM-DD date of a day number. */
export function acsDate(epoch: string, day: number): string {
  return new Date(Date.parse(`${epoch}T00:00:00Z`) + day * DAY_MS).toISOString().slice(0, 10);
}

export function acsMedian(x: readonly number[]): number {
  const s = [...x].sort((p, q) => p - q);
  return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2;
}

/** Round half to even, as Python's round(). */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

const byRef = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface AcsIndex {
  model: AcsModel;
  /** Building key to its index in `model.buildings`. */
  b: Map<string, number>;
  /** Project family id to the keys of its buildings. */
  family: Map<number, string[]>;
  /** "building index|bedrooms|basis" to [sxx, sxy]. */
  cs: Map<string, [number, number]>;
}

/** Indexes a model once, for many requests. */
export function prepareAcs(model: AcsModel): AcsIndex {
  const b = new Map<string, number>();
  const family = new Map<number, string[]>();
  const cs = new Map<string, [number, number]>();
  model.buildings.key.forEach((k, i) => {
    b.set(k, i);
    const f = model.buildings.family[i];
    if (f > 0) {
      const l = family.get(f);
      if (l) l.push(k);
      else family.set(f, [k]);
    }
  });
  for (const [bi, bed, basis, sxx, sxy] of model.cellSlope) cs.set(`${bi}|${bed}|${basis}`, [sxx, sxy]);
  return { model, b, family, cs };
}

/** The other buildings of the listing's project family (ring 3). Empty when the building has none or is not in the model. */
export function acsSiblingKeys(ix: AcsIndex, buildingKey: string): string[] {
  const i = ix.b.get(buildingKey);
  if (i === undefined) return [];
  const f = ix.model.buildings.family[i];
  return f > 0 ? (ix.family.get(f) ?? []).filter((k) => k !== buildingKey) : [];
}

/**
 * The pool rows of ONE building and ONE basis. `rows`: its sales in the pool window, in any order.
 * - One-price batch: a run of 5 or more sales within 0.1% of the run's lowest AED per sq ft, of unlike
 *   units (more than one bedroom count, or the largest size over 1.05 x the smallest), on 3 or fewer
 *   days. It becomes one row per bedroom count: latest day, median size, median AED per sq ft.
 * - Exact duplicates (day, bedrooms, size to 0.01, price to AED 1) become one row.
 * Pool order: the ref of the first sale of each row, ascending by code unit.
 */
export function collapseAcs(rows: readonly AcsSaleRow[]): AcsPoolRow[] {
  const src = [...rows].sort((x, y) => byRef(x.ref, y.ref));
  const n = src.length;
  const psf = src.map((r) => r.price / r.size);
  const o = Array.from({ length: n }, (_, i) => i).sort((x, y) => psf[x] - psf[y] || x - y);
  const inBatch = new Array<boolean>(n).fill(false);
  const out: (AcsPoolRow & { first: number })[] = [];
  let s = 0;
  while (s < n) {
    let e = s + 1;
    while (e < n && !(psf[o[e]] > psf[o[s]] * 1.001)) e++;
    if (e - s >= 5) {
      const run = o.slice(s, e);
      const beds = new Set(run.map((i) => src[i].bed));
      const days = new Set(run.map((i) => src[i].day));
      let lo = Infinity;
      let hi = 0;
      for (const i of run) {
        lo = Math.min(lo, src[i].size);
        hi = Math.max(hi, src[i].size);
      }
      if ((beds.size > 1 || hi > lo * 1.05) && days.size <= 3) {
        for (const bed of [...beds].sort((p, q) => p - q)) {
          const g = run.filter((i) => src[i].bed === bed).sort((p, q) => p - q);
          for (const i of g) inBatch[i] = true;
          out.push({
            first: g[0],
            ord: src[g[0]].ref,
            buildingKey: src[g[0]].buildingKey,
            day: Math.max(...g.map((i) => src[i].day)),
            bed,
            size: acsMedian(g.map((i) => src[i].size)),
            psf: acsMedian(g.map((i) => psf[i])),
            price: null,
            count: g.length,
            batch: true,
            refs: g.map((i) => src[i].ref),
          });
        }
      }
    }
    s = e;
  }
  const seen = new Map<string, AcsPoolRow & { first: number }>();
  for (let i = 0; i < n; i++) {
    if (inBatch[i]) continue;
    const r = src[i];
    const k = `${r.day}|${r.bed}|${Math.round(r.size * 100)}|${Math.round(r.price)}`;
    const d = seen.get(k);
    if (d) {
      d.count++;
      d.refs.push(r.ref);
      continue;
    }
    const row = { first: i, ord: r.ref, buildingKey: r.buildingKey, day: r.day, bed: r.bed, size: r.size, psf: psf[i], price: r.price, count: 1, batch: false, refs: [r.ref] };
    seen.set(k, row);
    out.push(row);
  }
  out.sort((x, y) => x.first - y.first);
  return out.map(({ first: _first, ...row }) => {
    void _first;
    return row;
  });
}

/** Weighted quantile: midpoint rule, linear interpolation, flat outside the first and the last point. */
export function weightedQuantile(v: readonly number[], w: readonly number[], p: number): number {
  const n = v.length;
  const o = Array.from({ length: n }, (_, i) => i).sort((x, y) => v[x] - v[y] || x - y);
  const pp = new Array<number>(n);
  const c = new Array<number>(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += w[o[i]];
    c[i] = s;
  }
  for (let i = 0; i < n; i++) pp[i] = (c[i] - 0.5 * w[o[i]]) / c[n - 1];
  if (p <= pp[0]) return v[o[0]];
  if (p >= pp[n - 1]) return v[o[n - 1]];
  let j = 0;
  while (pp[j] <= p) j++;
  return v[o[j - 1]] + ((p - pp[j - 1]) / (pp[j] - pp[j - 1])) * (v[o[j]] - v[o[j - 1]]);
}

/**
 * One request. `own`: the building's open-data sales of the request's basis in the pool window (all
 * bedroom counts). `siblings`: the same for every building of `acsSiblingKeys` (all bedroom counts:
 * a one-price batch spans bedroom counts, so each building is collapsed whole).
 */
export function estimateAcs(ix: AcsIndex, q: AcsRequest, own: readonly AcsSaleRow[], siblings: readonly AcsSaleRow[]): AcsResult {
  const m = ix.model;
  const P = m.params;
  const R = m.range;
  const T = m.T;
  const out: AcsResult = { shown: false, reason: null, features: null, comps: [], typicalSize: null };
  const inWindow = (r: AcsSaleRow) => r.day >= m.poolFromDay && r.day <= T;
  const ownPool = collapseAcs(own.filter((r) => r.buildingKey === q.buildingKey && inWindow(r)));
  const sibBy = new Map<string, AcsSaleRow[]>();
  for (const r of siblings) {
    if (r.buildingKey === q.buildingKey || !inWindow(r)) continue;
    const l = sibBy.get(r.buildingKey);
    if (l) l.push(r);
    else sibBy.set(r.buildingKey, [r]);
  }
  let sibPool: AcsPoolRow[] = [];
  for (const l of sibBy.values()) sibPool = sibPool.concat(collapseAcs(l).filter((r) => r.bed === q.bed));
  const latestFirst = (x: AcsPoolRow, y: AcsPoolRow) => y.day - x.day || byRef(x.ord, y.ord);
  const Lz = Math.log(q.size);
  const bd = Math.min(q.bed, 4);
  const lo = Math.log(P.size_lo);
  const hi = Math.log(P.size_hi);
  const l4 = Math.log(0.4);
  const l25 = Math.log(2.5);
  const ring: (1 | 2 | 3)[] = [];
  const rows: AcsPoolRow[] = [];
  const lsrs: number[] = [];
  const add = (rg: 1 | 2 | 3, list: AcsPoolRow[], ok: (r: AcsPoolRow, lsr: number) => boolean) => {
    let k = 0;
    for (const r of list) {
      const lsr = Lz - Math.log(r.size);
      if (!ok(r, lsr)) continue;
      if (k++ >= P.nmax) break;
      ring.push(rg);
      rows.push(r);
      lsrs.push(lsr);
    }
  };
  const r1 = ownPool.filter((r) => r.bed === q.bed).sort(latestFirst);
  if (r1.length) out.typicalSize = acsMedian(r1.map((r) => r.size));
  add(1, r1, (_r, lsr) => lsr >= lo && lsr <= hi);
  add(3, sibPool.sort(latestFirst), (_r, lsr) => lsr >= lo && lsr <= hi);
  add(2, [...ownPool].sort(latestFirst), (r, lsr) => r.bed !== q.bed && Math.abs(Math.min(r.bed, 4) - bd) <= 2 && lsr >= l4 && lsr <= l25);
  const n0 = rows.length;
  if (n0 === 0) {
    out.reason = "no_comparables";
    return out;
  }

  const bi = ix.b.get(q.buildingKey);
  const seg = m.seg[q.basis][bd];
  let beta1 = seg;
  const st = bi === undefined ? undefined : ix.cs.get(`${bi}|${q.bed}|${q.basis}`);
  if (st) beta1 = Math.min(Math.max((st[1] + P.lam * seg) / (st[0] + P.lam), P.slope_lo), P.slope_hi);
  const sadj = new Array<number>(n0);
  const tadj = new Array<number>(n0);
  const adj = new Array<number>(n0);
  const age = new Array<number>(n0);
  const w = new Array<number>(n0);
  const u = new Array<number>(n0);
  for (let i = 0; i < n0; i++) {
    const r = rows[i];
    const rg = ring[i];
    const lsr = lsrs[i];
    const bc = Math.min(r.bed, 4);
    sadj[i] = rg === 1 ? beta1 * lsr : rg === 2 ? m.beta2[q.basis] * lsr + (m.prem[q.basis][bd] - m.prem[q.basis][bc]) : seg * lsr;
    const rb = ix.b.get(r.buildingKey);
    const th = (rb === undefined ? undefined : m.theta[`${m.buildings.area[rb]}|${q.basis}`]) ?? m.tau[q.basis];
    tadj[i] = th[0] - th[Math.min(Math.floor((T - r.day) / ACS_MONTH_DAYS), ACS_INDEX_MONTHS - 1)];
    age[i] = (T - r.day) / ACS_MONTH_DAYS;
    adj[i] = Math.log(r.psf) + tadj[i] + sadj[i];
    let base = rg === 1 ? 1.0 : rg === 3 ? P.r3 : Math.abs(bc - bd) >= 2 ? P.r2 * P.bed2 : P.r2;
    if (rg !== 2) {
      const z = Math.abs(lsr) / P.size_half;
      base = base * Math.pow(0.5, z * z);
    }
    u[i] = base * Math.pow(0.5, age[i] / P.age_half);
  }
  // One other building of the project has at most `cap` in total.
  const sibs = [...new Set(rows.filter((_r, i) => ring[i] === 3).map((r) => r.buildingKey))];
  for (const k of sibs) {
    let t = 0;
    for (let i = 0; i < n0; i++) if (ring[i] === 3 && rows[i].buildingKey === k) t += u[i];
    if (t > P.cap) for (let i = 0; i < n0; i++) if (ring[i] === 3 && rows[i].buildingKey === k) u[i] = u[i] * (P.cap / t);
  }
  // The best rows first, until there is enough (W0).
  const ord = Array.from({ length: n0 }, (_, i) => i).sort((x, y) => u[y] - u[x] || x - y);
  let prev = 0;
  for (const i of ord) {
    w[i] = Math.min(u[i], Math.max(P.W0 - prev, 0));
    prev += u[i];
  }
  const keep: number[] = [];
  for (let i = 0; i < n0; i++) if (w[i] > 0) keep.push(i);
  if (keep.length === 0) {
    out.reason = "no_comparables";
    return out;
  }
  const v = keep.map((i) => adj[i]);
  const ww = keep.map((i) => w[i]);
  let W = 0;
  for (const x of ww) W += x;
  const centre = weightedQuantile(v, ww, 0.5);
  const Wr = [0, 0, 0, 0];
  const nr = [0, 0, 0, 0];
  let sw2 = 0;
  let swa = 0;
  let swl = 0;
  let swn = 0;
  for (const i of keep) {
    const rg = ring[i];
    Wr[rg] += w[i];
    nr[rg]++;
    sw2 += w[i] * w[i];
    swa += w[i] * age[i];
    if (rg !== 2) {
      swl += w[i] * Math.abs(lsrs[i]);
      swn += w[i];
    }
  }
  const f: AcsFeatures = {
    centre,
    n: keep.length,
    W,
    neff: (W * W) / sw2,
    disp: (weightedQuantile(v, ww, 0.75) - weightedQuantile(v, ww, 0.25)) / 1.349,
    W1: Wr[1],
    W2: Wr[2],
    W3: Wr[3],
    n1: nr[1],
    n2: nr[2],
    n3: nr[3],
    age_w: swa / W,
    lsr_w: swn > 0 ? swl / swn : NaN,
    beta1,
  };
  out.features = f;
  out.comps = keep.map((i) => ({
    refs: rows[i].refs,
    buildingKey: rows[i].buildingKey,
    day: rows[i].day,
    bed: rows[i].bed,
    size: rows[i].size,
    psf: rows[i].psf,
    price: rows[i].price,
    count: rows[i].count,
    batch: rows[i].batch,
    ring: ring[i],
    ageMonths: age[i],
    timeLn: tadj[i],
    sizeLn: sadj[i],
    bedroomLn: ring[i] === 2 ? m.prem[q.basis][bd] - m.prem[q.basis][Math.min(rows[i].bed, 4)] : 0,
    adjustedPsf: Math.exp(adj[i]),
    weight: w[i],
  }));

  // Evidence class: 1 when own same-bedroom rows have half of the weight, else the ring with the most (ties: 1, 3, 2).
  let cls = 1;
  if (!(f.W1 >= 0.5 * W)) {
    let best = 1;
    for (const r of [1, 3, 2]) if (Wr[r] > Wr[best]) best = r;
    cls = best;
  }
  const thin = W < R.thinW ? 1 : 0;
  const old = f.age_w > R.oldAge ? 1 : 0;
  const far = !Number.isNaN(f.lsr_w) && f.lsr_w > R.farLsr ? 1 : 0;
  const parts = [q.basis, cls, thin, old, far];
  let qq: [number, number] | undefined;
  let used = "";
  // A refused class has no range: its multipliers are not in the model.
  if (!R.refuseClasses.includes(cls)) {
    for (const cut of [5, 4, 3, 2]) {
      used = parts.slice(0, cut).join("|");
      qq = R.q[used];
      if (qq) break;
    }
  }
  const d2 = (f.neff * f.disp * f.disp + R.k0 * R.d0 * R.d0) / (f.neff + R.k0);
  const scale = Math.sqrt(R.floor * R.floor + d2);
  out.evidenceClass = cls;
  out.group = parts.join("|");
  out.groupUsed = qq ? used : null;
  out.centrePsf = Math.exp(centre);
  let l = NaN;
  let h = NaN;
  let hw = NaN;
  if (qq) {
    l = centre - qq[0] * scale;
    h = centre + qq[1] * scale;
    hw = (Math.exp(h) - Math.exp(l)) / (2 * Math.exp(centre));
    out.lowPsf = Math.exp(l);
    out.highPsf = Math.exp(h);
    out.halfWidth = hw;
  }
  const typ = out.typicalSize;
  if (q.bed > R.maxBedrooms) out.reason = "bedrooms_not_validated";
  else if (R.refuseClasses.includes(cls)) out.reason = "no_close_comparables";
  else if (f.n < R.minComps || W < R.minWeight - EPS || W < R.minWeightKnown - EPS || f.n1 < R.minOwn) out.reason = "too_few_comparables";
  else if ((!Number.isNaN(f.lsr_w) && f.lsr_w > R.maxLsr) || (typ !== null && (q.size / typ < R.typLo || q.size / typ > R.typHi))) out.reason = "size_too_far";
  else if (!qq) out.reason = "no_calibration";
  else if (hw > R.maxHalfWidth) out.reason = "range_too_wide";
  else {
    out.shown = true;
    out.rangeLowPsf = roundHalfEven(Math.exp(l) / R.rounding) * R.rounding;
    out.rangeHighPsf = roundHalfEven(Math.exp(h) / R.rounding) * R.rounding;
    // The asking price as the page prints it (whole AED per sq ft), so the outcome never contradicts the figures beside it.
    if (q.askingPsf !== undefined && q.askingPsf !== null) {
      const ask = Math.floor(q.askingPsf + 0.5);
      out.verdict = ask > out.rangeHighPsf ? "above" : ask < out.rangeLowPsf ? "below" : "within";
    }
  }
  return out;
}
