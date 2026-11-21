import "server-only";
/**
 * CSV import (A§4.4): buildings, aliases or sales.
 * - A dry run (`commit: false`) validates every row, finds duplicates and computes the per-building
 *   median impact, and writes nothing.
 * - A commit runs the same plan inside one transaction; any database error rolls back every row.
 * - Sales are stored with `source = "import"`, `import_batch` = this upload's id and the row's
 *   completion (blank = ready). Duplicates (same `external_ref`, or the exact same building, date,
 *   bedrooms, size and price when there is no ref) are skipped and counted, not rejected. A commit that
 *   adds sales sets `app_meta.data_imported_at`.
 * - A sale's building is found by exact name (case-insensitive), then by a normalised alias. DLD
 *   names repeat across areas (REAL_DATA.md section 5): when more than one building fits, the row's
 *   `area` (shown area or DLD area) picks one, and without it the row is rejected as ambiguous.
 * - Buildings are matched by name and area (case-insensitive). A building from the DLD open data is
 *   never changed here (each snapshot load rewrites it); an admin-added building with that name is
 *   updated (area and project names). Aliases need a known building.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { t } from "@/lib/copy";
import type { Rules } from "@/lib/domain/analyse";
import type { IsoDate } from "@/lib/domain/dates";
import { normalise } from "@/lib/domain/normalise";
import type { Db } from "@/lib/db/client";
import { setAppMeta } from "@/lib/db/meta";
import { adminWindow, medianView, recentSalesFor } from "@/lib/db/repo/admin";
import { invalidateAliasCache } from "@/lib/db/repo/buildings";
import { buildingAliases, buildings, sales } from "@/lib/db/schema";
import {
  CSV_MAX_ROWS,
  CSV_REJECTED_LIST_MAX,
  type CsvKind,
  type ImportImpact,
  type ImportResult,
} from "@/lib/validation/admin";
import {
  checkAliasRow,
  checkBuildingRow,
  checkSaleRow,
  parseCsvText,
  type BuildingCsvRow,
  type SaleCsvRow,
} from "./parse";

export { CsvFormatError } from "./parse";

export interface ImportOptions {
  kind: CsvKind;
  text: string;
  commit: boolean;
  /** Dubai day: future sale dates are rejected; the impact uses the window ending today. */
  today: IsoDate;
  rules: Rules;
  /** Stored as `import_batch` on committed sales (default: a fresh id). */
  batchId?: string;
}

const INSERT_CHUNK = 500;

type Rejected = Array<{ line: number; reason: string }>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

interface BuildingRef {
  id: number;
  name: string;
  area: string;
  areaDld: string | null;
}

type Resolved = { ok: true; building: BuildingRef } | { ok: false; reason: string };

const lower = (s: string) => s.trim().toLowerCase();

/** True when `area` is the building's shown area or its DLD area (case-insensitive). */
function inArea(b: BuildingRef, area: string): boolean {
  const a = lower(area);
  return lower(b.area) === a || (b.areaDld !== null && lower(b.areaDld) === a);
}

/**
 * Looks a building up by exact name (case-insensitive), then by a normalised alias. When several
 * buildings fit, `area` must pick exactly one; otherwise the row is ambiguous.
 */
async function buildingResolver(db: Db): Promise<(name: string, area: string | null) => Resolved> {
  const [bs, as] = await Promise.all([
    db.select({ id: buildings.id, name: buildings.name, area: buildings.area, areaDld: buildings.areaDld }).from(buildings),
    db.select({ buildingId: buildingAliases.buildingId, aliasNorm: buildingAliases.aliasNorm }).from(buildingAliases),
  ]);
  const byName = new Map<string, BuildingRef[]>();
  for (const b of bs) {
    const key = b.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), b]);
  }
  const byId = new Map(bs.map((b) => [b.id, b]));
  const byAlias = new Map<string, Set<number>>();
  for (const a of as) {
    const set = byAlias.get(a.aliasNorm) ?? new Set<number>();
    set.add(a.buildingId);
    byAlias.set(a.aliasNorm, set);
  }
  const pick = (list: BuildingRef[], name: string, area: string | null): Resolved | null => {
    const fit = area ? list.filter((b) => inArea(b, area)) : list;
    if (fit.length === 1) return { ok: true, building: fit[0] };
    if (fit.length > 1) return { ok: false, reason: t("adminUi.csv.ambiguousBuilding", { name }) };
    return null;
  };
  return (name, area) => {
    const exact = pick(byName.get(lower(name)) ?? [], name, area);
    if (exact) return exact;
    const ids = [...(byAlias.get(normalise(name)) ?? [])];
    const viaAlias = pick(
      ids.map((id) => byId.get(id)).filter((b): b is BuildingRef => b !== undefined),
      name,
      area,
    );
    return viaAlias ?? { ok: false, reason: t("adminUi.csv.unknownBuilding", { name }) };
  };
}

function result(kind: CsvKind, rows: number, rejected: Rejected, part: Partial<ImportResult>): ImportResult {
  const ok = rows - rejected.length;
  return {
    kind,
    rows,
    ok,
    rejected: rejected.slice(0, CSV_REJECTED_LIST_MAX),
    rejectedCount: rejected.length,
    created: 0,
    updated: 0,
    skippedDuplicates: 0,
    committed: false,
    impact: [],
    ...part,
  };
}

async function inChunks<T>(items: readonly T[], fn: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += INSERT_CHUNK) await fn(items.slice(i, i + INSERT_CHUNK));
}

// ---------- sales ----------

const saleKey = (buildingId: number, s: Pick<SaleCsvRow, "saleDate" | "bedrooms" | "sizeSqft" | "priceAed">) =>
  `${buildingId}|${s.saleDate}|${s.bedrooms}|${s.sizeSqft}|${s.priceAed}`;

type ValidSale = SaleCsvRow & { buildingId: number; buildingName: string };

/** Serialises sales-import commits (pg_advisory_xact_lock); any constant not used by another lock. */
const SALES_IMPORT_LOCK_KEY = 727_275;

interface SalesPlan {
  toInsert: ValidSale[];
  skipped: number;
  impact: ImportImpact[];
}

/**
 * Splits the valid rows into new sales and duplicates (an existing or repeated `external_ref`, or
 * the exact same building, date, bedrooms, size and price when there is no ref), and computes the
 * median impact, all against `db` (the commit's transaction, so nothing can change in between).
 */
async function planSales(db: Db, valid: readonly ValidSale[], o: ImportOptions): Promise<SalesPlan> {
  const refs = [...new Set(valid.map((v) => v.externalRef).filter((r): r is string => r !== null))];
  const existingRefs = new Set<string>();
  for (let i = 0; i < refs.length; i += INSERT_CHUNK) {
    const chunk = refs.slice(i, i + INSERT_CHUNK);
    const rows = await db.select({ ref: sales.externalRef }).from(sales).where(inArray(sales.externalRef, chunk));
    for (const r of rows) if (r.ref) existingRefs.add(r.ref);
  }
  const ids = [...new Set(valid.map((v) => v.buildingId))];
  const existingKeys = new Set<string>();
  if (ids.length) {
    const rows = await db
      .select({
        buildingId: sales.buildingId,
        saleDate: sales.saleDate,
        bedrooms: sales.bedrooms,
        sizeSqft: sales.sizeSqft,
        priceAed: sales.priceAed,
      })
      .from(sales)
      .where(inArray(sales.buildingId, ids));
    for (const r of rows) existingKeys.add(saleKey(r.buildingId, r));
  }

  const toInsert: ValidSale[] = [];
  let skipped = 0;
  const seenRefs = new Set<string>();
  const seenKeys = new Set<string>();
  for (const v of valid) {
    const key = saleKey(v.buildingId, v);
    const dup = v.externalRef
      ? existingRefs.has(v.externalRef) || seenRefs.has(v.externalRef)
      : existingKeys.has(key) || seenKeys.has(key);
    if (dup) {
      skipped++;
      continue;
    }
    if (v.externalRef) seenRefs.add(v.externalRef);
    seenKeys.add(key);
    toInsert.push(v);
  }

  // Impact: the 12-month median (the comparisons' window) for each building, bedroom count and
  // completion that gains sales. Ready and off-plan sales are never pooled.
  const groups = new Map<
    string,
    { buildingId: number; buildingName: string; bedrooms: number; completion: "ready" | "off_plan"; added: ValidSale[] }
  >();
  for (const v of toInsert) {
    const k = `${v.buildingId}:${v.bedrooms}:${v.completion}`;
    const g = groups.get(k) ?? {
      buildingId: v.buildingId,
      buildingName: v.buildingName,
      bedrooms: v.bedrooms,
      completion: v.completion,
      added: [],
    };
    g.added.push(v);
    groups.set(k, g);
  }
  const window = await adminWindow(db, o.today, o.rules);
  const current = await recentSalesFor(db, [...groups.values()], window);
  const impact: ImportImpact[] = [...groups.entries()]
    .map(([k, g]) => {
      const before = current.get(k) ?? [];
      const addedInWindow = g.added.filter((a) => a.saleDate >= window.start && a.saleDate <= window.end);
      return {
        buildingName: g.buildingName,
        bedrooms: g.bedrooms,
        completion: g.completion,
        beforeMedianPsf: medianView(before).medianPsf,
        afterMedianPsf: medianView([...before, ...addedInWindow]).medianPsf,
        added: g.added.length,
      };
    })
    .sort(
      (a, b) =>
        a.buildingName.localeCompare(b.buildingName) || a.bedrooms - b.bedrooms || a.completion.localeCompare(b.completion),
    );

  return { toInsert, skipped, impact };
}

async function importSales(db: Db, o: ImportOptions): Promise<ImportResult> {
  const parsed = parseCsvText(o.text, "sales", CSV_MAX_ROWS);
  const resolve = await buildingResolver(db);
  const rejected: Rejected = [];
  const valid: ValidSale[] = [];
  for (const row of parsed.rows) {
    const c = checkSaleRow(row.values, o.today);
    if (!c.ok) {
      rejected.push({ line: row.line, reason: c.reason });
      continue;
    }
    const r = resolve(c.value.buildingName, c.value.area);
    if (!r.ok) {
      rejected.push({ line: row.line, reason: r.reason });
      continue;
    }
    valid.push({ ...c.value, buildingId: r.building.id, buildingName: r.building.name });
  }

  if (!o.commit) {
    const plan = await planSales(db, valid, o);
    return result("sales", parsed.rows.length, rejected, {
      created: plan.toInsert.length,
      skippedDuplicates: plan.skipped,
      committed: false,
      impact: plan.impact,
    });
  }

  const batch = o.batchId ?? `import-${o.today}-${randomUUID().slice(0, 8)}`;
  // The duplicate lookup and the insert run in one transaction, and sales-import commits are
  // serialised with a transaction-level advisory lock: two commits of the same file (a retry, a
  // second tab) cannot both see "no duplicates" and store every row twice, or fail on the unique ref.
  const plan = await db.transaction(async (tx: Tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SALES_IMPORT_LOCK_KEY})`);
    const p = await planSales(tx as unknown as Db, valid, o);
    let skippedOnInsert = 0;
    await inChunks(p.toInsert, async (chunk) => {
      const inserted = await tx
        .insert(sales)
        .values(
          chunk.map((v) => ({
            buildingId: v.buildingId,
            saleDate: v.saleDate,
            bedrooms: v.bedrooms,
            sizeSqft: v.sizeSqft,
            priceAed: v.priceAed,
            source: "import" as const,
            completion: v.completion,
            externalRef: v.externalRef,
            importBatch: batch,
          })),
        )
        // A ref stored meanwhile by a single registered sale is skipped and counted, not a 500.
        .onConflictDoNothing({ target: sales.externalRef })
        .returning({ id: sales.id });
      skippedOnInsert += chunk.length - inserted.length;
    });
    if (p.toInsert.length - skippedOnInsert > 0) await setAppMeta(tx as unknown as Db, "data_imported_at", o.today);
    return { ...p, created: p.toInsert.length - skippedOnInsert, skipped: p.skipped + skippedOnInsert };
  });

  return result("sales", parsed.rows.length, rejected, {
    created: plan.created,
    skippedDuplicates: plan.skipped,
    committed: true,
    impact: plan.impact,
  });
}

// ---------- buildings ----------

type ResolvedBuilding = BuildingCsvRow;

async function importBuildings(db: Db, o: ImportOptions): Promise<ImportResult> {
  const parsed = parseCsvText(o.text, "buildings", CSV_MAX_ROWS);
  const existing = await db.select().from(buildings);
  const byName = new Map<string, typeof existing>();
  for (const b of existing) {
    const key = b.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), b]);
  }
  const rejected: Rejected = [];
  const creates: ResolvedBuilding[] = [];
  const updates: Array<ResolvedBuilding & { id: number }> = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const row of parsed.rows) {
    const c = checkBuildingRow(row.values);
    if (!c.ok) {
      rejected.push({ line: row.line, reason: c.reason });
      continue;
    }
    const v: BuildingCsvRow = c.value;
    const key = `${lower(v.name)}|${lower(v.area)}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const named = byName.get(lower(v.name)) ?? [];
    const sameArea = named.find((b) => inArea(b, v.area));
    // A DLD building is the snapshot's: leave it as it is (the next load would rewrite it anyway).
    if (sameArea?.dldKey) {
      skipped++;
      continue;
    }
    const adminOnes = named.filter((b) => b.dldKey === null);
    const cur = sameArea ?? (adminOnes.length === 1 ? adminOnes[0] : undefined);
    if (!cur) {
      creates.push(v);
      continue;
    }
    // Blank optional cells keep the current values.
    const next: ResolvedBuilding = {
      name: cur.name,
      area: v.area,
      project: v.project ?? cur.project,
      masterProject: v.masterProject ?? cur.masterProject,
    };
    if (cur.area === next.area && cur.project === next.project && cur.masterProject === next.masterProject) {
      skipped++;
    } else updates.push({ ...next, id: cur.id });
  }

  let committed = false;
  if (o.commit) {
    await db.transaction(async (tx: Tx) => {
      for (const u of updates) {
        await tx
          .update(buildings)
          .set({ area: u.area, project: u.project, masterProject: u.masterProject, updatedAt: sql`now()` })
          .where(eq(buildings.id, u.id));
      }
      await inChunks(creates, async (chunk) => {
        const inserted = await tx
          .insert(buildings)
          .values(chunk.map((v) => ({ name: v.name, area: v.area, project: v.project, masterProject: v.masterProject })))
          .returning({ id: buildings.id, name: buildings.name });
        const aliasRows = inserted
          .map((b) => ({ buildingId: b.id, aliasRaw: b.name, aliasNorm: normalise(b.name), source: "import" as const }))
          .filter((a) => a.aliasNorm !== "");
        if (aliasRows.length) await tx.insert(buildingAliases).values(aliasRows).onConflictDoNothing();
      });
    });
    invalidateAliasCache();
    committed = true;
  }

  return result("buildings", parsed.rows.length, rejected, {
    created: creates.length,
    updated: updates.length,
    skippedDuplicates: skipped,
    committed,
  });
}

// ---------- aliases ----------

async function importAliases(db: Db, o: ImportOptions): Promise<ImportResult> {
  const parsed = parseCsvText(o.text, "aliases", CSV_MAX_ROWS);
  const resolve = await buildingResolver(db);
  const existing = await db.select({ buildingId: buildingAliases.buildingId, aliasNorm: buildingAliases.aliasNorm }).from(buildingAliases);
  const have = new Set(existing.map((a) => `${a.buildingId}|${a.aliasNorm}`));
  const rejected: Rejected = [];
  const creates: Array<{ buildingId: number; aliasRaw: string; aliasNorm: string }> = [];
  let skipped = 0;
  for (const row of parsed.rows) {
    const c = checkAliasRow(row.values);
    if (!c.ok) {
      rejected.push({ line: row.line, reason: c.reason });
      continue;
    }
    const r = resolve(c.value.buildingName, null);
    if (!r.ok) {
      rejected.push({ line: row.line, reason: r.reason });
      continue;
    }
    const b = r.building;
    const aliasNorm = normalise(c.value.alias);
    if (!aliasNorm) {
      rejected.push({ line: row.line, reason: t("adminUi.csv.aliasMissing") });
      continue;
    }
    const key = `${b.id}|${aliasNorm}`;
    if (have.has(key)) {
      skipped++;
      continue;
    }
    have.add(key);
    creates.push({ buildingId: b.id, aliasRaw: c.value.alias, aliasNorm });
  }

  let committed = false;
  if (o.commit) {
    await db.transaction(async (tx: Tx) => {
      await inChunks(creates, (chunk) =>
        tx
          .insert(buildingAliases)
          .values(chunk.map((a) => ({ ...a, source: "import" as const })))
          .onConflictDoNothing({ target: [buildingAliases.aliasNorm, buildingAliases.buildingId] }),
      );
    });
    invalidateAliasCache();
    committed = true;
  }

  return result("aliases", parsed.rows.length, rejected, {
    created: creates.length,
    skippedDuplicates: skipped,
    committed,
  });
}

/** Runs a dry run or a commit. Throws CsvFormatError for a file-level problem, and rethrows DB errors. */
export async function importCsv(db: Db, o: ImportOptions): Promise<ImportResult> {
  if (o.kind === "sales") return importSales(db, o);
  if (o.kind === "buildings") return importBuildings(db, o);
  return importAliases(db, o);
}
