/**
 * Building identity and names (REAL_DATA.md sections 5 and 6).
 * - `dldKey`: one building per normalised DLD name in its DLD area (names repeat across areas).
 * - `displayName`: the DLD name in title case, with known acronyms and Roman numerals kept.
 * - `cleanAliasName`: the alias variant without a leading "The", "Residences at" or the word
 *   "Tower"/"Twr", never dropping a tower number or letter.
 * - `displayArea`: the area people know, from a short, evidenced mapping of DLD area names.
 */
import { normalise } from "@/lib/domain/normalise";
import { cleanText } from "./fields";

/** `normalise(building) + "|" + normalise(areaDld)`: unique per DLD building (buildings.dld_key). */
export function dldKey(building: string, areaDld: string): string {
  return `${normalise(building)}|${normalise(areaDld)}`;
}

/** Words always written in capitals (REAL_DATA.md section 5, plus a few community acronyms). */
const ACRONYMS: ReadonlySet<string> = new Set(["JLT", "JVC", "JVT", "JBR", "DIFC", "DMCC", "MBR", "UAE"]);

/** Roman numerals I to XXXIX (tower numbers), kept in capitals. */
const ROMAN = /^X{0,3}(IX|IV|V?I{0,3})$/;

/** Joining words written in lower case when they are not the first word ("a" is left out: "Tower A"). */
const SMALL: ReadonlySet<string> = new Set(["and", "at", "by", "for", "in", "of", "on", "the", "to"]);

function capitalise(part: string): string {
  if (!part) return part;
  const upper = part.toUpperCase();
  if (ACRONYMS.has(upper)) return upper;
  if (ROMAN.test(upper)) return upper;
  // A tower code such as "2B", "B2" or a single letter: all capitals.
  if (/\d/.test(part) || /^[a-z]$/i.test(part)) return upper;
  return upper[0] + part.slice(1).toLowerCase();
}

/** Title-cases one word, also inside hyphens, slashes and brackets ("AL-FURJAN" → "Al-Furjan"). */
function titleWord(word: string, first: boolean): string {
  const lower = word.toLowerCase();
  if (!first && SMALL.has(lower)) return lower;
  return word.replace(/[A-Za-z0-9]+(?:'[A-Za-z]+)?/g, (m) => {
    const apostrophe = m.indexOf("'");
    if (apostrophe < 0) return capitalise(m);
    return capitalise(m.slice(0, apostrophe)) + m.slice(apostrophe).toLowerCase();
  });
}

/**
 * The display form of a DLD name: "MARINA GATE 1" → "Marina Gate 1", "JLT CLUSTER X TOWER II" →
 * "JLT Cluster X Tower II", "THE RESIDENCES AT MARINA GATE" → "The Residences at Marina Gate".
 */
export function displayName(raw: string): string {
  const words = cleanText(raw).split(" ").filter(Boolean);
  return words.map((w, i) => titleWord(w, i === 0)).join(" ");
}

/** True for a word that only identifies a tower within a group: a number, a Roman numeral or one letter. */
function isTowerMark(word: string): boolean {
  const w = word.replace(/[^A-Za-z0-9]/g, "");
  return /^\d+[A-Za-z]?$/.test(w) || /^[A-Za-z]\d*$/.test(w) || (w !== "" && ROMAN.test(w.toUpperCase()));
}

/**
 * The alias variant of a name: drops a leading "The", a leading "Residences at" / "The Residences at"
 * and the words "Tower" / "Twr" / "Towers". Numbers and tower letters always stay. Returns null when
 * nothing changes, or when what is left would only be a number or a letter ("Tower 2" → null).
 */
export function cleanAliasName(name: string): string | null {
  const original = cleanText(name);
  let words = original.split(" ").filter(Boolean);
  const lower = () => words.map((w) => w.toLowerCase());
  if (lower()[0] === "the" && lower()[1] === "residences" && lower()[2] === "at") words = words.slice(3);
  else if (lower()[0] === "residences" && lower()[1] === "at") words = words.slice(2);
  else if (lower()[0] === "the") words = words.slice(1);
  words = words.filter((w) => !/^(tower|towers|twr)$/i.test(w));
  const out = words.join(" ");
  if (out === original || out === "") return null;
  if (words.every(isTowerMark)) return null;
  return out;
}

/**
 * The aliases a DLD building gets (source `import`): every raw DLD name seen for it, plus the cleaned
 * variant of its display name. De-duplicated by normalised form; empty forms are dropped.
 */
export function buildingAliases(rawNames: readonly string[], display: string): Array<{ raw: string; norm: string }> {
  const out: Array<{ raw: string; norm: string }> = [];
  const seen = new Set<string>();
  const cleaned = cleanAliasName(display);
  for (const raw of [...rawNames, ...(cleaned ? [cleaned] : [])]) {
    const r = cleanText(raw);
    const norm = normalise(r);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ raw: r, norm });
  }
  return out;
}

/**
 * DLD area name → the name people use. Only mappings with evidence (REAL_DATA.md section 6); add
 * more only with evidence. Keys are compared case- and space-insensitively.
 */
export const AREA_MAP: Readonly<Record<string, string>> = Object.freeze({
  "Marsa Dubai": "Dubai Marina",
  "Burj Khalifa": "Downtown Dubai",
  "Business Bay": "Business Bay",
  "Palm Jumeirah": "Palm Jumeirah",
  "Al Barsha South Fourth": "Jumeirah Village Circle (JVC)",
  "Al Thanyah Fifth": "Jumeirah Lake Towers (JLT)",
  "Al Khairan First": "Dubai Creek Harbour",
  "Hadaeq Sheikh Mohammed Bin Rashid": "Dubai Hills Estate",
  "Madinat Al Mataar": "Dubai South",
  "Nadd Hessa": "Dubai Silicon Oasis",
});

const areaKey = (s: string) => cleanText(s).toLowerCase();
const AREA_LOOKUP = new Map(Object.entries(AREA_MAP).map(([k, v]) => [areaKey(k), v]));

/** The area shown to people: the mapped name, else the DLD area name in title case. */
export function displayArea(areaDld: string): string {
  return AREA_LOOKUP.get(areaKey(areaDld)) ?? displayName(areaDld);
}
