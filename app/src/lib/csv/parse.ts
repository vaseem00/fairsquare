/**
 * CSV formats for the admin import (A§4.4) and the pure row checks shared by the import service and
 * `npm run import:csv`. Client-safe on purpose (BUILD_PLAN WP5): the admin "Download template" button
 * builds the header row in the browser from `CSV_COLUMNS`, so this file imports no server code.
 *
 * - Header row required, UTF-8 (a BOM is ignored), comma-separated, header names case-insensitive.
 * - `sales`: building_name, sale_date, bedrooms, size_sqft | size_sqm, price_aed, external_ref?,
 *   completion? (ready or off_plan, blank = ready; REAL_DATA.md section 12), area? (which building,
 *   when more than one has that name).
 * - `buildings`: name, area, project?, master_project?
 * - `aliases`: building_name, alias
 * Other columns (for example one left over from an older template) are ignored.
 * Rejection reasons are plain words from the copy deck ("Size is missing", "Date is in the future"...).
 */
import Papa from "papaparse";
import { COPY, t } from "@/lib/copy";
import { isIsoDate, type IsoDate } from "@/lib/domain/dates";
import { LIMITS, toNumberOrUndefined } from "@/lib/validation/fields";
import { CSV_MAX_ROWS, PROJECT_MAX, REF_MAX, type CsvKind } from "@/lib/validation/admin";

export type { CsvKind };

/** The template header row for each kind (sales lists size_sqft; size_sqm is the accepted alternative). */
export const CSV_COLUMNS: Record<CsvKind, readonly string[]> = Object.freeze({
  sales: Object.freeze(["building_name", "sale_date", "bedrooms", "size_sqft", "price_aed", "external_ref", "completion"]),
  buildings: Object.freeze(["name", "area", "project", "master_project"]),
  aliases: Object.freeze(["building_name", "alias"]),
});

/** Columns that must be present (sales also needs size_sqft or size_sqm). */
const REQUIRED: Record<CsvKind, readonly string[]> = {
  sales: ["building_name", "sale_date", "bedrooms", "price_aed"],
  buildings: ["name", "area"],
  aliases: ["building_name", "alias"],
};

/** Square metres to square feet. */
export const SQFT_PER_SQM = 10.763_910_416_7;

/** The "Download template" file body: exactly the header row of CSV_COLUMNS[kind]. */
export function templateCsv(kind: CsvKind): string {
  return `${CSV_COLUMNS[kind].join(",")}\n`;
}

/** The template's file name, e.g. "fairsquare-sales-template.csv". */
export function templateFileName(kind: CsvKind): string {
  return `fairsquare-${kind}-template.csv`;
}

/** A problem with the whole file (missing column, too many rows, no rows). */
export class CsvFormatError extends Error {
  override name = "CsvFormatError";
}

export interface CsvRow {
  /** 1-based line of the record in the file (the header is line 1). */
  line: number;
  values: Record<string, string>;
}

export interface ParsedCsv {
  columns: string[];
  rows: CsvRow[];
}

/** Parses CSV text into trimmed string records keyed by lowercased header. Blank lines are skipped. */
export function parseCsvText(text: string, kind: CsvKind, maxRows: number = CSV_MAX_ROWS): ParsedCsv {
  const clean = text.replace(/^﻿/, "");
  const result = Papa.parse<string[]>(clean, { header: false, skipEmptyLines: false });
  const records = result.data;
  const headerIndex = records.findIndex((r) => r.some((c) => c.trim() !== ""));
  if (headerIndex < 0) throw new CsvFormatError(COPY["adminUi.csv.empty"]);
  const columns = records[headerIndex].map((c) => c.trim().toLowerCase());
  for (const col of REQUIRED[kind]) {
    if (!columns.includes(col)) throw new CsvFormatError(t("adminUi.csv.missingColumn", { column: col }));
  }
  if (kind === "sales" && !columns.includes("size_sqft") && !columns.includes("size_sqm")) {
    throw new CsvFormatError(t("adminUi.csv.missingColumn", { column: "size_sqft" }));
  }
  const rows: CsvRow[] = [];
  for (let i = headerIndex + 1; i < records.length; i++) {
    const rec = records[i];
    if (!rec.some((c) => c.trim() !== "")) continue;
    if (rows.length >= maxRows) throw new CsvFormatError(t("adminUi.csv.tooManyRows", { max: maxRows }));
    const values: Record<string, string> = {};
    columns.forEach((col, j) => {
      if (col) values[col] = (rec[j] ?? "").trim();
    });
    rows.push({ line: i + 1, values });
  }
  if (rows.length === 0) throw new CsvFormatError(COPY["adminUi.csv.empty"]);
  return { columns, rows };
}

/** Quick count of data rows (non-blank lines after the header), for the upload progress bar. */
export function countDataLines(text: string): number {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
  return Math.max(0, lines.length - 1);
}

export type RowCheck<T> = { ok: true; value: T } | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** "true"/"false" (also yes/no, 1/0); empty is false. null when unreadable. */
export function parseCsvBool(v: string | undefined): boolean | null {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "") return false;
  if (["true", "yes", "1", "y"].includes(s)) return true;
  if (["false", "no", "0", "n"].includes(s)) return false;
  return null;
}

/** Blank → "ready"; ready / off_plan (also "off-plan", "offplan", "existing"); null otherwise. */
export function parseCsvCompletion(v: string | undefined): "ready" | "off_plan" | null {
  const s = (v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "" || s === "ready" || s === "existing") return "ready";
  if (s === "off_plan" || s === "offplan") return "off_plan";
  return null;
}

/** "studio" → 0; an integer 0–7; null otherwise. "2 bed" and "2BR" are accepted too. */
export function parseCsvBedrooms(v: string | undefined): number | null {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "studio" || s === "st") return 0;
  const m = /^(\d+)\s*(?:b|br|bed|beds|bedroom|bedrooms)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= LIMITS.bedMin && n <= LIMITS.bedMax ? n : null;
}

export interface SaleCsvRow {
  buildingName: string;
  /** The `area` cell: picks the building when several share its name. */
  area: string | null;
  saleDate: IsoDate;
  bedrooms: number;
  sizeSqft: number;
  priceAed: number;
  externalRef: string | null;
  completion: "ready" | "off_plan";
}

/** Checks one sales row with the ListingFields limits plus the psf range; `today` is the Dubai day. */
export function checkSaleRow(values: Record<string, string>, today: IsoDate): RowCheck<SaleCsvRow> {
  const buildingName = values.building_name ?? "";
  if (!buildingName) return fail(COPY["adminUi.csv.buildingMissing"]);
  if (buildingName.length > LIMITS.buildingMax) return fail(t("adminUi.csv.tooLong", { column: "building_name" }));

  const date = values.sale_date ?? "";
  if (!date) return fail(COPY["adminUi.csv.dateMissing"]);
  if (!isIsoDate(date)) return fail(COPY["adminUi.csv.dateBad"]);
  if (date > today) return fail(COPY["adminUi.csv.futureDate"]);

  const bedrooms = parseCsvBedrooms(values.bedrooms);
  if (bedrooms === null) return fail(COPY["adminUi.csv.bedsBad"]);

  const sqftRaw = values.size_sqft ?? "";
  const sqmRaw = values.size_sqm ?? "";
  let sizeSqft: number | undefined;
  if (sqftRaw !== "") sizeSqft = toNumberOrUndefined(sqftRaw);
  else if (sqmRaw !== "") {
    const sqm = toNumberOrUndefined(sqmRaw);
    sizeSqft = sqm === undefined ? undefined : Math.round(sqm * SQFT_PER_SQM * 100) / 100;
  } else return fail(COPY["adminUi.csv.sizeMissing"]);
  if (sizeSqft === undefined || !(sizeSqft > LIMITS.sizeMin) || sizeSqft > LIMITS.sizeMax) {
    return fail(COPY["adminUi.csv.sizeBad"]);
  }

  const priceRaw = values.price_aed ?? "";
  if (!priceRaw) return fail(COPY["adminUi.csv.priceMissing"]);
  const priceAed = toNumberOrUndefined(priceRaw);
  if (priceAed === undefined || !Number.isInteger(priceAed) || !(priceAed > LIMITS.priceMin) || priceAed > LIMITS.priceMax) {
    return fail(COPY["adminUi.csv.priceBad"]);
  }

  const psf = priceAed / sizeSqft;
  if (psf < LIMITS.psfMin || psf > LIMITS.psfMax) return fail(COPY["adminUi.csv.psf"]);

  const externalRef = values.external_ref ?? "";
  if (externalRef.length > REF_MAX) return fail(COPY["adminUi.csv.refBad"]);

  const completion = parseCsvCompletion(values.completion);
  if (completion === null) return fail(COPY["adminUi.csv.completionBad"]);

  const area = values.area ?? "";
  if (area.length > LIMITS.areaMax) return fail(t("adminUi.csv.tooLong", { column: "area" }));

  return {
    ok: true,
    value: { buildingName, area: area || null, saleDate: date, bedrooms, sizeSqft, priceAed, externalRef: externalRef || null, completion },
  };
}

/**
 * A buildings row. Blank optional cells are null: a new building stores null, and an existing
 * building keeps its current value (an upsert never clears data by leaving a cell empty).
 */
export interface BuildingCsvRow {
  name: string;
  area: string;
  project: string | null;
  masterProject: string | null;
}

export function checkBuildingRow(values: Record<string, string>): RowCheck<BuildingCsvRow> {
  const name = values.name ?? "";
  if (name.length < 2) return fail(COPY["adminUi.csv.nameMissing"]);
  if (name.length > LIMITS.buildingMax) return fail(t("adminUi.csv.tooLong", { column: "name" }));
  const area = values.area ?? "";
  if (area.length < 2) return fail(COPY["adminUi.csv.areaMissing"]);
  if (area.length > LIMITS.areaMax) return fail(t("adminUi.csv.tooLong", { column: "area" }));
  const project = values.project ?? "";
  if (project.length > PROJECT_MAX) return fail(t("adminUi.csv.tooLong", { column: "project" }));
  const masterProject = values.master_project ?? "";
  if (masterProject.length > PROJECT_MAX) return fail(t("adminUi.csv.tooLong", { column: "master_project" }));
  return { ok: true, value: { name, area, project: project || null, masterProject: masterProject || null } };
}

export interface AliasCsvRow {
  buildingName: string;
  alias: string;
}

export function checkAliasRow(values: Record<string, string>): RowCheck<AliasCsvRow> {
  const buildingName = values.building_name ?? "";
  if (!buildingName) return fail(COPY["adminUi.csv.buildingMissing"]);
  const alias = values.alias ?? "";
  if (alias.length < 2) return fail(COPY["adminUi.csv.aliasMissing"]);
  if (alias.length > LIMITS.buildingMax) return fail(t("adminUi.csv.tooLong", { column: "alias" }));
  return { ok: true, value: { buildingName, alias } };
}
