/**
 * The Data.Dubai (Dubai Pulse) "Transactions" CSV adapter (REAL_DATA.md sections 1 and 2).
 *
 * - `mapColumns` reads the header: case-insensitive after trimming and removing a BOM, any column
 *   order, extra columns ignored. The dubailand.gov.ae website export is refused.
 * - `classifyRow` applies the per-row rules 1 to 8 (plus a readable date and a transaction id) and
 *   decides the completion (rule 11).
 * - `DataDubaiCollector` streams rows in, keeps only the rows that pass, counts every exclusion
 *   reason and the most common source values, and `finish()` applies the rules that need the whole
 *   file: repeated transaction ids (9), blocks of unlike units at one price (10), sizes unlike the
 *   building's (10b) and the 36-month window (12). It also gathers the facts of each building, and
 *   what the adjusted-registered-sales model is built from (REAL_DATA.md section 16.2): the rows of
 *   the 1,461 days to the data date that pass every rule but the window, and each building's
 *   project family. Memory grows with the kept rows only (strings are shared), never with the file.
 */
import { ACS_INDEX_DAYS, familyKey, type AcsBuildSale } from "@/lib/acs/build";
import { COPY, t } from "@/lib/copy";
import { addDays, type IsoDate } from "@/lib/domain/dates";
import {
  addMonths,
  cleanLatin,
  cleanLatinOrNull,
  cleanOrNull,
  cleanText,
  parseAmount,
  parseFlag,
  parseProjectNumber,
  parseRooms,
  parseSourceDate,
  round2,
  stripBom,
} from "./fields";
import { dldKey } from "./identity";
import { compareRefs } from "./snapshot";
import {
  emptyExclusionCounts,
  type BuildingFacts,
  type ExclusionCounts,
  type ExclusionReason,
  type NormalisedSale,
  type SaleCompletion,
} from "./types";

export const DATA_DUBAI_REQUIRED = [
  "transaction_id",
  "trans_group_en",
  "procedure_name_en",
  "instance_date",
  "property_sub_type_en",
  "area_name_en",
  "building_name_en",
  "rooms_en",
  "procedure_area",
  "actual_worth",
] as const;
export const DATA_DUBAI_OPTIONAL = [
  "reg_type_en",
  "property_usage_en",
  "project_name_en",
  "master_project_en",
  "project_number",
  "nearest_metro_en",
  "nearest_mall_en",
  "nearest_landmark_en",
  "has_parking",
] as const;

type RequiredColumn = (typeof DATA_DUBAI_REQUIRED)[number];
type OptionalColumn = (typeof DATA_DUBAI_OPTIONAL)[number];
/** Column positions; an optional column that is absent is -1. */
export type ColumnIndex = Record<RequiredColumn | OptionalColumn, number>;

/** Square metres to square feet (REAL_DATA.md section 2, rule 7). */
export const SQFT_PER_SQM = 10.7639;
/**
 * 150 sq ft is also the smallest size a listing may have (validation/fields.ts). The Nov 2026 files
 * have 129 sales of 150 to 200 sq ft in the window whose AED per sq ft sits at their building's
 * median (ratio 1.03), so they are real small studios; under 150 the rows are slips (16 sq ft).
 */
export const SIZE_MIN_SQFT = 150;
export const SIZE_MAX_SQFT = 15_000;
export const PSF_MIN = 279;
/**
 * Was 11,148 (120,000 AED per sq m), which cut the top off real buildings: of the 59 window sales
 * above it that have a building to compare with, 43 are within twice their building's median
 * (the highest real one is 17,327). A slip that still passes is left out when a comparison runs
 * (the 0.5x to 2x rule in domain/analyse.ts).
 */
export const PSF_MAX = 20_000;
/** Rows of one building on one date at one price, from this many up, are looked at as a block. */
export const PORTFOLIO_MIN_ROWS = 3;
/**
 * A block is left out only when its units are unlike: other bedrooms, or the largest more than 5%
 * bigger than the smallest. Identical units sold at one list price on one day are ordinary sales
 * (their AED per sq ft sits at the median of the building's other sales), so they stay.
 */
export const PORTFOLIO_SIZE_TOLERANCE = 1.05;
/**
 * A block of like units is still left out when its AED per sq ft is under 0.85x or over 1.18x the
 * median of the building's other sales (rows in no block, same bedrooms, same completion, within
 * 365 days of the block's date), when at least 5 such sales exist. In the Nov 2026 files 13% of
 * like-unit block rows were outside 0.8x to 1.25x against 5.5% of ordinary sales, and the far ones
 * are bulk deals (77 units of one building on two days at exactly AED 851 per sq ft, where its
 * other sales sit at about 1,500). The band was 0.8x to 1.25x until the owner's review of 19 Nov
 * 2026, which tightened it for one-price batches at 0.81x to 0.85x and 1.12x to 1.16x that still
 * moved three buildings' medians by 11% to 16% (REAL_DATA.md section 14). A block with nothing
 * to compare with stays.
 */
export const PORTFOLIO_LEVEL_LOW = 0.85;
export const PORTFOLIO_LEVEL_HIGH = 1.18;
export const PORTFOLIO_LEVEL_DAYS = 365;
export const PORTFOLIO_LEVEL_MIN_ROWS = 5;
/** A size under 0.5x or over 2x the median size of the same building and bedrooms is left out ... */
export const SIZE_UNLIKE_LOW = 0.5;
export const SIZE_UNLIKE_HIGH = 2;
/** ... when that building has at least this many sales with those bedrooms. */
export const SIZE_UNLIKE_MIN_ROWS = 5;
export const WINDOW_MONTHS = 36;

export type SourceFormatErrorCode = "dubailand_export" | "missing_columns" | "empty_file";

export class SourceFormatError extends Error {
  override name = "SourceFormatError";
  constructor(
    message: string,
    readonly code: SourceFormatErrorCode,
  ) {
    super(message);
  }
}

/** A header cell as compared: no BOM, trimmed, lower case, single spaces. */
export function headerName(h: string): string {
  return cleanText(stripBom(h)).toLowerCase();
}

/** Columns only the dubailand.gov.ae website export has. */
const WEBSITE_EXPORT_COLUMNS = [
  "transaction number",
  "transaction date",
  "property id",
  "transaction type",
  "transaction sub type",
  "registration type",
  "is free hold?",
  "property size (sq.m)",
  "transaction size (sq.m)",
  "room(s)",
  "no. of buyer",
  "no. of seller",
  "master project",
  "project",
];

/** True when the header looks like the dubailand.gov.ae export: its columns, and no building column. */
export function isDubailandExport(header: readonly string[]): boolean {
  const names = new Set(header.map(headerName));
  const hasBuilding = names.has("building_name_en") || names.has("building name") || names.has("building");
  const hits = WEBSITE_EXPORT_COLUMNS.filter((c) => names.has(c)).length;
  return !hasBuilding && (names.has("transaction number") || names.has("transaction date") || hits >= 3);
}

/** Maps the header to column positions. Throws SourceFormatError for the website export or missing columns. */
export function mapColumns(header: readonly string[]): ColumnIndex {
  if (header.length === 0 || header.every((h) => headerName(h) === "")) {
    throw new SourceFormatError(COPY["adminUi.ingest.emptyFile"], "empty_file");
  }
  const names = header.map(headerName);
  const at = (c: string) => names.indexOf(c);
  const missing = DATA_DUBAI_REQUIRED.filter((c) => at(c) < 0);
  if (missing.length) {
    if (isDubailandExport(header)) throw new SourceFormatError(COPY["adminUi.ingest.dubailandExport"], "dubailand_export");
    throw new SourceFormatError(t("adminUi.ingest.missingColumns", { columns: missing.join(", ") }), "missing_columns");
  }
  const out = {} as ColumnIndex;
  for (const c of [...DATA_DUBAI_REQUIRED, ...DATA_DUBAI_OPTIONAL]) out[c] = at(c);
  return out;
}

/** "Sell - Pre registration" to "sell-preregistration": compared case- and space-insensitively. */
export function procedureKey(s: string): string {
  return cleanText(s).toLowerCase().replace(/\s+/g, "");
}

const SALE_PROCEDURES: ReadonlySet<string> = new Set(["sell", "sale", "sell-preregistration", "delayedsell"]);
const PRE_REGISTRATION = "sell-preregistration";

/** Rule 11: `reg_type_en` says Off-Plan or Existing; otherwise a pre-registration sale is off-plan. */
export function completionOf(regType: string | null, procedure: string): SaleCompletion {
  const r = (regType ?? "").toLowerCase();
  if (/off[\s-]*plan/.test(r)) return "off_plan";
  if (r.includes("existing")) return "ready";
  return procedureKey(procedure) === PRE_REGISTRATION ? "off_plan" : "ready";
}

/** A row that passed the per-row rules; `txid` and the text fields are cleaned. */
export interface CandidateSale {
  txid: string;
  date: IsoDate;
  building: string;
  areaDld: string;
  project: string | null;
  masterProject: string | null;
  bedrooms: number;
  sizeSqft: number;
  priceAed: number;
  completion: SaleCompletion;
  projectNumber: number | null;
  parking: boolean | null;
  nearestMetro: string | null;
  nearestMall: string | null;
  nearestLandmark: string | null;
}

export type RowResult = { ok: true; sale: CandidateSale } | { ok: false; reason: ExclusionReason };

const cell = (rec: readonly string[], i: number): string => (i >= 0 ? (rec[i] ?? "") : "");
const fail = (reason: ExclusionReason): RowResult => ({ ok: false, reason });

export interface ClassifyOptions {
  /**
   * The day the file was downloaded: a sale dated after it cannot be real (a typing slip, or a
   * pre-2000 two-digit year read as 20YY) and is left out as `date_out_of_range`, so it can never
   * become `dataThrough` and push every real sale out of the 36-month window.
   */
  latestDate?: IsoDate | null;
}

/**
 * Rules 1 to 8, the area, the date, the transaction id and the completion (rule 11) for one record.
 * Every row it keeps is one the snapshot reader accepts (`parseSnapshotRecord`): a building name, a
 * DLD area, a date, sizes and prices in range.
 */
export function classifyRow(rec: readonly string[], cols: ColumnIndex, opts: ClassifyOptions = {}): RowResult {
  if (cleanText(cell(rec, cols.trans_group_en)).toLowerCase() !== "sales") return fail("not_sales");
  const procedure = cell(rec, cols.procedure_name_en);
  if (!SALE_PROCEDURES.has(procedureKey(procedure))) return fail("procedure_excluded");
  if (cleanText(cell(rec, cols.property_sub_type_en)).toLowerCase() !== "flat") return fail("not_flat");
  const usage = cleanText(cell(rec, cols.property_usage_en));
  if (usage !== "" && usage.toLowerCase() !== "residential") return fail("not_residential");
  const bedrooms = parseRooms(cell(rec, cols.rooms_en));
  if (bedrooms === null) return fail("rooms_excluded");
  const building = cleanLatin(cell(rec, cols.building_name_en));
  if (!building) return fail("no_building_name");
  const areaDld = cleanLatin(cell(rec, cols.area_name_en));
  if (!areaDld) return fail("no_area");
  const sqm = parseAmount(cell(rec, cols.procedure_area));
  const worth = parseAmount(cell(rec, cols.actual_worth));
  if (!(sqm > 0) || !(worth > 0)) return fail("no_size_or_price");
  const sizeSqft = round2(sqm * SQFT_PER_SQM);
  if (sizeSqft < SIZE_MIN_SQFT || sizeSqft > SIZE_MAX_SQFT) return fail("size_out_of_range");
  const psf = worth / sizeSqft;
  if (psf < PSF_MIN || psf > PSF_MAX) return fail("psf_out_of_range");
  const date = parseSourceDate(cell(rec, cols.instance_date));
  if (!date) return fail("bad_date");
  if (opts.latestDate && date > opts.latestDate) return fail("date_out_of_range");
  const txid = cleanText(cell(rec, cols.transaction_id));
  if (!txid) return fail("no_transaction_id");
  return {
    ok: true,
    sale: {
      txid,
      date,
      building,
      areaDld,
      project: cleanLatinOrNull(cell(rec, cols.project_name_en)),
      masterProject: cleanLatinOrNull(cell(rec, cols.master_project_en)),
      bedrooms,
      sizeSqft,
      priceAed: Math.round(worth),
      completion: completionOf(cleanOrNull(cell(rec, cols.reg_type_en)), procedure),
      projectNumber: parseProjectNumber(cell(rec, cols.project_number)),
      parking: parseFlag(cell(rec, cols.has_parking)),
      nearestMetro: cleanLatinOrNull(cell(rec, cols.nearest_metro_en)),
      nearestMall: cleanLatinOrNull(cell(rec, cols.nearest_mall_en)),
      nearestLandmark: cleanLatinOrNull(cell(rec, cols.nearest_landmark_en)),
    },
  };
}

/** Source columns whose most common values the build report lists. */
export const REPORT_COLUMNS = ["procedure_name_en", "property_sub_type_en", "rooms_en", "reg_type_en", "area_name_en"] as const;
export type ReportColumn = (typeof REPORT_COLUMNS)[number];
export const REPORT_TOP_N = 20;
export const EMPTY_VALUE = "(empty)";

export interface CollectorResult {
  /** Kept sales, sorted by ref. */
  sales: NormalisedSale[];
  read: number;
  kept: number;
  excluded: ExclusionCounts;
  dataFrom: IsoDate | null;
  dataThrough: IsoDate | null;
  /** Distinct `dld_key` values among the kept sales. */
  buildings: number;
  /** One row per building of the kept sales, sorted by building name, then area. */
  buildingFacts: BuildingFacts[];
  /** The 20 most common values of each report column over every row read (missing column: empty list). */
  topValues: Record<ReportColumn, Array<{ value: string; count: number }>>;
  /**
   * The input of the adjusted-registered-sales model: the sales of the 1,461 days to `dataThrough`
   * that pass rules 1 to 10b (the kept sales and the 12 months before them), and the project family
   * of each of their buildings by `dld_key`. Null when no sale was kept.
   */
  acs: { sales: AcsBuildSale[]; families: Map<string, string> } | null;
}

type Kept = Omit<CandidateSale, "nearestMetro" | "nearestMall" | "nearestLandmark">;

/** What `add()` remembers per building (name and area as written) over every row that passes the row rules. */
interface SeenBuilding {
  firstSale: IsoDate;
  firstReadySale: IsoDate | null;
  metro: Map<string, number>;
  mall: Map<string, number>;
  landmark: Map<string, number>;
  /** The project number ("" when the row has none) and the project name ("" when none) of every passing row. */
  numbers: Map<string, number>;
  projects: Map<string, number>;
}

const bump = (m: Map<string, number>, v: string | null | undefined) => {
  if (v) m.set(v, (m.get(v) ?? 0) + 1);
};

/** The most frequent value (ties: the first in code-unit order), or null. */
function mostCommon(m: Map<string, number>): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of m) {
    if (c > n || (c === n && best !== null && compareRefs(v, best) < 0)) {
      best = v;
      n = c;
    }
  }
  return best;
}

/** The most frequent value over several counters, "" counted like any other (ties: the first one seen). */
function mostCommonSeen(maps: Iterable<Map<string, number>>): string {
  const sum = new Map<string, number>();
  for (const m of maps) for (const [v, c] of m) sum.set(v, (sum.get(v) ?? 0) + c);
  let best = "";
  let n = 0;
  for (const [v, c] of sum) {
    if (c > n) {
      best = v;
      n = c;
    }
  }
  return best;
}

function medianOf(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** `txSeen` packs (file, times kept) into one number: file x TX_FILE + n. */
const TX_FILE = 1_000_000;

/** Collects rows from one or more files; see the module comment. */
export class DataDubaiCollector {
  private readonly excluded = emptyExclusionCounts();
  private readonly kept: Kept[] = [];
  /** Transaction id to the file it was first kept from and how often it was kept there (packed). */
  private readonly txSeen = new Map<string, number>();
  private readonly values = Object.fromEntries(REPORT_COLUMNS.map((c) => [c, new Map<string, number>()])) as Record<
    ReportColumn,
    Map<string, number>
  >;
  private readonly strings = new Map<string, string>();
  /** Building (name + NUL + area, as written) to what every passing row said about it. */
  private readonly seen = new Map<string, SeenBuilding>();
  private read = 0;
  private finished = false;

  /** `opts.latestDate`: the download day (`--downloaded`); later dates are left out (`classifyRow`). */
  constructor(private readonly opts: ClassifyOptions = {}) {}

  /** One shared copy of each repeated string (building, area and project names, dates). */
  private intern<T extends string | null>(s: T): T {
    if (s === null) return s;
    const hit = this.strings.get(s);
    if (hit !== undefined) return hit as T;
    this.strings.set(s, s);
    return s;
  }

  /** Adds one data record of file number `file` (0-based, in the order the files are read). */
  add(rec: readonly string[], cols: ColumnIndex, file: number): void {
    if (this.finished) throw new Error("DataDubaiCollector: add() after finish()");
    this.read++;
    for (const c of REPORT_COLUMNS) {
      if (cols[c] < 0) continue;
      const v = cleanText(cell(rec, cols[c])) || EMPTY_VALUE;
      const m = this.values[c];
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    const r = classifyRow(rec, cols, this.opts);
    if (!r.ok) {
      this.excluded[r.reason]++;
      return;
    }
    const seen = this.txSeen.get(r.sale.txid);
    if (seen !== undefined && Math.floor(seen / TX_FILE) !== file) {
      // The same transaction in an overlapping second file: keep the first copy only.
      this.excluded.repeated_in_other_file++;
      return;
    }
    this.txSeen.set(r.sale.txid, seen === undefined ? file * TX_FILE + 1 : seen + 1);
    const s = r.sale;
    const pair = `${s.building}\u0000${s.areaDld}`;
    let b = this.seen.get(pair);
    if (!b) {
      b = { firstSale: s.date, firstReadySale: null, metro: new Map(), mall: new Map(), landmark: new Map(), numbers: new Map(), projects: new Map() };
      this.seen.set(pair, b);
    }
    if (s.date < b.firstSale) b.firstSale = s.date;
    if (s.completion === "ready" && (b.firstReadySale === null || s.date < b.firstReadySale)) b.firstReadySale = s.date;
    bump(b.metro, s.nearestMetro);
    bump(b.mall, s.nearestMall);
    bump(b.landmark, s.nearestLandmark);
    const number = s.projectNumber === null ? "" : String(s.projectNumber);
    b.numbers.set(number, (b.numbers.get(number) ?? 0) + 1);
    b.projects.set(s.project ?? "", (b.projects.get(s.project ?? "") ?? 0) + 1);
    this.kept.push({
      txid: s.txid,
      date: this.intern(s.date),
      building: this.intern(s.building),
      areaDld: this.intern(s.areaDld),
      project: this.intern(s.project),
      masterProject: this.intern(s.masterProject),
      bedrooms: s.bedrooms,
      sizeSqft: s.sizeSqft,
      priceAed: s.priceAed,
      completion: s.completion,
      projectNumber: s.projectNumber,
      parking: s.parking,
    });
  }

  /** Applies rules 9, 10, 10a, 10b and 12 and returns the kept sales, the building facts and every count. */
  finish(): CollectorResult {
    this.finished = true;
    // Rule 9: a transaction id kept more than once is a multi-unit deal.
    let rows = this.kept.filter((s) => {
      if ((this.txSeen.get(s.txid) ?? 0) % TX_FILE > 1) {
        this.excluded.multi_unit_deal++;
        return false;
      }
      return true;
    });

    // Rule 10: 3 or more rows with the same building, date and price whose units are unlike (other
    // bedrooms, or sizes more than 5% apart) carry a block price, not a price per unit.
    const keys = new Map<string, string>();
    const keyOf = (s: Kept) => {
      const pair = `${s.building}\u0000${s.areaDld}`;
      let k = keys.get(pair);
      if (k === undefined) {
        k = dldKey(s.building, s.areaDld);
        keys.set(pair, k);
      }
      return k;
    };
    interface Group {
      n: number;
      min: number;
      max: number;
      sizeSum: number;
      bedrooms: number;
      mixed: boolean;
    }
    const groups = new Map<string, Group>();
    const groupKey = (s: Kept) => `${keyOf(s)}\u0000${s.date}\u0000${s.priceAed}`;
    for (const s of rows) {
      const k = groupKey(s);
      const g = groups.get(k);
      if (!g) groups.set(k, { n: 1, min: s.sizeSqft, max: s.sizeSqft, sizeSum: s.sizeSqft, bedrooms: s.bedrooms, mixed: false });
      else {
        g.n++;
        g.sizeSum += s.sizeSqft;
        if (s.sizeSqft < g.min) g.min = s.sizeSqft;
        if (s.sizeSqft > g.max) g.max = s.sizeSqft;
        if (s.bedrooms !== g.bedrooms) g.mixed = true;
      }
    }
    rows = rows.filter((s) => {
      const g = groups.get(groupKey(s));
      if (g && g.n >= PORTFOLIO_MIN_ROWS && (g.mixed || g.max > g.min * PORTFOLIO_SIZE_TOLERANCE)) {
        this.excluded.portfolio_deal++;
        return false;
      }
      return true;
    });

    // Rule 10a: a block of like units whose AED per sq ft is far from the building's other sales
    // (rows in no block; same bedrooms and completion; within 365 days) is a bulk deal too.
    const levelKey = (s: Kept) => `${keyOf(s)}\u0000${s.bedrooms}\u0000${s.completion}`;
    const inBlock = (s: Kept) => (groups.get(groupKey(s))?.n ?? 0) >= PORTFOLIO_MIN_ROWS;
    const others = new Map<string, { date: IsoDate; psf: number }[]>();
    for (const s of rows) if (inBlock(s) && !others.has(levelKey(s))) others.set(levelKey(s), []);
    if (others.size > 0) {
      for (const s of rows) {
        if (inBlock(s)) continue;
        const a = others.get(levelKey(s));
        if (a) a.push({ date: s.date, psf: s.priceAed / s.sizeSqft });
      }
      // A block is judged once per completion, each against the building's other sales of that
      // completion, so a block that mixes ready and off-plan rows does not depend on the row order.
      const partKey = (s: Kept) => `${groupKey(s)}\u0000${s.completion}`;
      const judged = new Set<string>();
      const offLevel = new Set<string>();
      for (const s of rows) {
        const g = groups.get(groupKey(s));
        const part = partKey(s);
        if (!g || g.n < PORTFOLIO_MIN_ROWS || judged.has(part)) continue;
        judged.add(part);
        const from = addDays(s.date, -PORTFOLIO_LEVEL_DAYS);
        const to = addDays(s.date, PORTFOLIO_LEVEL_DAYS);
        const near: number[] = [];
        for (const o of others.get(levelKey(s)) ?? []) if (o.date >= from && o.date <= to) near.push(o.psf);
        if (near.length < PORTFOLIO_LEVEL_MIN_ROWS) continue;
        const ratio = (s.priceAed * g.n) / g.sizeSum / medianOf(near);
        if (ratio < PORTFOLIO_LEVEL_LOW || ratio > PORTFOLIO_LEVEL_HIGH) offLevel.add(part);
      }
      rows = rows.filter((s) => {
        if (offLevel.has(partKey(s))) {
          this.excluded.portfolio_deal++;
          return false;
        }
        return true;
      });
    }
    others.clear();
    groups.clear();

    // Rule 10b: a size far from the building's usual size for those bedrooms (every year counts:
    // units do not change size) means the room label or the area of that row is wrong.
    const cellKey = (s: Kept) => `${keyOf(s)}\u0000${s.bedrooms}`;
    const cellSizes = new Map<string, number[]>();
    for (const s of rows) {
      const k = cellKey(s);
      const a = cellSizes.get(k);
      if (a) a.push(s.sizeSqft);
      else cellSizes.set(k, [s.sizeSqft]);
    }
    const cellMedian = new Map<string, number>();
    for (const [k, a] of cellSizes) if (a.length >= SIZE_UNLIKE_MIN_ROWS) cellMedian.set(k, medianOf(a));
    cellSizes.clear();
    rows = rows.filter((s) => {
      const m = cellMedian.get(cellKey(s));
      if (m !== undefined && (s.sizeSqft < m * SIZE_UNLIKE_LOW || s.sizeSqft > m * SIZE_UNLIKE_HIGH)) {
        this.excluded.size_unlike_building++;
        return false;
      }
      return true;
    });

    // Rule 12: the 36 months that end at the latest kept date.
    let dataThrough: IsoDate | null = null;
    for (const s of rows) if (dataThrough === null || s.date > dataThrough) dataThrough = s.date;
    const acs = dataThrough === null ? null : this.acsInput(rows, keyOf, dataThrough);
    if (dataThrough !== null) {
      const start = addDays(addMonths(dataThrough, -WINDOW_MONTHS), 1);
      rows = rows.filter((s) => {
        if (s.date < start) {
          this.excluded.outside_window++;
          return false;
        }
        return true;
      });
    }
    let dataFrom: IsoDate | null = null;
    for (const s of rows) if (dataFrom === null || s.date < dataFrom) dataFrom = s.date;

    const sales: NormalisedSale[] = rows
      .map((s) => ({
        ref: `dld:${s.txid}`,
        date: s.date,
        building: s.building,
        areaDld: s.areaDld,
        project: s.project,
        masterProject: s.masterProject,
        bedrooms: s.bedrooms,
        sizeSqft: s.sizeSqft,
        priceAed: s.priceAed,
        completion: s.completion,
        projectNumber: s.projectNumber,
        parking: s.parking,
      }))
      .sort((a, b) => compareRefs(a.ref, b.ref));
    const buildingFacts = this.factsOf(rows, keyOf);
    const buildings = buildingFacts.length;

    const topValues = Object.fromEntries(
      REPORT_COLUMNS.map((c) => [
        c,
        [...this.values[c].entries()]
          .sort((a, b) => b[1] - a[1] || compareRefs(a[0], b[0]))
          .slice(0, REPORT_TOP_N)
          .map(([value, count]) => ({ value, count })),
      ]),
    ) as CollectorResult["topValues"];

    this.kept.length = 0;
    this.txSeen.clear();
    this.strings.clear();
    this.seen.clear();
    return {
      sales,
      read: this.read,
      kept: sales.length,
      excluded: { ...this.excluded },
      dataFrom,
      dataThrough,
      buildings,
      buildingFacts,
      topValues,
      acs,
    };
  }

  /**
   * The model's input (see `CollectorResult.acs`). `rows` have passed rules 9 to 10b. The family of
   * a building reads every row of the source files that passed the row rules (all years), as the
   * first-sale dates do: its most common project number and project name.
   */
  private acsInput(rows: readonly Kept[], keyOf: (s: Kept) => string, dataThrough: IsoDate): NonNullable<CollectorResult["acs"]> {
    const from = addDays(dataThrough, 1 - ACS_INDEX_DAYS);
    const sales: AcsBuildSale[] = [];
    const groups = new Map<string, { pairs: Set<string>; areas: Map<string, number> }>();
    for (const s of rows) {
      if (s.date < from) continue;
      const key = keyOf(s);
      sales.push({ ref: `dld:${s.txid}`, building: key, area: s.areaDld, date: s.date, bedrooms: s.bedrooms, basis: s.completion === "off_plan" ? 1 : 0, sizeSqft: s.sizeSqft, priceAed: s.priceAed });
      let g = groups.get(key);
      if (!g) {
        g = { pairs: new Set(), areas: new Map() };
        groups.set(key, g);
      }
      g.pairs.add(`${s.building}\u0000${s.areaDld}`);
      bump(g.areas, s.areaDld);
    }
    const families = new Map<string, string>();
    for (const [key, g] of groups) {
      const seen = [...g.pairs].map((p) => this.seen.get(p)).filter((b): b is SeenBuilding => b !== undefined);
      const family = familyKey(mostCommonSeen(seen.map((b) => b.numbers)), mostCommonSeen(seen.map((b) => b.projects)), mostCommon(g.areas) ?? "");
      if (family) families.set(key, family);
    }
    return { sales, families };
  }

  /** One `BuildingFacts` per `dld_key` of the kept rows (the same grouping the loader uses). */
  private factsOf(rows: readonly Kept[], keyOf: (s: Kept) => string): BuildingFacts[] {
    interface Group {
      names: Map<string, number>;
      areas: Map<string, number>;
      projects: Map<string, number>;
      masters: Map<string, number>;
      numbers: Map<string, number>;
      pairs: Set<string>;
      lastSale: IsoDate;
      sales: number;
      offPlan: number;
      parking: number;
    }
    const groups = new Map<string, Group>();
    for (const s of rows) {
      const k = keyOf(s);
      let g = groups.get(k);
      if (!g) {
        g = { names: new Map(), areas: new Map(), projects: new Map(), masters: new Map(), numbers: new Map(), pairs: new Set(), lastSale: s.date, sales: 0, offPlan: 0, parking: 0 };
        groups.set(k, g);
      }
      bump(g.names, s.building);
      bump(g.areas, s.areaDld);
      bump(g.projects, s.project);
      bump(g.masters, s.masterProject);
      bump(g.numbers, s.projectNumber === null ? null : String(s.projectNumber));
      g.pairs.add(`${s.building}\u0000${s.areaDld}`);
      if (s.date > g.lastSale) g.lastSale = s.date;
      g.sales++;
      if (s.completion === "off_plan") g.offPlan++;
      if (s.parking) g.parking++;
    }
    const out: BuildingFacts[] = [];
    for (const g of groups.values()) {
      let firstSale: IsoDate | null = null;
      let firstReadySale: IsoDate | null = null;
      const metro = new Map<string, number>();
      const mall = new Map<string, number>();
      const landmark = new Map<string, number>();
      for (const pair of g.pairs) {
        const b = this.seen.get(pair);
        if (!b) continue;
        if (firstSale === null || b.firstSale < firstSale) firstSale = b.firstSale;
        if (b.firstReadySale !== null && (firstReadySale === null || b.firstReadySale < firstReadySale)) firstReadySale = b.firstReadySale;
        for (const [v, c] of b.metro) metro.set(v, (metro.get(v) ?? 0) + c);
        for (const [v, c] of b.mall) mall.set(v, (mall.get(v) ?? 0) + c);
        for (const [v, c] of b.landmark) landmark.set(v, (landmark.get(v) ?? 0) + c);
      }
      const number = mostCommon(g.numbers);
      out.push({
        building: mostCommon(g.names) as string,
        areaDld: mostCommon(g.areas) as string,
        projectNumber: number === null ? null : Number(number),
        project: mostCommon(g.projects),
        masterProject: mostCommon(g.masters),
        nearestMetro: mostCommon(metro),
        nearestMall: mostCommon(mall),
        nearestLandmark: mostCommon(landmark),
        firstSale: firstSale ?? g.lastSale,
        firstReadySale,
        lastSale: g.lastSale,
        sales: g.sales,
        offPlanSales: g.offPlan,
        parkingSales: g.parking,
      });
    }
    return out.sort((a, b) => compareRefs(a.building, b.building) || compareRefs(a.areaDld, b.areaDld));
  }
}
