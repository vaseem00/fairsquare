/**
 * Drizzle schema: the data contract (A§3.3). Only WP0 edits this file and runs `npm run db:generate`.
 * No "server-only" import here: drizzle-kit loads this file outside Next to generate migrations.
 * It holds table definitions only; client code must not import it (lint rule).
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  bigserial,
  integer,
  bigint,
  smallint,
  doublePrecision,
  real,
  text,
  boolean,
  date,
  timestamp,
  uuid,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").defaultNow().notNull();

/** Where a sale came from: the DLD open-data snapshot, an admin registration, or an admin CSV import. */
export const SALE_SOURCES = ["open_data", "admin", "import"] as const;
export type SaleSource = (typeof SALE_SOURCES)[number];

// ---------- reference data ----------
export const buildings = pgTable(
  "buildings",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // display name; not unique (DLD names repeat across areas)
    area: text("area").notNull(), // the area people know, e.g. "Dubai Marina" (REAL_DATA.md section 6)
    areaDld: text("area_dld"), // the official DLD area name, e.g. "Marsa Dubai"
    project: text("project"), // registered project name
    masterProject: text("master_project"),
    dldKey: text("dld_key"), // normalise(DLD name) + "|" + normalise(area_dld); null for admin-created buildings
    // What the open-data snapshot's buildings.csv.gz says about the building (migration 0006). All
    // null for admin-created buildings and for buildings loaded before the file existed.
    projectNumber: integer("project_number"), // DLD project number
    nearestMetro: text("nearest_metro"), // DLD reference values, as written
    nearestMall: text("nearest_mall"),
    nearestLandmark: text("nearest_landmark"),
    firstSaleDate: date("first_sale_date", { mode: "string" }), // earliest flat sale in the source files (all years)
    firstReadySaleDate: date("first_ready_sale_date", { mode: "string" }), // earliest ready sale: about when it was handed over
    lastSaleDate: date("last_sale_date", { mode: "string" }), // latest sale in the snapshot
    offPlanShare: real("off_plan_share"), // off-plan sales / all sales in the snapshot, 0 to 1
    createdAt: createdAt(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("buildings_dld_key_uq").on(t.dldKey).where(sql`${t.dldKey} is not null`)],
);

export const buildingAliases = pgTable(
  "building_aliases",
  {
    id: serial("id").primaryKey(),
    buildingId: integer("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    aliasRaw: text("alias_raw").notNull(),
    aliasNorm: text("alias_norm").notNull(), // normalise(aliasRaw); the building name is always an alias too
    source: text("source", { enum: ["seed", "admin", "import"] }).notNull().default("admin"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("building_aliases_norm_building_uq").on(t.aliasNorm, t.buildingId),
    index("building_aliases_norm_idx").on(t.aliasNorm),
  ],
);

export const sales = pgTable(
  "sales",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    buildingId: integer("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    saleDate: date("sale_date", { mode: "string" }).notNull(), // registration date
    bedrooms: smallint("bedrooms").notNull(), // 0 = studio
    sizeSqft: doublePrecision("size_sqft").notNull(),
    priceAed: bigint("price_aed", { mode: "number" }).notNull(),
    source: text("source", { enum: SALE_SOURCES }).notNull(),
    completion: text("completion", { enum: ["ready", "off_plan"] }).notNull().default("ready"),
    externalRef: text("external_ref").unique(), // "dld:<transaction_id>" for open data; idempotent imports
    rawBuildingName: text("raw_building_name"), // the building name as the source wrote it
    importBatch: text("import_batch"),
    hasParking: boolean("has_parking"), // DLD has_parking for the unit; null when unknown (migration 0006)
    createdAt: createdAt(), // "recorded in Fairsquare": drives "new since you saved"
  },
  (t) => [
    index("sales_lookup_idx").on(t.buildingId, t.bedrooms, t.saleDate),
    index("sales_recorded_idx").on(t.buildingId, t.bedrooms, t.createdAt),
    check("sales_bedrooms_ck", sql`${t.bedrooms} between 0 and 7`),
    check("sales_positive_ck", sql`${t.sizeSqft} > 0 and ${t.priceAed} > 0`),
    check("sales_completion_ck", sql`${t.completion} in ('ready', 'off_plan')`),
    check("sales_source_ck", sql`${t.source} in ('open_data', 'admin', 'import')`),
  ],
);

// ---------- people (anonymous) ----------
export const anonUsers = pgTable("anon_users", {
  id: uuid("id").primaryKey(), // value inside the signed mz_aid cookie
  refCode: text("ref_code"), // first-touch share code (/?ref=CODE)
  createdAt: createdAt(),
  lastSeenAt: ts("last_seen_at").defaultNow().notNull(),
});

/**
 * Ids erased by "Delete all my data". The signed cookie has no server state, so a copy of it in
 * another browser would otherwise recreate the same id (and revive its recovery links): an id listed
 * here is never accepted again and the person gets a fresh one. Holds the random uuid only.
 */
export const deletedAnonIds = pgTable("deleted_anon_ids", {
  id: uuid("id").primaryKey(),
  deletedAt: ts("deleted_at").defaultNow().notNull(),
});

/**
 * The similar-buildings cells of the loaded snapshot (REAL_DATA.md section 15.1): one row per DLD
 * building, bedroom count and basis, replaced whole by every open-data load. `area_dld`,
 * `master_project` and `project_number` are the values of buildings.csv.gz, written on each row so
 * one query by area and basis returns everything a comparison needs.
 */
export const similarCells = pgTable(
  "similar_cells",
  {
    buildingId: integer("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    bedrooms: smallint("bedrooms").notNull(),
    basis: text("basis", { enum: ["ready", "off_plan"] }).notNull(),
    areaDld: text("area_dld").notNull(),
    masterProject: text("master_project").notNull().default(""),
    projectNumber: text("project_number").notNull().default(""),
    nRaw12: integer("n_raw12").notNull(), // sales in the 12 months to data_through
    n12: integer("n12").notNull(), // those the product median used
    med12: doublePrecision("med12"), // their median AED per sq ft; null when there are none
    nOld1: integer("n_old1").notNull(), // 12 to 24 months before data_through
    medOld1: doublePrecision("med_old1"),
    nOld2: integer("n_old2").notNull(), // 24 to 36 months before
    medOld2: doublePrecision("med_old2"),
  },
  (t) => [primaryKey({ columns: [t.buildingId, t.bedrooms, t.basis] }), index("similar_cells_area_idx").on(t.areaDld, t.basis)],
);

/**
 * One sale a comparison used. `source` says where it came from, so a sale the admin registered or
 * imported is never presented as DLD open data (REAL_DATA.md section 9); snapshots stored before it
 * was kept have no `source` and are open data.
 */
export type SaleSnapshot = { saleDate: string; sizeSqft: number; priceAed: number; source?: SaleSource };

export const checks = pgTable(
  "checks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    code: text("code").notNull().unique(),
    anonId: uuid("anon_id")
      .notNull()
      .references(() => anonUsers.id, { onDelete: "cascade" }),
    buildingId: integer("building_id").references(() => buildings.id, { onDelete: "set null" }), // null = not covered
    buildingName: text("building_name"), // snapshot of buildings.name
    buildingArea: text("building_area"),
    buildingAreaDld: text("building_area_dld"), // snapshot of buildings.area_dld (REAL_DATA.md section 6)
    buildingText: text("building_text").notNull(), // as written in the listing (≤120)
    areaText: text("area_text"),
    bedrooms: smallint("bedrooms").notNull(),
    sizeSqft: doublePrecision("size_sqft").notNull(),
    priceAed: bigint("price_aed", { mode: "number" }).notNull(),
    propertyType: text("property_type", { enum: ["apartment", "villa", "townhouse", "other", "unknown"] })
      .notNull()
      .default("unknown"),
    completion: text("completion", { enum: ["ready", "off_plan", "unknown"] }).notNull().default("unknown"),
    source: text("source", { enum: ["claude", "manual", "text"] }).notNull(),
    editedFields: text("edited_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`), // extraction-quality metric
    band: text("band", { enum: ["above", "inline", "below", "thin", "none"] }).notNull(),
    askingPsf: doublePrecision("asking_psf").notNull(),
    medianPsf: doublePrecision("median_psf"),
    medianPriceAed: doublePrecision("median_price_aed"),
    salesCount: integer("sales_count").notNull().default(0),
    diff: doublePrecision("diff"), // fraction; null when thin/none
    windowStart: date("window_start", { mode: "string" }).notNull(),
    windowEnd: date("window_end", { mode: "string" }).notNull(),
    minSales: smallint("min_sales").notNull(),
    bandPct: real("band_pct").notNull(),
    salesSnapshot: jsonb("sales_snapshot")
      .$type<SaleSnapshot[]>()
      .notNull()
      .default(sql`'[]'::jsonb`), // ≤200 rows, no PII
    // Which sales the listing was compared with: off-plan listings with off-plan sales, ready or
    // unknown with ready sales (REAL_DATA.md section 7).
    completionBasis: text("completion_basis", { enum: ["ready", "off_plan"] }).notNull().default("ready"),
    outliersDropped: smallint("outliers_dropped").notNull().default(0),
    dataThrough: date("data_through", { mode: "string" }), // app_meta.data_through when compared
    medianSizeSqft: doublePrecision("median_size_sqft"), // median size of the sales used (the size note)
    // RESULT_SPEC section 12.2: the unusual sales the comparison left out (the list marks them "set
    // aside"; the scale never draws them), newest first. Comparisons stored before this have [].
    setAsideSnapshot: jsonb("set_aside_snapshot")
      .$type<SaleSnapshot[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Where the size came from: "read", "typed" or "cluster" (a size button: "about 815 sq ft"). Null
    // when the client did not say, and for comparisons stored before this.
    sizeSource: text("size_source", { enum: ["read", "typed", "cluster"] }),
    // The similar-buildings comparison as it was shown (REAL_DATA.md section 15.4), versioned (`v`).
    // Null when the same-building comparison ran, when the second tier did not apply, and for
    // comparisons stored before it existed. Read through SimilarViewSchema, never trusted as typed.
    similar: jsonb("similar_view"), // "similar" alone is a reserved word in SQL
    // The adjusted-registered-sales result as it was computed (REAL_DATA.md section 16.4), versioned
    // (`v`): the range, the position of the asking price, the registered sales used with their
    // adjustments, or the reason it gave no range. Null when it did not run (no building, switched
    // off, no usable model) and for comparisons stored before it existed (migration 0008). Read
    // through AcsViewSchema, never trusted as typed; the middle figure in it never leaves the server.
    acsView: jsonb("acs_view"),
    // The nearby-registered-sales result as it was computed (REAL_DATA.md section 17.4), versioned (`v`):
    // the last resort, from other buildings of the community or the DLD area. Null when it did not run
    // (something else gave a comparison, switched off, no usable model) and for comparisons stored
    // before it existed (migration 0009). Read through NearbyViewSchema, never trusted as typed.
    nearbyView: jsonb("nearby_view"),
    refCode: text("ref_code"), // share code that led to this check
    createdAt: createdAt(),
  },
  (t) => [
    index("checks_created_idx").on(t.createdAt),
    index("checks_anon_idx").on(t.anonId),
    index("checks_building_idx").on(t.buildingId, t.bedrooms),
  ],
);

export const savedListings = pgTable(
  "saved_listings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    anonId: uuid("anon_id")
      .notNull()
      .references(() => anonUsers.id, { onDelete: "cascade" }),
    checkId: bigint("check_id", { mode: "number" })
      .notNull()
      .references(() => checks.id, { onDelete: "cascade" }),
    bandAtSave: text("band_at_save").notNull(),
    diffAtSave: doublePrecision("diff_at_save"),
    countAtSave: integer("count_at_save").notNull(),
    createdAt: createdAt(), // savedAt; baseline for "new sales since you saved"
    seenAt: ts("seen_at").defaultNow().notNull(), // last "Open" from Saved; drives the header badge
    removedAt: ts("removed_at"), // soft delete; re-saving clears it (exact Undo)
  },
  (t) => [uniqueIndex("saved_anon_check_uq").on(t.anonId, t.checkId)],
);

export const leads = pgTable(
  "leads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    anonId: uuid("anon_id").references(() => anonUsers.id, { onDelete: "set null" }),
    checkId: bigint("check_id", { mode: "number" }).references(() => checks.id, { onDelete: "set null" }),
    partner: text("partner").notNull(), // PARTNER_NAME at consent time
    consentVersion: text("consent_version").notNull(), // e.g. "optin-v1"
    consentText: text("consent_text").notNull(), // exact text shown (snapshot)
    consentTextSha256: text("consent_text_sha256").notNull(),
    consentedAt: ts("consented_at").notNull(),
    name: text("name"), // nulled on withdraw / delete-my-data
    phoneE164: text("phone_e164"), // nulled on withdraw / delete-my-data
    phoneLast4: text("phone_last4"), // kept for partner reference
    ipHash: text("ip_hash").notNull(),
    buildingName: text("building_name").notNull(), // listing snapshot
    bedrooms: smallint("bedrooms").notNull(),
    sizeSqft: doublePrecision("size_sqft").notNull(),
    priceAed: bigint("price_aed", { mode: "number" }).notNull(),
    downPct: smallint("down_pct").notNull(),
    ratePct: real("rate_pct").notNull(),
    years: smallint("years").notNull(),
    loanEstimateAed: integer("loan_estimate_aed").notNull(),
    monthlyEstimateAed: integer("monthly_estimate_aed").notNull(),
    status: text("status", { enum: ["new", "sent", "withdrawn"] }).notNull().default("new"),
    sentAt: ts("sent_at"), // admin marked "sent to partner"
    withdrawnAt: ts("withdrawn_at"),
    withdrawalNotifiedAt: ts("withdrawal_notified_at"), // admin told the partner
    createdAt: createdAt(),
  },
  (t) => [
    index("leads_status_idx").on(t.status, t.createdAt),
    index("leads_anon_idx").on(t.anonId),
    uniqueIndex("leads_active_uq").on(t.anonId, t.checkId).where(sql`${t.withdrawnAt} is null`),
  ],
);

export const buildingRequests = pgTable(
  "building_requests",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    anonId: uuid("anon_id").references(() => anonUsers.id, { onDelete: "set null" }),
    textRaw: text("text_raw").notNull(),
    textNorm: text("text_norm").notNull(),
    areaText: text("area_text"),
    source: text("source", { enum: ["none_of_these", "request_form"] }).notNull(), // none_of_these = sent with a comparison code
    checkId: bigint("check_id", { mode: "number" }).references(() => checks.id, { onDelete: "set null" }),
    resolvedBuildingId: integer("resolved_building_id").references(() => buildings.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("requests_norm_idx").on(t.textNorm),
    uniqueIndex("requests_anon_norm_uq")
      .on(t.anonId, t.textNorm)
      .where(sql`${t.anonId} is not null`), // one ask per person per building
  ],
);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(), // EventName union (types.ts)
    anonId: uuid("anon_id").references(() => anonUsers.id, { onDelete: "set null" }),
    checkId: bigint("check_id", { mode: "number" }).references(() => checks.id, { onDelete: "set null" }),
    meta: jsonb("meta")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default(sql`'{}'::jsonb`), // never PII
    createdAt: createdAt(),
  },
  (t) => [index("events_name_created_idx").on(t.name, t.createdAt)],
);

// ---------- platform ----------
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(), // e.g. "extract:anon:<uuid>", "extract:ip:<hash>", "extract:global"
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index("rate_limits_expires_idx").on(t.expiresAt)],
);

export const adminSessions = pgTable("admin_sessions", {
  idHash: text("id_hash").primaryKey(), // sha256(session token); raw token only in the cookie
  createdAt: createdAt(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  ipHash: text("ip_hash").notNull(),
});

export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(), // AppMetaKey
  value: text("value").notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

// ---------- server-only row types (never sent to the browser) ----------
export type BuildingRow = typeof buildings.$inferSelect;
export type AliasDbRow = typeof buildingAliases.$inferSelect;
export type SaleRow = typeof sales.$inferSelect;
export type CheckRow = typeof checks.$inferSelect;
export type SimilarCellDbRow = typeof similarCells.$inferSelect;
export type NewCheck = typeof checks.$inferInsert;
export type SavedListingRow = typeof savedListings.$inferSelect;
export type LeadRow = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type BuildingRequestRow = typeof buildingRequests.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type AnonUserRow = typeof anonUsers.$inferSelect;
export type AdminSessionRow = typeof adminSessions.$inferSelect;
/**
 * app_meta keys (REAL_DATA.md section 4):
 * - `open_data_sha`: snapshotSha256 of the loaded open-data snapshot (the loader skips when equal).
 * - `open_data_buildings_sha`: the SHA-256 of the loaded buildings.csv.gz (the loader skips only when both match).
 * - `data_from` / `data_through`: the date range of the loaded snapshot (YYYY-MM-DD).
 * - `data_source`: the snapshot manifest without its counts, as JSON.
 * - `data_imported_at`: when sales were last added (ISO timestamp from the loader, a date from a CSV import).
 * - `similar_model`: the loaded similar-buildings model as JSON (SimilarModelMeta: constants, backtest summary,
 *   the snapshot it belongs to); "" when the loaded snapshot has none (REAL_DATA.md section 15).
 * - `open_data_similar_sha`: the SHA-256 of the loaded manifest's `similar` section ("" when it has none).
 * - `acs_model`: the loaded adjusted-registered-sales model, the JSON text of acs-model.json.gz; "" when the
 *   loaded snapshot has none (REAL_DATA.md section 16).
 * - `open_data_acs_sha`: the SHA-256 of the loaded manifest's `acs` section ("" when it has none).
 * - `market_names_sha`: the SHA-256 of the hand-kept marketing names last added as aliases (ingest/market-names.ts).
 */
export type AppMetaKey =
  | "open_data_sha"
  | "open_data_buildings_sha"
  | "open_data_similar_sha"
  | "similar_model"
  | "open_data_acs_sha"
  | "market_names_sha"
  | "acs_model"
  | "data_from"
  | "data_through"
  | "data_source"
  | "data_imported_at";
export type NewSale = {
  buildingId: number;
  saleDate: string;
  bedrooms: number;
  sizeSqft: number;
  priceAed: number;
  completion: "ready" | "off_plan";
  externalRef?: string;
};
