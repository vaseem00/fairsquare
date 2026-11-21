/** Number, money, percent and date formatting (pure; client-safe). Copy rules: DESIGN.md section 6. */
import type { IsoDate } from "@/lib/domain/dates";

const intFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const MINUS = "−";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** 1284.4 → "1,284" (rounded, en-US grouping). */
export function formatInt(v: number): string {
  return intFormat.format(Math.round(v));
}

/** "AED 1,908". */
export function formatAed(v: number): string {
  return `AED ${formatInt(v)}`;
}

function pctRounded(diff: number): number {
  const r = Math.round(diff * 1000) / 10;
  return Object.is(r, -0) ? 0 : r;
}

/** 0.13953 → "+14.0%", −0.01705 → "−1.7%" (U+2212). A value that rounds to 0 → "0.0%". */
export function formatPct(diff: number): string {
  const r = pctRounded(diff);
  if (r === 0) return "0.0%";
  return `${r > 0 ? "+" : MINUS}${Math.abs(r).toFixed(1)}%`;
}

/** "14.0%" (no sign; for sentences). */
export function formatPctAbs(diff: number): string {
  return `${formatPctNumber(diff)}%`;
}

/** "14.0" (no sign, no % sign; fills "{pct}%" placeholders). */
export function formatPctNumber(diff: number): string {
  return Math.abs(pctRounded(diff)).toFixed(1);
}

/** "2026-11-17" → "17 Nov 2026" (en-GB, fixed month names). */
export function formatDate(d: IsoDate): string {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

/**
 * "18 Aug" when `d` falls in the same year as `ref`, else "18 Aug 2025" (the result's short dates:
 * "since 18 Aug", "the latest on 16 Nov").
 */
export function formatDateNear(d: IsoDate, ref: IsoDate): string {
  const full = formatDate(d);
  return d.slice(0, 4) === ref.slice(0, 4) ? full.replace(/ \d{4}$/, "") : full;
}

const dubaiParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dubai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function dubai(ts: string | Date): Record<string, string> {
  const parts = dubaiParts.formatToParts(typeof ts === "string" ? new Date(ts) : ts);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** A timestamp ("2026-11-17T10:05:00Z") as its Dubai date: "17 Nov 2026". */
export function formatTimestampDate(ts: string | Date): string {
  const p = dubai(ts);
  return formatDate(`${p.year}-${p.month}-${p.day}`);
}

/** A timestamp as Dubai 24-hour time: "14:05". */
export function formatTime(ts: string | Date): string {
  const p = dubai(ts);
  return `${p.hour}:${p.minute}`;
}

/** 0 → "studio", 2 → "2-bed". */
export function bedsLabel(b: number): string {
  return b === 0 ? "studio" : `${b}-bed`;
}

/** 0 → "studios", 2 → "2-beds" (`{bedTypePlural}`). */
export function bedsLabelPlural(b: number): string {
  return b === 0 ? "studios" : `${b}-beds`;
}

/** 0 → "Studio", 1 → "1 bedroom", 2 → "2 bedrooms". */
export function bedsOption(b: number): string {
  if (b === 0) return "Studio";
  return b === 1 ? "1 bedroom" : `${b} bedrooms`;
}

/** "Test Tower A" → "test-tower-a" (file names). */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "listing"
  );
}

/** "16 Nov 2026" and "18 Aug" in a sentence: a date never breaks across lines. */
const DATE_IN_TEXT = new RegExp(`\\b(\\d{1,2}) (${MONTHS.join("|")})\\b(?: (\\d{4})\\b)?`, "g");

/**
 * For on-screen sentences only: "AED" stays on the same line as its amount, a size or a price per
 * sq ft stays with "sq ft", and a date stays whole (no-break spaces). The deck strings, the share text and the OG text keep
 * ordinary spaces.
 */
export function keepFiguresTogether(s: string): string {
  return s
    .replace(/\bAED (?=[\d\u2212-])/g, "AED\u00A0")
    .replace(/ sq ft\b/g, "\u00A0sq\u00A0ft")
    .replace(DATE_IN_TEXT, (_m, d: string, mon: string, y?: string) => (y ? `${d}\u00A0${mon}\u00A0${y}` : `${d}\u00A0${mon}`));
}