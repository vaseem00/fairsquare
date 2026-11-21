/**
 * Nearby registered sales (REAL_DATA.md section 17; scripts/model/nearby/SPEC.md): the last-resort
 * comparison for a listing whose own building gives no usable evidence. Registered sales of the same
 * bedroom count and basis in OTHER buildings of the community (and, when the community has too few
 * buildings, of the DLD area), each moved to the data date, to the listing's size and to the age of
 * its building, give a range. Own-building sales are never comparables.
 *
 * Pure TypeScript: no I/O, no dates beyond day numbers. It is written from SPEC.md step by step and
 * reproduces the Python reference (`nearby()` in scripts/model/nearby/make.py) on the golden cases
 * (tests/unit/domain/nearby-golden.test.ts). The time index and the size slopes are those of the
 * adjusted-registered-sales model of the loaded snapshot (domain/acs.ts).
 */

/** Why there is no range (SPEC.md section 6), in the order they are tested. */
export const NEARBY_RULE_REASONS = ["no_comparables", "bedrooms_not_validated", "too_few_buildings", "size_too_far", "no_calibration", "range_too_wide"] as const;
export type NearbyRuleReason = (typeof NEARBY_RULE_REASONS)[number];

export type NearbyKind = "in" | "out";
export type NearbyScope = "community" | "community_and_area" | "area";
export type NearbyVerdict = "above" | "within" | "below";

/** The fitted numbers (`constants.json`): the method's parameters, the rule, the age curves and the range multipliers. */
export interface NearbyConstants {
  params: {
    windowDays: number;
    ageHalfMonths: number;
    sizeHalf: number;
    cap: number;
    areaWeight: number;
    vintageHalfYears: number;
    minCommunityBuildings: number;
    countWeight: number;
    floor: number;
    far: readonly number[];
    thinBuildings: number;
  };
  rule: { maxBedrooms: number; minBuildings: number; minWeight: number; maxSizeDistance: number; maxHalfWidth: number; rounding: number };
  vintage: { readyAges: readonly number[]; ready: readonly number[]; offPlanAges: readonly number[]; offPlan: readonly number[] };
  range: Record<NearbyKind, Record<string, readonly number[] | undefined>>;
}

/** What the method reads from the adjusted-registered-sales model of the snapshot. */
export interface NearbyIndex {
  /** The data date as days since the epoch (2020-01-01). */
  T: number;
  /** DLD area name to its index in `theta` keys. */
  areas: ReadonlyMap<string, number>;
  /** `"<area index>|<basis>"` to 48 monthly values. */
  theta: Readonly<Record<string, readonly number[]>>;
  /** The Dubai index per basis: used when an area has none. */
  tau: readonly (readonly number[])[];
  /** The size slope per basis and bedroom count (0 to 4). */
  seg: readonly (readonly number[])[];
}

/** One registered sale of another building, as the one read returns it (SPEC.md section 2). */
export interface NearbySaleRow {
  ref: string;
  /** Any stable identity of the building (the database id). */
  buildingId: number | string;
  /** The building as shown. */
  building: string;
  /** buildings.area_dld of the row's building. */
  areaDld: string;
  /** Sale date as days since the epoch. */
  day: number;
  sizeSqft: number;
  priceAed: number;
  /** The building's first sale and first ready sale as days since the epoch; null when unknown. */
  firstSaleDay: number | null;
  firstReadySaleDay: number | null;
  /** The building is in the listing's community (master project). */
  inCommunity: boolean;
  /** The building is in the listing's DLD area. */
  inArea: boolean;
}

export interface NearbyRequest {
  bedrooms: number;
  /** 0 ready, 1 off-plan. */
  basis: 0 | 1;
  sizeSqft: number;
  askingPsf?: number | null;
  /** The listing's building when it is in the data (kind "in"): its two dates. Null: kind "out". */
  own: { firstSaleDay: number | null; firstReadySaleDay: number | null } | null;
  /** Whether a community (master project) and a DLD area are known for the listing. */
  masterKnown: boolean;
  areaKnown: boolean;
}

export interface NearbyComparable {
  ref: string;
  buildingId: number | string;
  building: string;
  day: number;
  sizeSqft: number;
  registeredPsf: number;
  timeLn: number;
  sizeLn: number;
  vintageLn: number;
  adjustedPsf: number;
  /** The row's share of the total weight, 0 to 1. */
  weightShare: number;
  /** The row counted with the community's weight (1); false for the rest of the area in the second pass. */
  inCommunity: boolean;
}

export interface NearbyBuildingShare {
  buildingId: number | string;
  building: string;
  weightShare: number;
  sales: number;
}

export interface NearbyResult {
  kind: NearbyKind;
  shown: boolean;
  reason: NearbyRuleReason | null;
  scope?: NearbyScope;
  group?: string;
  centrePsf?: number;
  /** Buildings that count (weight at least countWeight * cap). */
  buildings?: number;
  weight?: number;
  /** Rows with weight. */
  comparables?: number;
  sizeDistance?: number;
  lowPsf?: number;
  highPsf?: number;
  halfWidth?: number;
  rangeLowPsf?: number;
  rangeHighPsf?: number;
  verdict?: NearbyVerdict;
  /** Every row with weight, largest weight first (ties: ref ascending). Empty with no result. */
  rows: NearbyComparable[];
  /** Every building with a row, largest weight first (ties: name ascending). */
  buildingShares: NearbyBuildingShare[];
  /** True when the building-age adjustment was applied (kind "in", and kind "out" off-plan). */
  vintageAdjusted: boolean;
}

const MONTH = 30.4375;
const YEAR = 365.25;

/** The curve of a basis at an age in years: linear between the listed ages, flat outside them. */
export function nearbyVintage(v: NearbyConstants["vintage"], basis: 0 | 1, age: number): number {
  const xs = basis === 0 ? v.readyAges : v.offPlanAges;
  const ys = basis === 0 ? v.ready : v.offPlan;
  if (age <= xs[0]) return ys[0];
  if (age >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let j = 1; j < xs.length; j++) {
    if (age <= xs[j]) return ys[j - 1] + ((age - xs[j - 1]) / (xs[j] - xs[j - 1])) * (ys[j] - ys[j - 1]);
  }
  return ys[ys.length - 1];
}

/** The weighted quantile of SPEC.md step 10: `v` ascending (ties: smaller weight first), `w` > 0. */
export function nearbyQuantile(v: readonly number[], w: readonly number[], p: number): number {
  let tot = 0;
  for (const x of w) tot += x;
  const pp: number[] = [];
  let c = 0;
  for (const x of w) {
    c += x;
    pp.push((c - 0.5 * x) / tot);
  }
  const n = v.length;
  if (p <= pp[0]) return v[0];
  if (p >= pp[n - 1]) return v[n - 1];
  let j = 0;
  while (j < n && !(pp[j] > p)) j++;
  return v[j - 1] + ((p - pp[j - 1]) / (pp[j] - pp[j - 1])) * (v[j] - v[j - 1]);
}

interface Comp {
  row: NearbySaleRow;
  psf: number;
  lsr: number;
  timeLn: number;
  sizeLn: number;
  vintageLn: number;
  a: number;
  u: number;
  community: boolean;
}

interface Pass {
  centre: number;
  q10: number;
  q90: number;
  W: number;
  nb: number;
  sizeDistance: number;
  su: number;
  comps: Comp[];
}

const ageOf = (T: number, day: number | null) => (day === null ? null : (T - day) / YEAR);

/** One pass (SPEC.md section 3) over `rows` with their level weights. Null when no row has weight. */
function estimate(ix: NearbyIndex, c: NearbyConstants, q: NearbyRequest, rows: readonly NearbySaleRow[], levelWeight: (r: NearbySaleRow) => number): Pass | null {
  const P = c.params;
  const basis = q.basis;
  const kind: NearbyKind = q.own ? "in" : "out";
  const L = Math.log(q.sizeSqft);
  const seg = ix.seg[basis][Math.min(q.bedrooms, 4)];
  const useVintage = kind === "in" || basis === 1;
  let listingAge: number | null = null;
  let kernel = false;
  if (q.own) {
    const own = ageOf(ix.T, basis === 1 ? q.own.firstSaleDay : q.own.firstReadySaleDay);
    listingAge = own ?? 0;
    kernel = basis === 1 ? true : own !== null;
  } else if (basis === 1) {
    listingAge = 0;
  }
  const gT = useVintage ? nearbyVintage(c.vintage, basis, listingAge ?? 0) : 0;

  const comps: Comp[] = [];
  for (const row of rows) {
    const w0 = levelWeight(row);
    const ageMonths = (ix.T - row.day) / MONTH;
    const mo = Math.min(Math.floor((ix.T - row.day) / MONTH), 47);
    const at = ix.areas.get(row.areaDld);
    const th = (at === undefined ? undefined : ix.theta[`${at}|${basis}`]) ?? ix.tau[basis];
    const timeLn = th[0] - th[mo];
    const psf = row.priceAed / row.sizeSqft;
    const lsr = L - Math.log(row.sizeSqft);
    const sizeLn = seg * lsr;
    const rowAge = ageOf(ix.T, basis === 1 ? row.firstSaleDay : row.firstReadySaleDay);
    const vintageLn = useVintage ? gT - nearbyVintage(c.vintage, basis, rowAge ?? 0) : 0;
    let u = w0 * 0.5 ** (ageMonths / P.ageHalfMonths) * 0.5 ** ((lsr / P.sizeHalf) ** 2);
    if (kernel) {
      const ac = rowAge ?? (basis === 1 ? 50 : 0);
      u *= 0.5 ** (Math.abs(ac - (listingAge as number)) / P.vintageHalfYears);
    }
    if (u > 0) comps.push({ row, psf, lsr, timeLn, sizeLn, vintageLn, a: Math.log(psf) + timeLn + sizeLn + vintageLn, u, community: w0 === 1 });
  }
  if (comps.length === 0) return null;

  // The cap per building.
  const tot = new Map<number | string, number>();
  for (const x of comps) tot.set(x.row.buildingId, (tot.get(x.row.buildingId) ?? 0) + x.u);
  for (const x of comps) {
    const t = tot.get(x.row.buildingId) as number;
    if (t > P.cap) x.u *= P.cap / t;
  }
  let W = 0;
  let nb = 0;
  for (const t of tot.values()) {
    const wb = Math.min(t, P.cap);
    W += wb;
    if (wb >= P.countWeight * P.cap) nb++;
  }
  comps.sort((x, y) => x.a - y.a || x.u - y.u);
  const v = comps.map((x) => x.a);
  const w = comps.map((x) => x.u);
  let su = 0;
  for (const x of w) su += x;
  let dist = 0;
  for (const x of comps) dist += x.u * Math.abs(x.lsr);
  return { centre: nearbyQuantile(v, w, 0.5), q10: nearbyQuantile(v, w, 0.1), q90: nearbyQuantile(v, w, 0.9), W, nb, sizeDistance: dist / su, su, comps };
}

/**
 * The method (SPEC.md sections 3 to 7). `rows` are the sales of the one read: the same bedroom count
 * and basis, the 730 days to the data date, a building of the listing's DLD area or community, never
 * the listing's own building.
 */
export function estimateNearby(ix: NearbyIndex, c: NearbyConstants, q: NearbyRequest, rows: readonly NearbySaleRow[]): NearbyResult {
  const P = c.params;
  const R = c.rule;
  const kind: NearbyKind = q.own ? "in" : "out";
  const vintageAdjusted = kind === "in" || q.basis === 1;
  const out: NearbyResult = { kind, shown: false, reason: null, rows: [], buildingShares: [], vintageAdjusted };
  const inWindow = rows.filter((r) => r.day > ix.T - P.windowDays && r.day <= ix.T);

  let est: Pass | null = null;
  let scope: NearbyScope | null = null;
  if (q.masterKnown) {
    est = estimate(ix, c, q, inWindow.filter((r) => r.inCommunity), () => 1);
    scope = "community";
    if ((est === null || est.nb < P.minCommunityBuildings) && q.areaKnown) {
      est = estimate(ix, c, q, inWindow.filter((r) => r.inCommunity || r.inArea), (r) => (r.inCommunity ? 1 : P.areaWeight));
      scope = "community_and_area";
    }
  } else if (q.areaKnown) {
    est = estimate(ix, c, q, inWindow.filter((r) => r.inArea), () => 1);
    scope = "area";
  }
  if (est === null || scope === null) return { ...out, reason: "no_comparables" };

  const far = est.sizeDistance < P.far[0] ? "0" : est.sizeDistance < P.far[1] ? "1" : "2";
  const cls = est.nb < P.thinBuildings ? "t" : q.bedrooms === 3 ? "b" : scope === "community" ? `c${far}` : "a";
  const group = (q.basis === 0 ? "R" : "O") + cls;
  const mult = c.range[kind][group];
  const r: NearbyResult = { ...out, scope, group, centrePsf: Math.exp(est.centre), buildings: est.nb, weight: est.W, comparables: est.comps.length, sizeDistance: est.sizeDistance };

  let lo = 0;
  let hi = 0;
  let hw = 0;
  if (mult) {
    const sLow = Math.sqrt(Math.max(est.centre - est.q10, P.floor));
    const sHigh = Math.sqrt(Math.max(est.q90 - est.centre, P.floor));
    lo = est.centre - mult[0] * sLow;
    hi = est.centre + mult[1] * sHigh;
    hw = (Math.exp(hi) - Math.exp(lo)) / (2 * Math.exp(est.centre));
    r.lowPsf = Math.exp(lo);
    r.highPsf = Math.exp(hi);
    r.halfWidth = hw;
  }
  if (q.bedrooms > R.maxBedrooms) r.reason = "bedrooms_not_validated";
  else if (est.nb < R.minBuildings || est.W < R.minWeight - 1e-9) r.reason = "too_few_buildings";
  else if (est.sizeDistance > R.maxSizeDistance) r.reason = "size_too_far";
  else if (!mult) r.reason = "no_calibration";
  else if (hw > R.maxHalfWidth) r.reason = "range_too_wide";
  else {
    const step = R.rounding;
    const rlo = Math.floor(Math.exp(lo) / step + 0.5) * step;
    const rhi = Math.floor(Math.exp(hi) / step + 0.5) * step;
    r.shown = true;
    r.rangeLowPsf = rlo;
    r.rangeHighPsf = rhi;
    if (q.askingPsf !== null && q.askingPsf !== undefined) {
      const ask = Math.floor(q.askingPsf + 0.5);
      r.verdict = ask > rhi ? "above" : ask < rlo ? "below" : "within";
    }
  }

  const su = est.su;
  r.rows = [...est.comps]
    .sort((x, y) => y.u - x.u || (x.row.ref < y.row.ref ? -1 : x.row.ref > y.row.ref ? 1 : 0))
    .map((x) => ({
      ref: x.row.ref,
      buildingId: x.row.buildingId,
      building: x.row.building,
      day: x.row.day,
      sizeSqft: x.row.sizeSqft,
      registeredPsf: x.psf,
      timeLn: x.timeLn,
      sizeLn: x.sizeLn,
      vintageLn: x.vintageLn,
      adjustedPsf: Math.exp(x.a),
      weightShare: x.u / su,
      inCommunity: x.community,
    }));
  const by = new Map<number | string, NearbyBuildingShare>();
  for (const x of est.comps) {
    const b = by.get(x.row.buildingId) ?? { buildingId: x.row.buildingId, building: x.row.building, weightShare: 0, sales: 0 };
    b.weightShare += x.u;
    b.sales += 1;
    by.set(x.row.buildingId, b);
  }
  r.buildingShares = [...by.values()]
    .sort((x, y) => y.weightShare - x.weightShare || (x.building < y.building ? -1 : x.building > y.building ? 1 : 0))
    .map((b) => ({ ...b, weightShare: b.weightShare / su }));
  return r;
}
