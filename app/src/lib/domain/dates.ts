/** Calendar dates as "YYYY-MM-DD" strings. "Today" is always the Dubai calendar day. */
export type IsoDate = string;

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const dubaiFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dubai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Dubai calendar day (UTC+4, no DST) for `now`. */
export function dubaiToday(now: Date = new Date()): IsoDate {
  const parts = dubaiFormatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

function toUtcMs(d: IsoDate): number {
  if (!isIsoDate(d)) throw new RangeError(`Not an ISO date: ${d}`);
  return Date.parse(`${d}T00:00:00Z`);
}

/** UTC arithmetic on the date only. */
export function addDays(d: IsoDate, days: number): IsoDate {
  return new Date(toUtcMs(d) + Math.trunc(days) * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}
