/**
 * The committed snapshot (REAL_DATA.md section 3): `sales.csv.gz` (one row per kept sale, sorted by
 * ref), `buildings.csv.gz` (one row per building: what the source says about it) and
 * `manifest.json` (source, licence, date range, counts and the SHA-256 of each gzip file).
 * The writer is used by `npm run data:build`; the reader streams the gzip for the server loader.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip, gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { ACS_MODEL_FILE, AcsManifestSchema, AcsModelFileSchema, type AcsModelFile } from "@/lib/acs/model";
import { isIsoDate } from "@/lib/domain/dates";
import type { SimilarArtifact, SimilarBasis } from "@/lib/domain/similar";
import { SimilarManifestSchema } from "@/lib/similar/model";
import { csvLine, readCsvRecords } from "./csv-stream";
import { stripBom } from "./fields";
import { EXCLUSION_REASONS, SALE_COMPLETIONS, type BuildingFacts, type NormalisedSale, type SaleCompletion } from "./types";

export const SNAPSHOT_FILE = "sales.csv.gz";
export const BUILDINGS_FILE = "buildings.csv.gz";
export const SIMILAR_CELLS_FILE = "similar-cells.csv.gz";
export const MANIFEST_FILE = "manifest.json";

export const SNAPSHOT_COLUMNS = [
  "ref",
  "date",
  "building",
  "area_dld",
  "project",
  "master_project",
  "bedrooms",
  "size_sqft",
  "price_aed",
  "completion",
  "project_number",
  "parking",
] as const;

/** Snapshots written before `project_number` and `parking` existed have the first 10 columns only; they still load. */
export const LEGACY_SNAPSHOT_COLUMNS = SNAPSHOT_COLUMNS.slice(0, 10);

export const BUILDING_COLUMNS = [
  "building",
  "area_dld",
  "project_number",
  "project",
  "master_project",
  "nearest_metro",
  "nearest_mall",
  "nearest_landmark",
  "first_sale",
  "first_ready_sale",
  "last_sale",
  "sales",
  "off_plan_sales",
  "parking_sales",
] as const;

const IsoDateSchema = z.string().refine(isIsoDate, { error: "not a YYYY-MM-DD date" });
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const Count = z.number().int().min(0);

export const ManifestSchema = z.object({
  version: z.literal(1),
  source: z.string().min(1),
  publisher: z.string().min(1),
  datasetTitle: z.string().min(1),
  datasetUrl: z.url({ protocol: /^https$/ }),
  licence: z.string().min(1),
  licenceUrl: z.url({ protocol: /^https$/ }),
  downloadedOn: IsoDateSchema,
  sourceFiles: z.array(z.object({ name: z.string().min(1), sha256: Sha256Schema, rows: Count })),
  dataFrom: IsoDateSchema,
  dataThrough: IsoDateSchema,
  counts: z.object({ read: Count, kept: Count, excluded: z.record(z.string(), Count) }),
  buildings: Count,
  snapshotSha256: Sha256Schema,
  /** `buildings.csv.gz`; absent in snapshots built before it existed. */
  buildingsFile: z.object({ sha256: Sha256Schema, rows: Count }).optional(),
  /**
   * The similar-buildings model built with this snapshot (REAL_DATA.md section 15): the cells file, the
   * fitted constants and the backtest summary. Absent in snapshots built before 19 Nov 2026.
   */
  similar: SimilarManifestSchema.optional(),
  /**
   * The adjusted-registered-sales model built with this snapshot (REAL_DATA.md section 16): the model
   * file and the fit it carries. Absent in snapshots built before 19 Nov 2026.
   */
  acs: AcsManifestSchema.optional(),
});
export type Manifest = z.output<typeof ManifestSchema>;

/** The manifest without its counts and its model section: what `app_meta.data_source` holds (REAL_DATA.md section 4). */
export type DataSourceMeta = Omit<Manifest, "counts" | "similar" | "acs">;

export function dataSourceMeta(m: Manifest): DataSourceMeta {
  const { counts: _counts, similar: _similar, acs: _acs, ...rest } = m;
  void _counts;
  void _similar;
  void _acs;
  return rest;
}

/** Fixed values of the Data.Dubai source and its licence. */
export const DATA_DUBAI_SOURCE = Object.freeze({
  source: "data.dubai",
  publisher: "Dubai Land Department",
  licence: "Dubai Open Data Licence",
  licenceUrl: "https://data.dubai/en/terms-conditions",
});

export class SnapshotError extends Error {
  override name = "SnapshotError";
}

/** SHA-256 (hex) of a file, streamed. */
export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), async function* (src: AsyncIterable<Buffer>) {
    for await (const chunk of src) hash.update(chunk);
  });
  return hash.digest("hex");
}

function toLine(s: NormalisedSale): string {
  return csvLine([
    s.ref,
    s.date,
    s.building,
    s.areaDld,
    s.project,
    s.masterProject,
    s.bedrooms,
    s.sizeSqft,
    s.priceAed,
    s.completion,
    s.projectNumber,
    s.parking === null ? "" : s.parking ? 1 : 0,
  ]);
}

function buildingLine(b: BuildingFacts): string {
  return csvLine([
    b.building,
    b.areaDld,
    b.projectNumber,
    b.project,
    b.masterProject,
    b.nearestMetro,
    b.nearestMall,
    b.nearestLandmark,
    b.firstSale,
    b.firstReadySale,
    b.lastSale,
    b.sales,
    b.offPlanSales,
    b.parkingSales,
  ]);
}

/** Compares refs by code unit, so the order never depends on the machine's locale. */
export function compareRefs(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Writes `sales.csv.gz` into `dir` (via a temporary file and a rename) from rows already sorted by
 * ref. Returns its SHA-256 and the number of rows written.
 */
export function writeSnapshotFile(dir: string, rows: Iterable<NormalisedSale>): Promise<{ file: string; sha256: string; rows: number }> {
  return writeGzCsv(dir, SNAPSHOT_FILE, SNAPSHOT_COLUMNS, rows, toLine);
}

/** Writes `buildings.csv.gz` into `dir` from rows already sorted by building name, then area. */
export function writeBuildingsFile(dir: string, rows: Iterable<BuildingFacts>): Promise<{ file: string; sha256: string; rows: number }> {
  return writeGzCsv(dir, BUILDINGS_FILE, BUILDING_COLUMNS, rows, buildingLine);
}

async function writeGzCsv<T>(
  dir: string,
  name: string,
  columns: readonly string[],
  rows: Iterable<T>,
  toCsv: (row: T) => string,
): Promise<{ file: string; sha256: string; rows: number }> {
  await mkdir(dir, { recursive: true });
  const file = path.join(/*turbopackIgnore: true*/ dir, name);
  const tmp = `${file}.tmp`;
  let n = 0;
  function* lines(): Generator<string> {
    yield `${columns.join(",")}\n`;
    let buf: string[] = [];
    for (const r of rows) {
      buf.push(toCsv(r));
      n++;
      if (buf.length >= 2000) {
        yield `${buf.join("\n")}\n`;
        buf = [];
      }
    }
    if (buf.length) yield `${buf.join("\n")}\n`;
  }
  try {
    await pipeline(Readable.from(lines()), createGzip({ level: 9 }), createWriteStream(tmp));
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return { file, sha256: await sha256File(file), rows: n };
}

/** Writes `manifest.json` (2-space JSON, trailing newline) via a temporary file. */
export async function writeManifest(dir: string, manifest: Manifest): Promise<string> {
  const valid = ManifestSchema.parse(manifest);
  const file = path.join(/*turbopackIgnore: true*/ dir, MANIFEST_FILE);
  await writeFile(`${file}.tmp`, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
  await rename(`${file}.tmp`, file);
  return file;
}

/** The manifest in `dir`, or null when there is none. Throws SnapshotError when it is invalid. */
export async function readManifest(dir: string): Promise<Manifest | null> {
  let text: string;
  try {
    text = await readFile(path.join(/*turbopackIgnore: true*/ dir, MANIFEST_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(stripBom(text));
  } catch {
    throw new SnapshotError("manifest.json is not valid JSON");
  }
  const parsed = ManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new SnapshotError(`manifest.json is invalid: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  for (const k of Object.keys(parsed.data.counts.excluded)) {
    if (!(EXCLUSION_REASONS as readonly string[]).includes(k)) throw new SnapshotError(`manifest.json has an unknown exclusion reason: ${k}`);
  }
  return parsed.data;
}

const intOrNaN = (s: string) => (/^\d+$/.test(s) ? Number(s) : Number.NaN);

/** One snapshot record as a sale; throws SnapshotError (with the line) when a value is wrong. */
export function parseSnapshotRecord(rec: readonly string[], line: number, width: number = SNAPSHOT_COLUMNS.length): NormalisedSale {
  if (rec.length !== width) throw new SnapshotError(`snapshot line ${line}: expected ${width} fields`);
  const [ref, date, building, areaDld, project, masterProject, beds, size, price, completion, number = "", park = ""] = rec;
  const bedrooms = intOrNaN(beds);
  const projectNumber = number === "" ? null : intOrNaN(number);
  const sizeSqft = Number(size);
  const priceAed = intOrNaN(price);
  if (
    !ref ||
    !isIsoDate(date) ||
    !building ||
    !areaDld ||
    !(bedrooms >= 0 && bedrooms <= 7) ||
    !(Number.isFinite(sizeSqft) && sizeSqft > 0) ||
    !(Number.isSafeInteger(priceAed) && priceAed > 0) ||
    !SALE_COMPLETIONS.includes(completion as SaleCompletion) ||
    !(projectNumber === null || (Number.isSafeInteger(projectNumber) && projectNumber > 0)) ||
    !(park === "" || park === "0" || park === "1")
  ) {
    throw new SnapshotError(`snapshot line ${line}: invalid value`);
  }
  return {
    ref,
    date,
    building,
    areaDld,
    project: project || null,
    masterProject: masterProject || null,
    bedrooms,
    sizeSqft,
    priceAed,
    completion: completion as SaleCompletion,
    projectNumber,
    parking: park === "" ? null : park === "1",
  };
}

/**
 * Streams the rows of a `sales.csv.gz`. `onDone` receives the SHA-256 of the gzip bytes read, so a
 * caller can check the file against its manifest in the same pass.
 */
export async function* readSnapshotRows(file: string, onDone?: (sha256: string) => void): AsyncGenerator<NormalisedSale> {
  const hash = createHash("sha256");
  const raw = createReadStream(file);
  raw.on("data", (chunk) => hash.update(chunk as Buffer));
  const gunzip = createGunzip();
  raw.on("error", (err) => gunzip.destroy(err));
  raw.pipe(gunzip);
  let line = 0;
  let width: number = SNAPSHOT_COLUMNS.length;
  try {
    for await (const rec of readCsvRecords(gunzip)) {
      line++;
      if (line === 1) {
        const header = rec.join(",");
        if (header === LEGACY_SNAPSHOT_COLUMNS.join(",")) width = LEGACY_SNAPSHOT_COLUMNS.length;
        else if (header !== SNAPSHOT_COLUMNS.join(",")) throw new SnapshotError("snapshot header does not match");
        continue;
      }
      yield parseSnapshotRecord(rec, line, width);
    }
  } finally {
    raw.destroy();
  }
  if (line === 0) throw new SnapshotError("snapshot is empty");
  onDone?.(hash.digest("hex"));
}

/**
 * Reads `buildings.csv.gz` whole (a few thousand rows) and checks it against the manifest. Throws
 * SnapshotError when the file is missing, does not match its SHA-256 or holds a wrong value.
 */
export async function readBuildingFacts(file: string, expected: { sha256: string; rows: number }): Promise<BuildingFacts[]> {
  let raw: Buffer;
  try {
    raw = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new SnapshotError("buildings.csv.gz is missing");
    throw err;
  }
  if (createHash("sha256").update(raw).digest("hex") !== expected.sha256) throw new SnapshotError("buildings.csv.gz does not match manifest.buildingsFile.sha256");
  const out: BuildingFacts[] = [];
  let line = 0;
  for await (const rec of readCsvRecords(Readable.from([raw]).pipe(createGunzip()))) {
    line++;
    if (line === 1) {
      if (rec.join(",") !== BUILDING_COLUMNS.join(",")) throw new SnapshotError("buildings header does not match");
      continue;
    }
    out.push(parseBuildingRecord(rec, line));
  }
  if (out.length !== expected.rows) throw new SnapshotError(`buildings.csv.gz has ${out.length} rows; the manifest says ${expected.rows}`);
  return out;
}

/** One `buildings.csv.gz` record; throws SnapshotError (with the line) when a value is wrong. */
export function parseBuildingRecord(rec: readonly string[], line: number): BuildingFacts {
  if (rec.length !== BUILDING_COLUMNS.length) throw new SnapshotError(`buildings line ${line}: expected ${BUILDING_COLUMNS.length} fields`);
  const [building, areaDld, number, project, masterProject, metro, mall, landmark, firstSale, firstReadySale, lastSale, sales, offPlan, parking] = rec;
  const projectNumber = number === "" ? null : intOrNaN(number);
  const counts = [intOrNaN(sales), intOrNaN(offPlan), intOrNaN(parking)];
  if (
    !building ||
    !areaDld ||
    !(projectNumber === null || (Number.isSafeInteger(projectNumber) && projectNumber > 0)) ||
    !isIsoDate(firstSale) ||
    !(firstReadySale === "" || isIsoDate(firstReadySale)) ||
    !isIsoDate(lastSale) ||
    !counts.every((n) => Number.isSafeInteger(n)) ||
    counts[1] > counts[0] ||
    counts[2] > counts[0]
  ) {
    throw new SnapshotError(`buildings line ${line}: invalid value`);
  }
  return {
    building,
    areaDld,
    projectNumber,
    project: project || null,
    masterProject: masterProject || null,
    nearestMetro: metro || null,
    nearestMall: mall || null,
    nearestLandmark: landmark || null,
    firstSale,
    firstReadySale: firstReadySale || null,
    lastSale,
    sales: counts[0],
    offPlanSales: counts[1],
    parkingSales: counts[2],
  };
}

// ---------- the adjusted-registered-sales model (REAL_DATA.md section 16) ----------

/**
 * Writes `acs-model.json.gz` into `dir` (via a temporary file and a rename). Numbers are written
 * with every digit a double has. Returns the SHA-256 and the size of the gzip file.
 */
export async function writeAcsModelFile(dir: string, model: AcsModelFile): Promise<{ file: string; sha256: string; bytes: number }> {
  const valid = AcsModelFileSchema.parse(model);
  await mkdir(dir, { recursive: true });
  const file = path.join(/*turbopackIgnore: true*/ dir, ACS_MODEL_FILE);
  const gz = gzipSync(Buffer.from(JSON.stringify(valid), "utf8"), { level: 9 });
  await writeFile(`${file}.tmp`, gz);
  await rename(`${file}.tmp`, file);
  return { file, sha256: createHash("sha256").update(gz).digest("hex"), bytes: gz.length };
}

/**
 * Reads `acs-model.json.gz` and checks it against the manifest: its SHA-256, that it parses, and
 * that it belongs to this snapshot and carries the fit the manifest names. Returns the JSON text
 * (what app_meta holds). Throws SnapshotError otherwise.
 */
export async function readAcsModelText(file: string, manifest: Pick<Manifest, "acs" | "snapshotSha256" | "dataThrough">): Promise<string> {
  const expected = manifest.acs;
  if (!expected) throw new SnapshotError("the manifest has no acs section");
  let raw: Buffer;
  try {
    raw = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new SnapshotError(`${ACS_MODEL_FILE} is missing`);
    throw err;
  }
  if (createHash("sha256").update(raw).digest("hex") !== expected.modelFile.sha256) throw new SnapshotError(`${ACS_MODEL_FILE} does not match manifest.acs.modelFile.sha256`);
  let text: string;
  let json: unknown;
  try {
    text = gunzipSync(raw).toString("utf8");
    json = JSON.parse(text);
  } catch {
    throw new SnapshotError(`${ACS_MODEL_FILE} is not gzipped JSON`);
  }
  const parsed = AcsModelFileSchema.safeParse(json);
  if (!parsed.success) throw new SnapshotError(`${ACS_MODEL_FILE} is invalid: ${parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")).join(", ")}`);
  const m = parsed.data;
  if (m.snapshotSha256 !== manifest.snapshotSha256 || m.dataThrough !== manifest.dataThrough) throw new SnapshotError(`${ACS_MODEL_FILE} belongs to another snapshot`);
  if (m.constantsVersion !== expected.constantsVersion || m.fittedOn.dataThrough !== expected.fittedOn.dataThrough) throw new SnapshotError(`${ACS_MODEL_FILE} does not carry the fit the manifest names`);
  return text;
}

// ---------- the similar-buildings cells (REAL_DATA.md section 15) ----------

export const SIMILAR_CELL_COLUMNS = [
  "building",
  "area_dld",
  "project_number",
  "master_project",
  "bedrooms",
  "completion",
  "n_raw12",
  "n12",
  "med12",
  "n_old1",
  "med_old1",
  "n_old2",
  "med_old2",
] as const;

/** One row of `similar-cells.csv.gz`: a cell with the facts of its building written out. */
export interface SimilarCellRow {
  building: string;
  areaDld: string;
  /** "" when the building has none. */
  projectNumber: string;
  /** "" when the building has none. */
  masterProject: string;
  bedrooms: number;
  completion: SimilarBasis;
  nRaw12: number;
  n12: number;
  med12: number | null;
  nOld1: number;
  medOld1: number | null;
  nOld2: number;
  medOld2: number | null;
}

/** The artifact's cells as file rows, in artifact order (building, bedrooms, basis). */
export function* similarCellRows(a: SimilarArtifact): Generator<SimilarCellRow> {
  for (const c of a.cells) {
    const b = a.buildings[c.b];
    yield {
      building: b.building,
      areaDld: b.areaDld,
      projectNumber: b.projectNumber,
      masterProject: b.masterProject,
      bedrooms: c.bed,
      completion: c.basis,
      nRaw12: c.nRaw12,
      n12: c.n12,
      med12: c.med12,
      nOld1: c.nOld1,
      medOld1: c.medOld1,
      nOld2: c.nOld2,
      medOld2: c.medOld2,
    };
  }
}

// Medians are written with every digit a double has (String(number) round-trips exactly).
function cellLine(r: SimilarCellRow): string {
  return csvLine([r.building, r.areaDld, r.projectNumber, r.masterProject, r.bedrooms, r.completion, r.nRaw12, r.n12, r.med12, r.nOld1, r.medOld1, r.nOld2, r.medOld2]);
}

/** Writes `similar-cells.csv.gz` into `dir`. */
export function writeSimilarCellsFile(dir: string, rows: Iterable<SimilarCellRow>): Promise<{ file: string; sha256: string; rows: number }> {
  return writeGzCsv(dir, SIMILAR_CELLS_FILE, SIMILAR_CELL_COLUMNS, rows, cellLine);
}

/** One `similar-cells.csv.gz` record; throws SnapshotError (with the line) when a value is wrong. */
export function parseSimilarCellRecord(rec: readonly string[], line: number): SimilarCellRow {
  if (rec.length !== SIMILAR_CELL_COLUMNS.length) throw new SnapshotError(`similar cells line ${line}: expected ${SIMILAR_CELL_COLUMNS.length} fields`);
  const [building, areaDld, projectNumber, masterProject, beds, completion, nRaw, nUsed, med, nO1, medO1, nO2, medO2] = rec;
  const bedrooms = intOrNaN(beds);
  const counts = [intOrNaN(nRaw), intOrNaN(nUsed), intOrNaN(nO1), intOrNaN(nO2)];
  const medians = [med, medO1, medO2].map((v) => (v === "" ? null : Number(v)));
  const pairOk = (n: number, m: number | null) => (n === 0 ? m === null : m !== null && Number.isFinite(m) && m > 0);
  if (
    !building ||
    !areaDld ||
    !(projectNumber === "" || /^\d+$/.test(projectNumber)) ||
    !(bedrooms >= 0 && bedrooms <= 7) ||
    !SALE_COMPLETIONS.includes(completion as SaleCompletion) ||
    !counts.every((n) => Number.isSafeInteger(n)) ||
    counts[1] > counts[0] ||
    counts[0] + counts[2] + counts[3] === 0 ||
    !pairOk(counts[0], medians[0]) ||
    !pairOk(counts[2], medians[1]) ||
    !pairOk(counts[3], medians[2])
  ) {
    throw new SnapshotError(`similar cells line ${line}: invalid value`);
  }
  return {
    building,
    areaDld,
    projectNumber,
    masterProject,
    bedrooms,
    completion: completion as SimilarBasis,
    nRaw12: counts[0],
    n12: counts[1],
    med12: medians[0],
    nOld1: counts[2],
    medOld1: medians[1],
    nOld2: counts[3],
    medOld2: medians[2],
  };
}

/**
 * Reads `similar-cells.csv.gz` whole (some thousands of rows) and checks it against the manifest.
 * Throws SnapshotError when the file is missing, does not match its SHA-256 or holds a wrong value.
 */
export async function readSimilarCells(file: string, expected: { sha256: string; rows: number }): Promise<SimilarCellRow[]> {
  let raw: Buffer;
  try {
    raw = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new SnapshotError(`${SIMILAR_CELLS_FILE} is missing`);
    throw err;
  }
  if (createHash("sha256").update(raw).digest("hex") !== expected.sha256) throw new SnapshotError(`${SIMILAR_CELLS_FILE} does not match manifest.similar.cellsFile.sha256`);
  const out: SimilarCellRow[] = [];
  let line = 0;
  for await (const rec of readCsvRecords(Readable.from([raw]).pipe(createGunzip()))) {
    line++;
    if (line === 1) {
      if (rec.join(",") !== SIMILAR_CELL_COLUMNS.join(",")) throw new SnapshotError("similar cells header does not match");
      continue;
    }
    out.push(parseSimilarCellRecord(rec, line));
  }
  if (out.length !== expected.rows) throw new SnapshotError(`${SIMILAR_CELLS_FILE} has ${out.length} rows; the manifest says ${expected.rows}`);
  return out;
}

/** The cells file rows as an artifact for `compareSimilar` (buildings keyed `${building}|${areaDld}`). */
export function artifactFromCellRows(rows: readonly SimilarCellRow[], dataThrough: string, windowStart: string): SimilarArtifact {
  const index = new Map<string, number>();
  const buildings: SimilarArtifact["buildings"] = [];
  const cells: SimilarArtifact["cells"] = [];
  for (const r of rows) {
    const key = `${r.building}|${r.areaDld}`;
    let b = index.get(key);
    if (b === undefined) {
      b = buildings.length;
      index.set(key, b);
      buildings.push({ key, building: r.building, areaDld: r.areaDld, projectNumber: r.projectNumber, masterProject: r.masterProject });
    }
    cells.push({ b, bed: r.bedrooms, basis: r.completion, nRaw12: r.nRaw12, n12: r.n12, med12: r.med12, nOld1: r.nOld1, medOld1: r.medOld1, nOld2: r.nOld2, medOld2: r.medOld2 });
  }
  return { version: 1, dataThrough, windowStart, buildings, cells };
}
