/**
 * Zod schemas for every public request and response DTO (A§4.1–4.3).
 * `src/lib/types.ts` re-exports the inferred types; route handlers validate requests with these.
 */
import { ACS_REASONS } from "@/lib/domain/acs";
import { NEARBY_RULE_REASONS } from "@/lib/domain/nearby";
import { z } from "zod";
import { COPY, t } from "@/lib/copy";
import { normalisePhone } from "@/lib/domain/phone";
import { CodeSchema, IsoDateSchema, LIMITS, ListingFieldsSchema } from "./fields";

// ---------- enums ----------
export const CHECK_BANDS = ["above", "inline", "below", "thin", "none"] as const;
export const PROPERTY_TYPES = ["apartment", "villa", "townhouse", "other", "unknown"] as const;
export const COMPLETIONS = ["ready", "off_plan", "unknown"] as const;
/** Which sales a listing was compared with (REAL_DATA.md section 7). */
export const COMPLETION_BASES = ["ready", "off_plan"] as const;
export const CHECK_SOURCES = ["claude", "manual", "text"] as const;
/**
 * Where a comparison's size came from (RESULT_SPEC section 12.2): read from the listing, typed by the
 * person, or a size button built from the building's sales ("cluster", shown as "about 815 sq ft").
 */
export const SIZE_SOURCES = ["read", "typed", "cluster"] as const;
export const FIELD_KEYS = ["buildingText", "areaText", "bedrooms", "sizeSqft", "priceAed"] as const;
export const EXTRACT_OUTCOMES = ["ok", "not_listing", "rental", "not_apartment"] as const;
export const LEAD_STATUSES = ["new", "sent", "withdrawn"] as const;
export const CONSENT_VERSIONS = ["optin-v1"] as const;
export const MORTGAGE_YEARS = [15, 20, 25] as const;

export const ERROR_CODES = [
  "bad_request",
  "empty_input",
  "validation_failed",
  "image_too_large",
  "file_too_large",
  "unsupported_image",
  "image_rejected",
  "extract_refused",
  "extract_unreadable",
  "extract_timeout",
  "extract_failed",
  "extract_busy",
  "extract_unavailable",
  "daily_cap_reached",
  "rate_limited",
  "building_not_found",
  "not_found",
  "leads_unavailable",
  "consent_required",
  "consent_version_mismatch",
  "unauthorized",
  "bad_credentials",
  "bad_origin",
  "internal",
] as const;

export const RATE_LIMIT_SCOPES = ["extract_burst", "extract_daily", "spam", "admin_login"] as const;

export const CLIENT_EVENT_NAMES = [
  "share_native",
  "share_whatsapp",
  "link_copied",
  "card_downloaded",
  "cost_opened",
  "recovery_link_copied",
] as const;

export const SERVER_EVENT_NAMES = [
  "extract_ok",
  "extract_fail",
  "check_created",
  "card_viewed",
  "saved",
  "unsaved",
  "request_created",
  "lead_created",
  "lead_withdrawn",
  "lead_revealed",
  "leads_exported",
  "data_deleted",
] as const;

export const EVENT_NAMES = [...SERVER_EVENT_NAMES, ...CLIENT_EVENT_NAMES] as const;

export const CheckBandSchema = z.enum(CHECK_BANDS);
export const PropertyTypeSchema = z.enum(PROPERTY_TYPES);
export const CompletionSchema = z.enum(COMPLETIONS);
export const CompletionBasisSchema = z.enum(COMPLETION_BASES);
export const CheckSourceSchema = z.enum(CHECK_SOURCES);
export const SizeSourceSchema = z.enum(SIZE_SOURCES);
export const FieldKeySchema = z.enum(FIELD_KEYS);
export const ExtractOutcomeSchema = z.enum(EXTRACT_OUTCOMES);
export const LeadStatusSchema = z.enum(LEAD_STATUSES);
export const ConsentVersionSchema = z.enum(CONSENT_VERSIONS);
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export const RateLimitScopeSchema = z.enum(RATE_LIMIT_SCOPES);
export const EventNameSchema = z.enum(EVENT_NAMES);
export const ClientEventNameSchema = z.enum(CLIENT_EVENT_NAMES);

// ---------- errors ----------
export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
  retryAfterSec: z.number().optional(),
  requestId: z.string(),
});
export const ApiErrorBodySchema = z.object({ error: ApiErrorSchema });

// ---------- shared DTOs ----------
export { ListingFieldsSchema };

export const ExtractedFieldsSchema = z.object({
  buildingText: z.string().nullable(),
  areaText: z.string().nullable(),
  bedrooms: z.number().int().nullable(),
  sizeSqft: z.number().nullable(),
  priceAed: z.number().nullable(),
});

/** `areaDld`: the official DLD area name when it is known (REAL_DATA.md section 6). */
export const BuildingRefSchema = z.object({ id: z.number().int(), name: z.string(), area: z.string(), areaDld: z.string().nullish() });

/** A size button (RESULT_SPEC section 2.5): a cluster's median size, rounded to 5 sq ft, and its sales. */
export const SizeClusterViewSchema = z.object({ sqft: z.number(), sales: z.number().int() });

export const CandidateViewSchema = z.object({
  buildingId: z.number().int(),
  name: z.string(),
  area: z.string(),
  strength: z.enum(["strong", "possible"]),
  salesForBedrooms: z.number().int().nullable(),
  /**
   * The usual sizes of this bedroom count here (RESULT_SPEC sections 2.5 and 12.2): only on the
   * preselected (strong) candidate when the bedrooms are known and sales data is loaded, from the same
   * 12-month, same-bedroom, same-basis sales `salesForBedrooms` counts. Up to 3, by size; may be empty.
   */
  sizes: z.array(SizeClusterViewSchema).optional(),
  /**
   * The same 12-month, same-bedroom registered sales counted by basis (ready, off-plan): only on the
   * preselected candidate when the bedrooms are known and sales data is loaded. The scene asks "Is it
   * ready or off-plan?" when the listing did not say and both are above 0 (RESULT_SPEC section 2.5).
   */
  basisSales: z.object({ ready: z.number().int(), offPlan: z.number().int() }).optional(),
});

export const MatchResponseSchema = z.object({
  candidates: z.array(CandidateViewSchema),
  preselectId: z.number().int().nullable(),
  /** Two candidates differ only by a tower number: check the number on the listing. */
  towerCheck: z.boolean(),
  /** Two candidates have the same name in different areas: check the area on the listing. */
  areaCheck: z.boolean(),
});

/**
 * A sale behind a comparison. `source` is present only for a sale that is not DLD open data (one the
 * admin registered or imported): it is marked as added by Fairsquare and never credited to the DLD.
 */
export const SaleViewSchema = z.object({
  saleDate: IsoDateSchema,
  sizeSqft: z.number(),
  priceAed: z.number(),
  psf: z.number(),
  source: z.enum(["admin", "import"]).optional(),
});

/**
 * A comparison's numbers (REAL_DATA.md section 7). The window ends at min(the day it was computed,
 * data_through); `dataThrough` is null when no sales data was loaded (the comparison is then "none").
 * `count` is the sales used after `outliersDropped` unusual ones were left out; `medianSizeSqft` is
 * their median size, for the size note (`sizeNote` in copy.ts).
 */
export const AnalysisViewSchema = z.object({
  band: CheckBandSchema,
  askingPsf: z.number(),
  medianPsf: z.number().nullable(),
  medianPriceAed: z.number().nullable(),
  count: z.number().int(),
  diff: z.number().nullable(),
  windowStart: IsoDateSchema,
  windowEnd: IsoDateSchema,
  completionBasis: CompletionBasisSchema,
  outliersDropped: z.number().int(),
  medianSizeSqft: z.number().nullable(),
  dataThrough: IsoDateSchema.nullable(),
});

/** Why a similar-buildings comparison is not shown (REAL_DATA.md section 15.3). */
export const SIMILAR_REASONS = [
  // More than 3 bedrooms: too few test cases to state anything.
  "bedrooms_not_validated",
  // Nothing to build a range from.
  "no_evidence",
  // Only other buildings (of the project, the community or the area), nothing from the building itself: never shown.
  "no_building_evidence",
  // Only the building's 1 to 4 sales of the 12 months, nothing more: the same sales the first tier calls too few.
  "own_sales_only",
  // The building's own medians are far apart, or its 12-month median is outside the range.
  "evidence_disagrees",
  // The range is too wide to say anything.
  "range_too_wide",
  // The building was not matched and the listing's area names no DLD area.
  "area_unresolved",
  // The building was not matched and the area fits several DLD areas (`areaCandidates`).
  "area_ambiguous",
] as const;
export const SIMILAR_VERDICTS = ["above", "within", "below"] as const;
export const SIMILAR_TIERS = ["close", "broad"] as const;
export const SIMILAR_LEVELS = ["project", "community", "area"] as const;

/**
 * The similar-buildings comparison stored with a comparison (REAL_DATA.md section 15.4), version 1. It is
 * the second tier: present only when the same-building comparison could not run (too few sales, or
 * the building was not matched). Everything a page needs to show it later is here, so /c shows what
 * the person saw. `shown` false keeps the reason and nothing to display: the page then shows "Too few
 * sales to compare yet" or "Not covered yet" exactly as before. The range is where the building's
 * own median sits, rounded to AED 10 per sq ft; it is never a price for the unit, and no single
 * middle figure is stored.
 */
export const SimilarViewSchema = z.object({
  v: z.literal(1),
  /** The version of the fitted constants. */
  modelVersion: z.number().int(),
  /**
   * "building": a matched building with too few sales. "area": no building, only the listing's area.
   * "project": no building, but the listing names a project of the data (REAL_DATA.md section 15.8):
   * the range comes from other buildings of that project alone, and says the building has no sales.
   */
  scenario: z.enum(["building", "area", "project"]),
  shown: z.boolean(),
  reason: z.enum(SIMILAR_REASONS).nullable(),
  /** "close": the range is at most about 10% either way; "broad": up to about 20%. Null when not shown. */
  tier: z.enum(SIMILAR_TIERS).nullable(),
  /** Where the similar buildings are: the same project, the same community (master project) or the same DLD area. */
  level: z.enum(SIMILAR_LEVELS).nullable(),
  /** The community or area as shown ("Jumeirah Village Circle"); null for the project level and when there is none. */
  place: z.string().nullable(),
  /** Similar buildings with 3 or more same-bedroom, same-basis sales in the 12 months, and those sales. */
  comparableBuildings: z.number().int(),
  comparableSales: z.number().int(),
  rangeLowPsf: z.number().nullable(),
  rangeHighPsf: z.number().nullable(),
  /** The asking price per sq ft against exactly the rounded range. */
  verdict: z.enum(SIMILAR_VERDICTS).nullable(),
  /** Registered sales of the building itself behind the range: counts only. */
  evidence: z.object({
    /** Same bedrooms and basis in the 12 months (1 to 4, or 0). */
    ownSales: z.number().int(),
    /** Same bedrooms and basis in the 24 months before that. */
    olderSales: z.number().int(),
    /** Other bedroom types on the same basis in the 12 months. */
    otherBedroomSales: z.number().int(),
  }),
  /** The 12 months the range is stated for (they end at data_through). */
  windowStart: IsoDateSchema,
  windowEnd: IsoDateSchema,
  /** "area" scenario: the DLD area the listing's text resolved to. */
  area: z.object({ areaDld: z.string(), masterProject: z.string().nullable() }).nullable(),
  /** "area" scenario, reason area_ambiguous: the DLD areas the text could mean, for one question. */
  areaCandidates: z.array(z.object({ areaDld: z.string(), masterProject: z.string().nullable(), alias: z.string() })).default([]),
  /** Of 10 tested cases, how many ranges held the building's median: at the data date, and against the next six months. */
  tested: z.object({ heldOf10: z.number().int(), heldLaterOf10: z.number().int() }).nullable(),
  /**
   * The similar buildings behind a shown range, most sales first (at most SIMILAR_COMPARABLES_MAX of
   * `comparableBuildings`): the DLD building as shown, its same-bedroom, same-basis sales in the 12
   * months and their median AED per sq ft, rounded. Registered facts about other buildings: the scale
   * marks them and the list names them. Empty for an entry stored before the list existed.
   */
  comparables: z.array(z.object({ name: z.string(), sales: z.number().int(), medianPsf: z.number() })).default([]),
  /**
   * The lowest and the highest of the medians of ALL the buildings the reference was read from (not
   * only the stored `comparables`), rounded to a whole dirham: how unlike each other they are. Null
   * with none, when not shown, and for an entry stored before it existed.
   */
  comparableSpan: z.object({ lowPsf: z.number(), highPsf: z.number() }).nullable().default(null),
  /**
   * "project" scenario: the project the listing was resolved to, its name as shown ("Azizi Venice") and
   * its DLD area. Null otherwise, and for an entry stored before the project route existed.
   */
  project: z.object({ name: z.string().min(1), areaDld: z.string() }).nullable().default(null),
});
/** The most similar buildings a stored comparison names. */
export const SIMILAR_COMPARABLES_MAX = 200;

/** Why adjusted registered sales gave no range (REAL_DATA.md section 16.3; the list is in domain/acs.ts). Stored, never shown as such. */
export { ACS_REASONS };
export const ACS_VERDICTS = ["above", "within", "below"] as const;
/** The most rows a stored comparison lists (the rows with the most weight). */
export const ACS_COMPARABLES_MAX = 200;

/**
 * One row behind an adjusted-registered-sales range: a registered sale (or several registered at one
 * price) and how it was moved to the listing. The adjustments are fractions (0.031 is +3.1%).
 */
export const AcsComparableSchema = z.object({
  /** 1: this building, same bedrooms. 2: this building, another bedroom count. 3: another building of the project. */
  ring: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** The other building as shown (ring 3); null for the listing's own building. */
  building: z.string().nullable(),
  /** The registration date; for several sales in one row, the latest. */
  date: IsoDateSchema,
  /** 0 = studio. */
  bedrooms: z.number().int(),
  /** The size; for sales of unlike units registered at one price, the median size. */
  sizeSqft: z.number(),
  /** The registered price; null for sales of unlike units registered at one price per sq ft. */
  priceAed: z.number().nullable(),
  /** The registered AED per sq ft. */
  psf: z.number(),
  /** Registered sales in the row: 1, or more for sales registered at one price. */
  count: z.number().int().min(1),
  /** True when the row is several unlike units registered at one price per sq ft within a few days. */
  batch: z.boolean(),
  /** The adjustment from the sale's date to the data date. */
  timeAdj: z.number(),
  /** The adjustment from the sale's size to the listing's size. */
  sizeAdj: z.number(),
  /** The adjustment between bedroom counts; 0 except ring 2. */
  bedroomAdj: z.number(),
  /** AED per sq ft after the adjustments. */
  adjustedPsf: z.number(),
  /** The row's share of the total weight, 0 to 1. */
  weightShare: z.number(),
});

/**
 * The adjusted-registered-sales result stored with a comparison (`checks.acs_view`, REAL_DATA.md
 * section 16.4), version 1. It is the first answer for a matched building, studio to 3-bed: registered
 * sales of the building (and of other buildings of its project), each moved to the data date and to
 * the listing's size, give a range, and the asking price per sq ft is above, within or below exactly
 * that rounded range. `shown` false keeps the reason and nothing to display: the page then shows the
 * same-building median or the second tier exactly as before. No single middle figure is in this view
 * (the stored row keeps one under `server`, which this schema drops).
 */
export const AcsViewSchema = z.object({
  v: z.literal(1),
  /** The format of the model file, and the version of the fit. */
  modelVersion: z.number().int(),
  constantsVersion: z.number().int(),
  /** The data date the sales are adjusted to, and the first day of the sales read. */
  dataThrough: IsoDateSchema,
  poolFrom: IsoDateSchema,
  /** "enough": the same-building comparison had its 5 or more sales. "few": it had too few. */
  scenario: z.enum(["enough", "few"]),
  shown: z.boolean(),
  reason: z.enum(ACS_REASONS).nullable(),
  /** The range, each end rounded to AED 10 per sq ft. Null when not shown. */
  rangeLowPsf: z.number().nullable(),
  rangeHighPsf: z.number().nullable(),
  /** The asking price per sq ft against exactly the rounded range. */
  verdict: z.enum(ACS_VERDICTS).nullable(),
  /**
   * Registered sales behind the range, by where they come from. `lead` is 1 when sales of the same
   * bedroom count in the building carry at least half of the weight, 2 when other bedroom counts lead.
   */
  evidence: z.object({
    lead: z.number().int().nullable(),
    sales: z.number().int(),
    ownSales: z.number().int(),
    otherBedroomSales: z.number().int(),
    projectSales: z.number().int(),
  }),
  /** The median size of the building's sales of this bedroom count and basis; null with none. */
  typicalSizeSqft: z.number().nullable(),
  /** Of 10 later registered sales, how many were inside ranges made this way: over all tested data dates, and at the later ones. */
  tested: z.object({ heldOf10: z.number().int(), heldLaterOf10: z.number().int() }).nullable(),
  /** The rows used, largest weight first (at most ACS_COMPARABLES_MAX of `comparablesTotal`). Empty when not shown. */
  comparables: z.array(AcsComparableSchema).default([]),
  comparablesTotal: z.number().int().default(0),
});

/**
 * What `checks.acs_view` holds: the view plus what stays on the server (the middle figure and the
 * unrounded ends, for audit only). Never sent to a browser: every reader goes through AcsViewSchema.
 */
export const AcsStoredSchema = AcsViewSchema.extend({
  server: z
    .object({ centrePsf: z.number(), lowPsf: z.number().nullable(), highPsf: z.number().nullable(), halfWidth: z.number().nullable(), group: z.string(), groupUsed: z.string().nullable() })
    .nullable()
    .default(null),
});
/**
 * Why nearby registered sales gave no range (REAL_DATA.md section 17.3): the rule's refusals
 * (domain/nearby.ts), and for a building that is not in the data the two cases where the listing's
 * area names no one place. Stored, never shown as such: the page then stays as it was.
 */
export const NEARBY_REASONS = [...NEARBY_RULE_REASONS, "area_unresolved", "area_ambiguous"] as const;
export const NEARBY_VERDICTS = ["above", "within", "below"] as const;
export const NEARBY_SCOPES = ["community", "community_and_area", "area"] as const;
/** The most rows and the most buildings a stored comparison lists (those with the most weight). */
export const NEARBY_COMPARABLES_MAX = 200;
export const NEARBY_BUILDINGS_MAX = 200;

/**
 * One row behind a range of nearby registered sales: a registered sale in ANOTHER building and how it
 * was moved to the listing. The adjustments are fractions (0.031 is +3.1%).
 */
export const NearbyComparableSchema = z.object({
  /** The other building as shown (buildings.name). */
  building: z.string(),
  /** The registration date. */
  date: IsoDateSchema,
  sizeSqft: z.number(),
  /** The registered AED per sq ft. */
  psf: z.number(),
  /** The adjustment from the sale's date to the data date. */
  timeAdj: z.number(),
  /** The adjustment from the sale's size to the listing's size. */
  sizeAdj: z.number(),
  /** The adjustment for the age of the sale's building against the listing's; 0 when none is made. */
  ageAdj: z.number(),
  /** AED per sq ft after the adjustments. */
  adjustedPsf: z.number(),
  /** The row's share of the total weight, 0 to 1. */
  weightShare: z.number(),
});

/**
 * The nearby-registered-sales result stored with a comparison (`checks.nearby_view`, REAL_DATA.md
 * section 17.4), version 1. It is the last resort: computed only when the same-building comparison,
 * adjusted registered sales and the second tier all gave nothing to show. Registered sales of the same
 * bedroom count and basis in OTHER buildings of the community (or the DLD area), each moved to the data
 * date, to the listing's size and, where it applies, to the age of its building, give a range, and the
 * asking price per sq ft is above, within or below exactly that rounded range. `shown` false keeps the
 * reason and nothing to display. No single middle figure is in this view (the stored row keeps one
 * under `server`, which this schema drops).
 */
export const NearbyViewSchema = z.object({
  v: z.literal(1),
  /** The version of the fit (src/lib/nearby/constants.json). */
  constantsVersion: z.number().int(),
  /** The data date the sales are adjusted to, and the first day of the sales read (730 days). */
  dataThrough: IsoDateSchema,
  windowFrom: IsoDateSchema,
  /** "in": the listing's building is in the data (its own sales are never used). "out": no building was chosen. */
  kind: z.enum(["in", "out"]),
  shown: z.boolean(),
  reason: z.enum(NEARBY_REASONS).nullable(),
  /** Where the other buildings are: the community alone, the community with the rest of its DLD area, or the DLD area. */
  scope: z.enum(NEARBY_SCOPES).nullable(),
  /** The community (master project) and the area as shown ("Dubai Science Park", "Al Barsha South"); null when not known. */
  community: z.string().nullable(),
  area: z.string().nullable(),
  /** The range, each end rounded to AED 10 per sq ft. Null when not shown. */
  rangeLowPsf: z.number().nullable(),
  rangeHighPsf: z.number().nullable(),
  /** The asking price per sq ft against exactly the rounded range. */
  verdict: z.enum(NEARBY_VERDICTS).nullable(),
  /** True when the sales were also adjusted for the age of their building. */
  ageAdjusted: z.boolean().default(false),
  /** Of 10 later registered sales, how many were inside ranges made this way (constants `tested.heldOf10`). */
  tested: z.object({ heldOf10: z.number().int() }).nullable(),
  /** The other buildings the sales come from, largest share first (at most NEARBY_BUILDINGS_MAX of `buildingsTotal`). */
  buildings: z.array(z.object({ name: z.string(), sales: z.number().int(), weightShare: z.number() })).default([]),
  buildingsTotal: z.number().int().default(0),
  /** The rows used, largest weight first (at most NEARBY_COMPARABLES_MAX of `comparablesTotal`). Empty when not shown. */
  comparables: z.array(NearbyComparableSchema).default([]),
  comparablesTotal: z.number().int().default(0),
});

/**
 * What `checks.nearby_view` holds: the view plus what stays on the server (the middle figure, the
 * unrounded ends and the rule's inputs, for audit only). Never sent to a browser.
 */
export const NearbyStoredSchema = NearbyViewSchema.extend({
  server: z
    .object({
      centrePsf: z.number(),
      lowPsf: z.number().nullable(),
      highPsf: z.number().nullable(),
      halfWidth: z.number().nullable(),
      group: z.string(),
      /** Buildings that count for the rule, the total weight and the weighted size distance. */
      buildings: z.number(),
      weight: z.number(),
      sizeDistance: z.number(),
    })
    .nullable()
    .default(null),
});

export const RulesSchema = z.object({
  minSales: z.number().int(),
  windowDays: z.number().int(),
  bandPct: z.number(),
});

export const CheckViewSchema = z.object({
  code: z.string(),
  url: z.string(),
  createdAt: z.string(),
  building: BuildingRefSchema.nullable(),
  buildingText: z.string(),
  areaText: z.string().nullable(),
  bedrooms: z.number().int(),
  sizeSqft: z.number(),
  priceAed: z.number(),
  propertyType: PropertyTypeSchema,
  completion: CompletionSchema,
  source: CheckSourceSchema,
  analysis: AnalysisViewSchema,
  /** The sales compared (unusual ones left out), newest first. */
  sales: z.array(SaleViewSchema),
  /**
   * The unusual sales left out of the comparison (`analysis.outliersDropped` of them), newest first
   * (RESULT_SPEC section 12.2): the list marks them "set aside"; the scale never draws them. Empty when
   * none, and for comparisons stored before they were kept.
   */
  setAsideSales: z.array(SaleViewSchema).default([]),
  /** Where the size came from ("cluster": the fact line says "about"); null when not given. */
  sizeSource: SizeSourceSchema.nullable().default(null),
  rules: RulesSchema,
  /**
   * The similar-buildings comparison (the second tier), when it applied. Absent or null: it did not
   * apply, or the comparison was stored before it existed. An entry of a version this build cannot
   * read is taken as null.
   */
  similar: SimilarViewSchema.nullable().optional().catch(null),
  /**
   * Adjusted registered sales (REAL_DATA.md section 16), when it ran. With `shown` true it is the
   * first answer: its range decides above, within or below, and `analysis` and `similar` (always
   * stored) are what the page shows without it. Absent or null: it did not run, it is switched off
   * (ACS_TIER=off), or the comparison was stored before it existed. An entry of a version this build
   * cannot read is taken as null.
   */
  acs: AcsViewSchema.nullable().optional().catch(null),
  /**
   * Nearby registered sales (REAL_DATA.md section 17), when it ran: the last resort, computed only when
   * nothing else gave a comparison. With `shown` true the headline is its outcome and the page says
   * that the range comes from other buildings. Absent or null: it did not run, it is switched off
   * (NEARBY_TIER=off), or the comparison was stored before it existed.
   */
  nearby: NearbyViewSchema.nullable().optional().catch(null),
});

export const BandSnapshotSchema = z.object({
  band: CheckBandSchema,
  diff: z.number().nullable(),
  count: z.number().int(),
});

export const SavedItemViewSchema = z.object({
  code: z.string(),
  savedAt: z.string(),
  building: BuildingRefSchema.nullable(),
  buildingText: z.string(),
  bedrooms: z.number().int(),
  sizeSqft: z.number(),
  priceAed: z.number(),
  atSave: BandSnapshotSchema,
  now: BandSnapshotSchema,
  newSalesSinceSave: z.number().int(),
  unseenNewSales: z.number().int(),
  /**
   * The range of adjusted registered sales when it leads the saved comparison (REAL_DATA.md section
   * 16): the Saved line then states the outcome against that range, as the comparison's page does.
   * Null otherwise, and from a server without it.
   */
  acs: z.object({ verdict: z.enum(ACS_VERDICTS), rangeLowPsf: z.number(), rangeHighPsf: z.number() }).nullable().optional(),
  /** The range of nearby registered sales when it answers the saved comparison (REAL_DATA.md section 17). Null otherwise. */
  nearby: z.object({ verdict: z.enum(NEARBY_VERDICTS), rangeLowPsf: z.number(), rangeHighPsf: z.number() }).nullable().optional(),
});

export const RequestViewSchema = z.object({
  id: z.number().int(),
  text: z.string(),
  area: z.string().nullable(),
  createdAt: z.string(),
  othersAsked: z.number().int(),
  covered: z.boolean(),
  coveredBuilding: z.object({ id: z.number().int(), name: z.string() }).nullable(),
});

export const LeadViewSchema = z.object({
  id: z.number().int(),
  partner: z.string(),
  status: LeadStatusSchema,
  createdAt: z.string(),
  withdrawnAt: z.string().nullable(),
  phoneMasked: z.string().nullable(),
  checkCode: z.string().nullable(),
  buildingName: z.string(),
  bedrooms: z.number().int(),
  priceAed: z.number(),
});

export const MeViewSchema = z.object({
  savedCount: z.number().int(),
  savedWithNewSales: z.number().int(),
  checksCount: z.number().int(),
  requests: z.array(RequestViewSchema),
  leads: z.array(LeadViewSchema),
});

const WindowSchema = z.object({ start: IsoDateSchema, end: IsoDateSchema });

/**
 * One bedroom count of a covered building. Counts are registered sales in the comparison window, per
 * completion basis (never pooled, REAL_DATA.md section 7); `medianPsf` is of the ready ones (outliers
 * left out). `readyComparable` / `offPlanComparable`: a ready (or unknown) / an off-plan listing of
 * this type gets a verdict, i.e. that basis has MIN_SALES sales once unusual ones are left out.
 */
export const CoverageTypeSchema = z.object({
  bedrooms: z.number().int(),
  readySales: z.number().int(),
  offPlanSales: z.number().int(),
  medianPsf: z.number().nullable(),
  latestSaleDate: IsoDateSchema.nullable(),
  readyComparable: z.boolean(),
  offPlanComparable: z.boolean(),
});

/** A coverage row (REAL_DATA.md section 11): building, area, ready and off-plan sales in the window, latest sale. */
export const CoverageBuildingSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  area: z.string(),
  /** The official DLD area name (null for admin-added buildings). */
  areaDld: z.string().nullable(),
  readySales: z.number().int(),
  offPlanSales: z.number().int(),
  latestSaleDate: IsoDateSchema.nullable(),
  types: z.array(CoverageTypeSchema),
});

/**
 * GET /api/buildings?q=&page=: one page of 50, most sales in the window first. `q` is the search that
 * was applied (null when none or shorter than 2 characters); `total` counts every matching building.
 * `window` is null (and the list empty) when no sales data is loaded.
 */
export const CoverageResponseSchema = z.object({
  buildings: z.array(CoverageBuildingSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  q: z.string().nullable(),
  window: WindowSchema.nullable(),
  dataThrough: IsoDateSchema.nullable(),
});

export const ExtractResponseSchema = z.object({
  outcome: ExtractOutcomeSchema,
  fields: ExtractedFieldsSchema,
  propertyType: PropertyTypeSchema,
  completion: CompletionSchema,
  contactDetailsVisible: z.boolean(),
  match: MatchResponseSchema,
});

/**
 * The loaded sales data (REAL_DATA.md sections 7 and 9): its range, whether it is stale (data_through
 * more than 45 days before today) and the dataset and licence for the attribution line. `loaded` is
 * false (and every date null) until the open-data snapshot has loaded.
 */
export const DataStatusSchema = z.object({
  loaded: z.boolean(),
  dataFrom: IsoDateSchema.nullable(),
  dataThrough: IsoDateSchema.nullable(),
  stale: z.boolean(),
  source: z
    .object({
      title: z.string(),
      url: z.string(),
      publisher: z.string(),
      licence: z.string(),
      licenceUrl: z.string(),
    })
    .nullable(),
});

/**
 * Configuration for the browser (A§7.1). The adviser opt-in exists only when PARTNER_NAME,
 * PARTNER_REGULATOR and PARTNER_LICENCE are all set (`leadsEnabled`); otherwise `partner` and
 * `consent` are null (REAL_DATA.md section 8).
 */
export const PublicConfigSchema = z.object({
  appUrl: z.string(),
  extractEnabled: z.boolean(),
  maxImageBytes: z.number().int(),
  leadsEnabled: z.boolean(),
  partner: z
    .object({
      name: z.string(),
      regulator: z.string(),
      licence: z.string(),
      promise: z.string().nullable(),
    })
    .nullable(),
  consent: z.object({ version: ConsentVersionSchema, text: z.string() }).nullable(),
  rules: RulesSchema,
  mortgage: z.object({ downPct: z.number(), ratePct: z.number(), years: z.number().int() }),
  data: DataStatusSchema,
  /**
   * The median of the last 200 reads in whole seconds, once 50 reads exist (RESULT_SPEC 2.3): "Still
   * reading. This usually takes about {s} seconds." Null or absent until then.
   */
  readP50Sec: z.number().int().positive().nullable().optional(),
});

/**
 * "From the data" (REAL_DATA.md section 10): the building with the most ready 2-bed sales in the
 * window, with their median AED per sq ft (outliers left out), count and date range. Real numbers
 * only: never a listing or an asking price.
 */
export const FromTheDataSchema = z.object({
  building: z.object({ id: z.number().int(), name: z.string(), area: z.string(), areaDld: z.string().nullable() }),
  bedrooms: z.number().int(),
  completion: CompletionBasisSchema,
  count: z.number().int(),
  medianPsf: z.number(),
  outliersDropped: z.number().int(),
  firstSaleDate: IsoDateSchema,
  lastSaleDate: IsoDateSchema,
  window: WindowSchema,
});

/** GET /api/meta: the data status and the "From the data" panel (null when no data is loaded). */
export const MetaResponseSchema = z.object({
  data: DataStatusSchema,
  fromTheData: FromTheDataSchema.nullable(),
});

// ---------- requests ----------
/** POST /api/extract: the text part of the multipart body (the image is checked by magic bytes). */
export const ExtractTextSchema = z.string().max(LIMITS.textMax);

/** GET /api/buildings/match?q=&area=&beds= */
export const MatchQuerySchema = z.object({
  q: z.string().trim().min(1).max(LIMITS.buildingMax),
  area: z.string().trim().max(LIMITS.areaMax).optional().nullable(),
  // An empty `beds=` is "not given", never 0 (Studio): z.coerce.number() alone turns "" into 0.
  beds: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().min(LIMITS.bedMin).max(LIMITS.bedMax).optional().nullable(),
  ),
  /** The listing's completion: `salesForBedrooms` counts off-plan sales for "off_plan", ready ones otherwise. */
  completion: CompletionSchema.optional().nullable(),
});

/** GET /api/buildings?q=&page= (REAL_DATA.md section 11). A `q` under 2 characters is ignored. */
export const CoverageQuerySchema = z.object({
  q: z.string().trim().max(LIMITS.buildingMax).optional().nullable(),
  page: z.coerce.number().int().min(1).max(10_000).optional().nullable(),
});

/** POST /api/checks */
export const CheckRequestSchema = z.object({
  fields: ListingFieldsSchema,
  buildingId: z.number().int().positive().nullable(),
  source: CheckSourceSchema,
  editedFields: z.array(FieldKeySchema).max(FIELD_KEYS.length).default([]),
  propertyType: PropertyTypeSchema.optional(),
  completion: CompletionSchema.optional(),
  /** Where the size came from (RESULT_SPEC section 12.2), stored with the comparison. */
  sizeSource: SizeSourceSchema.optional(),
  /** Share code from /?ref=; the server ignores it when invalid. */
  ref: z.string().max(16).optional(),
});

/** POST /api/saved */
export const SaveRequestSchema = z.object({ code: CodeSchema });

/** POST /api/leads */
export const LeadRequestSchema = z.object({
  code: CodeSchema,
  name: z
    .string({ error: COPY["lead.errName"] })
    .trim()
    .min(1, { error: COPY["lead.errName"] })
    .max(80, { error: COPY["lead.errName"] }),
  phone: z
    .string({ error: COPY["lead.errMobile"] })
    .max(32, { error: COPY["lead.errMobile"] })
    .refine((v) => normalisePhone(v) !== null, { error: COPY["lead.errMobile"] }),
  /** The route answers 422 consent_required when this is not exactly true. */
  consent: z.literal(true, { error: COPY["apiError.consent_required"] }),
  consentVersion: ConsentVersionSchema,
  /** minDownPct(price)..80, step 5; the route checks the price-dependent minimum. */
  downPct: z.number().int().min(20).max(80).multipleOf(5),
  ratePct: z.number({ error: COPY["cost.rateErr"] }).min(1, { error: COPY["cost.rateErr"] }).max(12, { error: COPY["cost.rateErr"] }),
  years: z.literal(MORTGAGE_YEARS),
});

/** POST /api/requests */
export const BuildingRequestSchema = z.object({
  text: z
    .string({ error: COPY["coverage.requestErr"] })
    .trim()
    .min(3, { error: COPY["coverage.requestErr"] })
    .max(LIMITS.buildingMax, { error: COPY["coverage.requestErr"] }),
  area: z.string().trim().max(LIMITS.areaMax).optional(),
  code: CodeSchema.optional(),
});

/** POST /api/events */
export const EventRequestSchema = z.object({
  name: ClientEventNameSchema,
  code: CodeSchema.optional(),
});

// ---------- responses ----------
export const CheckResponseSchema = z.object({ check: CheckViewSchema });
/** GET /api/checks/[code]: the comparison as stored and today's same-building verdict. */
export const CheckWithCurrentSchema = z.object({
  check: CheckViewSchema,
  current: AnalysisViewSchema,
});
export const SavedListResponseSchema = z.object({ items: z.array(SavedItemViewSchema) });
export const SavedItemResponseSchema = z.object({ item: SavedItemViewSchema });
export const LeadResponseSchema = z.object({ lead: LeadViewSchema });
export const LeadsResponseSchema = z.object({ leads: z.array(LeadViewSchema) });
export const RecoveryLinkResponseSchema = z.object({ url: z.string() });
/** POST /api/me/recover: the token from a confirmed recovery link. */
export const RecoverRequestSchema = z.object({ token: z.string().min(1).max(1024) });
export const BuildingRequestResponseSchema = z.object({
  id: z.number().int(),
  othersAsked: z.number().int(),
  created: z.boolean(),
});
export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  db: z.enum(["postgres", "pglite"]).optional(),
  version: z.string().optional(),
});

/** The first message of each failed path, keyed by dotted path ("fields.bedrooms"). */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Message for a 422 summary ("Fix 2 things to compare the price"). */
export function fieldErrorSummary(count: number): string {
  return t("err.summary", { n: count });
}
