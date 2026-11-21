/** Fuzzy building matching (port of the web JS matched/score/candidates/preselect). */
import { GENERIC, normalise } from "./normalise";

export const MATCH_FLOOR = 0.62;
export const STRONG_MATCH = 0.8;
export const AREA_BONUS = 0.05;
export const MAX_CANDIDATES = 3;
export const MAX_QUERY_CHARS = 120;

export interface AliasRow {
  buildingId: number;
  aliasNorm: string;
  name: string;
  area: string;
}
export type MatchStrength = "strong" | "possible";
export interface Candidate {
  buildingId: number;
  name: string;
  area: string;
  score: number;
  strength: MatchStrength;
}

// Two reusable rows for the longest-common-substring table (no allocation per call).
let dpPrev = new Int32Array(128);
let dpCur = new Int32Array(128);

/** Ratcliff–Obershelp on a[a0, a1) and b[b0, b1): the first longest common block, then both sides. */
function blocks(a: string, a0: number, a1: number, b: string, b0: number, b1: number): number {
  if (a0 >= a1 || b0 >= b1) return 0;
  const lb = b1 - b0;
  if (dpPrev.length <= lb) {
    dpPrev = new Int32Array(lb * 2 + 1);
    dpCur = new Int32Array(lb * 2 + 1);
  }
  let prev = dpPrev;
  let cur = dpCur;
  prev.fill(0, 0, lb + 1);
  cur[0] = 0;
  let best = 0;
  let ai = 0;
  let bi = 0;
  for (let i = a0; i < a1; i++) {
    const ca = a.charCodeAt(i);
    for (let j = 1; j <= lb; j++) {
      if (ca === b.charCodeAt(b0 + j - 1)) {
        const v = prev[j - 1] + 1;
        cur[j] = v;
        // Strictly longer only: the first block found (lowest a end, then lowest b end) wins ties.
        if (v > best) {
          best = v;
          ai = i + 1 - v;
          bi = b0 + j - v;
        }
      } else cur[j] = 0;
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  if (best === 0) return 0;
  return best + blocks(a, a0, ai, b, b0, bi) + blocks(a, ai + best, a1, b, bi + best, b1);
}

/** Ratcliff–Obershelp: number of matching characters (recursive longest common substring). */
export function matchedChars(a: string, b: string): number {
  if (!a || !b) return 0;
  return blocks(a, 0, a.length, b, 0, b.length);
}

/** 2*M/(|a|+|b|), 0 when either is empty. Same as difflib ratio without autojunk. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return (2 * matchedChars(a, b)) / (a.length + b.length);
}

const words = (s: string) => s.split(" ").filter(Boolean);
const isDigits = (w: string) => /^\d+$/.test(w);

/** A normalised string with everything scoring needs, computed once. */
interface Prepared {
  norm: string;
  words: ReadonlySet<string>;
  /** The words the overlap counts: the non-generic ones, or all of them when every word is generic. */
  base: readonly string[];
  /** `base` without numbers: the query words an alias must contain (numbers have their own rule). */
  named: readonly string[];
  digits: readonly string[];
  /** Character counts (a–z, 0–9, space, other): an upper bound for the matching characters. */
  hist: Uint16Array;
}

const HIST_SIZE = 38;
const SPACE = 36;

function histogram(s: string): Uint16Array {
  const h = new Uint16Array(HIST_SIZE);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 97 && c <= 122) h[c - 97]++;
    else if (c >= 48 && c <= 57) h[c - 22]++;
    else if (c === 32) h[SPACE]++;
    else h[37]++;
  }
  return h;
}

/** Prepared from a set of distinct words (the norm and its histogram are given). */
function fromWords(norm: string, set: ReadonlySet<string>, hist: Uint16Array): Prepared {
  const all = [...set];
  const distinct = all.filter((w) => !GENERIC.has(w));
  const base = distinct.length ? distinct : all;
  return { norm, words: set, base, named: base.filter((w) => !isDigits(w)), digits: all.filter(isDigits), hist };
}

function prepare(norm: string): Prepared {
  return fromWords(norm, new Set(words(norm)), histogram(norm));
}

/**
 * `prepare(`${a.norm} ${b.norm}`.trim())` built from two prepared parts: the histograms add up (plus
 * the joining space) and the word sets join, so nothing is split or counted twice.
 */
function prepareJoined(a: Prepared, b: Prepared): Prepared {
  if (!b.norm) return a;
  if (!a.norm) return b;
  const hist = new Uint16Array(HIST_SIZE);
  for (let i = 0; i < HIST_SIZE; i++) hist[i] = a.hist[i] + b.hist[i];
  hist[SPACE]++;
  const set = new Set(a.words);
  for (const w of b.words) set.add(w);
  return fromWords(`${a.norm} ${b.norm}`, set, hist);
}

/** The number rule's penalty when both have numbers and none is shared. */
const NUMBER_MISMATCH = 0.25;
/** The number rule's penalty when only one of the two has numbers. */
const NUMBER_ONE_SIDE = 0.15;

/** The number rule: 0.25 when both have numbers and none is shared, 0.15 when only one has numbers. */
function numberPenalty(q: Prepared, a: Prepared): number {
  if (q.digits.length && a.digits.length && !q.digits.some((w) => a.digits.includes(w))) return NUMBER_MISMATCH;
  if (q.digits.length > 0 !== a.digits.length > 0) return NUMBER_ONE_SIDE;
  return 0;
}

/**
 * Word overlap both ways: the share of the alias's distinctive words found in the query, capped by
 * the share of the query's distinctive words (numbers aside) found in the alias. One way only, a
 * short alias whose words all appear in the query ("Gate Tower 1", "Test Tower") scored 1, exactly
 * like the exact name ("Test Gate 1"), and DLD has thousands of such short "X Tower" names. Numbers
 * stay with the number rule, so "Mockup Crest 2" still finds "Mockup Crest Tower" (at 0.85).
 */
function overlapOf(q: Prepared, a: Prepared): number {
  let n = 0;
  for (const w of a.base) if (q.words.has(w)) n++;
  if (n === 0) return 0;
  const aliasShare = n / a.base.length;
  if (q.named.length === 0) return aliasShare;
  let m = 0;
  for (const w of q.named) if (a.words.has(w)) m++;
  return Math.min(aliasShare, m / q.named.length);
}

/** Character-count bound on `similarity` (difflib's quick_ratio): matching characters ≤ shared counts. */
function quickRatio(q: Prepared, a: Prepared): number {
  let common = 0;
  for (let i = 0; i < HIST_SIZE; i++) common += Math.min(q.hist[i], a.hist[i]);
  return (2 * common) / (q.norm.length + a.norm.length);
}

/**
 * An upper bound on `scorePrepared(q, a, ·)`: never below the exact score. `sharesWord` false means
 * the alias (with its area) has no word of the query, so its word overlap is 0 without looking.
 */
function scoreBound(q: Prepared, a: Prepared, sharesWord = true): number {
  if (!q.norm || !a.norm) return 0;
  const overlap = sharesWord ? overlapOf(q, a) : 0;
  return Math.max(quickRatio(q, a), overlap) - numberPenalty(q, a);
}

/**
 * The score of an alias, or -Infinity when it cannot reach `minUseful` (then the expensive character
 * match is skipped; the bound never prunes a score that could reach it, so results are unchanged).
 */
function scorePrepared(q: Prepared, a: Prepared, minUseful: number): number {
  if (!q.norm || !a.norm) return 0;
  const overlap = overlapOf(q, a);
  const penalty = numberPenalty(q, a);
  if (overlap - penalty < minUseful && quickRatio(q, a) - penalty < minUseful) return -Infinity;
  const sim = similarity(q.norm, a.norm);
  if (sim > overlap && sim - penalty >= STRONG_MATCH && !namesAgree(q, a)) {
    // The letters match mostly through shared generic words ("residence tower 2"), while a distinctive
    // word of the query has no counterpart: "Marriott Residences Tower 2" is not "May Residence Tower 2".
    // Such a row stays a possible match and is never pre-selected.
    return Math.max(Math.min(sim - penalty, WEAK_NAME_CAP), overlap - penalty);
  }
  return Math.max(sim, overlap) - penalty;
}

/** The highest score of a row whose distinctive words do not agree with the query's: below strong. */
const WEAK_NAME_CAP = STRONG_MATCH - 0.01;
/** How alike two words must be to count as the same word with a typo ("mariott", "marriot"). */
const WORD_ALIKE = 0.75;

/** True when every distinctive word of the query (numbers aside) has a counterpart in the alias. */
function namesAgree(q: Prepared, a: Prepared): boolean {
  if (q.named.length === 0) return true;
  const joined = a.norm.replaceAll(" ", "");
  return q.named.every((w) => {
    if (a.words.has(w) || (w.length >= 4 && joined.includes(w))) return true;
    for (const x of a.words) {
      if (isDigits(x)) continue;
      if (x.length >= 4 && w.includes(x) && !GENERIC.has(x)) return true;
      if (similarity(w, x) >= WORD_ALIKE) return true;
    }
    return false;
  });
}

/** queryNorm and aliasNorm are already normalised. */
export function scoreAlias(queryNorm: string, aliasNorm: string): number {
  if (!queryNorm || !aliasNorm) return 0;
  return scorePrepared(prepare(queryNorm), prepare(aliasNorm), -Infinity);
}

interface PreparedRow {
  row: AliasRow;
  areaNorm: string;
  alias: Prepared;
  /** The alias followed by the area ("test tower a dubai marina"). */
  withArea: Prepared;
  /** The building's normalised name, and that name without its numbers (`towerKey`). */
  nameKey: string;
  towerKey: string;
}

/**
 * Prepared rows per alias array: building it normalises every area once; later queries on the same
 * array (getAliasRows caches it for 60 s) reuse it. Rebuilt if the array's length changes.
 */
interface PreparedSet {
  length: number;
  rows: PreparedRow[];
  /** Rows by `towerKey`, for the numbered siblings of a match. */
  byTowerKey: Map<string, PreparedRow[]>;
  /** Row positions by word (of the alias with its area): rows sharing no word with a query skip the overlap. */
  byWord: Map<string, number[]>;
}
const prepared = new WeakMap<readonly AliasRow[], PreparedSet>();

function prepareRows(rows: readonly AliasRow[]): PreparedSet {
  const hit = prepared.get(rows);
  if (hit && hit.length === rows.length) return hit;
  const areas = new Map<string, Prepared>();
  const names = new Map<string, { nameKey: string; towerKey: string }>();
  const byTowerKey = new Map<string, PreparedRow[]>();
  const byWord = new Map<string, number[]>();
  const out = rows.map((row, index) => {
    let area = areas.get(row.area);
    if (area === undefined) {
      area = prepare(normalise(row.area));
      areas.set(row.area, area);
    }
    let name = names.get(row.name);
    if (name === undefined) {
      const nameKey = normalise(row.name);
      name = { nameKey, towerKey: towerKeyOf(nameKey) };
      names.set(row.name, name);
    }
    const alias = prepare(row.aliasNorm);
    const p: PreparedRow = { row, areaNorm: area.norm, alias, withArea: prepareJoined(alias, area), ...name };
    const group = byTowerKey.get(p.towerKey);
    if (group) group.push(p);
    else byTowerKey.set(p.towerKey, [p]);
    // withArea's words include the alias's own.
    for (const w of p.withArea.words) {
      const at = byWord.get(w);
      if (at) at.push(index);
      else byWord.set(w, [index]);
    }
    return p;
  });
  const set = { length: rows.length, rows: out, byTowerKey, byWord };
  prepared.set(rows, set);
  return set;
}

/**
 * Prepares an alias array for matching ahead of the first query (getAliasRows does this after each
 * load, so the one-off preparation never lands on a person's request). Idempotent.
 */
export function prepareAliasRows(rows: readonly AliasRow[]): void {
  prepareRows(rows);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** A normalised building name without its numbers: "test gate 1" and "test gate 2" share one. */
function towerKeyOf(nameNorm: string): string {
  return words(nameNorm)
    .filter((w) => !isDigits(w))
    .join(" ");
}

/** One alias row's score: `raw` includes the area bonus; which forms (alias, alias + area) reached it. */
interface Scored {
  p: PreparedRow;
  raw: number;
  viaAlias: boolean;
  viaArea: boolean;
  /** Character similarity of the query with the form that scored (cached): how exact the match is. */
  exact?: number;
}

function exactness(q: Prepared, s: Scored): number {
  if (s.exact === undefined) {
    s.exact = Math.max(
      s.viaAlias ? similarity(q.norm, s.p.alias.norm) : 0,
      s.viaArea ? similarity(q.norm, s.p.withArea.norm) : 0,
    );
  }
  return s.exact;
}

/** Two scored rows of one building with the same alias and area text: equally exact. */
function sameForms(a: Scored, b: Scored): boolean {
  return a.p.alias.norm === b.p.alias.norm && a.p.areaNorm === b.p.areaNorm && a.viaAlias === b.viaAlias && a.viaArea === b.viaArea;
}

/** Scores one row; null when it cannot reach `minUseful + bonus` or `floor`. */
function scoreRow(q: Prepared, p: PreparedRow, bonus: number, minUseful: number, floor = MATCH_FLOOR): Scored | null {
  const a = scorePrepared(q, p.alias, minUseful);
  const b = scorePrepared(q, p.withArea, minUseful);
  const m = Math.max(a, b);
  const raw = m + bonus;
  if (!(raw >= floor)) return null;
  return { p, raw, viaAlias: a === m, viaArea: b === m };
}

/**
 * A numbered sibling of the top match is shown when it would reach MATCH_FLOOR but for the number
 * rule ("Test Gate 1" for "Test Gate 2 Tower" scores 0.46: 0.71 less the 0.25 for a different number).
 */
const SIBLING_FLOOR = MATCH_FLOOR - NUMBER_MISMATCH;

/**
 * The ranking: the score, then how exact the match is (an exact name before a longer one with the
 * same words), then the name, then the lower building id (rows come ordered by building id), so the
 * result never depends on the scoring order.
 */
function rank(q: Prepared, x: Scored, y: Scored): number {
  return (
    y.raw - x.raw ||
    exactness(q, y) - exactness(q, x) ||
    x.p.row.name.localeCompare(y.p.row.name) ||
    x.p.row.buildingId - y.p.row.buildingId
  );
}

/**
 * Up to 3 buildings whose aliases score at least MATCH_FLOOR, best first (ties by how exact the
 * match is, then by name). When the query has a number and the best building has a numbered sibling
 * ("Test Gate 1" and "Test Gate 2") that would match but for its number (SIBLING_FLOOR), the best
 * such sibling is always among the 3, in the last place when it was not there already, so the
 * tower-number check is never lost to other names crowding the list.
 *
 * Branch and bound over a cheap upper bound per row (character counts and word overlap), so the full
 * Ratcliff–Obershelp match runs only on rows that can still change the top 3. Rows are scored in
 * order of their bound and the scan stops once three buildings score strictly more than every
 * remaining bound: the result is exactly that of scoring every row.
 */
export function findCandidates(
  query: string,
  rows: readonly AliasRow[],
  areaHint?: string | null,
): Candidate[] {
  const q = normalise(String(query ?? "").slice(0, MAX_QUERY_CHARS));
  if (!q) return [];
  const qp = prepare(q);
  const hint = areaHint ? normalise(areaHint) : "";
  const set = prepareRows(rows);
  const bonusOf = (p: PreparedRow) => (hint && p.areaNorm.includes(hint) ? AREA_BONUS : 0);

  // The rows that share a word with the query: only they can have a word overlap.
  const sharing = new Uint8Array(set.rows.length);
  for (const w of qp.words) for (const i of set.byWord.get(w) ?? []) sharing[i] = 1;

  const open: Array<{ p: PreparedRow; bonus: number; bound: number }> = [];
  for (let i = 0; i < set.rows.length; i++) {
    const p = set.rows[i];
    const bonus = bonusOf(p);
    const shares = sharing[i] === 1;
    const alias = scoreBound(qp, p.alias, shares);
    const bound = (p.withArea === p.alias ? alias : Math.max(alias, scoreBound(qp, p.withArea, shares))) + bonus;
    if (bound >= MATCH_FLOOR) open.push({ p, bonus, bound });
  }
  open.sort((x, y) => y.bound - x.bound);

  const best = new Map<number, Scored>();
  // The three highest building scores so far, highest first.
  const top: number[] = [];
  for (const { p, bonus, bound } of open) {
    const third = top.length === MAX_CANDIDATES ? top[MAX_CANDIDATES - 1] : -Infinity;
    if (bound < third) break;
    // A tie with the third score can still win on exactness or the name, so prune only clearly lower
    // scores (the epsilon absorbs rounding between "x − bonus" and "x + bonus" forms).
    const minUseful = Math.max(MATCH_FLOOR - bonus, third - bonus - 1e-9);
    const s = scoreRow(qp, p, bonus, minUseful);
    if (!s) continue;
    const prev = best.get(p.row.buildingId);
    // A building keeps its best alias; on equal scores, the more exact one (the same alias text, as
    // a "The ..." variant often normalises to, cannot be more exact).
    if (prev && (s.raw < prev.raw || (s.raw === prev.raw && (sameForms(prev, s) || exactness(qp, s) <= exactness(qp, prev))))) continue;
    best.set(p.row.buildingId, s);
    if (prev) {
      const i = top.indexOf(prev.raw);
      if (i >= 0) top.splice(i, 1);
    }
    top.push(s.raw);
    top.sort((a, b) => b - a);
    if (top.length > MAX_CANDIDATES) top.length = MAX_CANDIDATES;
  }

  const shown = [...best.values()].sort((x, y) => rank(qp, x, y)).slice(0, MAX_CANDIDATES);
  const lead = shown[0];
  if (qp.digits.length > 0 && lead && lead.p.towerKey && !shown.some((s) => s !== lead && isSibling(lead.p, s.p))) {
    // REAL_DATA.md section 5: two towers that differ only by a number are flagged. When the query
    // has a number, a sibling with another number loses 0.25 and other names can push it out of the
    // top 3: it then takes the last place, so the person sees both towers and checks the number.
    let sibling: Scored | null = null;
    for (const p of set.byTowerKey.get(lead.p.towerKey) ?? []) {
      if (!isSibling(lead.p, p)) continue;
      const s = scoreRow(qp, p, bonusOf(p), -Infinity, SIBLING_FLOOR);
      if (s && (!sibling || rank(qp, s, sibling) < 0)) sibling = s;
    }
    if (sibling) shown.splice(Math.min(shown.length, MAX_CANDIDATES - 1), 1, sibling);
  }

  return shown.map((s) => ({
    buildingId: s.p.row.buildingId,
    name: s.p.row.name,
    area: s.p.row.area,
    score: round3(s.raw),
    strength: s.raw >= STRONG_MATCH ? "strong" : "possible",
  }));
}

/** Another building whose name differs from `a`'s only by its numbers ("Test Gate 1", "Test Gate 2"). */
function isSibling(a: PreparedRow, b: PreparedRow): boolean {
  return b.row.buildingId !== a.row.buildingId && b.towerKey === a.towerKey && b.nameKey !== a.nameKey;
}

/**
 * The top candidate's building id when its score is strong and no other candidate scores the same;
 * otherwise null. With a tie (two buildings with the same name in different areas, or two names that
 * fit the query equally well), the person chooses.
 */
export function preselect(cands: readonly Candidate[]): number | null {
  const [top, next] = cands;
  if (!top || top.strength !== "strong") return null;
  if (next && next.score === top.score) return null;
  return top.buildingId;
}

/**
 * True when two candidates have the same name once numbers are removed but different names
 * ("Test Tower 1" vs "Test Tower 2"). The UI then asks to check the tower number.
 */
export function needsTowerCheck(cands: readonly Candidate[]): boolean {
  const seen = new Map<string, string>();
  for (const c of cands) {
    const name = normalise(c.name);
    const key = towerKeyOf(name);
    const other = seen.get(key);
    if (other !== undefined && other !== name) return true;
    if (other === undefined) seen.set(key, name);
  }
  return false;
}

/**
 * True when two candidates have exactly the same name (DLD names repeat across areas, REAL_DATA.md
 * section 5). The UI then asks to check the area, not the tower number.
 */
export function needsAreaCheck(cands: readonly Candidate[]): boolean {
  const seen = new Set<string>();
  for (const c of cands) {
    const name = normalise(c.name);
    if (seen.has(name)) return true;
    seen.add(name);
  }
  return false;
}
