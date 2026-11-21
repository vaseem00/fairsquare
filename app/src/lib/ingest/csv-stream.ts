/**
 * Streaming CSV records (REAL_DATA.md section 1: the source file can be about 1 GB, so it is never
 * read whole). Papa Parse runs as a Node duplex stream with back-pressure; the input is decoded as
 * UTF-8 first so a multi-byte character split across two chunks is never damaged.
 */
import type { Readable } from "node:stream";
import Papa from "papaparse";

/** Every record of a CSV stream as an array of raw strings. Blank lines are skipped. */
export async function* readCsvRecords(input: Readable): AsyncGenerator<string[]> {
  input.setEncoding("utf8");
  // The delimiter is fixed: Papa Parse would otherwise guess it from the first chunk.
  const parser = Papa.parse(Papa.NODE_STREAM_INPUT, { header: false, delimiter: "," }) as unknown as NodeJS.ReadWriteStream &
    AsyncIterable<string[]>;
  input.on("error", (err) => (parser as unknown as Readable).destroy(err));
  input.pipe(parser);
  for await (const record of parser) {
    if (record.length === 1 && record[0] === "") continue;
    yield record;
  }
}

/** One CSV field, quoted when it holds a comma, a quote, a line break or edge spaces. */
export function csvField(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One CSV line (no line break). */
export function csvLine(values: ReadonlyArray<string | number | null | undefined>): string {
  return values.map(csvField).join(",");
}
