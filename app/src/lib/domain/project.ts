/**
 * The project resolver (REAL_DATA.md section 15.8): the words of a listing ("Azizi Venice 15, Dubai
 * South", "Binghatti Flare, JVC") to one DLD project of the loaded data, for a building that is not in
 * the data. Pure TypeScript; the project rows are passed in (`buildProjectIndex`).
 *
 * A "project" here is one of:
 * - the buildings of one DLD project number (`project_number`);
 * - the numbered phases of one project name in one DLD area ("AZIZI VENICE 1" to "Azizi Venice 16",
 *   "DAMAC LAGOONS - LAGOON VIEWS 1" to "13"): the name with its trailing number, roman numeral,
 *   single letter or "phase N" taken off.
 * Its key is that name, normalised. A key of fewer than two words (other than "the", "by" and the like)
 * is never used: "Reef 998", "Oxford 212" or "The 8" do not name a project safely.
 *
 * Exact words only, never a near spelling. It never guesses:
 * - `resolved`: exactly one project key occurs in the text as whole words, in one DLD area (the
 *   listing's area decides between areas when it names one of them);
 * - `ambiguous`: two different projects, or one key in several areas that the text does not settle;
 * - `unresolved`: nothing found, a community or area name only, another emirate, or an area that
 *   contradicts the project.
 */
import { normaliseArea } from "./area";

export interface ProjectRow {
  /** The DLD building name. */
  building: string;
  /** The registered project name (buildings.project). */
  project: string;
  /** The DLD project number, as text ("" when none). */
  projectNumber: string;
  areaDld: string;
  /** "" when none. */
  masterProject: string;
}

export interface ProjectGroup {
  /** The normalised key ("azizi venice"). */
  key: string;
  areaDld: string;
  /** The name as written, from the most common spelling, without its trailing number ("Azizi Venice"). */
  name: string;
  /** The DLD project numbers of its buildings, sorted. */
  projectNumbers: string[];
  /** The community, when all its buildings share one; else "". */
  masterProject: string;
  /** The normalised names of its buildings in the data that can be told apart in a listing (see `buildingNeedle`). */
  buildings: string[];
  /** The normalised full names of its numbered projects ("azizi venice 3"): a listing that names one names a project in the data. */
  projects: string[];
}

export interface ProjectIndex {
  groups: ProjectGroup[];
  /** Groups by key (one per DLD area). */
  byKey: Map<string, ProjectGroup[]>;
  /** Normalised community names, to tell "a community only" from "nothing". */
  communities: Set<string>;
}

export type ProjectResolution =
  | { status: "resolved"; group: ProjectGroup; matched: string }
  | { status: "ambiguous"; candidates: ProjectGroup[]; matched: string[] }
  | { status: "unresolved"; why: "nothing" | "community_only" | "other_emirate" | "area_conflict" | "building_in_data" };

/** Words that do not count towards the two a key needs. */
const MINOR = new Set(["the", "a", "an", "of", "by", "at", "and"]);
/** A trailing building or phase designator: "1", "02", "iii", "b", "phase 4" (repeated: "13 a"). */
const TRAILING = /(?:\s+(?:phase\s+)?(?:[0-9]+|[ivx]+|[a-h]))+$/;
export const PROJECT_MAX_CHARS = 240;
export const PROJECT_MAX_CANDIDATES = 4;

/**
 * Places outside Dubai that listings name. A text with one of them is never resolved, whatever
 * else it says: a Dubai project name inside it would be a coincidence ("Marina" on Al Reem Island).
 */
export const OTHER_EMIRATES: readonly string[] = [
  "abu dhabi",
  "sharjah",
  "ajman",
  "ras al khaimah",
  "rak",
  "umm al quwain",
  "uaq",
  "fujairah",
  "al ain",
  "reem island",
  "al reem",
  "yas island",
  "saadiyat",
  "al raha",
  "masdar",
  "aljada",
  "al majaz",
  "al khan",
  "al marjan island",
  "marjan island",
  "hayat island",
  "mina al arab",
  "muwaileh",
  "tilal city",
  "al zahia",
  "al mamzar sharjah",
];

/** The normalised key of a registered project name, or null when it cannot name a project safely. */
export function projectKey(name: string): string | null {
  const norm = normaliseArea(name);
  const stripped = norm.includes(" ") ? ` ${norm}`.replace(TRAILING, "").trim() : norm;
  const words = stripped.split(" ").filter((w) => w !== "" && !MINOR.has(w));
  return words.length >= 2 ? stripped : null;
}

/** Words that do not tell one building of a project from another. */
const GENERIC = new Set(["tower", "towers", "building", "buildings", "block", "residence", "residences", "phase", "apartments", "apartment", "plot", "cluster", "twr", "bldg"]);

/**
 * A building's name as a listing would write it, normalised, or null when it is too plain to find in
 * a listing ("Tower 1", "Building A"): it needs two words that are neither minor, generic nor designators.
 */
export function buildingNeedle(name: string): string | null {
  const norm = normaliseArea(name);
  const words = norm.split(" ").filter((w) => w !== "" && !MINOR.has(w) && !GENERIC.has(w) && !/^(?:[0-9]+|[ivx]+|[a-h])$/.test(w));
  return words.length >= 2 ? norm : null;
}

/** The name as written without its trailing designator: "AZIZI VENICE 15" to "AZIZI VENICE". */
function strippedName(name: string): string {
  const s = name.replace(/[\s\-_,.]+$/g, "").trim();
  // Take words off the end while the normalised name still ends in a designator.
  const words = s.split(/\s+/);
  while (words.length > 1) {
    const last = normaliseArea(words[words.length - 1]);
    if (last === "" || /^(?:[0-9]+|[ivx]+|[a-h]|phase)$/.test(last)) words.pop();
    else break;
  }
  return words.join(" ").replace(/[\s\-_,.]+$/g, "").trim();
}

/**
 * Groups the rows by key and DLD area. Rows without a project number or a usable key are left out,
 * and so is a key that is also the name of a place: a community, a DLD area or one of `placeNames`
 * (the area aliases, normalised), so "Dubai Marina" in a listing's area never reads as a project.
 */
export function buildProjectIndex(rows: readonly ProjectRow[], placeNames: Iterable<string> = []): ProjectIndex {
  const acc = new Map<string, { key: string; areaDld: string; numbers: Set<string>; names: Map<string, number>; masters: Set<string>; buildings: Set<string>; projects: Set<string> }>();
  const communities = new Set<string>();
  const places = new Set<string>([...placeNames].map(normaliseArea));
  for (const r of rows) {
    if (r.masterProject) {
      const c = normaliseArea(r.masterProject);
      if (c) communities.add(c);
    }
    if (r.areaDld) places.add(normaliseArea(r.areaDld));
  }
  for (const c of communities) places.add(c);
  for (const r of rows) {
    if (!r.projectNumber || !r.areaDld) continue;
    const key = projectKey(r.project);
    if (key === null || places.has(key)) continue;
    const id = `${key}|${r.areaDld}`;
    let g = acc.get(id);
    if (!g) acc.set(id, (g = { key, areaDld: r.areaDld, numbers: new Set(), names: new Map(), masters: new Set(), buildings: new Set(), projects: new Set() }));
    g.numbers.add(r.projectNumber);
    const needle = buildingNeedle(r.building);
    if (needle) g.buildings.add(needle);
    const full = normaliseArea(r.project);
    if (full !== key) g.projects.add(full);
    const shown = strippedName(r.project);
    g.names.set(shown, (g.names.get(shown) ?? 0) + 1);
    g.masters.add(r.masterProject);
  }
  const groups: ProjectGroup[] = [...acc.values()]
    .map((g) => ({
      key: g.key,
      areaDld: g.areaDld,
      // The most common spelling; on a tie the one with lower-case letters (as people write it), then the first in order.
      name: [...g.names.entries()].sort((x, y) => y[1] - x[1] || Number(/[a-z]/.test(y[0])) - Number(/[a-z]/.test(x[0])) || (x[0] < y[0] ? -1 : 1))[0][0],
      projectNumbers: [...g.numbers].sort(),
      masterProject: g.masters.size === 1 ? [...g.masters][0] : "",
      buildings: [...g.buildings].sort(),
      projects: [...g.projects].sort(),
    }))
    .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : x.areaDld < y.areaDld ? -1 : x.areaDld > y.areaDld ? 1 : 0));
  const byKey = new Map<string, ProjectGroup[]>();
  for (const g of groups) {
    const list = byKey.get(g.key);
    if (list) list.push(g);
    else byKey.set(g.key, [g]);
  }
  return { groups, byKey, communities };
}

/** Every occurrence of `needle` (normalised, space-separated words) in ` text ` as whole words. */
function occurrences(t: string, needle: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const n = ` ${needle} `;
  for (let at = t.indexOf(n); at !== -1; at = t.indexOf(n, at + 1)) out.push({ start: at, end: at + n.length });
  return out;
}

/**
 * Resolves the project of a listing from its building text and area text. `areaDld` is the area the
 * area resolver found for the listing (null when it found none); it only ever narrows the answer.
 */
export function resolveProject(
  input: { buildingText: string | null | undefined; areaText?: string | null; areaDld?: string | null },
  index: ProjectIndex,
): ProjectResolution {
  const raw = `${input.buildingText ?? ""} , ${input.areaText ?? ""}`.slice(0, PROJECT_MAX_CHARS);
  const norm = normaliseArea(raw);
  if (norm === "") return { status: "unresolved", why: "nothing" };
  const t = ` ${norm} `;
  if (OTHER_EMIRATES.some((p) => t.includes(` ${p} `))) return { status: "unresolved", why: "other_emirate" };

  // Every key that occurs as whole words; a match inside a longer match is dropped.
  const found: Array<{ key: string; start: number; end: number }> = [];
  for (const key of index.byKey.keys()) for (const o of occurrences(t, key)) found.push({ key, ...o });
  const outer = found.filter((m) => !found.some((o) => o !== m && o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start));
  const keys = [...new Set(outer.map((m) => m.key))].sort();
  if (keys.length === 0) {
    for (const c of index.communities) if (occurrences(t, c).length > 0) return { status: "unresolved", why: "community_only" };
    return { status: "unresolved", why: "nothing" };
  }
  let candidates = keys.flatMap((k) => index.byKey.get(k) ?? []);
  if (input.areaDld) {
    const inArea = candidates.filter((g) => g.areaDld === input.areaDld);
    // The listing's area names another place than every candidate: refuse rather than choose.
    if (inArea.length === 0) return { status: "unresolved", why: "area_conflict" };
    candidates = inArea;
  }
  if (candidates.length === 1) {
    const group = candidates[0];
    // The listing names a building of this project that IS in the data (by a name the matcher should
    // have found): the comparison must not say that the building has no registered sales. Refuse.
    if (group.buildings.some((b) => occurrences(t, b).length > 0)) return { status: "unresolved", why: "building_in_data" };
    // The same for a numbered project of the group that is in the data ("Azizi Venice 3"): the listing's
    // building may be one of its buildings under another name.
    if (group.projects.some((p) => occurrences(t, p).length > 0)) return { status: "unresolved", why: "building_in_data" };
    return { status: "resolved", group, matched: group.key };
  }
  return { status: "ambiguous", candidates: candidates.slice(0, PROJECT_MAX_CANDIDATES), matched: keys };
}
