/** Building-name normalisation, the same rules as the bot (matching.py) and the old web app. */

export const ABBREV: Readonly<Record<string, string>> = Object.freeze({
  res: "residences",
  resi: "residences",
  residence: "residences",
  twr: "tower",
  towers: "tower",
  hts: "heights",
  ht: "heights",
  bldg: "building",
  blg: "building",
  apts: "apartments",
  apt: "apartments",
  jvc: "jumeirah village circle",
  jlt: "jumeirah lake towers",
  dxb: "dubai",
  no: "",
  the: "",
});

export const ROMAN: Readonly<Record<string, string>> = Object.freeze({
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
});

/**
 * Number words read as digits, so "Peninsula One" and "Peninsula 1" are the same name and the
 * number rule tells "Peninsula One" from "Peninsula Two" (DLD names use both spellings).
 */
export const NUMBER_WORDS: Readonly<Record<string, string>> = Object.freeze({
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
});

/** Words that say nothing about which building it is. */
export const GENERIC: ReadonlySet<string> = new Set([
  "tower",
  "residences",
  "heights",
  "building",
  "apartments",
  "and",
  "at",
  "by",
  "dubai",
]);

function lookup(map: Readonly<Record<string, string>>, w: string): string {
  return Object.prototype.hasOwnProperty.call(map, w) ? map[w] : w;
}

export function normalise(text: string | null | undefined): string {
  const cleaned = String(text ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ");
  const out: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue;
    const w = lookup(ABBREV, lookup(NUMBER_WORDS, lookup(ROMAN, raw)));
    if (w) out.push(...w.split(" "));
  }
  return out.join(" ");
}
