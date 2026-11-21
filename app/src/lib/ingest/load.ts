import "server-only";
/**
 * Loads the committed open-data snapshot into the database (REAL_DATA.md section 4).
 *
 * `startOpenDataLoad()` runs from src/instrumentation.ts after migrateAndSeed, in the background: the
 * server starts and answers the healthcheck while it runs, and a failure is logged
 * (`open_data_load_failed`), never thrown. `loadOpenData()`:
 * 1. reads `manifest.json` from OPEN_DATA_DIR (none: logs `open_data_missing` once and stops);
 * 2. stops when `app_meta.open_data_sha` already equals the manifest's `snapshotSha256`, the similar-buildings
 *    model and the adjusted-registered-sales model are the loaded ones (`app_meta.open_data_similar_sha`,
 *    `app_meta.open_data_acs_sha`) (and, when the
 *    manifest names a `buildings.csv.gz`, `app_meta.open_data_buildings_sha` equals its sha too);
 * 3. streams `sales.csv.gz` once to group the buildings and check the file against the manifest, and
 *    reads `buildings.csv.gz` (project number, nearest metro, mall and landmark, first and last sale
 *    dates, off-plan share) when the manifest names one;
 * 4. Postgres: in one transaction, behind pg_advisory_xact_lock, then the sha is checked again (so a
 *    second instance waits and then skips). PGlite: as a series of short transactions, one load at
 *    a time per process, so requests (and the health check) run between them. Either way it upserts
 *    buildings by `dld_key`, adds aliases (source `import`), streams the sales in again in batches
 *    of 2,000 with ON CONFLICT (external_ref) DO NOTHING (existing rows keep `created_at`, so "new
 *    since you saved" stays right), updates in place the existing `open_data` rows whose values DLD
 *    corrected (also keeping `created_at`; skipped on a first load), deletes the `open_data` sales
 *    whose ref is no longer in the snapshot (staging temp table), removes DLD buildings that left
 *    the snapshot and have no sales, stamps the sales it added with the time they become visible
 *    (Postgres) and sets app_meta;
 *    When the manifest has a `similar` section (REAL_DATA.md section 15), the last step also replaces
 *    `similar_cells` with the rows of `similar-cells.csv.gz` and stores the model (constants, backtest
 *    summary) in app_meta, so the cells, the constants and the sales always belong together;
 *    When the manifest has an `acs` section (REAL_DATA.md section 16), it also stores the text of
 *    `acs-model.json.gz` in app_meta (`acs_model`), checked against the manifest before the load starts;
 *    a snapshot without one empties it, so an old model is never used with new sales;
 * 5. adds the marketing names kept by hand (market-names.ts) as aliases: after a load, and at any
 *    start where that list changed although the snapshot did not (`syncMarketNames`);
 * 6. invalidates the alias cache, the cached data status and the "From the data" panel, and logs
 *    `open_data_loaded` with counts and milliseconds.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { sql } from "drizzle-orm";
import { ACS_MODEL_FILE } from "@/lib/acs/model";
import { invalidateDataMeta } from "@/lib/data-status";
import { dbKind, getDb, type Db, type DbKind } from "@/lib/db/client";
import { getAppMeta, setAppMeta } from "@/lib/db/meta";
import { invalidateAliasCache } from "@/lib/db/repo/buildings";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { invalidateFromTheData } from "@/lib/services/from-the-data";
import type { SimilarModelMeta } from "@/lib/similar/model";
import { buildingAliases, displayArea, displayName, dldKey } from "./identity";
import { marketAliases, marketNamesSha, MARKET_NAMES, type MarketName } from "./market-names";
import {
  BUILDINGS_FILE,
  compareRefs,
  dataSourceMeta,
  readAcsModelText,
  readBuildingFacts,
  readManifest,
  readSimilarCells,
  readSnapshotRows,
  SIMILAR_CELLS_FILE,
  SNAPSHOT_FILE,
  SnapshotError,
  type Manifest,
  type SimilarCellRow,
} from "./snapshot";
import type { BuildingFacts, NormalisedSale } from "./types";

/** pg_advisory_xact_lock key for the open-data load (727274: migrations, 727275: CSV import). */
export const OPEN_DATA_LOCK_KEY = 727_276;
export const SALES_BATCH = 2_000;
const BUILDING_BATCH = 500;
const ALIAS_BATCH = 2_000;
const CELL_BATCH = 2_000;

/** OPEN_DATA_DIR, or `<cwd>/data/open-data`. */
export function openDataDir(): string {
  const configured = getEnv().OPEN_DATA_DIR;
  // turbopackIgnore: a runtime data directory, not a source path.
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured ?? path.join("data", "open-data"));
}

export interface LoadOptions {
  /** Defaults to getDb(). Tests pass their in-memory PGlite. */
  db?: Db;
  /** Defaults to dbKind() (with `db`: "pglite"). */
  kind?: DbKind;
  /** Defaults to openDataDir(). */
  dir?: string;
  /** Sales per INSERT (default 2,000). */
  batchSize?: number;
}

export interface LoadResult {
  status: "loaded" | "up_to_date" | "missing";
  /** Why an up-to-date load did nothing: the sha was already loaded, or another instance loaded it first. */
  skipped?: "same_sha" | "loaded_by_other";
  rows: number;
  inserted: number;
  /** Existing open-data sales whose values changed in this snapshot (a DLD correction). */
  updated: number;
  deleted: number;
  /** DLD buildings no longer in the snapshot and with no sales left, removed with their aliases. */
  removedBuildings: number;
  buildings: number;
  /** Rows now in similar_cells (0 when the snapshot has no similar-buildings model). */
  similarCells: number;
  ms: number;
}

interface BuildingGroup {
  key: string;
  names: Map<string, number>;
  areas: Map<string, number>;
  projects: Map<string, number>;
  masters: Map<string, number>;
  /** The building's row of buildings.csv.gz; absent when the snapshot has no such file. */
  facts?: BuildingFacts;
}

const bump = (m: Map<string, number>, v: string | null) => {
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

interface Scan {
  rows: number;
  groups: Map<string, BuildingGroup>;
  /** The rows of similar-cells.csv.gz; null when the manifest has no `similar` section. */
  cells: SimilarCellRow[] | null;
  /** The JSON text of acs-model.json.gz, checked against the manifest; null when the manifest has no `acs` section. */
  acsModel: string | null;
}

/** Pass 1: groups the buildings and checks the file's sha and row count against the manifest. */
async function scanSnapshot(file: string, manifest: Manifest, dir: string): Promise<Scan> {
  const groups = new Map<string, BuildingGroup>();
  const keys = new Map<string, string>();
  let rows = 0;
  let sha = "";
  for await (const s of readSnapshotRows(file, (h) => (sha = h))) {
    rows++;
    const pair = `${s.building}\u0000${s.areaDld}`;
    let key = keys.get(pair);
    if (key === undefined) {
      key = dldKey(s.building, s.areaDld);
      keys.set(pair, key);
    }
    let g = groups.get(key);
    if (!g) {
      g = { key, names: new Map(), areas: new Map(), projects: new Map(), masters: new Map() };
      groups.set(key, g);
    }
    bump(g.names, s.building);
    bump(g.areas, s.areaDld);
    bump(g.projects, s.project);
    bump(g.masters, s.masterProject);
  }
  if (sha !== manifest.snapshotSha256) throw new SnapshotError("sales.csv.gz does not match manifest.snapshotSha256");
  if (rows !== manifest.counts.kept) throw new SnapshotError(`sales.csv.gz has ${rows} rows; the manifest says ${manifest.counts.kept}`);
  if (manifest.buildingsFile) {
    // turbopackIgnore: a runtime data file, not a source path.
    const facts = await readBuildingFacts(path.join(/*turbopackIgnore: true*/ dir, BUILDINGS_FILE), manifest.buildingsFile);
    for (const f of facts) {
      const g = groups.get(dldKey(f.building, f.areaDld));
      if (g) g.facts = f;
    }
  }
  // turbopackIgnore: a runtime data file, not a source path.
  const cells = manifest.similar ? await readSimilarCells(path.join(/*turbopackIgnore: true*/ dir, SIMILAR_CELLS_FILE), manifest.similar.cellsFile) : null;
  // turbopackIgnore: a runtime data file, not a source path.
  const acsModel = manifest.acs ? await readAcsModelText(path.join(/*turbopackIgnore: true*/ dir, ACS_MODEL_FILE), manifest) : null;
  return { rows, groups, cells, acsModel };
}

/** Rows of a `db.execute` result (node-postgres and PGlite both return `{ rows }`). */
function rowsOf<T>(res: unknown): T[] {
  const rows = (res as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function countOf(res: unknown): number {
  return Number(rowsOf<{ n: number | string }>(res)[0]?.n ?? 0);
}

async function upsertBuildings(tx: Db, groups: Iterable<BuildingGroup>): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  let batch: Array<Record<string, string | number | null>> = [];
  const flush = async () => {
    if (batch.length === 0) return;
    // The facts columns keep their old value when this snapshot has none (a snapshot without
    // buildings.csv.gz never wipes them).
    const res = await tx.execute(sql`
      insert into buildings (dld_key, name, area, area_dld, project, master_project, project_number, nearest_metro,
                             nearest_mall, nearest_landmark, first_sale_date, first_ready_sale_date, last_sale_date, off_plan_share)
      select x.dld_key, x.name, x.area, x.area_dld, x.project, x.master_project, x.project_number, x.nearest_metro,
             x.nearest_mall, x.nearest_landmark, x.first_sale_date, x.first_ready_sale_date, x.last_sale_date, x.off_plan_share
      from json_to_recordset(${JSON.stringify(batch)}::json)
        as x(dld_key text, name text, area text, area_dld text, project text, master_project text, project_number int,
             nearest_metro text, nearest_mall text, nearest_landmark text, first_sale_date date,
             first_ready_sale_date date, last_sale_date date, off_plan_share real)
      on conflict (dld_key) where dld_key is not null do update set
        name = excluded.name,
        area = excluded.area,
        area_dld = excluded.area_dld,
        project = excluded.project,
        master_project = excluded.master_project,
        project_number = coalesce(excluded.project_number, buildings.project_number),
        nearest_metro = coalesce(excluded.nearest_metro, buildings.nearest_metro),
        nearest_mall = coalesce(excluded.nearest_mall, buildings.nearest_mall),
        nearest_landmark = coalesce(excluded.nearest_landmark, buildings.nearest_landmark),
        first_sale_date = coalesce(excluded.first_sale_date, buildings.first_sale_date),
        first_ready_sale_date = coalesce(excluded.first_ready_sale_date, buildings.first_ready_sale_date),
        last_sale_date = coalesce(excluded.last_sale_date, buildings.last_sale_date),
        off_plan_share = coalesce(excluded.off_plan_share, buildings.off_plan_share),
        updated_at = now()
      returning id, dld_key`);
    for (const r of rowsOf<{ id: number; dld_key: string }>(res)) ids.set(r.dld_key, Number(r.id));
    batch = [];
  };
  for (const g of groups) {
    const raw = mostCommon(g.names) as string;
    const areaDld = mostCommon(g.areas) ?? "";
    batch.push({
      dld_key: g.key,
      name: displayName(raw),
      area: displayArea(areaDld),
      area_dld: areaDld,
      project: mostCommon(g.projects),
      master_project: mostCommon(g.masters),
      project_number: g.facts?.projectNumber ?? null,
      nearest_metro: g.facts?.nearestMetro ?? null,
      nearest_mall: g.facts?.nearestMall ?? null,
      nearest_landmark: g.facts?.nearestLandmark ?? null,
      first_sale_date: g.facts?.firstSale ?? null,
      first_ready_sale_date: g.facts?.firstReadySale ?? null,
      last_sale_date: g.facts?.lastSale ?? null,
      off_plan_share: g.facts && g.facts.sales > 0 ? Math.round((g.facts.offPlanSales / g.facts.sales) * 10_000) / 10_000 : null,
    });
    if (batch.length >= BUILDING_BATCH) await flush();
  }
  await flush();
  return ids;
}

async function addAliases(tx: Db, groups: Iterable<BuildingGroup>, ids: Map<string, number>): Promise<void> {
  let batch: Array<{ building_id: number; alias_raw: string; alias_norm: string }> = [];
  const flush = async () => {
    if (batch.length === 0) return;
    await tx.execute(sql`
      insert into building_aliases (building_id, alias_raw, alias_norm, source)
      select x.building_id, x.alias_raw, x.alias_norm, 'import'
      from json_to_recordset(${JSON.stringify(batch)}::json) as x(building_id int, alias_raw text, alias_norm text)
      on conflict (alias_norm, building_id) do nothing`);
    batch = [];
  };
  for (const g of groups) {
    const id = ids.get(g.key);
    if (id === undefined) continue;
    const raws = [...g.names.keys()].sort(compareRefs);
    for (const a of buildingAliases(raws, displayName(mostCommon(g.names) as string))) {
      batch.push({ building_id: id, alias_raw: a.raw, alias_norm: a.norm });
      if (batch.length >= ALIAS_BATCH) await flush();
    }
  }
  await flush();
}

/**
 * Adds the marketing names kept by hand (market-names.ts) as aliases (source `import`) of their DLD
 * buildings. It runs when the list changed since it last ran (app_meta `market_names_sha`), or always
 * with `force` (after a snapshot load, which may have brought a listed building in). A listed building
 * that is not in the database is skipped; it only adds, never removes. Returns the aliases added.
 */
export async function syncMarketNames(db: Db, opts: { force?: boolean; list?: readonly MarketName[] } = {}): Promise<number> {
  const list = opts.list ?? MARKET_NAMES;
  const sha = marketNamesSha(list);
  if (!opts.force && (await getAppMeta(db, "market_names_sha")) === sha) return 0;
  const rows = marketAliases(list).map((a) => ({ dld_key: a.dldKey, alias_raw: a.raw, alias_norm: a.norm }));
  let added = 0;
  if (rows.length > 0) {
    added = countOf(
      await db.execute(sql`
        with ins as (
          insert into building_aliases (building_id, alias_raw, alias_norm, source)
          select b.id, x.alias_raw, x.alias_norm, 'import'
          from json_to_recordset(${JSON.stringify(rows)}::json) as x(dld_key text, alias_raw text, alias_norm text)
          join buildings b on b.dld_key = x.dld_key
          on conflict (alias_norm, building_id) do nothing
          returning 1
        )
        select count(*)::int as n from ins`),
    );
  }
  await setAppMeta(db, "market_names_sha", sha);
  if (added > 0) {
    invalidateAliasCache();
    log.info("market_names_added", { added });
  }
  return added;
}

/**
 * What app_meta.open_data_similar_sha holds: the SHA-256 of the manifest's `similar` section (cells
 * file, constants and backtest summary), or "" when the manifest has none. A refit that changes only
 * the constants therefore loads too.
 */
export function similarShaOf(manifest: Manifest): string {
  return manifest.similar ? createHash("sha256").update(JSON.stringify(manifest.similar)).digest("hex") : "";
}

/**
 * Replaces similar_cells with the snapshot's cells and stores the model in app_meta. A snapshot
 * without a model empties both, so an old model is never used with new sales. Returns the rows written.
 */
async function replaceSimilar(tx: Db, manifest: Manifest, cells: readonly SimilarCellRow[] | null, ids: Map<string, number>): Promise<number> {
  await tx.execute(sql`delete from similar_cells`);
  let written = 0;
  if (manifest.similar && cells) {
    const keys = new Map<string, string>();
    for (let at = 0; at < cells.length; at += CELL_BATCH) {
      const batch = cells.slice(at, at + CELL_BATCH).map((c) => {
        const pair = `${c.building}\u0000${c.areaDld}`;
        let key = keys.get(pair);
        if (key === undefined) {
          key = dldKey(c.building, c.areaDld);
          keys.set(pair, key);
        }
        const buildingId = ids.get(key);
        if (buildingId === undefined) throw new SnapshotError(`similar cells: no building for ${c.building} in ${c.areaDld}`);
        return {
          building_id: buildingId,
          bedrooms: c.bedrooms,
          basis: c.completion,
          area_dld: c.areaDld,
          master_project: c.masterProject,
          project_number: c.projectNumber,
          n_raw12: c.nRaw12,
          n12: c.n12,
          med12: c.med12,
          n_old1: c.nOld1,
          med_old1: c.medOld1,
          n_old2: c.nOld2,
          med_old2: c.medOld2,
        };
      });
      await tx.execute(sql`
        insert into similar_cells (building_id, bedrooms, basis, area_dld, master_project, project_number,
                                   n_raw12, n12, med12, n_old1, med_old1, n_old2, med_old2)
        select x.building_id, x.bedrooms, x.basis, x.area_dld, x.master_project, x.project_number,
               x.n_raw12, x.n12, x.med12, x.n_old1, x.med_old1, x.n_old2, x.med_old2
        from json_to_recordset(${JSON.stringify(batch)}::json)
          as x(building_id int, bedrooms smallint, basis text, area_dld text, master_project text, project_number text,
               n_raw12 int, n12 int, med12 double precision, n_old1 int, med_old1 double precision,
               n_old2 int, med_old2 double precision)`);
      written += batch.length;
    }
    const meta: SimilarModelMeta = { ...manifest.similar, snapshotSha256: manifest.snapshotSha256, dataThrough: manifest.dataThrough };
    await setAppMeta(tx, "similar_model", JSON.stringify(meta));
  } else {
    await setAppMeta(tx, "similar_model", "");
  }
  await setAppMeta(tx, "open_data_similar_sha", similarShaOf(manifest));
  return written;
}

/**
 * What app_meta.open_data_acs_sha holds: the SHA-256 of the manifest's `acs` section (the model file's
 * hash and the fit), or "" when the manifest has none. A refit therefore loads too.
 */
export function acsShaOf(manifest: Manifest): string {
  return manifest.acs ? createHash("sha256").update(JSON.stringify(manifest.acs)).digest("hex") : "";
}

/** Stores the adjusted-registered-sales model of the snapshot in app_meta; a snapshot without one empties it. */
async function replaceAcs(tx: Db, manifest: Manifest, model: string | null): Promise<void> {
  await setAppMeta(tx, "acs_model", manifest.acs && model ? model : "");
  await setAppMeta(tx, "open_data_acs_sha", acsShaOf(manifest));
}

/** The `import_batch` of the open-data sales a snapshot inserted or corrected. */
const importBatchOf = (manifest: Manifest) => `open_data:${manifest.snapshotSha256.slice(0, 12)}`;

/**
 * Runs one part of the load against the database. Postgres: every part runs inside the one load
 * transaction. PGlite: each part is its own short transaction (see `loadOpenData`).
 */
type Step = <T>(fn: (tx: Db) => Promise<T>) => Promise<T>;

async function insertSales(
  step: Step,
  file: string,
  manifest: Manifest,
  ids: Map<string, number>,
  batchSize: number,
  correct: boolean,
): Promise<{ rows: number; inserted: number; updated: number }> {
  const importBatch = importBatchOf(manifest);
  const keys = new Map<string, string>();
  let batch: Array<Record<string, string | number | boolean | null>> = [];
  let rows = 0;
  let inserted = 0;
  let updated = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const json = JSON.stringify(batch);
    batch = [];
    await step(async (tx) => {
      const r = await insertBatch(tx, json, importBatch, correct);
      inserted += r.inserted;
      updated += r.updated;
    });
  };
  let sha = "";
  for await (const s of readSnapshotRows(file, (h) => (sha = h))) {
    rows++;
    const pair = `${s.building}\u0000${s.areaDld}`;
    let key = keys.get(pair);
    if (key === undefined) {
      key = dldKey(s.building, s.areaDld);
      keys.set(pair, key);
    }
    const buildingId = ids.get(key);
    if (buildingId === undefined) throw new SnapshotError(`no building for ${s.ref}`);
    batch.push(saleJson(s, buildingId));
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  // The file must not have changed since pass 1 (the transaction rolls back if it did).
  if (sha !== manifest.snapshotSha256) throw new SnapshotError("sales.csv.gz changed while it was loading");
  return { rows, inserted, updated };
}

/** One batch of sales (JSON rows): corrections first when `correct`, then the new refs. */
async function insertBatch(tx: Db, json: string, importBatch: string, correct: boolean): Promise<{ inserted: number; updated: number }> {
  let updated = 0;
  if (correct) {
    // A transaction DLD corrected since the last snapshot (same ref, other values): update it in
    // place. created_at stays, so a correction never counts as "new since you saved". Unchanged
    // rows are not touched (and not locked); admin and import rows are never overwritten.
    const upd = await tx.execute(sql`
      with x as (
        select * from json_to_recordset(${json}::json)
          as x(building_id int, sale_date date, bedrooms smallint, size_sqft double precision,
               price_aed bigint, ref text, completion text, raw text)
      ), u as (
        update sales s set
          building_id = x.building_id, sale_date = x.sale_date, bedrooms = x.bedrooms,
          size_sqft = x.size_sqft, price_aed = x.price_aed, completion = x.completion,
          raw_building_name = x.raw, import_batch = ${importBatch}
        from x
        where s.external_ref = x.ref and s.source = 'open_data'
          and (s.building_id, s.sale_date, s.bedrooms, s.size_sqft, s.price_aed, s.completion, s.raw_building_name)
            is distinct from (x.building_id, x.sale_date, x.bedrooms, x.size_sqft, x.price_aed, x.completion, x.raw)
        returning 1
      )
      select count(*)::int as n from u`);
    updated = countOf(upd);
    // Sales loaded before `has_parking` existed get it now. Not a correction: import_batch and
    // created_at stay, and the row is not counted as updated.
    await tx.execute(sql`
      update sales s set has_parking = x.parking
      from json_to_recordset(${json}::json) as x(ref text, parking boolean)
      where s.external_ref = x.ref and s.source = 'open_data' and x.parking is not null and s.has_parking is distinct from x.parking`);
  }
  const res = await tx.execute(sql`
    with x as (
      select * from json_to_recordset(${json}::json)
        as x(building_id int, sale_date date, bedrooms smallint, size_sqft double precision,
             price_aed bigint, ref text, completion text, raw text, parking boolean)
    ), staged as (
      insert into open_data_refs (ref) select ref from x on conflict do nothing
    ), ins as (
      insert into sales (building_id, sale_date, bedrooms, size_sqft, price_aed, source, completion,
                         external_ref, raw_building_name, import_batch, has_parking)
      select building_id, sale_date, bedrooms, size_sqft, price_aed, 'open_data', completion, ref, raw, ${importBatch}, parking
      from x
      on conflict (external_ref) do nothing
      returning 1
    )
    select count(*)::int as n from ins`);
  return { inserted: countOf(res), updated };
}

/**
 * DLD buildings that are no longer in the snapshot (DLD renamed or respelled the name or its area,
 * so it now has another dld_key) and have no sales of any source left: removed with their aliases,
 * so a zero-sale twin never wins a match. Comparisons keep their stored names (building_id is set to
 * null), and admin-created buildings (no dld_key) are never touched.
 */
async function removeOrphanBuildings(tx: Db, keep: Iterable<number>): Promise<number> {
  const res = await tx.execute(sql`
    with keep as (
      select value::int as id from json_array_elements_text(${JSON.stringify([...keep])}::json)
    ), d as (
      delete from buildings b
      where b.dld_key is not null
        and not exists (select 1 from keep k where k.id = b.id)
        and not exists (select 1 from sales s where s.building_id = b.id)
      returning 1
    )
    select count(*)::int as n from d`);
  return countOf(res);
}

function saleJson(s: NormalisedSale, buildingId: number): Record<string, string | number | boolean | null> {
  return {
    building_id: buildingId,
    sale_date: s.date,
    bedrooms: s.bedrooms,
    size_sqft: s.sizeSqft,
    price_aed: s.priceAed,
    ref: s.ref,
    completion: s.completion,
    raw: s.building,
    parking: s.parking,
  };
}

/**
 * The load itself, as steps (see `Step`). Returns null when this snapshot is already loaded (another
 * instance, or an earlier load in this process, got there first).
 */
async function loadSteps(step: Step, kind: DbKind, file: string, manifest: Manifest, scan: Scan, batchSize: number) {
  // Another instance may have loaded this snapshot while this one waited for the lock.
  if (await step((tx) => alreadyLoaded(tx, manifest))) return null;

  // First load: nothing to correct, so the per-batch UPDATE is skipped.
  const hadOpenData = await step(
    async (tx) => countOf(await tx.execute(sql`select count(*)::int as n from (select 1 from sales where source = 'open_data' limit 1) t`)) > 0,
  );
  const ids = await step(async (tx) => {
    const out = await upsertBuildings(tx, scan.groups.values());
    await addAliases(tx, scan.groups.values(), out);
    return out;
  });
  // The snapshot's refs, for the delete below (a temp table: this session only).
  await step(async (tx) => {
    await tx.execute(sql`create temp table if not exists open_data_refs (ref text primary key)`);
    await tx.execute(sql`truncate open_data_refs`);
  });
  const { rows, inserted, updated } = await insertSales(step, file, manifest, ids, batchSize, hadOpenData);

  return step(async (tx) => {
    const deleted = countOf(
      await tx.execute(sql`
        with d as (
          delete from sales s
          where s.source = 'open_data'
            and not exists (select 1 from open_data_refs r where r.ref = s.external_ref)
          returning 1
        )
        select count(*)::int as n from d`),
    );
    await tx.execute(sql`drop table if exists open_data_refs`);
    const removedBuildings = await removeOrphanBuildings(tx, ids.values());
    if (kind === "postgres") {
      // The sales this transaction added carry its start time (now()), but nobody could see them
      // before the commit: a listing saved while the load ran must still count them as new. Stamp
      // them with the time they become visible.
      await tx.execute(sql`
        update sales set created_at = clock_timestamp()
        where source = 'open_data' and import_batch = ${importBatchOf(manifest)} and created_at = now()`);
    }
    const similarCells = await replaceSimilar(tx, manifest, scan.cells, ids);
    await replaceAcs(tx, manifest, scan.acsModel);
    await setAppMeta(tx, "open_data_sha", manifest.snapshotSha256);
    if (manifest.buildingsFile) await setAppMeta(tx, "open_data_buildings_sha", manifest.buildingsFile.sha256);
    await setAppMeta(tx, "data_from", manifest.dataFrom);
    await setAppMeta(tx, "data_through", manifest.dataThrough);
    await setAppMeta(tx, "data_source", JSON.stringify(dataSourceMeta(manifest)));
    await setAppMeta(tx, "data_imported_at", new Date().toISOString());
    return { rows, inserted, updated, deleted, removedBuildings, buildings: ids.size, similarCells };
  });
}

/** True when the database already holds this snapshot: the sales file and, when there is one, the buildings file. */
async function alreadyLoaded(db: Db, manifest: Manifest): Promise<boolean> {
  if ((await getAppMeta(db, "open_data_sha")) !== manifest.snapshotSha256) return false;
  if (((await getAppMeta(db, "open_data_similar_sha")) ?? "") !== similarShaOf(manifest)) return false;
  if (((await getAppMeta(db, "open_data_acs_sha")) ?? "") !== acsShaOf(manifest)) return false;
  if (!manifest.buildingsFile) return true;
  return (await getAppMeta(db, "open_data_buildings_sha")) === manifest.buildingsFile.sha256;
}

/** PGlite loads in this process, one after another (the PGlite stand-in for the advisory lock). */
let pgliteQueue: Promise<unknown> = Promise.resolve();

function onePgliteLoad<T>(fn: () => Promise<T>): Promise<T> {
  const next = pgliteQueue.then(fn, fn);
  pgliteQueue = next.catch(() => undefined);
  return next;
}

let missingLogged = false;

/** Tests: log `open_data_missing` again. */
export function __resetOpenDataLogForTests(): void {
  missingLogged = false;
}

/**
 * Loads the snapshot when it is new (see the module comment). Throws on any failure. On Postgres
 * nothing is then half-loaded; on PGlite the sales already added stay and the next start finishes.
 */
export async function loadOpenData(opts: LoadOptions = {}): Promise<LoadResult> {
  const started = Date.now();
  const db = opts.db ?? getDb();
  const kind = opts.kind ?? (opts.db ? "pglite" : dbKind());
  const dir = opts.dir ?? openDataDir();
  const batchSize = Math.max(1, Math.trunc(opts.batchSize ?? SALES_BATCH));
  const empty = { rows: 0, inserted: 0, updated: 0, deleted: 0, removedBuildings: 0, buildings: 0, similarCells: 0 };

  const manifest = await readManifest(dir);
  if (!manifest) {
    if (!missingLogged) {
      missingLogged = true;
      log.info("open_data_missing", { dir });
    }
    return { status: "missing", ...empty, ms: Date.now() - started };
  }
  if (await alreadyLoaded(db, manifest)) {
    // The snapshot is the loaded one; the hand-kept marketing names may still have changed.
    await syncMarketNames(db);
    return { status: "up_to_date", skipped: "same_sha", ...empty, ms: Date.now() - started };
  }

  // turbopackIgnore: a runtime data file, not a source path (keeps the build from tracing the whole project).
  const file = path.join(/*turbopackIgnore: true*/ dir, SNAPSHOT_FILE);
  const scan = await scanSnapshot(file, manifest, dir);
  const run = (step: Step) => loadSteps(step, kind, file, manifest, scan, batchSize);

  let done: Awaited<ReturnType<typeof loadSteps>>;
  if (kind === "postgres") {
    // One transaction: people see the old data or the new data, never a mix.
    done = await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      await tx.execute(sql`select pg_advisory_xact_lock(${OPEN_DATA_LOCK_KEY})`);
      return run((fn) => fn(tx));
    });
  } else {
    // PGlite has one connection, and an open transaction holds it: every request, /api/health
    // included, would wait for the whole load (20 to 25 s for 400,000 rows; REAL_DATA.md section 4:
    // the load must not delay the health check). So each part is its own short transaction, and
    // requests run in between. The new sales show batch by batch while data_through and the sha
    // change last; a load that stops part-way left only sales of the new snapshot, and the next
    // start finishes it (every write is idempotent). One load at a time per process.
    done = await onePgliteLoad(async () => {
      try {
        return await run(async (fn) => {
          const out = await db.transaction((txRaw) => fn(txRaw as unknown as Db));
          await new Promise<void>((resolve) => setImmediate(resolve)); // let waiting requests in
          return out;
        });
      } finally {
        await db.execute(sql`drop table if exists open_data_refs`).catch(() => undefined);
      }
    });
  }

  // A load may have brought in a building the list names: add its marketing names now.
  await syncMarketNames(db, { force: true });
  if (!done) {
    log.info("open_data_load_skipped", { reason: "loaded_by_other", sha: manifest.snapshotSha256.slice(0, 12) });
    return { status: "up_to_date", skipped: "loaded_by_other", ...empty, ms: Date.now() - started };
  }
  invalidateAliasCache();
  invalidateDataMeta();
  invalidateFromTheData();
  const out: LoadResult = { status: "loaded", ...done, ms: Date.now() - started };
  log.info("open_data_loaded", {
    sha: manifest.snapshotSha256.slice(0, 12),
    dataFrom: manifest.dataFrom,
    dataThrough: manifest.dataThrough,
    rows: out.rows,
    inserted: out.inserted,
    updated: out.updated,
    deleted: out.deleted,
    removedBuildings: out.removedBuildings,
    buildings: out.buildings,
    similarCells: out.similarCells,
    ms: out.ms,
  });
  return out;
}

/**
 * Starts `loadOpenData()` without waiting for it (src/instrumentation.ts). Never throws and never
 * rejects: failures are logged as `open_data_load_failed`. Returns the promise for tests.
 */
export function startOpenDataLoad(opts: LoadOptions = {}): Promise<LoadResult | null> {
  return loadOpenData(opts).catch((err: unknown) => {
    log.error("open_data_load_failed", { err });
    return null;
  });
}
