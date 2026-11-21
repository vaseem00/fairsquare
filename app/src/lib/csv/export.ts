import "server-only";
/**
 * CSV writing for the leads export (A§4.4, A§6.5). RFC 4180 quoting, CRLF line ends, and
 * CSV-injection safety: a cell starting with = + - @ tab or carriage return gets a leading `'`, so a
 * spreadsheet shows it as text instead of running it as a formula. An E.164 phone ("+971…", digits
 * only) is the one exception: it is the column partners import, and it cannot carry a formula.
 */

export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;
/**
 * A server-normalised E.164 phone ("+" then digits only). It cannot hold a formula (no function
 * name, no reference, no operator after the sign), and the apostrophe would end up inside the
 * number in CRMs and diallers, so it is written as is.
 */
const E164 = /^\+\d{8,15}$/;

/** One cell: injection-guarded, then quoted when it holds a comma, quote or line break. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  if (typeof value === "string" && FORMULA_START.test(s) && !E164.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** A whole CSV document: the header row, then one line per row (CRLF). */
export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly CsvValue[]>): string {
  const lines = [header.map((h) => csvCell(h)).join(",")];
  for (const r of rows) lines.push(r.map((c) => csvCell(c)).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
