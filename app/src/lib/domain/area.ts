/**
 * The area resolver (REAL_DATA.md section 15.5): the area a listing writes ("JVC", "Downtown Dubai,
 * Dubai", "Marina") to the official DLD area and, when it is named, the master project (community).
 * Pure TypeScript; the alias table is passed in (src/lib/similar/area-aliases.json).
 *
 * It never guesses silently. The answer is one of:
 * - `resolved`: every area name found points to one DLD area;
 * - `ambiguous`: the text names a place that spans several DLD areas ("Meydan", "Dubailand"), names
 *   two different areas, or is close to a known name without being it (a misspelling). The
 *   candidates are returned so the flow can ask one question; none is chosen;
 * - `unresolved`: nothing known was found.
 */
import { similarity } from "./match";

export interface AreaAlias {
  /** Normalised with `normaliseArea`. */
  alias: string;
  /** Null for a name that spans several DLD areas (source "ambiguous"). */
  areaDld: string | null;
  masterProject: string | null;
  source: "dld_area" | "dld_master" | "common" | "ambiguous";
}

export interface AreaCandidate {
  areaDld: string;
  masterProject: string | null;
  /** The alias that led here, as written in the table ("jumeirah village circle"). */
  alias: string;
}

export type AreaResolution =
  | { status: "resolved"; areaDld: string; masterProject: string | null; matched: string[] }
  | { status: "ambiguous"; why: "spans_areas" | "several_areas" | "near_name"; candidates: AreaCandidate[]; matched: string[] }
  | { status: "unresolved" };

/** A near name must be at least this similar (Ratcliff-Obershelp) to be offered as a candidate. */
export const AREA_NEAR_MIN = 0.84;
export const AREA_MAX_CANDIDATES = 4;
export const AREA_MAX_CHARS = 160;

/** Lower case, accents removed, "&" to "and", every run of other characters to one space. */
export function normaliseArea(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** One candidate per DLD area, in the order given. Pass rows with an area only. */
function distinctCandidates(rows: readonly AreaAlias[]): AreaCandidate[] {
  const byArea = new Map<string, { masters: Set<string>; alias: string }>();
  for (const r of rows) {
    const area = r.areaDld as string;
    const e = byArea.get(area) ?? { masters: new Set<string>(), alias: r.alias };
    if (r.masterProject !== null) e.masters.add(r.masterProject);
    byArea.set(area, e);
  }
  return [...byArea.entries()]
    .map(([areaDld, e]) => ({ areaDld, masterProject: e.masters.size === 1 ? [...e.masters][0] : null, alias: e.alias }))
    .slice(0, AREA_MAX_CANDIDATES);
}

/** The specific aliases that contain an ambiguous name as whole words ("al barsha" in "al barsha south fourth"). */
function spanned(names: readonly string[], aliases: readonly AreaAlias[]): AreaAlias[] {
  return aliases.filter((r) => r.areaDld !== null && names.some((n) => ` ${r.alias} `.includes(` ${n} `)));
}

/** Aliases close to the text, or to one of its comma-separated parts, without being in it. */
function nearNames(text: string, aliases: readonly AreaAlias[]): AreaAlias[] {
  const parts = [...new Set([normaliseArea(text), ...text.split(/[,;|/()\n]+/).map(normaliseArea)])].filter((p) => p.length >= 4 && p !== "dubai");
  const scored: Array<{ row: AreaAlias; score: number }> = [];
  for (const row of aliases) {
    if (row.areaDld === null || row.alias.length < 4) continue;
    let best = 0;
    for (const p of parts) best = Math.max(best, similarity(p, row.alias));
    if (best >= AREA_NEAR_MIN) scored.push({ row, score: best });
  }
  // Nearest first; equal scores keep the table's order (the sort is stable).
  scored.sort((x, y) => y.score - x.score);
  return scored.map((s) => s.row);
}

/**
 * Resolves a listing's area text.
 * 1. Find every alias that occurs in the text as whole words.
 * 2. Drop a match that lies inside a longer match ("downtown" inside "downtown jebel ali").
 * 3. A name that spans several DLD areas counts only when nothing specific matched (then: ambiguous).
 * 4. More than one DLD area left: ambiguous. One: resolved, with the master project when exactly one is named.
 * 5. Nothing found: near names are offered as candidates (ambiguous), else unresolved.
 */
export function resolveArea(text: string | null | undefined, aliases: readonly AreaAlias[]): AreaResolution {
  const norm = normaliseArea((text ?? "").slice(0, AREA_MAX_CHARS));
  if (norm === "") return { status: "unresolved" };
  const t = ` ${norm} `;
  const found: Array<{ row: AreaAlias; start: number; end: number }> = [];
  for (const row of aliases) {
    const needle = ` ${row.alias} `;
    for (let at = t.indexOf(needle); at !== -1; at = t.indexOf(needle, at + 1)) found.push({ row, start: at, end: at + needle.length });
  }
  const outer = found.filter((m) => !found.some((o) => o !== m && o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start));
  const specific = outer.filter((m) => m.row.areaDld !== null);
  const names = (list: typeof outer) => [...new Set(list.map((m) => m.row.alias))].sort();
  if (specific.length === 0) {
    const vague = outer.filter((m) => m.row.areaDld === null);
    if (vague.length > 0) {
      return { status: "ambiguous", why: "spans_areas", candidates: distinctCandidates(spanned(names(vague), aliases)), matched: names(vague) };
    }
    const near = nearNames(text as string, aliases);
    if (near.length > 0) return { status: "ambiguous", why: "near_name", candidates: distinctCandidates(near), matched: [] };
    return { status: "unresolved" };
  }
  const areas = new Set(specific.map((m) => m.row.areaDld as string));
  if (areas.size !== 1) {
    return { status: "ambiguous", why: "several_areas", candidates: distinctCandidates(specific.map((m) => m.row)), matched: names(specific) };
  }
  const masters = new Set(specific.map((m) => m.row.masterProject).filter((m): m is string => m !== null));
  return { status: "resolved", areaDld: specific[0].row.areaDld as string, masterProject: masters.size === 1 ? [...masters][0] : null, matched: names(specific) };
}
