/**
 * The snapshot statistics of the adjusted-registered-sales model (REAL_DATA.md section 16.2), built
 * by `npm run data:build` on every data refresh: the time index, the size slopes, the other-bedrooms
 * fit and the project families. Pure functions, no I/O.
 *
 * It is the TypeScript side of scripts/model/acs/acs.py (`Ctx.build`), tindex.py and the family rule of
 * prep.py. tests/unit/acs/build-parity.test.ts (run on request: it is slow) holds the two to 1e-9 on
 * the data of the fit. Change neither side alone.
 *
 * Input: every cleaned flat sale of the 1,461 days to the data date (the snapshot keeps 36 months;
 * the time index needs 48), and the project family of each building.
 */
import { ACS_INDEX_MONTHS, ACS_MONTH_DAYS, acsDay, acsMedian, collapseAcs, type AcsModel, type AcsSaleRow } from "@/lib/domain/acs";
import { ACS_EPOCH, ACS_MODEL_VERSION, type AcsConstantsFile, type AcsModelFile } from "./model";

export interface AcsBuildSale {
  /** The sale's ref; the pool order of a building is the order of its refs. */
  ref: string;
  /** The building key (the app's `dld_key`). */
  building: string;
  /** The DLD area as written. */
  area: string;
  /** YYYY-MM-DD. */
  date: string;
  bedrooms: number;
  /** 0 ready, 1 off-plan. */
  basis: 0 | 1;
  sizeSqft: number;
  priceAed: number;
}

export interface AcsBuildInput {
  dataThrough: string;
  /** Sales of other days are ignored. */
  sales: Iterable<AcsBuildSale>;
  /** Building key to its project family key; a building without a family is absent. */
  families: ReadonlyMap<string, string>;
}

/** The statistics of one snapshot: an `AcsModel` without the fit. */
export type AcsStatistics = Omit<AcsModel, "params" | "range"> & { indexSales: number };

/** The days of the time index: 48 months of 30.4375 days. */
export const ACS_INDEX_DAYS = Math.round(ACS_INDEX_MONTHS * ACS_MONTH_DAYS);
/** The days of the pool (and of the size slopes): a sale of day T - 1095 is out. */
export const ACS_POOL_DAYS = 1095;
/** Half a year, in days: the time step inside which sizes are compared. */
const HALF_YEAR = 183;
/** The area index: shrinkage to the Dubai index (in sales per month) and smoothing in time. */
const AREA_K = 20;
const AREA_LAM = 50;
const SLOPE_MIN_ROWS = 200;

// ---------- small linear algebra (48 x 48 and 5 x 5) ----------

/** Eigenvalues and eigenvectors (columns of `v`) of a symmetric matrix: cyclic Jacobi. */
export function symmetricEigen(a: readonly (readonly number[])[]): { values: number[]; v: number[][] } {
  const n = a.length;
  const m = a.map((r) => [...r]);
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j): number => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    let diag = 0;
    for (let i = 0; i < n; i++) {
      diag += m[i][i] * m[i][i];
      for (let j = i + 1; j < n; j++) off += m[i][j] * m[i][j];
    }
    if (off <= 1e-30 * (diag + off) || off === 0) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = m[p][q];
        if (apq === 0) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = m[k][p];
          const akq = m[k][q];
          m[k][p] = c * akp - s * akq;
          m[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = m[p][k];
          const aqk = m[q][k];
          m[p][k] = c * apk - s * aqk;
          m[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: m.map((r, i) => r[i]), v };
}

/**
 * The minimum-norm least-squares solution of a symmetric positive semi-definite system (what
 * numpy.linalg.lstsq returns): directions whose eigenvalue is under 1e-12 of the largest are left out.
 */
export function solveMinNorm(a: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const n = a.length;
  const { values, v } = symmetricEigen(a);
  let top = 0;
  for (const x of values) top = Math.max(top, Math.abs(x));
  const out = new Array<number>(n).fill(0);
  if (top === 0) return out;
  for (let j = 0; j < n; j++) {
    if (!(values[j] > 1e-12 * top)) continue;
    let dot = 0;
    for (let i = 0; i < n; i++) dot += v[i][j] * rhs[i];
    const f = dot / values[j];
    for (let i = 0; i < n; i++) out[i] += f * v[i][j];
  }
  return out;
}

/** Solves a square system with partial pivoting. Throws when it is singular. */
export function solveSquare(a: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const n = a.length;
  const m = a.map((r, i) => [...r, rhs[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (m[p][c] === 0) throw new Error("solveSquare: singular matrix");
    if (p !== c) [m[p], m[c]] = [m[c], m[p]];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x;
}

// ---------- helpers ----------

/** Dense ids (0..G-1) of string keys, in order of first appearance. */
function denseIds(keys: readonly string[] | readonly number[]): { id: Int32Array; n: number } {
  const map = new Map<string | number, number>();
  const id = new Int32Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    let g = map.get(keys[i]);
    if (g === undefined) {
      g = map.size;
      map.set(keys[i], g);
    }
    id[i] = g;
  }
  return { id, n: map.size };
}

/** v minus the mean of its group. */
function demean(v: ArrayLike<number>, g: Int32Array, G: number): Float64Array {
  const sum = new Float64Array(G);
  const cnt = new Float64Array(G);
  for (let i = 0; i < v.length; i++) {
    sum[g[i]] += v[i];
    cnt[g[i]]++;
  }
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] - sum[g[i]] / Math.max(cnt[g[i]], 1);
  return out;
}

function medianAbs(v: ArrayLike<number>, keep?: Uint8Array): number {
  const a: number[] = [];
  for (let i = 0; i < v.length; i++) if (!keep || keep[i]) a.push(Math.abs(v[i]));
  return a.length ? acsMedian(a) : NaN;
}

/**
 * The slope of y on x inside groups, with one robust pass: rows whose residual is over 4 robust
 * standard deviations are dropped and the slope is fitted again. NaN when x does not vary.
 */
export function withinGroupSlope(y: ArrayLike<number>, x: ArrayLike<number>, g: Int32Array, G: number): number {
  const n = y.length;
  let yd = demean(y, g, G);
  let xd = demean(x, g, G);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += xd[i] * xd[i];
    sxy += xd[i] * yd[i];
  }
  if (!(sxx > 0)) return NaN;
  const b0 = sxy / sxx;
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = yd[i] - b0 * xd[i];
  const limit = 4 * Math.max(1.4826 * medianAbs(r), 1e-9);
  const keep = new Uint8Array(n);
  const sy = new Float64Array(G);
  const sx = new Float64Array(G);
  const sw = new Float64Array(G);
  for (let i = 0; i < n; i++) {
    if (Math.abs(r[i]) <= limit) {
      keep[i] = 1;
      sy[g[i]] += y[i];
      sx[g[i]] += x[i];
      sw[g[i]]++;
    }
  }
  yd = new Float64Array(n);
  xd = new Float64Array(n);
  sxx = 0;
  sxy = 0;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const w = Math.max(sw[g[i]], 1e-12);
    yd[i] = y[i] - sy[g[i]] / w;
    xd[i] = x[i] - sx[g[i]] / w;
    sxx += xd[i] * xd[i];
    sxy += xd[i] * yd[i];
  }
  return sxx > 0 ? sxy / sxx : NaN;
}

interface Rows {
  n: number;
  day: Int32Array;
  b: Int32Array;
  bed: Int8Array;
  basis: Int8Array;
  ls: Float64Array;
  lp: Float64Array;
}

/** The size slope of each segment (basis x bedrooms capped at 4) over the pool days; a thin segment takes the slope of the bedroom count below. */
function segmentSlopes(R: Rows, T: number): number[][] {
  const out = [new Array<number>(5).fill(0), new Array<number>(5).fill(0)];
  for (const s of [0, 1]) {
    for (let k = 0; k < 5; k++) {
      const idx: number[] = [];
      for (let i = 0; i < R.n; i++) if (R.day[i] > T - ACS_POOL_DAYS && R.basis[i] === s && Math.min(R.bed[i], 4) === k) idx.push(i);
      let slope = NaN;
      if (idx.length >= SLOPE_MIN_ROWS) {
        const { id, n } = denseIds(idx.map((i) => `${R.b[i]}|${R.bed[i]}|${Math.floor((T - R.day[i]) / HALF_YEAR)}`));
        slope = withinGroupSlope(
          idx.map((i) => R.lp[i]),
          idx.map((i) => R.ls[i]),
          id,
          n,
        );
      }
      out[s][k] = Number.isFinite(slope) ? slope : out[s][Math.max(k - 1, 0)];
    }
  }
  return out;
}

/**
 * Month effects with the cell effects absorbed, from whole cells (`cells`: the row lists). Without
 * `ridge` the minimum-norm solution; with it, the deviation from `offset`, shrunk and smoothed.
 */
function monthEffects(
  cells: readonly number[][],
  mo: Int32Array,
  y: Float64Array,
  w: Float64Array,
  offset: readonly number[] | null,
  ridge: { k: number; lam: number } | null,
): number[] {
  const M = ACS_INDEX_MONTHS;
  const A = Array.from({ length: M }, () => new Array<number>(M).fill(0));
  const rhs = new Array<number>(M).fill(0);
  const N = new Float64Array(M);
  for (const rows of cells) {
    N.fill(0);
    let nc = 0;
    let syc = 0;
    for (const i of rows) {
      if (w[i] === 0) continue;
      N[mo[i]] += w[i];
      nc += w[i];
      syc += w[i] * y[i];
      rhs[mo[i]] += w[i] * y[i];
    }
    if (!(nc > 0)) continue;
    const months: number[] = [];
    for (let m = 0; m < M; m++) if (N[m] !== 0) months.push(m);
    for (const m1 of months) {
      A[m1][m1] += N[m1];
      rhs[m1] -= (N[m1] / nc) * syc;
      for (const m2 of months) A[m1][m2] -= (N[m1] * N[m2]) / nc;
    }
  }
  if (offset) {
    for (let i = 0; i < M; i++) {
      let s = 0;
      for (let j = 0; j < M; j++) s += A[i][j] * offset[j];
      rhs[i] -= s;
    }
  }
  if (!ridge) return solveMinNorm(A, rhs);
  for (let i = 0; i < M; i++) {
    // k x identity, and lam x the random-walk penalty (first differences).
    A[i][i] += ridge.k + ridge.lam * (i === 0 || i === M - 1 ? 1 : 2);
    if (i > 0) A[i][i - 1] -= ridge.lam;
    if (i < M - 1) A[i][i + 1] -= ridge.lam;
  }
  return solveSquare(A, rhs);
}

/** The most frequent value (ties: the first in code-unit order). */
function mostCommon(m: Map<string, number>): string {
  let best = "";
  let n = 0;
  for (const [v, c] of m) {
    if (c > n || (c === n && v < best)) {
      best = v;
      n = c;
    }
  }
  return best;
}

/** Least squares by the normal equations (minimum norm when a column is empty). */
function leastSquares(X: readonly Float64Array[], y: Float64Array, keep?: Uint8Array): number[] {
  const p = X.length;
  const A = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const rhs = new Array<number>(p).fill(0);
  for (let i = 0; i < y.length; i++) {
    if (keep && !keep[i]) continue;
    for (let a = 0; a < p; a++) {
      const xa = X[a][i];
      if (xa === 0) continue;
      rhs[a] += xa * y[i];
      for (let b = a; b < p; b++) A[a][b] += xa * X[b][i];
    }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) A[a][b] = A[b][a];
  return solveMinNorm(A, rhs);
}

/** Builds the statistics of one snapshot. Throws when the input has no sale in the pool days. */
export function buildAcsStatistics(input: AcsBuildInput): AcsStatistics {
  const T = acsDay(ACS_EPOCH, input.dataThrough);
  const src: AcsBuildSale[] = [];
  const days: number[] = [];
  for (const s of input.sales) {
    const d = acsDay(ACS_EPOCH, s.date);
    if (d > T || d <= T - ACS_INDEX_DAYS) continue;
    src.push(s);
    days.push(d);
  }
  const n = src.length;
  const bIds = denseIds(src.map((s) => s.building));
  const bKeys = new Array<string>(bIds.n);
  const bAreas = Array.from({ length: bIds.n }, () => new Map<string, number>());
  const R: Rows = { n, day: Int32Array.from(days), b: bIds.id, bed: new Int8Array(n), basis: new Int8Array(n), ls: new Float64Array(n), lp: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    const s = src[i];
    bKeys[R.b[i]] = s.building;
    const areas = bAreas[R.b[i]];
    areas.set(s.area, (areas.get(s.area) ?? 0) + 1);
    R.bed[i] = s.bedrooms;
    R.basis[i] = s.basis;
    R.ls[i] = Math.log(s.sizeSqft);
    R.lp[i] = Math.log(s.priceAed / s.sizeSqft);
  }
  const bArea = bAreas.map(mostCommon);

  const seg = segmentSlopes(R, T);

  // ---- the time index: every sale of the 48 months, cell effects absorbed
  const mo = new Int32Array(n);
  for (let i = 0; i < n; i++) mo[i] = Math.min(Math.floor((T - R.day[i]) / ACS_MONTH_DAYS), ACS_INDEX_MONTHS - 1);
  const cellIds = denseIds(Array.from({ length: n }, (_, i) => (R.b[i] * 8 + R.bed[i]) * 2 + R.basis[i]));
  const cellRows: number[][] = Array.from({ length: cellIds.n }, () => []);
  for (let i = 0; i < n; i++) cellRows[cellIds.id[i]].push(i);
  const y = new Float64Array(n);
  for (const rows of cellRows) {
    let mean = 0;
    for (const i of rows) mean += R.ls[i];
    mean /= rows.length;
    for (const i of rows) y[i] = R.lp[i] - seg[R.basis[i]][Math.min(R.bed[i], 4)] * (R.ls[i] - mean);
  }
  const w = new Float64Array(n).fill(1);
  const cellsOfBasis = [0, 1].map((s) => cellRows.filter((rows) => R.basis[rows[0]] === s));
  const tau: number[][] = [[], []];
  for (let pass = 0; pass < 2; pass++) {
    for (const s of [0, 1]) {
      const t = monthEffects(cellsOfBasis[s], mo, y, w, null, null);
      tau[s] = t.map((x) => x - t[0]);
    }
    if (pass === 0) {
      const res = new Float64Array(n);
      for (let i = 0; i < n; i++) res[i] = y[i] - tau[R.basis[i]][mo[i]];
      const dev = demean(res, cellIds.id, cellIds.n);
      const sd = 1.4826 * medianAbs(dev);
      for (let i = 0; i < n; i++) w[i] = Math.abs(dev[i]) <= 4 * sd ? 1 : 0;
    }
  }
  const byArea = new Map<string, number[][]>();
  for (const rows of cellRows) {
    const k = `${bArea[R.b[rows[0]]]}\u0000${R.basis[rows[0]]}`;
    const l = byArea.get(k);
    if (l) l.push(rows);
    else byArea.set(k, [rows]);
  }
  const thetaByArea = new Map<string, number[]>();
  for (const [k, cells] of byArea) {
    const s = Number(k.slice(k.indexOf("\u0000") + 1));
    const d = monthEffects(cells, mo, y, w, tau[s], { k: AREA_K, lam: AREA_LAM });
    thetaByArea.set(
      k,
      d.map((x, i) => tau[s][i] + x),
    );
  }

  // ---- the pool: the sales of the pool days, collapsed per building and basis
  const perBuilding = new Map<string, AcsSaleRow[]>();
  let poolSales = 0;
  for (let i = 0; i < n; i++) {
    if (R.day[i] <= T - ACS_POOL_DAYS) continue;
    poolSales++;
    const k = `${R.b[i]}|${R.basis[i]}`;
    const row: AcsSaleRow = { ref: src[i].ref, buildingKey: src[i].building, day: R.day[i], bed: src[i].bedrooms, size: src[i].sizeSqft, price: src[i].priceAed };
    const l = perBuilding.get(k);
    if (l) l.push(row);
    else perBuilding.set(k, [row]);
  }
  if (poolSales === 0) throw new Error("buildAcsStatistics: no sale in the pool days");
  const pb: number[] = [];
  const pbed: number[] = [];
  const pbasis: number[] = [];
  const pday: number[] = [];
  const pls: number[] = [];
  const plp: number[] = [];
  for (const [k, list] of perBuilding) {
    const [b, basis] = k.split("|").map(Number);
    for (const r of collapseAcs(list)) {
      pb.push(b);
      pbed.push(r.bed);
      pbasis.push(basis);
      pday.push(r.day);
      pls.push(Math.log(r.size));
      plp.push(Math.log(r.psf));
    }
  }
  const pn = pb.length;
  const half = pday.map((d) => Math.floor((T - d) / HALF_YEAR));

  // ---- size statistics of each cell (building x bedrooms x basis), inside half-years
  const cellKey = pb.map((b, i) => `${b}|${pbed[i]}|${pbasis[i]}`);
  const groups = denseIds(cellKey.map((k, i) => `${k}|${half[i]}`));
  const xd = demean(pls, groups.id, groups.n);
  const yd = demean(plp, groups.id, groups.n);
  const stat = new Map<string, [number, number]>();
  for (let i = 0; i < pn; i++) {
    let st = stat.get(cellKey[i]);
    if (!st) {
      st = [0, 0];
      stat.set(cellKey[i], st);
    }
    st[0] += xd[i] * xd[i];
    st[1] += xd[i] * yd[i];
  }

  // ---- the other-bedrooms fit, per basis: ln psf = effect(building x half-year) + step(bedrooms) + beta2 x ln size
  const beta2 = [0, 0];
  const prem = [new Array<number>(5).fill(0), new Array<number>(5).fill(0)];
  for (const s of [0, 1]) {
    const idx: number[] = [];
    for (let i = 0; i < pn; i++) if (pbasis[i] === s) idx.push(i);
    if (idx.length === 0) continue;
    const g = denseIds(idx.map((i) => `${pb[i]}|${half[i]}`));
    const cols = [idx.map((i) => pls[i]), ...[1, 2, 3, 4].map((k) => idx.map((i) => (Math.min(pbed[i], 4) === k ? 1 : 0)))];
    const X = cols.map((c) => demean(c, g.id, g.n));
    const yy = demean(
      idx.map((i) => plp[i]),
      g.id,
      g.n,
    );
    let co = leastSquares(X, yy);
    const res = new Float64Array(idx.length);
    for (let i = 0; i < idx.length; i++) {
      let fit = 0;
      for (let a = 0; a < 5; a++) fit += X[a][i] * co[a];
      res[i] = yy[i] - fit;
    }
    const limit = 4 * 1.4826 * medianAbs(res);
    const keep = new Uint8Array(idx.length);
    for (let i = 0; i < idx.length; i++) keep[i] = Math.abs(res[i]) < limit ? 1 : 0;
    co = leastSquares(X, yy, keep);
    beta2[s] = co[0];
    for (let k = 1; k <= 4; k++) prem[s][k] = co[k];
  }

  // ---- the buildings of the pool, by key; their areas, time indexes and families
  const used = [...new Set(pb)].sort((x, y2) => (bKeys[x] < bKeys[y2] ? -1 : bKeys[x] > bKeys[y2] ? 1 : 0));
  if (new Set(used.map((b) => bKeys[b])).size !== used.length) throw new Error("buildAcsStatistics: two buildings have one key");
  const at = new Map<number, number>(used.map((b, i) => [b, i]));
  const areas = [...new Set(used.map((b) => bArea[b]))].sort();
  const areaAt = new Map<string, number>(areas.map((a, i) => [a, i]));
  const theta: Record<string, number[]> = {};
  for (const a of areas) {
    for (const s of [0, 1]) {
      const th = thetaByArea.get(`${a}\u0000${s}`);
      if (th) theta[`${areaAt.get(a)}|${s}`] = th;
    }
  }
  const famCount = new Map<string, number>();
  for (const b of used) {
    const f = input.families.get(bKeys[b]);
    if (f) famCount.set(f, (famCount.get(f) ?? 0) + 1);
  }
  const famId = new Map<string, number>([...famCount.entries()].filter(([, c]) => c > 1).map(([f]) => f).sort().map((f, i) => [f, i + 1]));
  const cellSlope: AcsModel["cellSlope"] = [];
  for (const [k, [sxx, sxy]] of stat) {
    if (!(sxx > 1e-12)) continue;
    const [b, bed, basis] = k.split("|").map(Number);
    cellSlope.push([at.get(b) as number, bed, basis, sxx, sxy]);
  }
  cellSlope.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);

  return {
    version: ACS_MODEL_VERSION,
    kind: "acs-model",
    dataThrough: input.dataThrough,
    epoch: ACS_EPOCH,
    T,
    poolFromDay: T - ACS_POOL_DAYS + 1,
    areas,
    tau,
    theta,
    seg,
    beta2,
    prem,
    buildings: {
      key: used.map((b) => bKeys[b]),
      area: used.map((b) => areaAt.get(bArea[b]) as number),
      family: used.map((b) => famId.get(input.families.get(bKeys[b]) ?? "") ?? 0),
    },
    cellSlope,
    indexSales: n,
  };
}

/** The model file of a snapshot: its statistics with the fit they are used with. */
export function acsModelFile(stats: AcsStatistics, constants: AcsConstantsFile, snapshotSha256: string): AcsModelFile {
  const { indexSales: _indexSales, ...rest } = stats;
  void _indexSales;
  return {
    ...rest,
    params: constants.params,
    range: constants.range,
    constantsVersion: constants.version,
    fittedOn: { dataThrough: constants.fittedOn.dataThrough, snapshotSha256: constants.fittedOn.snapshotSha256 },
    tested: { heldOf10: constants.tested.heldOf10, heldLaterOf10: constants.tested.heldLaterOf10 },
    snapshotSha256,
  } as AcsModelFile;
}

// ---------- the project family of a building (prep.py) ----------

const STOP = new Set(["the", "a", "an", "of", "by", "at", "and"]);
const TRAIL = /(\s+(phase\s+)?([0-9]+|[ivx]+|[a-h]))+$/;

/** A project name as compared: lower case, no accents, "&" as "and", letters and digits only. */
export function familyNameNorm(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .join(" ");
}

/** The name of a numbered or lettered phase without its number ("azizi venice 12" gives "azizi venice"); null when it is no phase name. */
export function familyGroupName(project: string): string | null {
  const s = familyNameNorm(project);
  const s2 = s.includes(" ") ? ` ${s}`.replace(TRAIL, "").trim() : s;
  if (s2 === s) return null;
  return s2.split(" ").filter((t) => !STOP.has(t)).length >= 2 ? s2 : null;
}

/**
 * The project family of a building: the numbered phases of one project name in one DLD area, else
 * its DLD project number. Null without a project number.
 */
export function familyKey(projectNumber: string, project: string, area: string): string | null {
  if (!projectNumber) return null;
  const g = familyGroupName(project);
  return g ? `${g}|${area}` : `#${projectNumber}`;
}
