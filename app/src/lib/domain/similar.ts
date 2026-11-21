/**
 * The similar-buildings comparison (REAL_DATA.md section 15): the second tier, used only when the
 * same-building comparison cannot run. Pure TypeScript, no I/O.
 *
 * Two parts:
 * - `buildSimilarArtifact(sales, buildings)`: once per snapshot (`npm run data:build`), one cell per
 *   building, bedroom count and basis with its 12-month median and its older medians.
 * - `compareSimilar(artifact, constants, request)`: per request. It combines up to five pieces of
 *   evidence about where the building's own median sits (its 1 to 4 sales of the 12 months, its
 *   older sales, its other bedroom types, and the medians of similar buildings of the same project,
 *   community or DLD area), each weighted by the spread the backtest measured, and returns a range.
 *   The range is shown only when the rule of step 7 allows it.
 *
 * Words such as "centre" are internal. Nothing here is copy, and the centre is never shown as a figure.
 * The numbers must stay exactly those of the verified reference: tests/unit/domain/similar.test.ts
 * reproduces every golden case to 1e-9.
 */

export type SimilarBasis = "ready" | "off_plan";
export type SimilarLevel = "project" | "community" | "area";
export type SimilarEvidenceClass = SimilarLevel | "own" | "indirect";
export type SimilarReason =
  | "bedrooms_not_validated"
  | "no_evidence"
  | "no_building_evidence"
  | "own_sales_only"
  | "evidence_disagrees"
  | "range_too_wide";
export type SimilarTier = "close" | "broad";
export type SimilarVerdict = "above" | "within" | "below";

export interface SimilarSale {
  /** YYYY-MM-DD */
  date: string;
  building: string;
  areaDld: string;
  bedrooms: number;
  sizeSqft: number;
  priceAed: number;
  completion: SimilarBasis;
}

export interface SimilarBuilding {
  building: string;
  areaDld: string;
  /** "" when none. */
  projectNumber: string;
  /** "" when none. */
  masterProject: string;
}

/** One building x bedrooms x basis with at least one kept sale in the 36 months. */
export interface SimilarCell {
  /** Index into `artifact.buildings`. */
  b: number;
  bed: number;
  basis: SimilarBasis;
  /** Sales in the 12 months to dataThrough, before unusual ones are set aside. */
  nRaw12: number;
  /** Sales the product median used (after the 0.5x to 2x rule when nRaw12 is 5 or more). */
  n12: number;
  /** Product median AED per sq ft of those sales; null when nRaw12 is 0. */
  med12: number | null;
  /** Sales 12 to 24 months before dataThrough (count before the rule) and their product median. */
  nOld1: number;
  medOld1: number | null;
  /** Sales 24 to 36 months before dataThrough. */
  nOld2: number;
  medOld2: number | null;
}

export interface SimilarArtifactBuilding extends SimilarBuilding {
  /** The key a request names the building by. `npm run data:build` uses `${building}|${areaDld}`. */
  key: string;
}

export interface SimilarArtifact {
  version: 1;
  dataThrough: string;
  /** dataThrough - 365 days (inclusive). */
  windowStart: string;
  buildings: SimilarArtifactBuilding[];
  cells: SimilarCell[];
}

/** The fitted constants (src/lib/similar/constants.json). `range80` already includes the thin-cell factor. */
export interface SimilarConstants {
  version: number;
  minComparableSales: number;
  levelMinBuildings: Record<SimilarLevel, number>;
  maxBedrooms: number;
  countBuckets: number[];
  spreadDivisor: number;
  otherBedroomsWeightK: number;
  /** [a2, b2]: variance = a2 + b2 x spread squared. */
  referenceVariance: Record<SimilarLevel, Record<SimilarBasis, [number, number]>>;
  evidenceVariance: Record<"own" | "older12to24" | "older24to36" | "otherBedrooms", Record<SimilarBasis, Record<string, number>>>;
  /** [floor, lower multiplier, upper multiplier] per evidence class. */
  range80: Record<SimilarEvidenceClass, [number, number, number]>;
  maxHalfWidth: number;
  closeHalfWidth: number;
  neverShownClasses: SimilarEvidenceClass[];
  displayRounding: number;
  /**
   * The consistency rules of version 2 (REAL_DATA.md section 15.3). Absent in constants of version 1
   * (the frozen golden cases), where they are off.
   * - requireEvidenceBeyondOwnSales: a range that would rest on the 1 to 4 sales of the 12 months alone is not shown.
   * - maxOwnMedianRatio: not shown when the building's own medians (the 12 months, 12 to 24 and 24 to 36
   *   months back) are further apart than this ratio.
   * - ownMedianInsideRange: not shown when the median of the building's own sales of the 12 months is
   *   outside the rounded range.
   */
  requireEvidenceBeyondOwnSales?: boolean;
  maxOwnMedianRatio?: number;
  ownMedianInsideRange?: boolean;
}

export interface SimilarRequest {
  bedrooms: number;
  basis: SimilarBasis;
  /** Asking price / size. */
  askingPsf: number;
  /** Known building: its key in the artifact. */
  buildingKey?: string;
  /** Unknown building: where it is. masterProject and projectNumber only when resolved with confidence. */
  scope?: { areaDld: string; masterProject?: string; projectNumber?: string };
}

export interface SimilarResult {
  shown: boolean;
  reason: SimilarReason | null;
  tier: SimilarTier | null;
  evidenceClass: SimilarEvidenceClass | null;
  /** The level the comparable buildings came from, with their counts. */
  level: SimilarLevel | null;
  comparableBuildings: number;
  comparableSales: number;
  /** Unrounded internals (never shown as a single figure). */
  centrePsf: number | null;
  lowPsf: number | null;
  highPsf: number | null;
  halfWidth: number | null;
  /** What the person sees: the range rounded to displayRounding, and the outcome against exactly that range. Null when not shown. */
  rangeLowPsf: number | null;
  rangeHighPsf: number | null;
  verdict: SimilarVerdict | null;
  evidence: {
    ownSales: { n: number; medianPsf: number } | null;
    older12to24: { n: number; medianPsf: number } | null;
    older24to36: { n: number; medianPsf: number } | null;
    otherBedrooms: { n: number; offset: number } | null;
  };
}

// ---------- shared small functions ----------

const middle = (sortedAsc: readonly number[]) => (sortedAsc[(sortedAsc.length - 1) >> 1] + sortedAsc[sortedAsc.length >> 1]) / 2;

/**
 * The product median (REAL_DATA.md section 7): sort, take the middle (the mean of the two middles);
 * with 5 or more values leave out those under 0.5x or over 2x it, once, and recompute.
 */
export function productMedian(values: readonly number[]): { median: number | null; used: number } {
  if (values.length === 0) return { median: null, used: 0 };
  let s = [...values].sort((a, b) => a - b);
  let m = middle(s);
  if (s.length >= 5) {
    s = s.filter((v) => v >= 0.5 * m && v <= 2 * m);
    m = middle(s);
  }
  return { median: m, used: s.length };
}

/** Linear-interpolation quantile: position q x (n - 1). */
export function quantile(sortedAsc: readonly number[], q: number): number {
  const pos = q * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sortedAsc.length - 1);
  return sortedAsc[lo] + (pos - lo) * (sortedAsc[hi] - sortedAsc[lo]);
}

/** 0 for 0; with the edges [1, 2, 3, 5, 10, 20]: 1 = 1, 2 = 2, 3 = 3 to 4, 4 = 5 to 9, 5 = 10 to 19, 6 = 20 or more. */
export function countBucket(n: number, edges: readonly number[]): number {
  let b = 0;
  for (const e of edges) if (n >= e) b++;
  return b;
}

const dayNumber = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
const isoOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
const defaultKey = (building: string, areaDld: string) => `${building}|${areaDld}`;

// ---------- precompute ----------

/**
 * Builds the cells from the kept sales of a snapshot and its buildings. `keyOf` says which building
 * a sale belongs to (the snapshot builder passes the loader's `dldKey`, so both group alike); a sale
 * of a building missing from `buildings` throws. The result does not depend on the order of `sales`.
 */
export function buildSimilarArtifact(
  sales: Iterable<SimilarSale>,
  buildings: readonly SimilarBuilding[],
  keyOf: (building: string, areaDld: string) => string = defaultKey,
): SimilarArtifact {
  const index = new Map<string, number>();
  const out: SimilarArtifactBuilding[] = buildings.map((r, i) => {
    const k = keyOf(r.building, r.areaDld);
    if (index.has(k)) throw new Error(`two buildings share the key ${k}`);
    index.set(k, i);
    return { key: defaultKey(r.building, r.areaDld), building: r.building, areaDld: r.areaDld, projectNumber: r.projectNumber, masterProject: r.masterProject };
  });
  const groups = new Map<string, { b: number; bed: number; basis: SimilarBasis; day: number[]; psf: number[] }>();
  let through = -Infinity;
  for (const s of sales) {
    const b = index.get(keyOf(s.building, s.areaDld));
    if (b === undefined) throw new Error(`sale of a building missing from the buildings list: ${s.building}|${s.areaDld}`);
    const k = `${b}|${s.bedrooms}|${s.completion}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { b, bed: s.bedrooms, basis: s.completion, day: [], psf: [] }));
    const d = dayNumber(s.date);
    g.day.push(d);
    g.psf.push(s.priceAed / s.sizeSqft);
    if (d > through) through = d;
  }
  if (through === -Infinity) throw new Error("no sales");
  const cells: SimilarCell[] = [];
  for (const g of groups.values()) {
    const w: number[] = [];
    const o1: number[] = [];
    const o2: number[] = [];
    for (let i = 0; i < g.day.length; i++) {
      const d = g.day[i];
      if (d >= through - 365) w.push(g.psf[i]);
      else if (d >= through - 730) o1.push(g.psf[i]);
      else if (d >= through - 1095) o2.push(g.psf[i]);
    }
    const mw = productMedian(w);
    cells.push({
      b: g.b,
      bed: g.bed,
      basis: g.basis,
      nRaw12: w.length,
      n12: mw.used,
      med12: mw.median,
      nOld1: o1.length,
      medOld1: productMedian(o1).median,
      nOld2: o2.length,
      medOld2: productMedian(o2).median,
    });
  }
  cells.sort((x, y) => x.b - y.b || x.bed - y.bed || (x.basis < y.basis ? -1 : x.basis > y.basis ? 1 : 0));
  return { version: 1, dataThrough: isoOf(through), windowStart: isoOf(through - 365), buildings: out, cells };
}

// ---------- per request ----------

interface Lookup {
  byBuilding: Map<number, SimilarCell[]>;
  /** Comparable cells (nRaw12 >= minComparableSales) by `${areaDld}|${bed}|${basis}`. */
  comparable: Map<string, SimilarCell[]>;
  keyToIndex: Map<string, number>;
  minComparableSales: number;
}
const lookups = new WeakMap<SimilarArtifact, Lookup>();

function lookupOf(a: SimilarArtifact, c: SimilarConstants): Lookup {
  const cached = lookups.get(a);
  if (cached && cached.minComparableSales === c.minComparableSales) return cached;
  const l: Lookup = { byBuilding: new Map(), comparable: new Map(), keyToIndex: new Map(), minComparableSales: c.minComparableSales };
  a.buildings.forEach((b, i) => l.keyToIndex.set(b.key, i));
  for (const cell of a.cells) {
    const list = l.byBuilding.get(cell.b);
    if (list) list.push(cell);
    else l.byBuilding.set(cell.b, [cell]);
    if (cell.nRaw12 >= c.minComparableSales && cell.med12 !== null) {
      const k = `${a.buildings[cell.b].areaDld}|${cell.bed}|${cell.basis}`;
      const comp = l.comparable.get(k);
      if (comp) comp.push(cell);
      else l.comparable.set(k, [cell]);
    }
  }
  lookups.set(a, l);
  return l;
}

interface Reference {
  level: SimilarLevel;
  /** Median of ln(median AED per sq ft) over the comparable buildings. */
  ref: number;
  buildings: number;
  sales: number;
  variance: number;
  /** The comparable cells the reference was read from. */
  cells: SimilarCell[];
}

interface Place {
  areaDld: string;
  masterProject: string;
  projectNumber: string;
}

const LEVELS = ["project", "community", "area"] as const;

/** The first level with enough comparable buildings: project, then community, then area. Never includes `exclude`. */
function reference(a: SimilarArtifact, c: SimilarConstants, l: Lookup, p: Place, bed: number, basis: SimilarBasis, exclude: number): Reference | null {
  const cand = (l.comparable.get(`${p.areaDld}|${bed}|${basis}`) ?? []).filter((x) => x.b !== exclude);
  const sets: Record<SimilarLevel, SimilarCell[]> = {
    project: p.projectNumber ? cand.filter((x) => a.buildings[x.b].projectNumber === p.projectNumber) : [],
    community: p.masterProject ? cand.filter((x) => a.buildings[x.b].masterProject === p.masterProject) : [],
    area: cand,
  };
  for (const level of LEVELS) {
    const s = sets[level];
    if (s.length < c.levelMinBuildings[level]) continue;
    const logs = s.map((x) => Math.log(x.med12 as number)).sort((x, y) => x - y);
    const spread = level === "project" ? 0 : (quantile(logs, 0.9) - quantile(logs, 0.1)) / c.spreadDivisor;
    const [a2, b2] = c.referenceVariance[level][basis];
    return { level, ref: middle(logs), buildings: s.length, sales: s.reduce((n, x) => n + x.nRaw12, 0), variance: a2 + b2 * spread * spread, cells: s };
  }
  return null;
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

function noEvidence(): SimilarResult {
  return {
    shown: false,
    reason: "no_evidence",
    tier: null,
    evidenceClass: null,
    level: null,
    comparableBuildings: 0,
    comparableSales: 0,
    centrePsf: null,
    lowPsf: null,
    highPsf: null,
    halfWidth: null,
    rangeLowPsf: null,
    rangeHighPsf: null,
    verdict: null,
    evidence: { ownSales: null, older12to24: null, older24to36: null, otherBedrooms: null },
  };
}

/**
 * The comparison for one listing. Steps (REAL_DATA.md section 15.2): comparable cells; the
 * reference; the building's own evidence; the precision-weighted combination; the evidence class;
 * the range; the rule (section 15.3); the rounded range and the outcome.
 */
/** Where a request sits: its building's index (-1 without one) and its place; null when neither is known. */
function locate(a: SimilarArtifact, l: Lookup, req: Pick<SimilarRequest, "buildingKey" | "scope">): { b: number; place: Place } | null {
  let b = -1;
  let place: Place = { areaDld: req.scope?.areaDld ?? "", masterProject: req.scope?.masterProject ?? "", projectNumber: req.scope?.projectNumber ?? "" };
  if (req.buildingKey !== undefined) {
    const i = l.keyToIndex.get(req.buildingKey);
    if (i === undefined) return null;
    b = i;
    const { areaDld, masterProject, projectNumber } = a.buildings[i];
    place = { areaDld, masterProject, projectNumber };
  }
  return place.areaDld ? { b, place } : null;
}

/** One similar building behind a comparison: its 12-month sales of the same bedrooms and basis, and their median. */
export interface SimilarComparable {
  building: SimilarArtifactBuilding;
  sales: number;
  medianPsf: number;
}

/**
 * The similar buildings `compareSimilar` reads its reference from for this request (the same level and
 * the same cells, never the building itself), most sales first, then by name. Empty when there is no
 * reference. These are registered facts about other buildings; they say nothing about the range's centre.
 */
export function similarComparables(a: SimilarArtifact, c: SimilarConstants, req: Pick<SimilarRequest, "bedrooms" | "basis" | "buildingKey" | "scope">): SimilarComparable[] {
  const l = lookupOf(a, c);
  const at = locate(a, l, req);
  if (!at) return [];
  const ref = reference(a, c, l, at.place, req.bedrooms, req.basis, at.b);
  if (!ref) return [];
  return ref.cells
    .map((x) => ({ building: a.buildings[x.b], sales: x.nRaw12, medianPsf: x.med12 as number }))
    .sort(
      (x, y) =>
        y.sales - x.sales ||
        (x.building.building < y.building.building ? -1 : x.building.building > y.building.building ? 1 : 0) ||
        (x.building.key < y.building.key ? -1 : x.building.key > y.building.key ? 1 : 0),
    );
}

export function compareSimilar(a: SimilarArtifact, c: SimilarConstants, req: SimilarRequest): SimilarResult {
  const l = lookupOf(a, c);
  const at = locate(a, l, req);
  if (!at) return noEvidence();
  const { b, place } = at;
  const { bedrooms: bed, basis } = req;
  const ref = reference(a, c, l, place, bed, basis, b);
  let num = 0;
  let den = 0;
  const add = (estimate: number, variance: number) => {
    num += estimate / variance;
    den += 1 / variance;
  };
  if (ref) add(ref.ref, ref.variance);
  const evidence = noEvidence().evidence;
  let own = false;
  let indirect = false;
  if (b >= 0) {
    const mine = l.byBuilding.get(b) ?? [];
    const cell = mine.find((x) => x.bed === bed && x.basis === basis);
    if (cell) {
      if (cell.n12 >= 1 && cell.n12 <= 4 && cell.med12 !== null) {
        add(Math.log(cell.med12), c.evidenceVariance.own[basis][String(cell.n12)]);
        evidence.ownSales = { n: cell.n12, medianPsf: cell.med12 };
        own = true;
      }
      if (cell.nOld1 > 0 && cell.medOld1 !== null) {
        add(Math.log(cell.medOld1), c.evidenceVariance.older12to24[basis][String(countBucket(cell.nOld1, c.countBuckets))]);
        evidence.older12to24 = { n: cell.nOld1, medianPsf: cell.medOld1 };
        indirect = true;
      }
      if (cell.nOld2 > 0 && cell.medOld2 !== null) {
        add(Math.log(cell.medOld2), c.evidenceVariance.older24to36[basis][String(countBucket(cell.nOld2, c.countBuckets))]);
        evidence.older24to36 = { n: cell.nOld2, medianPsf: cell.medOld2 };
        indirect = true;
      }
    }
    if (ref) {
      // Other bedroom types of the same building and basis: how far each sits from its own reference.
      let sw = 0;
      let sd = 0;
      let n = 0;
      for (const other of [...mine].sort((x, y) => x.bed - y.bed)) {
        if (other.basis !== basis || other.bed === bed || other.nRaw12 < 1 || other.med12 === null) continue;
        const r = reference(a, c, l, place, other.bed, basis, b);
        if (!r) continue;
        const w = other.nRaw12 / (other.nRaw12 + c.otherBedroomsWeightK);
        sw += w;
        sd += w * (Math.log(other.med12) - r.ref);
        n += other.nRaw12;
      }
      if (n > 0) {
        add(ref.ref + sd / sw, c.evidenceVariance.otherBedrooms[basis][String(countBucket(n, c.countBuckets))]);
        evidence.otherBedrooms = { n, offset: sd / sw };
        indirect = true;
      }
    }
  }
  if (den === 0) return { ...noEvidence(), evidence };
  const centre = num / den;
  const s = 1 / Math.sqrt(den);
  const evidenceClass: SimilarEvidenceClass = own ? "own" : indirect ? "indirect" : (ref as Reference).level;
  const [floor, qLow, qHigh] = c.range80[evidenceClass];
  const spread = Math.sqrt(s * s + floor * floor);
  const low = centre - qLow * spread;
  const high = centre + qHigh * spread;
  const halfWidth = ((qLow + qHigh) / 2) * spread;
  const rangeLowPsf = roundTo(Math.exp(low), c.displayRounding);
  const rangeHighPsf = roundTo(Math.exp(high), c.displayRounding);
  // The building's own medians: the 12 months (when used) and the two older years.
  const ownMedians = [evidence.ownSales, evidence.older12to24, evidence.older24to36].flatMap((e) => (e ? [e.medianPsf] : []));
  const apart = ownMedians.length >= 2 ? Math.max(...ownMedians) / Math.min(...ownMedians) : 1;
  const ownOutside = evidence.ownSales !== null && (evidence.ownSales.medianPsf < rangeLowPsf || evidence.ownSales.medianPsf > rangeHighPsf);
  const reason: SimilarReason | null =
    bed > c.maxBedrooms
      ? "bedrooms_not_validated"
      : c.neverShownClasses.includes(evidenceClass)
        ? "no_building_evidence"
        : c.requireEvidenceBeyondOwnSales && own && !indirect && !ref
          ? "own_sales_only"
          : halfWidth > c.maxHalfWidth
            ? "range_too_wide"
            : (c.maxOwnMedianRatio !== undefined && apart > c.maxOwnMedianRatio) || (c.ownMedianInsideRange && ownOutside)
              ? "evidence_disagrees"
              : null;
  const shown = reason === null;
  return {
    shown,
    reason,
    tier: shown ? (halfWidth <= c.closeHalfWidth ? "close" : "broad") : null,
    evidenceClass,
    level: ref ? ref.level : null,
    comparableBuildings: ref ? ref.buildings : 0,
    comparableSales: ref ? ref.sales : 0,
    centrePsf: Math.exp(centre),
    lowPsf: Math.exp(low),
    highPsf: Math.exp(high),
    halfWidth,
    rangeLowPsf: shown ? rangeLowPsf : null,
    rangeHighPsf: shown ? rangeHighPsf : null,
    verdict: shown ? (req.askingPsf > rangeHighPsf ? "above" : req.askingPsf < rangeLowPsf ? "below" : "within") : null,
    evidence,
  };
}
