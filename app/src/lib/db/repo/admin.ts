import "server-only";
/**
 * Admin reads and writes (A§3.4, A§4.4, WP5): stats, leads (list, reveal, status, export rows),
 * building requests (aggregate, resolve), buildings and aliases, and sales (list, preview, create,
 * delete). Every write that changes matching calls `invalidateAliasCache()`.
 *
 * Time ranges are Dubai calendar days: a 7-day range is today and the 6 days before it, from
 * 00:00 Dubai time (UTC+4, no daylight saving).
 * Sale windows follow the comparisons (REAL_DATA.md section 7): 12 months ending at
 * min(today, data_through), one completion basis at a time.
 */
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, max, or, sql, type SQL } from "drizzle-orm";
import { COPY, t } from "@/lib/copy";
import { readDataMeta } from "@/lib/data-status";
import { comparisonWindow, median, windowBounds, type Rules } from "@/lib/domain/analyse";
import { addDays, type IsoDate } from "@/lib/domain/dates";
import { normalise } from "@/lib/domain/normalise";
import { maskPhone } from "@/lib/domain/phone";
import { bedsLabel, formatInt } from "@/lib/format";
import type { CheckBand, ErrorCode, FieldKey } from "@/lib/types";
import { CHECK_BANDS, ERROR_CODES, FIELD_KEYS } from "@/lib/validation/api";
import {
  ADMIN_BUILDINGS_PAGE,
  ADMIN_BUILDINGS_QUERY_MIN,
  ADMIN_SALES_LIMIT,
  type AdminAlias,
  type AdminBuilding,
  type AdminBuildingOption,
  type AdminBuildingsPage,
  type AdminLeadRow,
  type AdminRange,
  type AdminRequestRow,
  type AdminSale,
  type AdminStats,
  type BuildingCreate,
  type LeadPatch,
  type LeadReveal,
  type LeadsQuery,
  type MedianView,
  type NewSaleInput,
  type SalePreview,
} from "@/lib/validation/admin";
import type { Db } from "../client";
import {
  anonUsers,
  buildingAliases,
  buildingRequests,
  buildings,
  checks,
  events,
  leads,
  sales,
  savedListings,
  type LeadRow,
  type SaleRow,
} from "../schema";
import { getBuilding, invalidateAliasCache, recentSales, toIsoDate, type SalesWindow } from "./buildings";

// ---------- time ----------

/** Dubai is UTC+4 all year. */
const DUBAI_OFFSET = "+04:00";

/** The instant a Dubai calendar day starts. */
export function dubaiDayStart(day: IsoDate): Date {
  return new Date(`${day}T00:00:00${DUBAI_OFFSET}`);
}

/** The first day of a range ending today, and the instant it starts. */
export function rangeStart(today: IsoDate, range: AdminRange): { firstDay: IsoDate; from: Date } {
  const firstDay = addDays(today, -(range - 1));
  return { firstDay, from: dubaiDayStart(firstDay) };
}

/** A timestamptz column as its Dubai calendar day ("YYYY-MM-DD"), without relying on tz data. */
function dubaiDay(col: SQL | typeof checks.createdAt | typeof events.createdAt): SQL<string> {
  return sql<string>`to_char((${col} at time zone 'UTC') + interval '4 hours', 'YYYY-MM-DD')`;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ---------- stats ----------

const SHARE_EVENTS = ["share_native", "share_whatsapp", "link_copied", "card_downloaded"] as const;
const TOP_REQUESTS = 10;

function emptyBands(): Record<CheckBand, number> {
  return Object.fromEntries(CHECK_BANDS.map((b) => [b, 0])) as Record<CheckBand, number>;
}

/** The Overview and Quality numbers for a 7, 30 or 90-day range (A§4.4 `AdminStats`). */
export async function getAdminStats(
  db: Db,
  opts: { today: IsoDate; range: AdminRange; rules: Rules },
): Promise<AdminStats> {
  const { today, range, rules } = opts;
  const { firstDay, from } = rangeStart(today, range);
  const checkInRange = gte(checks.createdAt, from);
  const window = await adminWindow(db, today, rules);

  const [
    visitors,
    eventRows,
    checkAgg,
    verdictRows,
    perDayChecks,
    perDayFails,
    failRows,
    readMs,
    edited,
    leadAgg,
    withdrawnAgg,
    topRows,
    coverage,
  ] = await Promise.all([
    db.select({ n: count() }).from(anonUsers).where(gte(anonUsers.createdAt, from)),
    db
      .select({ name: events.name, n: count() })
      .from(events)
      .where(gte(events.createdAt, from))
      .groupBy(events.name),
    db
      .select({
        n: count(),
        fromShares: sql<number>`count(*) filter (where ${checks.refCode} is not null)`.mapWith(Number),
      })
      .from(checks)
      .where(checkInRange),
    db.select({ band: checks.band, n: count() }).from(checks).where(checkInRange).groupBy(checks.band),
    db
      .select({ day: dubaiDay(checks.createdAt), n: count() })
      .from(checks)
      .where(checkInRange)
      .groupBy(dubaiDay(checks.createdAt)),
    db
      .select({ day: dubaiDay(events.createdAt), n: count() })
      .from(events)
      .where(and(eq(events.name, "extract_fail"), gte(events.createdAt, from)))
      .groupBy(dubaiDay(events.createdAt)),
    db
      .select({ code: sql<string | null>`${events.meta}->>'code'`, n: count() })
      .from(events)
      .where(and(eq(events.name, "extract_fail"), gte(events.createdAt, from)))
      .groupBy(sql`${events.meta}->>'code'`),
    db
      .select({
        ms: sql<string | number | null>`percentile_cont(0.5) within group (order by (${events.meta}->>'ms')::double precision)`,
      })
      .from(events)
      .where(
        and(
          eq(events.name, "extract_ok"),
          gte(events.createdAt, from),
          sql`jsonb_typeof(${events.meta}->'ms') = 'number'`,
        ),
      ),
    db
      .select({
        total: count(),
        ...Object.fromEntries(
          FIELD_KEYS.map((f) => [
            f,
            sql<number>`count(*) filter (where ${f}::text = any(${checks.editedFields}))`.mapWith(Number),
          ]),
        ),
      })
      .from(checks)
      .where(and(checkInRange, eq(checks.source, "claude"))),
    db.select({ n: count() }).from(leads).where(gte(leads.createdAt, from)),
    db.select({ n: count() }).from(leads).where(gte(leads.withdrawnAt, from)),
    db
      .select({
        textNorm: buildingRequests.textNorm,
        n: count(),
        last: sql<Date>`max(${buildingRequests.createdAt})`,
        resolved: sql<boolean>`bool_or(${buildingRequests.resolvedBuildingId} is not null)`,
      })
      .from(buildingRequests)
      .where(gte(buildingRequests.createdAt, from))
      .groupBy(buildingRequests.textNorm)
      .orderBy(desc(count()), desc(sql`max(${buildingRequests.createdAt})`), asc(buildingRequests.textNorm))
      .limit(TOP_REQUESTS),
    listFreshness(db, window),
  ]);

  const ev = new Map(eventRows.map((r) => [r.name, num(r.n)]));
  const evCount = (name: string) => ev.get(name) ?? 0;
  const checksN = num(checkAgg[0]?.n);
  const fromShares = num(checkAgg[0]?.fromShares);

  const verdicts = emptyBands();
  for (const r of verdictRows) verdicts[r.band] = num(r.n);

  const checksByDay = new Map(perDayChecks.map((r) => [r.day, num(r.n)]));
  const failsByDay = new Map(perDayFails.map((r) => [r.day, num(r.n)]));
  const perDay: AdminStats["perDay"] = [];
  for (let i = 0; i < range; i++) {
    const date = addDays(firstDay, i);
    perDay.push({ date, checks: checksByDay.get(date) ?? 0, extractFail: failsByDay.get(date) ?? 0 });
  }

  const known = new Set<string>(ERROR_CODES);
  const extractFailByCode: Partial<Record<ErrorCode, number>> = {};
  for (const r of failRows) {
    const code = (r.code && known.has(r.code) ? r.code : "internal") as ErrorCode;
    extractFailByCode[code] = (extractFailByCode[code] ?? 0) + num(r.n);
  }

  const msRaw = readMs[0]?.ms;
  const medianReadMs = msRaw === null || msRaw === undefined ? null : Math.round(Number(msRaw));

  const editedRow = (edited[0] ?? { total: 0 }) as Record<string, unknown>;
  const editedBase = num(editedRow.total);
  const editedFieldRate = Object.fromEntries(
    FIELD_KEYS.map((f) => [f, editedBase > 0 ? num(editedRow[f]) / editedBase : 0]),
  ) as Record<FieldKey, number>;

  const spelling = await latestSpellings(
    db,
    topRows.map((r) => r.textNorm),
  );

  return {
    range,
    funnel: {
      newVisitors: num(visitors[0]?.n),
      extractOk: evCount("extract_ok"),
      extractFail: evCount("extract_fail"),
      checks: checksN,
      checksFromShares: fromShares,
      shares: SHARE_EVENTS.reduce((s, name) => s + evCount(name), 0),
      cardViews: evCount("card_viewed"),
      costOpened: evCount("cost_opened"),
      leads: num(leadAgg[0]?.n),
      leadsWithdrawn: num(withdrawnAgg[0]?.n),
      kFactor: checksN > 0 ? fromShares / checksN : null,
    },
    perDay,
    extractFailByCode,
    medianReadMs,
    editedFieldRate,
    editedFieldBase: editedBase,
    verdicts,
    topRequests: topRows.map((r) => ({
      text: spelling.get(r.textNorm)?.text ?? r.textNorm,
      count: num(r.n),
      resolved: Boolean(r.resolved),
    })),
    freshness: coverage.rows,
    freshnessTotal: coverage.total,
  };
}

/**
 * The window admin numbers use: the comparisons' window (ending at min(today, data_through)); before
 * any data is loaded, the 12 months to today, so admin-registered sales still show their effect.
 */
export async function adminWindow(db: Db, today: IsoDate, rules: Pick<Rules, "windowDays">): Promise<SalesWindow> {
  const { dataThrough } = await readDataMeta(db);
  return comparisonWindow(today, dataThrough, rules.windowDays) ?? windowBounds(today, rules.windowDays);
}

/** Rows in AdminStats.freshness at most (thousands of DLD buildings would make the page heavy). */
export const FRESHNESS_MAX = 1000;

/**
 * "Latest sale by building": one row per building and bedroom count with a sale up to the window
 * end, by name, at most FRESHNESS_MAX rows (`total` counts them all). `sales12m` counts both bases.
 */
async function listFreshness(db: Db, window: SalesWindow): Promise<{ rows: AdminStats["freshness"]; total: number }> {
  const rows = await db
    .select({
      buildingId: sales.buildingId,
      name: buildings.name,
      bedrooms: sales.bedrooms,
      latest: max(sales.saleDate),
      inWindow: sql<number>`count(*) filter (where ${sales.saleDate} >= ${window.start})`.mapWith(Number),
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(sales)
    .innerJoin(buildings, eq(buildings.id, sales.buildingId))
    .where(lte(sales.saleDate, window.end))
    .groupBy(sales.buildingId, buildings.name, sales.bedrooms)
    .orderBy(asc(buildings.name), asc(sales.bedrooms), asc(sales.buildingId))
    .limit(FRESHNESS_MAX);
  return {
    rows: rows.map((r) => ({
      buildingId: r.buildingId,
      name: r.name,
      bedrooms: r.bedrooms,
      latestSaleDate: toIsoDate(r.latest),
      sales12m: num(r.inWindow),
    })),
    total: rows.length ? num(rows[0].total) : 0,
  };
}

/** The most recent spelling (text and area) of each normalised request text. */
async function latestSpellings(
  db: Db,
  norms: readonly string[],
): Promise<Map<string, { text: string; area: string | null }>> {
  const out = new Map<string, { text: string; area: string | null }>();
  if (norms.length === 0) return out;
  const rows = await db
    .select({ textNorm: buildingRequests.textNorm, text: buildingRequests.textRaw, area: buildingRequests.areaText })
    .from(buildingRequests)
    .where(inArray(buildingRequests.textNorm, [...norms]))
    .orderBy(desc(buildingRequests.createdAt), desc(buildingRequests.id));
  for (const r of rows) if (!out.has(r.textNorm)) out.set(r.textNorm, { text: r.text, area: r.area });
  return out;
}

// ---------- leads ----------

/** "+971 •• ••• 4567"; a withdrawn lead keeps only its last 4 digits: "•• ••• 4567". */
export function leadPhoneMasked(lead: Pick<LeadRow, "phoneE164" | "phoneLast4">): string | null {
  if (lead.phoneE164) return maskPhone(lead.phoneE164);
  return lead.phoneLast4 ? `•• ••• ${lead.phoneLast4}` : null;
}

export function toAdminLeadRow(lead: LeadRow, checkCode: string | null): AdminLeadRow {
  return {
    id: lead.id,
    partner: lead.partner,
    status: lead.status,
    createdAt: lead.createdAt.toISOString(),
    withdrawnAt: iso(lead.withdrawnAt),
    phoneMasked: leadPhoneMasked(lead),
    checkCode,
    buildingName: lead.buildingName,
    bedrooms: lead.bedrooms,
    priceAed: lead.priceAed,
    name: lead.name,
    consentVersion: lead.consentVersion,
    sentAt: iso(lead.sentAt),
    withdrawalNotifiedAt: iso(lead.withdrawalNotifiedAt),
  };
}

function leadFilters(q: LeadsQuery): SQL | undefined {
  const parts: SQL[] = [];
  if (q.status) parts.push(eq(leads.status, q.status));
  if (q.from) parts.push(gte(leads.createdAt, dubaiDayStart(q.from)));
  if (q.to) parts.push(sql`${leads.createdAt} < ${dubaiDayStart(addDays(q.to, 1))}`);
  return parts.length ? and(...parts) : undefined;
}

async function selectLeads(db: Db, where: SQL | undefined) {
  return db
    .select({ lead: leads, code: checks.code })
    .from(leads)
    .leftJoin(checks, eq(checks.id, leads.checkId))
    .where(where)
    .orderBy(desc(leads.createdAt), desc(leads.id));
}

/** Leads, newest first, with masked phones. `from`/`to` are inclusive Dubai days. */
export async function listAdminLeads(db: Db, q: LeadsQuery = {}): Promise<AdminLeadRow[]> {
  const rows = await selectLeads(db, leadFilters(q));
  return rows.map((r) => toAdminLeadRow(r.lead, r.code));
}

/** The full lead rows for the CSV export (same filters as the list). */
export async function listLeadsForExport(db: Db, q: LeadsQuery = {}): Promise<Array<LeadRow & { checkCode: string | null }>> {
  const rows = await selectLeads(db, leadFilters(q));
  return rows.map((r) => ({ ...r.lead, checkCode: r.code }));
}

export async function getLeadRow(db: Db, id: number): Promise<LeadRow | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const rows = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  return rows[0] ?? null;
}

/** The full phone and name of a lead (null after withdrawal), or null when the lead is unknown. */
export async function revealLead(db: Db, id: number): Promise<(LeadReveal & { checkId: number | null }) | null> {
  const lead = await getLeadRow(db, id);
  if (!lead) return null;
  return { phoneE164: lead.phoneE164, name: lead.name, checkId: lead.checkId };
}

/**
 * Marks a lead sent to the partner (only from "new"; a withdrawn lead stays withdrawn) and/or records
 * that the partner was told about a withdrawal (only once withdrawn). Idempotent. Null when unknown.
 */
export async function updateAdminLead(db: Db, id: number, patch: LeadPatch): Promise<AdminLeadRow | null> {
  const lead = await getLeadRow(db, id);
  if (!lead) return null;
  if (patch.status === "sent") {
    await db
      .update(leads)
      .set({ status: "sent", sentAt: new Date() })
      .where(and(eq(leads.id, id), eq(leads.status, "new")));
  }
  if (patch.withdrawalNotified) {
    await db
      .update(leads)
      .set({ withdrawalNotifiedAt: new Date() })
      .where(and(eq(leads.id, id), isNotNull(leads.withdrawnAt), isNull(leads.withdrawalNotifiedAt)));
  }
  const rows = await selectLeads(db, eq(leads.id, id));
  return rows[0] ? toAdminLeadRow(rows[0].lead, rows[0].code) : null;
}

// ---------- building requests ----------

/** Requests aggregated by normalised text, most asked first. `text`/`area` are the latest spelling. */
export async function listRequestAggregates(db: Db): Promise<AdminRequestRow[]> {
  const rows = await db
    .select({
      textNorm: buildingRequests.textNorm,
      requests: count(),
      people: sql<number>`count(distinct ${buildingRequests.anonId}) + count(*) filter (where ${buildingRequests.anonId} is null)`.mapWith(
        Number,
      ),
      first: sql<string>`min(${buildingRequests.createdAt})`,
      last: sql<string>`max(${buildingRequests.createdAt})`,
      resolvedId: sql<number | null>`max(${buildingRequests.resolvedBuildingId})`,
    })
    .from(buildingRequests)
    .groupBy(buildingRequests.textNorm)
    .orderBy(desc(count()), desc(sql`max(${buildingRequests.createdAt})`), asc(buildingRequests.textNorm));
  if (rows.length === 0) return [];

  const spelling = await latestSpellings(
    db,
    rows.map((r) => r.textNorm),
  );
  const resolvedIds = [...new Set(rows.map((r) => r.resolvedId).filter((v): v is number => v !== null))].map(Number);
  const names = new Map<number, string>();
  if (resolvedIds.length) {
    const bs = await db.select({ id: buildings.id, name: buildings.name }).from(buildings).where(inArray(buildings.id, resolvedIds));
    for (const b of bs) names.set(b.id, b.name);
  }
  const ts = (v: unknown) => new Date(v as string | Date).toISOString();
  return rows.map((r) => {
    const sp = spelling.get(r.textNorm);
    const rid = r.resolvedId === null ? null : Number(r.resolvedId);
    return {
      textNorm: r.textNorm,
      text: sp?.text ?? r.textNorm,
      area: sp?.area ?? null,
      requests: num(r.requests),
      people: num(r.people),
      firstAskedAt: ts(r.first),
      lastAskedAt: ts(r.last),
      resolvedBuilding: rid !== null && names.has(rid) ? { id: rid, name: names.get(rid) as string } : null,
    };
  });
}

/** Links (or, with null, unlinks) every request row with this text to a building. Returns rows changed. */
export async function resolveRequests(db: Db, textNorm: string, buildingId: number | null): Promise<number> {
  const rows = await db
    .update(buildingRequests)
    .set({ resolvedBuildingId: buildingId })
    .where(eq(buildingRequests.textNorm, textNorm))
    .returning({ id: buildingRequests.id });
  return rows.length;
}

// ---------- buildings and aliases ----------

/** Buildings by name (all of them, or the given ids) with their aliases and sale counts. */
async function selectAdminBuildings(db: Db, ids?: readonly number[]): Promise<AdminBuilding[]> {
  const only = ids === undefined ? undefined : [...ids];
  if (only && only.length === 0) return [];
  const [bs, as, counts] = await Promise.all([
    db
      .select()
      .from(buildings)
      .where(only ? inArray(buildings.id, only) : undefined)
      .orderBy(asc(buildings.name), asc(buildings.id)),
    db
      .select()
      .from(buildingAliases)
      .where(only ? inArray(buildingAliases.buildingId, only) : undefined)
      .orderBy(asc(buildingAliases.id)),
    db
      .select({ buildingId: sales.buildingId, n: count() })
      .from(sales)
      .where(only ? inArray(sales.buildingId, only) : undefined)
      .groupBy(sales.buildingId),
  ]);
  const aliasesBy = new Map<number, AdminAlias[]>();
  for (const a of as) {
    const list = aliasesBy.get(a.buildingId) ?? [];
    list.push({ id: a.id, alias: a.aliasRaw, aliasNorm: a.aliasNorm, source: a.source });
    aliasesBy.set(a.buildingId, list);
  }
  const countBy = new Map(counts.map((c) => [c.buildingId, num(c.n)]));
  return bs.map((b) => ({
    id: b.id,
    name: b.name,
    area: b.area,
    areaDld: b.areaDld,
    project: b.project,
    masterProject: b.masterProject,
    fromOpenData: b.dldKey !== null,
    aliases: aliasesBy.get(b.id) ?? [],
    salesCount: countBy.get(b.id) ?? 0,
  }));
}

/** Every building, by name. Small sets only (tests, scripts): admin pages use the paged search. */
export async function listAdminBuildings(db: Db): Promise<AdminBuilding[]> {
  return selectAdminBuildings(db);
}

/** `%`, `_` and `\` match themselves in an ILIKE pattern. */
function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * One page of the admin Buildings tab (REAL_DATA.md sections 11 and 12: thousands of DLD buildings):
 * by name, 50 at a time, searched on the server by name, area, DLD area or any alias (`q`, 2+
 * characters; shorter is ignored). Each row has its aliases and sale count.
 */
export async function searchAdminBuildings(db: Db, query: { q?: string | null; page?: number } = {}): Promise<AdminBuildingsPage> {
  const q = (query.q ?? "").trim();
  const search = q.length >= ADMIN_BUILDINGS_QUERY_MIN ? q.slice(0, 120) : null;
  const page = Math.max(1, Math.trunc(query.page ?? 1) || 1);
  const where = search
    ? or(
        ilike(buildings.name, containsPattern(search)),
        ilike(buildings.area, containsPattern(search)),
        ilike(buildings.areaDld, containsPattern(search)),
        sql`exists (select 1 from ${buildingAliases} where ${buildingAliases.buildingId} = ${buildings.id} and ${buildingAliases.aliasRaw} ilike ${containsPattern(search)})`,
      )
    : undefined;
  const [ids, [total]] = await Promise.all([
    db
      .select({ id: buildings.id })
      .from(buildings)
      .where(where)
      .orderBy(asc(buildings.name), asc(buildings.id))
      .limit(ADMIN_BUILDINGS_PAGE)
      .offset((page - 1) * ADMIN_BUILDINGS_PAGE),
    db.select({ n: count() }).from(buildings).where(where),
  ]);
  const list = await selectAdminBuildings(
    db,
    ids.map((r) => r.id),
  );
  return { buildings: list, total: num(total?.n), page, pageSize: ADMIN_BUILDINGS_PAGE, q: search };
}

/** Every building as a picker option (id, name, area), by name: the admin building comboboxes. */
export async function listBuildingOptions(db: Db): Promise<AdminBuildingOption[]> {
  return db
    .select({ id: buildings.id, name: buildings.name, area: buildings.area })
    .from(buildings)
    .orderBy(asc(buildings.name), asc(buildings.id));
}

export async function getAdminBuilding(db: Db, id: number): Promise<AdminBuilding | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [b] = await selectAdminBuildings(db, [id]);
  return b ?? null;
}

/**
 * True when a building with this name already exists in this area (both case-insensitive). DLD names
 * repeat across areas (REAL_DATA.md section 5), so the same name in another area is a different building.
 */
export async function buildingNameTaken(db: Db, name: string, area: string): Promise<boolean> {
  const a = area.trim();
  const rows = await db
    .select({ id: buildings.id })
    .from(buildings)
    .where(
      and(
        sql`lower(${buildings.name}) = lower(${name.trim()})`,
        sql`(lower(${buildings.area}) = lower(${a}) or lower(coalesce(${buildings.areaDld}, '')) = lower(${a}))`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Adds a building and its aliases (the name is always an alias too), de-duplicated by normalised
 * form, in one transaction. Matching sees it at once (the alias cache is invalidated).
 */
export async function createBuilding(
  db: Db,
  input: Required<Pick<BuildingCreate, "name" | "area">> & {
    project: string | null;
    masterProject: string | null;
    aliases: string[];
  },
  source: "admin" | "import" = "admin",
): Promise<number> {
  const id = await db.transaction(async (tx) => {
    const [b] = await tx
      .insert(buildings)
      .values({
        name: input.name.trim(),
        area: input.area.trim(),
        project: input.project,
        masterProject: input.masterProject,
      })
      .returning({ id: buildings.id });
    const seen = new Set<string>();
    const rows: Array<typeof buildingAliases.$inferInsert> = [];
    for (const raw of [input.name, ...input.aliases]) {
      const norm = normalise(raw);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      rows.push({ buildingId: b.id, aliasRaw: raw.trim(), aliasNorm: norm, source });
    }
    if (rows.length) await tx.insert(buildingAliases).values(rows).onConflictDoNothing();
    return b.id;
  });
  invalidateAliasCache();
  return id;
}

/**
 * Adds one alias to a building. Returns the alias and whether it was new; null when the building is
 * unknown. An alias that normalises to nothing returns `{ alias: null }`.
 */
export async function addAlias(
  db: Db,
  buildingId: number,
  aliasRaw: string,
): Promise<{ alias: AdminAlias | null; created: boolean } | null> {
  const building = await getBuilding(db, buildingId);
  if (!building) return null;
  const aliasNorm = normalise(aliasRaw);
  if (!aliasNorm) return { alias: null, created: false };
  const inserted = await db
    .insert(buildingAliases)
    .values({ buildingId, aliasRaw: aliasRaw.trim(), aliasNorm, source: "admin" })
    .onConflictDoNothing()
    .returning();
  invalidateAliasCache();
  if (inserted[0]) {
    const a = inserted[0];
    return { alias: { id: a.id, alias: a.aliasRaw, aliasNorm: a.aliasNorm, source: a.source }, created: true };
  }
  const [existing] = await db
    .select()
    .from(buildingAliases)
    .where(and(eq(buildingAliases.buildingId, buildingId), eq(buildingAliases.aliasNorm, aliasNorm)))
    .limit(1);
  return {
    alias: existing
      ? { id: existing.id, alias: existing.aliasRaw, aliasNorm: existing.aliasNorm, source: existing.source }
      : null,
    created: false,
  };
}

// ---------- sales ----------

function toAdminSale(s: SaleRow, building: { name: string; area: string }): AdminSale {
  return {
    id: s.id,
    buildingId: s.buildingId,
    buildingName: building.name,
    buildingArea: building.area,
    saleDate: s.saleDate,
    bedrooms: s.bedrooms,
    sizeSqft: s.sizeSqft,
    priceAed: s.priceAed,
    psf: s.priceAed / s.sizeSqft,
    source: s.source,
    completion: s.completion,
    externalRef: s.externalRef,
    createdAt: s.createdAt.toISOString(),
  };
}

/** Sales, newest sale date first, optionally for one building and/or bedroom count (at most 500). */
export async function listAdminSales(
  db: Db,
  q: { buildingId?: number; bedrooms?: number } = {},
  limit: number = ADMIN_SALES_LIMIT,
): Promise<AdminSale[]> {
  const parts: SQL[] = [];
  if (q.buildingId !== undefined) parts.push(eq(sales.buildingId, q.buildingId));
  if (q.bedrooms !== undefined) parts.push(eq(sales.bedrooms, q.bedrooms));
  const rows = await db
    .select({ sale: sales, name: buildings.name, area: buildings.area })
    .from(sales)
    .innerJoin(buildings, eq(buildings.id, sales.buildingId))
    .where(parts.length ? and(...parts) : undefined)
    .orderBy(desc(sales.saleDate), desc(sales.id))
    .limit(limit);
  return rows.map((r) => toAdminSale(r.sale, r));
}

export async function saleRefTaken(db: Db, externalRef: string): Promise<boolean> {
  const rows = await db.select({ id: sales.id }).from(sales).where(eq(sales.externalRef, externalRef)).limit(1);
  return rows.length > 0;
}

/** Stores an admin-registered sale (`source = "admin"`). The caller has checked the building. */
export async function createAdminSale(db: Db, s: NewSaleInput, building: { name: string; area: string }): Promise<AdminSale> {
  const [row] = await db
    .insert(sales)
    .values({
      buildingId: s.buildingId,
      saleDate: s.saleDate,
      bedrooms: s.bedrooms,
      sizeSqft: s.sizeSqft,
      priceAed: s.priceAed,
      source: "admin",
      completion: s.completion,
      externalRef: s.externalRef ?? null,
    })
    .returning();
  return toAdminSale(row, building);
}

/** Deletes a sale. False when it did not exist. */
export async function deleteSale(db: Db, id: number): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const rows = await db.delete(sales).where(eq(sales.id, id)).returning({ id: sales.id });
  return rows.length > 0;
}

/** Median price per sq ft and median price of a set of sales. */
export function medianView(list: ReadonlyArray<{ sizeSqft: number; priceAed: number }>): MedianView {
  const valid = list.filter((s) => s.sizeSqft > 0 && s.priceAed > 0);
  return {
    count: valid.length,
    medianPsf: median(valid.map((s) => s.priceAed / s.sizeSqft)),
    medianPriceAed: median(valid.map((s) => s.priceAed)),
  };
}

/** Non-removed saved listings for comparisons of this building, bedroom count and completion basis. */
export async function countSavedFor(db: Db, buildingId: number, bedrooms: number, basis: "ready" | "off_plan"): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(savedListings)
    .innerJoin(checks, eq(checks.id, savedListings.checkId))
    .where(
      and(
        isNull(savedListings.removedAt),
        eq(checks.buildingId, buildingId),
        eq(checks.bedrooms, bedrooms),
        eq(checks.completionBasis, basis),
      ),
    );
  return num(row?.n);
}

/**
 * What registering a sale would do: the 12-month median before and after for its building, bedroom
 * count and completion (the comparisons' window, see `adminWindow`), and how many saved listings of
 * that basis will show a new sale. Null when the building is unknown.
 */
export async function previewSale(
  db: Db,
  s: Pick<NewSaleInput, "buildingId" | "bedrooms" | "saleDate" | "sizeSqft" | "priceAed" | "completion">,
  today: IsoDate,
  rules: Rules,
): Promise<SalePreview | null> {
  const building = await getBuilding(db, s.buildingId);
  if (!building) return null;
  const window = await adminWindow(db, today, rules);
  const current = await recentSales(db, s.buildingId, s.bedrooms, s.completion, window);
  const inWindow = s.saleDate >= window.start && s.saleDate <= window.end;
  const before = medianView(current);
  const after = inWindow ? medianView([...current, { sizeSqft: s.sizeSqft, priceAed: s.priceAed }]) : before;
  const savedListingsAffected = inWindow ? await countSavedFor(db, s.buildingId, s.bedrooms, s.completion) : 0;
  const vars = { bedType: bedsLabel(s.bedrooms), building: building.name, n: savedListingsAffected };
  let impact: string;
  if (!inWindow) impact = COPY["adminUi.impactOutside"];
  else if (before.medianPsf === null) impact = t("adminUi.impactNew", { ...vars, new: formatInt(after.medianPsf ?? 0) });
  else impact = t("admin.impact", { ...vars, old: formatInt(before.medianPsf), new: formatInt(after.medianPsf ?? 0) });
  return { before, after, savedListingsAffected, inWindow, impact };
}

/**
 * Sales in the window for many building/bedroom pairs at once (CSV import impact), keyed
 * `buildingId:bedrooms:completion`.
 */
export async function recentSalesFor(
  db: Db,
  pairs: ReadonlyArray<{ buildingId: number; bedrooms: number }>,
  window: SalesWindow,
): Promise<Map<string, Array<{ sizeSqft: number; priceAed: number }>>> {
  const out = new Map<string, Array<{ sizeSqft: number; priceAed: number }>>();
  if (pairs.length === 0) return out;
  const ids = [...new Set(pairs.map((p) => p.buildingId))];
  const rows = await db
    .select({
      buildingId: sales.buildingId,
      bedrooms: sales.bedrooms,
      completion: sales.completion,
      sizeSqft: sales.sizeSqft,
      priceAed: sales.priceAed,
    })
    .from(sales)
    .where(and(inArray(sales.buildingId, ids), gte(sales.saleDate, window.start), lte(sales.saleDate, window.end)));
  for (const r of rows) {
    const key = `${r.buildingId}:${r.bedrooms}:${r.completion}`;
    const list = out.get(key) ?? [];
    list.push({ sizeSqft: r.sizeSqft, priceAed: r.priceAed });
    out.set(key, list);
  }
  return out;
}
