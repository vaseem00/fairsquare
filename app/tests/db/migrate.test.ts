import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, is, sql } from "drizzle-orm";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { getAppMeta, getAppMetas, setAppMeta } from "@/lib/db/meta";
import { applyMigrations, migrateAndSeed, migrationsFolder } from "@/lib/db/migrate";
import * as schema from "@/lib/db/schema";
import { anonUsers, buildingAliases, buildings, checks, sales, savedListings } from "@/lib/db/schema";
import { addDays, analyse, findCandidates, inWindow, preselect, type AliasRow } from "@/lib/domain";
import { TEST_BUILDINGS, TEST_TODAY } from "../fixtures/test-buildings";
import { createTestDb, type TestDb } from "../helpers/db";
import { seedCounts, seedTestBuildings, testAliases } from "../helpers/seed-test-data";

const TODAY = TEST_TODAY;

async function rows<T>(db: Db, q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(q)) as unknown as { rows: T[] }).rows;
}

describe("test seed (tests/helpers/seed-test-data.ts)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ today: TODAY });
  });
  afterAll(() => t.close());

  it("creates 6 buildings, 9 aliases and 32 ready open_data sales, and the data range", async () => {
    expect(await seedCounts(t.db)).toEqual({ buildings: 6, aliases: 9, sales: 32 });
    expect(TEST_BUILDINGS.reduce((n, b) => n + testAliases(b).length, 0)).toBe(9);
    const all = await t.db.select().from(sales);
    expect(all.every((s) => s.source === "open_data" && s.completion === "ready" && s.externalRef?.startsWith("test:"))).toBe(true);
    const meta = await getAppMetas(t.db, ["data_from", "data_through"]);
    expect(meta.get("data_through")?.value).toBe(TODAY);
    expect(meta.get("data_from")?.value).toBe(addDays(TODAY, -340));
    const [b] = await t.db.select().from(buildings).where(eq(buildings.name, "Mockup Crest Tower"));
    expect(b).toMatchObject({ area: "Dubai Marina", areaDld: "Marsa Dubai", dldKey: "mockup crest tower|marsa dubai" });
  });

  it("a second run adds nothing", async () => {
    expect(await seedTestBuildings(t.db, TODAY)).toBe(0);
    expect(await seedCounts(t.db)).toEqual({ buildings: 6, aliases: 9, sales: 32 });
  });

  it("dates sales relative to today", async () => {
    const [mct] = await t.db.select().from(buildings).where(eq(buildings.name, "Mockup Crest Tower"));
    const list = await t.db.select().from(sales).where(eq(sales.buildingId, mct.id));
    expect(list.map((r) => r.saleDate).sort().at(-1)).toBe(addDays(TODAY, -40));
    expect(list.every((r) => r.bedrooms === 2)).toBe(true);
  });

  it("keeps the known results: Mockup Crest above (11), Fake Vista in line (9), Dummyside thin (2)", async () => {
    const aliasRows: AliasRow[] = await t.db
      .select({ buildingId: buildingAliases.buildingId, aliasNorm: buildingAliases.aliasNorm, name: buildings.name, area: buildings.area })
      .from(buildingAliases)
      .innerJoin(buildings, eq(buildings.id, buildingAliases.buildingId));
    const cases = [
      { q: "Mockup Crest Tower", area: "Dubai Marina", beds: 2, size: 1284, price: 2_450_000, name: "Mockup Crest Tower", band: "above", count: 11 },
      { q: "Fake Vista Residences", area: "Jumeirah Village Circle", beds: 1, size: 742, price: 865_000, name: "Fake Vista Residences", band: "inline", count: 9 },
      { q: "Dummyside Heights 2", area: "Al Jaddaf", beds: 3, size: 1905, price: 3_600_000, name: "Dummyside Heights 2", band: "thin", count: 2 },
    ];
    for (const c of cases) {
      const cands = findCandidates(c.q, aliasRows, c.area);
      const id = preselect(cands);
      expect(cands.find((x) => x.buildingId === id)?.name).toBe(c.name);
      const list = await t.db
        .select({ saleDate: sales.saleDate, sizeSqft: sales.sizeSqft, priceAed: sales.priceAed })
        .from(sales)
        .where(and(eq(sales.buildingId, id as number), eq(sales.bedrooms, c.beds)));
      const a = analyse(c.price, c.size, inWindow(list, TODAY, 365));
      expect({ band: a.band, count: a.count }).toEqual({ band: c.band, count: c.count });
    }
    expect(findCandidates("Nowhere Point Tower", aliasRows, "Dubai Creek Harbour")).toEqual([]);
  });

  it("app meta get/set upserts; getAppMetas reads several keys", async () => {
    expect(await getAppMeta(t.db, "data_imported_at")).toBeNull();
    await setAppMeta(t.db, "data_imported_at", "2026-11-01T00:00:00Z");
    await setAppMeta(t.db, "data_imported_at", "2026-11-02T00:00:00Z");
    expect(await getAppMeta(t.db, "data_imported_at")).toBe("2026-11-02T00:00:00Z");
    const m = await getAppMetas(t.db, ["data_imported_at", "open_data_sha"]);
    expect(m.get("data_imported_at")?.value).toBe("2026-11-02T00:00:00Z");
    expect(m.get("data_imported_at")?.updatedAt).toBeInstanceOf(Date);
    expect(m.has("open_data_sha")).toBe(false);
    expect((await getAppMetas(t.db, [])).size).toBe(0);
  });
});

describe("migrateAndSeed", () => {
  it("migrates without seeding anything and purges saved listings removed more than 30 days ago", async () => {
    const t = await createTestDb({ seed: false });
    try {
      const first = await migrateAndSeed({ db: t.db, kind: "pglite" });
      expect(first.kind).toBe("pglite");
      expect(await seedCounts(t.db)).toEqual({ buildings: 0, aliases: 0, sales: 0 });

      const anonId = "11111111-1111-4111-8111-111111111111";
      await t.db.insert(anonUsers).values({ id: anonId });
      const base = {
        anonId,
        buildingText: "Mockup Crest",
        bedrooms: 2,
        sizeSqft: 1284,
        priceAed: 2_450_000,
        source: "manual" as const,
        band: "above" as const,
        askingPsf: 1908.1,
        windowStart: "2025-11-17",
        windowEnd: TODAY,
        minSales: 5,
        bandPct: 5,
      };
      const inserted = await t.db
        .insert(checks)
        .values([
          { ...base, code: "AAAAA2" },
          { ...base, code: "AAAAA3" },
          { ...base, code: "AAAAA4" },
        ])
        .returning({ id: checks.id, completionBasis: checks.completionBasis, outliersDropped: checks.outliersDropped, dataThrough: checks.dataThrough });
      expect(inserted[0]).toMatchObject({ completionBasis: "ready", outliersDropped: 0, dataThrough: null });
      const saved = (checkId: number, removedDaysAgo: number | null) => ({
        anonId,
        checkId,
        bandAtSave: "above",
        countAtSave: 11,
        removedAt: removedDaysAgo === null ? null : new Date(Date.now() - removedDaysAgo * 86_400_000),
      });
      await t.db.insert(savedListings).values([saved(inserted[0].id, 31), saved(inserted[1].id, 5), saved(inserted[2].id, null)]);

      const again = await migrateAndSeed({ db: t.db, kind: "pglite" });
      expect(again.purged.savedListings).toBe(1);
      const left = await t.db.select({ checkId: savedListings.checkId }).from(savedListings);
      expect(left.map((r) => r.checkId).sort()).toEqual([inserted[1].id, inserted[2].id].sort());
    } finally {
      await t.close();
    }
  });
});

/**
 * A fresh PGlite with only the first `n` migrations applied (the database of an older deploy).
 * Returns the client, its db and the temporary migrations folder (removed by the caller).
 */
async function oldStateDb(n: number): Promise<{ client: PGlite; db: Db; tmp: string }> {
  const tmp = mkdtempSync(path.join(tmpdir(), "fairsquare-mig-"));
  const src = migrationsFolder();
  mkdirSync(path.join(tmp, "meta"));
  const journal = JSON.parse(readFileSync(path.join(src, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(0, n);
  for (const e of journal.entries) copyFileSync(path.join(src, `${e.tag}.sql`), path.join(tmp, `${e.tag}.sql`));
  writeFileSync(path.join(tmp, "meta", "_journal.json"), JSON.stringify(journal));
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await applyMigrations(db, "pglite", tmp);
  return { client, db, tmp };
}

describe("migrateAndSeed on a database in the old (demo) state (REAL_DATA.md section 8)", () => {
  let client: PGlite;
  let db: Db;
  let tmp: string;
  const ANON = "22222222-2222-4222-8222-222222222222";
  const OTHER = "33333333-3333-4333-8333-333333333333";

  beforeAll(async () => {
    // Apply 0000 and 0001 only, add rows the way the old code wrote them (the demo seed, demo-mode
    // checks, sample checks, demo leads, requests), then boot: migrateAndSeed applies 0002 onwards.
    ({ client, db, tmp } = await oldStateDb(2));

    // The old demo seed: buildings flagged is_demo, aliases with source 'seed', sales with source
    // 'demo' and is_demo, and the demo_anchor_date. Plus one real (admin) building.
    await db.execute(sql`
      insert into buildings (id, name, area, project, master_project, is_demo) values
        (1, 'TEST DEMO TOWER', 'Test Area', 'TEST DEMO PROJECT', null, true),
        (2, 'TEST REAL TOWER', 'Test Area', null, null, false),
        (3, 'TEST DEMO HEIGHTS', 'Test Area East', null, 'TEST DEMO MASTER', true)`);
    await db.execute(sql`select setval('buildings_id_seq', 10)`);
    await db.execute(sql`
      insert into building_aliases (building_id, alias_raw, alias_norm, source) values
        (1, 'TEST DEMO TOWER', 'test demo tower', 'seed'), (1, 'Demo Twr', 'demo twr', 'seed'),
        (2, 'TEST REAL TOWER', 'test real tower', 'admin'), (3, 'TEST DEMO HEIGHTS', 'test demo heights', 'seed')`);
    await db.execute(sql`
      insert into sales (building_id, sale_date, bedrooms, size_sqft, price_aed, source, is_demo, external_ref) values
        (1, '2026-10-01', 2, 1000, 1500000, 'demo', true, null),
        (3, '2026-10-01', 3, 1900, 3500000, 'demo', true, null),
        (2, '2026-10-02', 2, 1000, 1500000, 'admin', true, null),
        (2, '2026-10-03', 2, 1000, 1500000, 'admin', false, 'ADM-1'),
        (2, '2026-10-04', 1, 700, 900000, 'import', false, 'IMP-1')`);
    await db.execute(sql`insert into anon_users (id) values (${ANON}), (${OTHER})`);
    const check = (code: string, buildingId: number | null, isDemo: boolean, isSample: boolean) => sql`
      insert into checks (code, anon_id, building_id, building_name, building_area, building_text, bedrooms, size_sqft,
                          price_aed, source, band, asking_psf, window_start, window_end, min_sales, band_pct, is_demo, is_sample)
      values (${code}, ${ANON}, ${buildingId}, ${buildingId === null ? null : "x"}, ${buildingId === null ? null : "Test Area"}, 'x', 2,
              1000, 1500000, 'manual', ${buildingId === null ? "none" : "above"}, 1500, '2025-11-17', '2026-11-17', 3, 5, ${isDemo}, ${isSample})`;
    await db.execute(check("DEMO01", 1, true, false)); // made while DEMO_MODE was on
    await db.execute(check("SAMPL1", 1, true, true)); // a sample listing
    await db.execute(check("SAMPL2", 2, false, true));
    await db.execute(check("LIVE01", 2, false, false));
    await db.execute(check("LIVE02", 1, false, false)); // a real person's comparison of a demo building
    await db.execute(check("LIVE03", null, false, false)); // "None of these"
    await db.execute(sql`
      insert into saved_listings (anon_id, check_id, band_at_save, count_at_save)
      select anon_id, id, band, 3 from checks`);
    const lead = (isDemo: boolean, code: string, version: string, partner: string) => sql`
      insert into leads (anon_id, check_id, partner, consent_version, consent_text, consent_text_sha256, consented_at,
                         ip_hash, building_name, bedrooms, size_sqft, price_aed, down_pct, rate_pct, years,
                         loan_estimate_aed, monthly_estimate_aed, is_demo)
      select anon_id, id, ${partner}, ${version}, 'text', 'sha', now(), 'ip', 'x', 2, 1000, 1500000, 20, 4.25, 25, 1, 1, ${isDemo}
      from checks where code = ${code}`;
    await db.execute(lead(true, "DEMO01", "optin-v1-demo", "Test Demo Partner"));
    await db.execute(lead(false, "LIVE01", "optin-v1", "Test Partner"));
    // Building requests: one an admin resolved to a demo building, one to the real building, one open.
    const request = (anon: string, text: string, resolved: number | null, code: string | null) => sql`
      insert into building_requests (anon_id, text_raw, text_norm, source, check_id, resolved_building_id)
      values (${anon}, ${text}, ${text.toLowerCase()}, ${code ? "none_of_these" : "request_form"},
              ${code ? sql`(select id from checks where code = ${code})` : null}, ${resolved})`;
    await db.execute(request(ANON, "TEST ASKED ONE", 1, "LIVE03"));
    await db.execute(request(OTHER, "TEST ASKED TWO", 2, null));
    await db.execute(request(OTHER, "TEST ASKED THREE", null, null));
    await db.execute(sql`
      insert into events (name, anon_id, check_id, meta)
      select 'check_created', anon_id, id, '{"band":"above"}'::jsonb from checks where code in ('DEMO01', 'LIVE01')`);
    await db.execute(sql`insert into app_meta (key, value) values ('demo_anchor_date', '2026-11-17'), ('data_imported_at', '2026-11-01')`);

    // The boot path, exactly as src/instrumentation.ts runs it.
    await migrateAndSeed({ db, kind: "pglite" });
  });
  afterAll(async () => {
    await client.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("deletes the demo rows first: demo leads, demo and sample checks, demo buildings, demo sales, the anchor", async () => {
    expect((await db.select().from(buildings)).map((b) => b.name)).toEqual(["TEST REAL TOWER"]);
    expect((await db.select().from(buildingAliases)).map((a) => a.aliasNorm)).toEqual(["test real tower"]);
    expect((await db.select().from(sales)).map((s) => s.externalRef).sort()).toEqual(["ADM-1", "IMP-1"]);
    const left = await db.select().from(checks);
    expect(left.map((c) => c.code).sort()).toEqual(["LIVE01", "LIVE02", "LIVE03"]);
    // LIVE02 pointed at the demo building: kept, with the building link cleared.
    expect(left.find((c) => c.code === "LIVE02")?.buildingId).toBeNull();
    // Saved listings of the deleted checks went with them (cascade).
    expect((await db.select().from(savedListings)).map((s) => s.checkId).sort()).toEqual(left.map((c) => c.id).sort());
    const leads = await rows<{ consent_version: string; partner: string }>(db, sql`select consent_version, partner from leads`);
    expect(leads).toEqual([{ consent_version: "optin-v1", partner: "Test Partner" }]);
    expect(await getAppMeta(db, "data_imported_at")).toBe("2026-11-01");
    expect((await rows(db, sql`select 1 from app_meta where key = 'demo_anchor_date'`)).length).toBe(0);
    // Nobody is deleted: the anonymous people stay.
    expect((await db.select().from(anonUsers)).length).toBe(2);
  });

  it("building requests survive; one resolved to a demo building is open again (resolved_building_id null)", async () => {
    const reqs = await rows<{ text_raw: string; resolved_building_id: number | null; check_id: number | null }>(
      db,
      sql`select text_raw, resolved_building_id, check_id from building_requests order by text_raw`,
    );
    const live03 = (await db.select().from(checks).where(eq(checks.code, "LIVE03")))[0];
    expect(reqs).toEqual([
      { text_raw: "TEST ASKED ONE", resolved_building_id: null, check_id: live03.id },
      { text_raw: "TEST ASKED THREE", resolved_building_id: null, check_id: null },
      { text_raw: "TEST ASKED TWO", resolved_building_id: 2, check_id: null },
    ]);
    // Events of deleted checks stay as counts, unlinked from the check.
    const ev = await rows<{ check_id: number | null }>(db, sql`select check_id from events order by id`);
    expect(ev.map((e) => e.check_id === null)).toEqual([true, false]);
  });

  it("the resulting tables, columns, types, nullability, indexes and checks match schema.ts", async () => {
    const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable)).map((tb) => getTableConfig(tb));
    const info = await rows<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      db,
      sql`select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public'`,
    );
    const dbTables = [...new Set(info.map((c) => c.table_name))].sort();
    expect(dbTables).toEqual(tables.map((tb) => tb.name).sort());
    const sqlType = (c: PgColumn) => {
      const t = c.getSQLType();
      if (t.endsWith("[]")) return "ARRAY";
      return ({ serial: "integer", bigserial: "bigint" } as Record<string, string>)[t] ?? t;
    };
    for (const tb of tables) {
      const want = tb.columns.map((c) => `${c.name} ${sqlType(c)} ${c.notNull ? "NO" : "YES"}`).sort();
      const got = info
        .filter((c) => c.table_name === tb.name)
        .map((c) => `${c.column_name} ${c.data_type} ${c.is_nullable}`)
        .sort();
      expect(got, tb.name).toEqual(want);
    }
    const idx = new Set((await rows<{ indexname: string }>(db, sql`select indexname from pg_indexes where schemaname = 'public'`)).map((r) => r.indexname));
    const checksDb = new Set(
      (await rows<{ conname: string }>(db, sql`select conname from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' and contype = 'c'`)).map(
        (r) => r.conname,
      ),
    );
    for (const tb of tables) {
      for (const i of tb.indexes) expect(idx.has(i.config.name as string), `${tb.name}: index ${i.config.name}`).toBe(true);
      for (const c of tb.checks) expect(checksDb.has(c.name), `${tb.name}: check ${c.name}`).toBe(true);
    }
    // The unique constraint on buildings.name is gone; no check constraint the schema doesn't declare is left.
    expect(idx.has("buildings_name_unique")).toBe(false);
    expect([...checksDb].sort()).toEqual(tables.flatMap((tb) => tb.checks.map((c) => c.name)).sort());
  });

  it("drops the demo and sample flags and adds the new columns with their defaults", async () => {
    const cols = await rows<{ table_name: string; column_name: string }>(
      db,
      sql`select table_name, column_name from information_schema.columns
          where table_schema = 'public' and column_name in ('is_demo', 'is_sample', 'completion', 'raw_building_name',
            'dld_key', 'area_dld', 'completion_basis', 'outliers_dropped', 'data_through', 'median_size_sqft')
          order by table_name, column_name`,
    );
    // checks.median_size_sqft comes from migration 0003 (the size check, REAL_DATA.md section 7).
    expect(cols.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
      "buildings.area_dld",
      "buildings.dld_key",
      "checks.completion",
      "checks.completion_basis",
      "checks.data_through",
      "checks.median_size_sqft",
      "checks.outliers_dropped",
      "sales.completion",
      "sales.raw_building_name",
      // Migration 0007: the similar-buildings cells carry their DLD area (REAL_DATA.md section 15).
      "similar_cells.area_dld",
    ]);
    const [s] = await db.select().from(sales).where(eq(sales.externalRef, "ADM-1"));
    expect(s).toMatchObject({ completion: "ready", rawBuildingName: null, source: "admin" });
    const [c] = await db.select().from(checks).where(eq(checks.code, "LIVE01"));
    expect(c).toMatchObject({ completionBasis: "ready", outliersDropped: 0, dataThrough: null, medianSizeSqft: null });
  });

  it("sales.source and sales.completion are checked; names repeat but dld_key is unique when set", async () => {
    await expect(
      db.execute(sql`insert into sales (building_id, sale_date, bedrooms, size_sqft, price_aed, source) values (2, '2026-10-05', 2, 1000, 1500000, 'demo')`),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.execute(
        sql`insert into sales (building_id, sale_date, bedrooms, size_sqft, price_aed, source, completion) values (2, '2026-10-05', 2, 1000, 1500000, 'open_data', 'unknown')`,
      ),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await db.insert(buildings).values([
      { name: "TEST TOWER A", area: "Test Area North", dldKey: "test tower a|north" },
      { name: "TEST TOWER A", area: "Test Area South", dldKey: "test tower a|south" },
      { name: "TEST TOWER A", area: "Test Area South" },
      { name: "TEST TOWER A", area: "Test Area South" },
    ]);
    await expect(db.insert(buildings).values({ name: "TEST TOWER B", area: "x", dldKey: "test tower a|north" })).rejects.toMatchObject({
      cause: { code: "23505" },
    });
  });
});

describe("migration 0004 (checks.building_area_dld, REAL_DATA.md section 6)", () => {
  it("adds the column and fills it for comparisons made before it existed, from their building", async () => {
    const { client, db, tmp } = await oldStateDb(4);
    try {
      await db.execute(sql`
        insert into buildings (id, name, area, area_dld, dld_key) values
          (1, 'Test Tower A', 'Dubai Marina', 'Marsa Dubai', 'test tower a|marsa dubai'),
          (2, 'TEST ADMIN TOWER', 'Test Area', null, null)`);
      await db.execute(sql`insert into anon_users (id) values ('44444444-4444-4444-8444-444444444444')`);
      const check = (code: string, buildingId: number | null) => sql`
        insert into checks (code, anon_id, building_id, building_text, bedrooms, size_sqft, price_aed, source, band,
                            asking_psf, window_start, window_end, min_sales, band_pct)
        values (${code}, '44444444-4444-4444-8444-444444444444', ${buildingId}, 'x', 2, 1000, 1500000, 'manual', 'above',
                1500, '2025-11-17', '2026-11-17', 5, 5)`;
      await db.execute(check("AREA01", 1));
      await db.execute(check("AREA02", 2));
      await db.execute(check("AREA03", null));
      await migrateAndSeed({ db, kind: "pglite" });
      const got = await db.select({ code: checks.code, areaDld: checks.buildingAreaDld }).from(checks).orderBy(checks.code);
      expect(got).toEqual([
        { code: "AREA01", areaDld: "Marsa Dubai" },
        { code: "AREA02", areaDld: null },
        { code: "AREA03", areaDld: null },
      ]);
    } finally {
      await client.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("migration 0005 (checks.set_aside_snapshot and checks.size_source, RESULT_SPEC section 12.2)", () => {
  it("adds both columns; comparisons stored before them keep working with no set-aside sales and no size source", async () => {
    const { client, db, tmp } = await oldStateDb(5);
    try {
      await db.execute(sql`insert into anon_users (id) values ('55555555-5555-4555-8555-555555555555')`);
      await db.execute(sql`
        insert into checks (code, anon_id, building_text, bedrooms, size_sqft, price_aed, source, band, asking_psf,
                            window_start, window_end, min_sales, band_pct, outliers_dropped)
        values ('OLD005', '55555555-5555-4555-8555-555555555555', 'x', 2, 1000, 1500000, 'manual', 'above', 1500,
                '2025-11-17', '2026-11-17', 5, 5, 1)`);
      await migrateAndSeed({ db, kind: "pglite" });
      const [row] = await db.select().from(checks).where(eq(checks.code, "OLD005"));
      expect(row).toMatchObject({ setAsideSnapshot: [], sizeSource: null, outliersDropped: 1 });
    } finally {
      await client.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
