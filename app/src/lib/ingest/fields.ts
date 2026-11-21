/**
 * Field readers shared by the source adapters (REAL_DATA.md section 1): text clean-up, the date
 * formats the DLD files use, the room labels and plain numbers.
 */
import { isIsoDate, type IsoDate } from "@/lib/domain/dates";

const BOM = "﻿";

/** Removes a leading UTF-8 byte order mark. */
export function stripBom(s: string): string {
  return s.startsWith(BOM) ? s.slice(1) : s;
}

/** Trims and collapses every run of whitespace (the data has trailing and double spaces). */
export function cleanText(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/[\s ]+/g, " ")
    .trim();
}

/** Arabic-script letters and marks (DLD's English columns sometimes carry stray ones). */
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g;

/**
 * `cleanText` for an English name column: Arabic-script characters are removed first (45 project
 * names in the Nov 2026 files start with stray Arabic vowel marks), so the same name is one value.
 */
export function cleanLatin(s: string | null | undefined): string {
  return cleanText(String(s ?? "").replace(ARABIC_SCRIPT, " "));
}

/** `cleanLatin`, with "" as null. */
export function cleanLatinOrNull(s: string | null | undefined): string | null {
  const v = cleanLatin(s);
  return v === "" ? null : v;
}

/** A DLD project number ("2977.00", "2977") as a whole number above zero; anything else is null. */
export function parseProjectNumber(raw: string | null | undefined): number | null {
  const n = parseAmount(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** A DLD 0/1 flag (`has_parking`): "1" is true, "0" is false, anything else is null. */
export function parseFlag(raw: string | null | undefined): boolean | null {
  const s = cleanText(raw);
  return s === "1" ? true : s === "0" ? false : null;
}

/** `cleanText`, with "" as null. */
export function cleanOrNull(s: string | null | undefined): string | null {
  const v = cleanText(s);
  return v === "" ? null : v;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function iso(y: number, m: number, d: number): IsoDate | null {
  const s = `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
  return isIsoDate(s) ? s : null;
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;
const DAY_FIRST = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

/**
 * A source date as YYYY-MM-DD, or null when it cannot be read. Accepts `YYYY-MM-DD`,
 * `YYYY-MM-DD HH:MM:SS`, `DD-MM-YYYY`, `DD-MM-YY` and `DD/MM/YYYY` (also with a time). Every
 * non-ISO form is day first; a two-digit year is 20YY. Impossible dates (31-02-2024) are null.
 */
export function parseSourceDate(raw: string | null | undefined): IsoDate | null {
  const s = cleanText(raw);
  if (!s) return null;
  let m = ISO_DATE.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = DAY_FIRST.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(y, Number(m[2]), Number(m[1]));
  }
  return null;
}

/** The day `months` calendar months from `d`, clamped to the month's last day (2024-02-29 − 12 → 2023-02-28). */
export function addMonths(d: IsoDate, months: number): IsoDate {
  const [y, m, day] = d.split("-").map(Number);
  const total = y * 12 + (m - 1) + Math.trunc(months);
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${String(ny).padStart(4, "0")}-${pad2(nm)}-${pad2(Math.min(day, last))}`;
}

const ROOMS = /^([1-9]\d*)\s*(?:b\s*\/\s*r|br)?$/;

/**
 * DLD `rooms_en` as a bedroom count: `Studio` → 0; `N B/R`, `N BR` or `N` → N for 1 to 7. Everything
 * else (PENTHOUSE, Single Room, Office, Shop, Store, GYM, empty, more than 7) is null.
 */
export function parseRooms(raw: string | null | undefined): number | null {
  const s = cleanText(raw).toLowerCase();
  if (s === "studio") return 0;
  const m = ROOMS.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 7 ? n : null;
}

/** A plain number ("1250000", "1,250,000.50", " 85.3 "); NaN when unreadable or empty. */
export function parseAmount(raw: string | null | undefined): number {
  const s = cleanText(raw).replace(/,/g, "");
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i.test(s)) return Number.NaN;
  return Number(s);
}

/** Rounds to 2 decimals (sizes in sq ft). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
