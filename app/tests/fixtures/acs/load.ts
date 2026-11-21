/**
 * The adjusted-registered-sales fixtures (tests/fixtures/acs), all made from the snapshot of the fit
 * (src/lib/acs/constants.json `fittedOn`) by the Python reference (scripts/model/README.md):
 * - acs-model.json.gz: the production model as acs.py built it;
 * - cases.json and expected.json.gz: 106 golden requests and what acs.py answers, number by number;
 * - golden-sales.csv.gz: the registered sales those requests read (scripts/model/acs/golden-sales.ts);
 * - older-sales.csv.gz and families.json.gz: the 12 months before the snapshot and the project
 *   families, for the build parity test.
 * The building names in them are DLD's own (open data), as in data/open-data.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { acsDay, type AcsModel, type AcsRequest, type AcsSaleRow } from "@/lib/domain/acs";

export const ACS_FIXTURES = path.join(process.cwd(), "tests", "fixtures", "acs");

const gz = (name: string) => gunzipSync(readFileSync(path.join(ACS_FIXTURES, name))).toString("utf8");

export function goldenModel(): AcsModel {
  return JSON.parse(gz("acs-model.json.gz")) as AcsModel;
}

export type GoldenCase = AcsRequest & { name: string };

export function goldenCases(): GoldenCase[] {
  return JSON.parse(readFileSync(path.join(ACS_FIXTURES, "cases.json"), "utf8")) as GoldenCase[];
}

export function goldenExpected(): Record<string, unknown>[] {
  return JSON.parse(gz("expected.json.gz")) as Record<string, unknown>[];
}

/** The golden sales by `${buildingKey}#${basis}`, as the database returns them for a request. */
export function goldenSales(epoch: string): Map<string, AcsSaleRow[]> {
  const out = new Map<string, AcsSaleRow[]>();
  const lines = gz("golden-sales.csv.gz").trim().split("\n");
  for (const line of lines.slice(1)) {
    const [ref, key, date, bed, basis, size, price] = line.split(",");
    const row: AcsSaleRow = { ref, buildingKey: key, day: acsDay(epoch, date), bed: Number(bed), size: Number(size), price: Number(price) };
    const k = `${key}#${basis}`;
    const l = out.get(k);
    if (l) l.push(row);
    else out.set(k, [row]);
  }
  return out;
}
