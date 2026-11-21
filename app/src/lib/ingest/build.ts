/**
 * `npm run data:build` (REAL_DATA.md section 3): reads one or more Data.Dubai Transactions files
 * (.csv, or .zip with a .csv inside) as streams, applies the rules of section 2, and writes
 * `sales.csv.gz`, `buildings.csv.gz`, `similar-cells.csv.gz`, `acs-model.json.gz` (the
 * adjusted-registered-sales model, section 16) and `manifest.json` into the output folder. Returns the report the owner and the
 * tech lead read before committing. Nothing here touches the network or the database.
 */
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { ACS_INDEX_DAYS, acsModelFile, buildAcsStatistics } from "@/lib/acs/build";
import { ACS_CONSTANTS, ACS_MAX_FIT_AGE_DAYS, ACS_MODEL_VERSION, type AcsConstantsFile } from "@/lib/acs/model";
import { COPY } from "@/lib/copy";
import { STALE_AFTER_DAYS } from "@/lib/domain/analyse";
import { addDays, diffDays, isIsoDate, type IsoDate } from "@/lib/domain/dates";
import { buildSimilarArtifact, type SimilarArtifact } from "@/lib/domain/similar";
import { NEARBY_CONSTANTS, NEARBY_MAX_FIT_AGE_DAYS } from "@/lib/nearby/model";
import { SIMILAR_BACKTEST, SIMILAR_CONSTANTS, SIMILAR_MAX_FIT_AGE_DAYS, SIMILAR_VERSION, type SimilarBacktest, type SimilarConstantsFile } from "@/lib/similar/model";
import { readCsvRecords } from "./csv-stream";
import { DataDubaiCollector, mapColumns, REPORT_COLUMNS, SourceFormatError, type CollectorResult } from "./data-dubai";
import { dldKey } from "./identity";
import { DATA_DUBAI_SOURCE, sha256File, similarCellRows, writeAcsModelFile, writeBuildingsFile, writeManifest, writeSimilarCellsFile, writeSnapshotFile, type Manifest } from "./snapshot";
import { EXCLUSION_REASONS, type BuildingFacts, type NormalisedSale } from "./types";
import { openZipCsv } from "./zip";

export interface BuildOptions {
  /** Source files, in order (a later file never re-adds a transaction an earlier file had). */
  inputs: readonly string[];
  datasetUrl: string;
  datasetTitle: string;
  /** The day the owner downloaded the files (YYYY-MM-DD). */
  downloadedOn: IsoDate;
  /** Default `<cwd>/data/open-data`. */
  outDir: string;
  /** Progress callback (rows read so far), called every 250,000 rows. */
  onProgress?: (rowsRead: number) => void;
  /** The day of the build, written to manifest.similar.builtOn. Default: `downloadedOn`, so a rebuild gives the same bytes. */
  builtOn?: IsoDate;
  /** The similar-buildings constants and backtest summary to ship. Default: the ones in src/lib/similar. */
  similar?: { constants: SimilarConstantsFile; backtest: SimilarBacktest };
  /** The fit of the adjusted-registered-sales model to ship. Default: src/lib/acs/constants.json. */
  acs?: { constants: AcsConstantsFile };
}

export interface BuildReport extends Omit<CollectorResult, "sales" | "buildingFacts" | "acs"> {
  manifest: Manifest;
  files: Array<{ name: string; sha256: string; rows: number; csvEntry: string | null }>;
  outDir: string;
  ms: number;
}

export class BuildError extends Error {
  override name = "BuildError";
}

/** Validates `--dataset-url`: https, and never the dubailand.gov.ae website. */
export function checkDatasetUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BuildError(`--dataset-url is not a URL: ${raw}`);
  }
  if (url.protocol !== "https:") throw new BuildError("--dataset-url must start with https://");
  if (/(^|\.)dubailand\.gov\.ae$/i.test(url.hostname)) throw new BuildError(COPY["adminUi.ingest.dubailandExport"]);
  return url.toString();
}

async function isZip(file: string): Promise<boolean> {
  if (/\.zip$/i.test(file)) return true;
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(buf, 0, 4, 0);
    return bytesRead === 4 && buf.readUInt32LE(0) === 0x04034b50;
  } finally {
    await fh.close();
  }
}

async function openSource(file: string): Promise<{ stream: Readable; csvEntry: string | null }> {
  if (await isZip(file)) {
    const { entry, stream } = await openZipCsv(file);
    return { stream, csvEntry: entry.name };
  }
  return { stream: createReadStream(file), csvEntry: null };
}

/**
 * The similar-buildings cells of a snapshot (REAL_DATA.md section 15.1): one per building, bedroom
 * count and basis, from the kept sales and the buildings file's project number and master project.
 * Sales are grouped by `dldKey`, as the loader groups them.
 */
export function similarArtifactOf(sales: Iterable<NormalisedSale>, facts: readonly BuildingFacts[]): SimilarArtifact {
  return buildSimilarArtifact(
    sales,
    facts.map((f) => ({ building: f.building, areaDld: f.areaDld, projectNumber: f.projectNumber === null ? "" : String(f.projectNumber), masterProject: f.masterProject ?? "" })),
    dldKey,
  );
}

/** Builds the snapshot. Throws SourceFormatError (refused file), BuildError or ZipFormatError. */
export async function buildSnapshot(o: BuildOptions): Promise<BuildReport> {
  const started = Date.now();
  if (o.inputs.length === 0) throw new BuildError("Pass at least one --in file.");
  if (!isIsoDate(o.downloadedOn)) throw new BuildError("--downloaded must be a date like 2026-11-18.");
  if (o.builtOn !== undefined && !isIsoDate(o.builtOn)) throw new BuildError("--built must be a date like 2026-11-18.");
  const datasetUrl = checkDatasetUrl(o.datasetUrl);
  // No sale can be dated after the day the file was downloaded.
  const collector = new DataDubaiCollector({ latestDate: o.downloadedOn });
  const files: BuildReport["files"] = [];
  let total = 0;

  for (const [i, file] of o.inputs.entries()) {
    const { stream, csvEntry } = await openSource(file);
    let rows = 0;
    let cols: ReturnType<typeof mapColumns> | null = null;
    try {
      for await (const rec of readCsvRecords(stream)) {
        if (!cols) {
          cols = mapColumns(rec);
          continue;
        }
        collector.add(rec, cols, i);
        rows++;
        total++;
        if (o.onProgress && total % 250_000 === 0) o.onProgress(total);
      }
    } finally {
      stream.destroy();
    }
    if (!cols) throw new SourceFormatError(COPY["adminUi.ingest.emptyFile"], "empty_file");
    files.push({ name: path.basename(file), sha256: await sha256File(file), rows, csvEntry });
  }

  const result = collector.finish();
  if (result.kept === 0 || !result.dataFrom || !result.dataThrough) {
    throw new BuildError("No sale passed the rules, so there is nothing to write. Check the report counts.");
  }
  const snap = await writeSnapshotFile(o.outDir, result.sales);
  const facts = await writeBuildingsFile(o.outDir, result.buildingFacts);
  const model = o.similar ?? { constants: SIMILAR_CONSTANTS, backtest: SIMILAR_BACKTEST };
  const artifact = similarArtifactOf(result.sales, result.buildingFacts);
  const cells = await writeSimilarCellsFile(o.outDir, similarCellRows(artifact));
  // The adjusted-registered-sales model: its snapshot statistics from the 48 months, with the shipped fit.
  let acs: Manifest["acs"];
  if (result.acs) {
    const fit = o.acs?.constants ?? ACS_CONSTANTS;
    const stats = buildAcsStatistics({ dataThrough: result.dataThrough, sales: result.acs.sales, families: result.acs.families });
    const file = await writeAcsModelFile(o.outDir, acsModelFile(stats, fit, snap.sha256));
    acs = {
      version: ACS_MODEL_VERSION,
      modelFile: { sha256: file.sha256, bytes: file.bytes },
      constantsVersion: fit.version,
      fittedOn: { dataThrough: fit.fittedOn.dataThrough, snapshotSha256: fit.fittedOn.snapshotSha256 },
      buildings: stats.buildings.key.length,
      areaIndexes: Object.keys(stats.theta).length,
      cellSlopes: stats.cellSlope.length,
      indexSales: stats.indexSales,
      // The earliest sale the time index saw: a download that starts later than the 48 months is warned about.
      ...(result.acs.sales.length ? { indexFrom: result.acs.sales.reduce((m, s) => (s.date < m ? s.date : m), result.acs.sales[0].date) } : {}),
    };
  }
  const excluded = Object.fromEntries(EXCLUSION_REASONS.map((r) => [r, result.excluded[r]]));
  const manifest: Manifest = {
    version: 1,
    source: DATA_DUBAI_SOURCE.source,
    publisher: DATA_DUBAI_SOURCE.publisher,
    datasetTitle: o.datasetTitle,
    datasetUrl,
    licence: DATA_DUBAI_SOURCE.licence,
    licenceUrl: DATA_DUBAI_SOURCE.licenceUrl,
    downloadedOn: o.downloadedOn,
    sourceFiles: files.map(({ name, sha256, rows }) => ({ name, sha256, rows })),
    dataFrom: result.dataFrom,
    dataThrough: result.dataThrough,
    counts: { read: result.read, kept: result.kept, excluded },
    buildings: result.buildings,
    snapshotSha256: snap.sha256,
    buildingsFile: { sha256: facts.sha256, rows: facts.rows },
    similar: {
      version: SIMILAR_VERSION,
      builtOn: o.builtOn ?? o.downloadedOn,
      windowStart: artifact.windowStart,
      cellsFile: { sha256: cells.sha256, rows: cells.rows },
      buildings: new Set(artifact.cells.map((c) => c.b)).size,
      constants: model.constants,
      backtest: model.backtest,
    },
    ...(acs ? { acs } : {}),
  };
  await writeManifest(o.outDir, manifest);
  const { sales: _sales, buildingFacts: _facts, acs: _acs, ...rest } = result;
  void _sales;
  void _facts;
  void _acs;
  return { ...rest, manifest, files, outDir: o.outDir, ms: Date.now() - started };
}

const n = (v: number) => v.toLocaleString("en-US");

/**
 * What the owner must look at before committing: rows dated after the download (left out), and data
 * that ends so long before the download that the site would show the stale-data note at once.
 */
/** True when the constants are too old for the data: the server will not show the second tier (REAL_DATA.md section 15.7). */
export function similarFitTooOld(m: Pick<Manifest, "similar" | "dataThrough">): boolean {
  const fitted = m.similar?.constants.fittedOn;
  return !!fitted && diffDays(fitted.dataThrough, m.dataThrough) > SIMILAR_MAX_FIT_AGE_DAYS;
}

/** The first sale of the 48 months may be this many days after their start before `reportWarnings` says the download is short. */
export const ACS_INDEX_START_SLACK_DAYS = 31;

/** True when the fit of the adjusted-registered-sales model is too old for the data: the server will not use it (REAL_DATA.md section 16.6). */
export function acsFitTooOld(m: Pick<Manifest, "acs" | "dataThrough">): boolean {
  return !!m.acs && diffDays(m.acs.fittedOn.dataThrough, m.dataThrough) > ACS_MAX_FIT_AGE_DAYS;
}

/**
 * True when the nearby constants (src/lib/nearby/constants.json) are too old for the data: the server
 * will not use nearby registered sales (REAL_DATA.md section 17.6). They are not in the manifest: the
 * fit date is the one in the repository when the snapshot is built and when the server runs.
 */
export function nearbyFitTooOld(m: Pick<Manifest, "dataThrough">, fittedOn: string = NEARBY_CONSTANTS.fittedOn): boolean {
  return diffDays(fittedOn, m.dataThrough) > NEARBY_MAX_FIT_AGE_DAYS;
}

export function reportWarnings(r: Pick<BuildReport, "excluded" | "manifest">): string[] {
  const out: string[] = [];
  const future = r.excluded.date_out_of_range;
  if (future > 0) {
    out.push(`${n(future)} rows are dated after the download date ${r.manifest.downloadedOn} and were left out. Check them in the source file.`);
  }
  const fitted = r.manifest.similar?.constants.fittedOn;
  const fitAge = fitted ? diffDays(fitted.dataThrough, r.manifest.dataThrough) : 0;
  if (fitted && fitAge > SIMILAR_MAX_FIT_AGE_DAYS) {
    out.push(
      `The similar-buildings constants were fitted on data to ${fitted.dataThrough}, ${n(fitAge)} days before this data ends. The site will not show the similar-buildings comparison until they are refitted (REAL_DATA.md section 15.7).`,
    );
  }
  const acsFit = r.manifest.acs?.fittedOn;
  if (acsFit && acsFitTooOld(r.manifest)) {
    out.push(
      `The adjusted-registered-sales fit was made on data to ${acsFit.dataThrough}, ${n(diffDays(acsFit.dataThrough, r.manifest.dataThrough))} days before this data ends. The site will give the same-building median and the second tier only, until it is refitted (REAL_DATA.md section 16.6).`,
    );
  }
  if (nearbyFitTooOld(r.manifest)) {
    out.push(
      `The nearby-registered-sales constants were fitted on data to ${NEARBY_CONSTANTS.fittedOn}, ${n(diffDays(NEARBY_CONSTANTS.fittedOn, r.manifest.dataThrough))} days before this data ends. The site will not compare with nearby registered sales until they are refitted (REAL_DATA.md section 17.6).`,
    );
  }
  // The time index needs 48 months of sales. A shorter download still builds (months without sales are
  // filled in), so say it: old sales would then be moved to the data date on thin air.
  const indexFrom = r.manifest.acs?.indexFrom;
  const indexNeeds = addDays(r.manifest.dataThrough, 1 - ACS_INDEX_DAYS);
  if (indexFrom && diffDays(indexNeeds, indexFrom) > ACS_INDEX_START_SLACK_DAYS) {
    out.push(
      `The download's first usable sale is dated ${indexFrom}; adjusted registered sales needs sales from ${indexNeeds} (48 months) for its time index. Download the full history before committing this snapshot.`,
    );
  }
  const lag = diffDays(r.manifest.dataThrough, r.manifest.downloadedOn);
  if (lag > STALE_AFTER_DAYS) {
    out.push(`The newest sale is ${n(lag)} days before the download date, so the site will show the stale-data note at once. Is this the latest file?`);
  }
  return out;
}

/** The plain-text report printed by `npm run data:build`. */
export function formatReport(r: BuildReport): string {
  const lines: string[] = [];
  lines.push("Fairsquare open-data snapshot");
  lines.push(`Output: ${r.outDir}`);
  for (const f of r.files) {
    lines.push(`Source: ${f.name}${f.csvEntry ? ` (${f.csvEntry})` : ""}  rows ${n(f.rows)}  sha256 ${f.sha256}`);
  }
  lines.push("");
  lines.push(`Rows read: ${n(r.read)}`);
  lines.push(`Kept:      ${n(r.kept)}`);
  lines.push("Excluded:");
  for (const reason of EXCLUSION_REASONS) lines.push(`  ${reason.padEnd(24)} ${n(r.excluded[reason])}`);
  lines.push("");
  lines.push(`Dates: ${r.dataFrom} to ${r.dataThrough}`);
  for (const w of reportWarnings(r)) lines.push(`WARNING: ${w}`);
  lines.push(`Buildings: ${n(r.buildings)}`);
  lines.push(`Snapshot sha256: ${r.manifest.snapshotSha256}`);
  if (r.manifest.buildingsFile) lines.push(`Buildings file sha256: ${r.manifest.buildingsFile.sha256}`);
  const sim = r.manifest.similar;
  if (sim) {
    lines.push(`Similar-buildings cells: ${n(sim.cellsFile.rows)} in ${n(sim.buildings)} buildings, 12 months from ${sim.windowStart}  sha256 ${sim.cellsFile.sha256}`);
    lines.push(`Similar-buildings constants: version ${sim.constants.version}, fitted on data to ${sim.constants.fittedOn.dataThrough}`);
  }
  const acs = r.manifest.acs;
  if (acs) {
    lines.push(
      `Adjusted registered sales: ${n(acs.buildings)} buildings, ${n(acs.areaIndexes)} area time indexes, ${n(acs.cellSlopes)} size slopes, from ${n(acs.indexSales)} sales of 48 months  ${n(acs.modelFile.bytes)} bytes  sha256 ${acs.modelFile.sha256}`,
    );
    lines.push(`Adjusted registered sales fit: version ${acs.constantsVersion}, made on data to ${acs.fittedOn.dataThrough}`);
  }
  for (const c of REPORT_COLUMNS) {
    lines.push("");
    lines.push(`Top ${c} (all rows read):`);
    const list = r.topValues[c];
    if (list.length === 0) lines.push("  (column not in the file)");
    for (const v of list) lines.push(`  ${n(v.count).padStart(12)}  ${v.value}`);
  }
  lines.push("");
  lines.push(`Done in ${(r.ms / 1000).toFixed(1)} s. Review the counts before you commit data/open-data/.`);
  return lines.join("\n");
}
