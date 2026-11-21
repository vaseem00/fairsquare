/**
 * Admin request schemas and response shapes (A§4.4, WP5). Client-safe: the admin forms validate with
 * the same schemas the `/api/admin/*` handlers use.
 */
import { z } from "zod";
import { COPY, FIELD_ERRORS } from "@/lib/copy";
import { isIsoDate, type IsoDate } from "@/lib/domain/dates";
import type { ExclusionReason } from "@/lib/ingest/types";
import type { AnalysisView, CheckBand, ErrorCode, FieldKey, LeadView } from "@/lib/types";
import { IdSchema, IsoDateSchema, LIMITS, wholeAed } from "./fields";

// ---------- shared ----------
export const ADMIN_RANGES = [7, 30, 90] as const;
export type AdminRange = (typeof ADMIN_RANGES)[number];
export const DEFAULT_ADMIN_RANGE: AdminRange = 30;

/** `?range=7|30|90`; anything else (or nothing) is the 30-day default. */
export function parseAdminRange(v: unknown): AdminRange {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (ADMIN_RANGES as readonly number[]).includes(n) ? (n as AdminRange) : DEFAULT_ADMIN_RANGE;
}

export const AdminRangeQuerySchema = z.object({
  range: z
    .union([z.literal("7"), z.literal("30"), z.literal("90")])
    .optional()
    .transform((v) => (v ? (Number(v) as AdminRange) : DEFAULT_ADMIN_RANGE)),
});

/** Longest external reference (e.g. a DLD transaction number). */
export const REF_MAX = 64;
/** Longest building project names. */
export const PROJECT_MAX = 120;
/** Aliases accepted when a building is added. */
export const ALIASES_MAX = 20;
/** Sales listed by GET /api/admin/sales. */
export const ADMIN_SALES_LIMIT = 500;

// ---------- stats ----------
export interface AdminStats {
  range: AdminRange;
  funnel: {
    newVisitors: number;
    extractOk: number;
    extractFail: number;
    checks: number;
    checksFromShares: number;
    shares: number;
    cardViews: number;
    costOpened: number;
    leads: number;
    leadsWithdrawn: number;
    kFactor: number | null;
  };
  perDay: Array<{ date: IsoDate; checks: number; extractFail: number }>;
  extractFailByCode: Partial<Record<ErrorCode, number>>;
  medianReadMs: number | null;
  editedFieldRate: Record<FieldKey, number>;
  /** Comparisons from screenshots (source "claude") the rates are based on. */
  editedFieldBase: number;
  verdicts: Record<CheckBand, number>;
  topRequests: Array<{ text: string; count: number; resolved: boolean }>;
  /** By building name, at most 1,000 rows; `freshnessTotal` counts every building and bedroom count. */
  freshness: Array<{ buildingId: number; name: string; bedrooms: number; latestSaleDate: IsoDate | null; sales12m: number }>;
  freshnessTotal: number;
}

// ---------- leads ----------
export type AdminLeadRow = LeadView & {
  name: string | null;
  consentVersion: string;
  sentAt: string | null;
  withdrawalNotifiedAt: string | null;
};

export const LEAD_STATUS_FILTERS = ["new", "sent", "withdrawn"] as const;

export const LeadsQuerySchema = z.object({
  status: z.enum(LEAD_STATUS_FILTERS).optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
});
export type LeadsQuery = z.output<typeof LeadsQuerySchema>;

export const LeadPatchSchema = z
  .object({
    status: z.literal("sent").optional(),
    withdrawalNotified: z.literal(true).optional(),
  })
  .refine((v) => v.status !== undefined || v.withdrawalNotified !== undefined, {
    error: COPY["apiError.bad_request"],
  });
export type LeadPatch = z.output<typeof LeadPatchSchema>;

export interface LeadReveal {
  phoneE164: string | null;
  name: string | null;
}

// ---------- requests ----------
export interface AdminRequestRow {
  textNorm: string;
  text: string;
  area: string | null;
  requests: number;
  people: number;
  firstAskedAt: string;
  lastAskedAt: string;
  resolvedBuilding: { id: number; name: string } | null;
}

export const RequestResolveSchema = z.object({
  textNorm: z.string({ error: COPY["adminUi.err.textNorm"] }).trim().min(1).max(200),
  resolvedBuildingId: z.number().int().positive().nullable(),
});

// ---------- buildings ----------
export interface AdminAlias {
  id: number;
  alias: string;
  aliasNorm: string;
  source: "seed" | "admin" | "import";
}

export interface AdminBuilding {
  id: number;
  name: string;
  area: string;
  /** The official DLD area name; null for buildings added by an admin. */
  areaDld: string | null;
  project: string | null;
  masterProject: string | null;
  /** True for a building from the DLD open data (it has a dld_key); each snapshot load rewrites its names. */
  fromOpenData: boolean;
  aliases: AdminAlias[];
  salesCount: number;
}

/** Buildings per page of the admin Buildings tab. */
export const ADMIN_BUILDINGS_PAGE = 50;
/** Shorter searches are ignored (the whole list is paged). */
export const ADMIN_BUILDINGS_QUERY_MIN = 2;

/** GET /api/admin/buildings?q=&page= (thousands of DLD buildings: searched and paged on the server). */
export const AdminBuildingsQuerySchema = z.object({
  q: z.string().trim().max(LIMITS.buildingMax).optional().nullable(),
  page: z.coerce.number().int().min(1).max(10_000).optional().nullable(),
});

export interface AdminBuildingsPage {
  buildings: AdminBuilding[];
  /** Buildings matching `q` (all buildings without one). */
  total: number;
  page: number;
  pageSize: number;
  /** The search used, or null when there was none (or it was shorter than 2 characters). */
  q: string | null;
}

/** A building in the admin pickers ("Register a sale", "Mark as covered"). */
export interface AdminBuildingOption {
  id: number;
  name: string;
  area: string;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: COPY["adminUi.err.tooLong"] })
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const BuildingCreateSchema = z.object({
  name: z
    .string({ error: COPY["adminUi.err.name"] })
    .trim()
    .min(2, { error: COPY["adminUi.err.name"] })
    .max(LIMITS.buildingMax, { error: COPY["adminUi.err.name"] }),
  area: z
    .string({ error: COPY["adminUi.err.area"] })
    .trim()
    .min(2, { error: COPY["adminUi.err.area"] })
    .max(LIMITS.areaMax, { error: COPY["adminUi.err.area"] }),
  project: optionalText(PROJECT_MAX),
  masterProject: optionalText(PROJECT_MAX),
  aliases: z
    .array(z.string().trim().max(LIMITS.buildingMax, { error: COPY["adminUi.err.alias"] }))
    .max(ALIASES_MAX)
    .optional()
    .default([])
    .transform((list) => list.filter((a) => a.length > 0)),
});
export type BuildingCreate = z.input<typeof BuildingCreateSchema>;

export const AliasCreateSchema = z.object({
  alias: z
    .string({ error: COPY["adminUi.err.alias"] })
    .trim()
    .min(2, { error: COPY["adminUi.err.alias"] })
    .max(LIMITS.buildingMax, { error: COPY["adminUi.err.alias"] }),
});

// ---------- sales ----------
export interface AdminSale {
  id: number;
  buildingId: number;
  buildingName: string;
  /** The building's area: DLD names repeat across areas, so the name alone cannot tell them apart. */
  buildingArea: string;
  saleDate: IsoDate;
  bedrooms: number;
  sizeSqft: number;
  priceAed: number;
  psf: number;
  source: "open_data" | "admin" | "import";
  completion: SaleCompletion;
  externalRef: string | null;
  createdAt: string;
}

/** A sale's completion status (REAL_DATA.md section 12: admin sales carry one). */
export const SALE_COMPLETIONS = ["ready", "off_plan"] as const;
export type SaleCompletion = (typeof SALE_COMPLETIONS)[number];

export const SalesQuerySchema = z.object({
  buildingId: IdSchema.optional(),
  bedrooms: z.coerce.number().int().min(LIMITS.bedMin).max(LIMITS.bedMax).optional(),
});

/**
 * A sale registered by an admin (`NewSale`, A§4.4). The same limits as ListingFields plus the
 * price-per-sq-ft range; `today` (Dubai) rejects a future date. `completion` defaults to "ready".
 */
export function newSaleSchema(today: IsoDate) {
  return z
    .object({
      buildingId: z.number({ error: COPY["adminUi.err.building"] }).int().positive({ error: COPY["adminUi.err.building"] }),
      saleDate: z
        .string({ error: COPY["err.date"] })
        .refine(isIsoDate, { error: COPY["err.date"] })
        .refine((d) => !isIsoDate(d) || d <= today, { error: COPY["adminUi.err.future"] }),
      bedrooms: z
        .number({ error: FIELD_ERRORS.bedrooms })
        .int({ error: FIELD_ERRORS.bedrooms })
        .min(LIMITS.bedMin, { error: FIELD_ERRORS.bedrooms })
        .max(LIMITS.bedMax, { error: FIELD_ERRORS.bedrooms }),
      sizeSqft: z
        .number({ error: FIELD_ERRORS.sizeSqft })
        .gt(LIMITS.sizeMin, { error: FIELD_ERRORS.sizeSqft })
        .max(LIMITS.sizeMax, { error: FIELD_ERRORS.sizeSqft }),
      priceAed: z
        .number({ error: COPY["adminUi.err.salePrice"] })
        .gt(LIMITS.priceMin, { error: COPY["adminUi.err.salePrice"] })
        .max(LIMITS.priceMax, { error: COPY["adminUi.err.salePrice"] })
        .transform(wholeAed),
      externalRef: z
        .string()
        .trim()
        .max(REF_MAX, { error: COPY["adminUi.err.ref"] })
        .optional()
        .nullable()
        .transform((v) => (v ? v : undefined)),
      /** Ready unless the sale was off-plan; a listing is compared only with sales of its own basis. */
      completion: z.enum(SALE_COMPLETIONS, { error: COPY["adminUi.err.completion"] }).optional().default("ready"),
    })
    .superRefine((s, ctx) => {
      const psf = s.priceAed / s.sizeSqft;
      if (psf < LIMITS.psfMin || psf > LIMITS.psfMax) {
        const message = FIELD_ERRORS.psf(psf);
        ctx.addIssue({ code: "custom", path: ["sizeSqft"], message });
        ctx.addIssue({ code: "custom", path: ["priceAed"], message });
      }
    });
}
export type NewSaleBody = z.input<ReturnType<typeof newSaleSchema>>;
export type NewSaleInput = z.output<ReturnType<typeof newSaleSchema>>;

/** Median view of one building and bedroom count ("AnalysisView-like"). */
export type MedianView = Pick<AnalysisView, "count" | "medianPsf" | "medianPriceAed">;

export interface SalePreview {
  before: MedianView;
  after: MedianView;
  /** Non-removed saved listings for this building and bedroom count that will show a new sale. */
  savedListingsAffected: number;
  /** False when the sale date is outside the comparison window (nothing changes). */
  inWindow: boolean;
  /** `admin.impact` (or `adminUi.impactNew` when there was no median before), or the outside-window note. */
  impact: string;
}

// ---------- data source (REAL_DATA.md section 12) ----------

/** GET /api/admin/data-source: the "Data source" panel of the sales data page. */
export interface DataSourcePanel {
  /** An open-data snapshot has been loaded (app_meta.open_data_sha is set). */
  loaded: boolean;
  /** The snapshot in OPEN_DATA_DIR differs from the loaded one (or none is loaded yet). */
  pending: boolean;
  /** app_meta.data_from / data_through of the loaded snapshot. */
  dataFrom: IsoDate | null;
  dataThrough: IsoDate | null;
  /**
   * The loaded data ends more than 45 days before today, so the public pages show the stale-data
   * note (REAL_DATA.md section 7): time to download a newer file.
   */
  stale: boolean;
  /** When the loader last finished (ISO timestamp), from app_meta. */
  loadedAt: string | null;
  /** The manifest of the loaded snapshot (or, when pending, of the one waiting to load). */
  manifest: {
    datasetTitle: string;
    datasetUrl: string;
    publisher: string;
    licence: string;
    licenceUrl: string;
    downloadedOn: IsoDate;
    /** Kept sales (rows in the snapshot). */
    rows: number;
    /** Source rows read. */
    read: number;
    buildings: number;
    snapshotSha256: string;
    /** Every exclusion reason in rule order, with its count. */
    excluded: Array<{ reason: ExclusionReason; count: number }>;
  } | null;
  /** What the database holds now. */
  live: { openDataSales: number; dldBuildings: number };
}

/** The Sales data page's tabs (`?tab=`). */
export const SALES_TABS = ["sales", "register", "buildings", "import"] as const;
export type SalesTab = (typeof SALES_TABS)[number];

// ---------- CSV import ----------
export const CSV_KINDS = ["sales", "buildings", "aliases"] as const;
export type CsvKind = (typeof CSV_KINDS)[number];

export const ImportQuerySchema = z.object({
  kind: z.enum(CSV_KINDS),
  commit: z
    .enum(["0", "1"])
    .optional()
    .transform((v) => v === "1"),
});

/** Largest CSV upload (A§4.4). */
export const CSV_MAX_BYTES = 5 * 1024 * 1024;
/** Most data rows in one CSV. */
export const CSV_MAX_ROWS = 50_000;
/** Rejected rows listed in the response. */
export const CSV_REJECTED_LIST_MAX = 100;

export interface ImportImpact {
  buildingName: string;
  bedrooms: number;
  /** Ready and off-plan medians are separate (REAL_DATA.md section 7). */
  completion: SaleCompletion;
  beforeMedianPsf: number | null;
  afterMedianPsf: number | null;
  added: number;
}

export interface ImportResult {
  kind: CsvKind;
  /** Data rows in the file. */
  rows: number;
  /** Rows that passed validation (duplicates included). */
  ok: number;
  /** The first 100 rejected rows; `rejectedCount` has the total. */
  rejected: Array<{ line: number; reason: string }>;
  rejectedCount: number;
  /** Rows that are (dry run) or were (commit) inserted. */
  created: number;
  /** Buildings whose area or project names change (buildings kind only). */
  updated: number;
  skippedDuplicates: number;
  committed: boolean;
  impact: ImportImpact[];
}
