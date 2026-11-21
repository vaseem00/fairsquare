/**
 * The open-data loader (REAL_DATA.md section 4) against in-memory PGlite, with snapshots built from
 * the synthetic Data.Dubai fixture by the real `buildSnapshot`.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { getAppMeta, getAppMetas } from "@/lib/db/meta";
import { ensureAnonUser } from "@/lib/db/repo/anon";
import { getAliasRows } from "@/lib/db/repo/buildings";
import { listSaved, saveCheck } from "@/lib/db/repo/saved";
import { buildingAliases, buildings, checks, sales } from "@/lib/db/schema";
import { DEFAULT_RULES } from "@/lib/domain/analyse";
import { findCandidates } from "@/lib/domain/match";
import { buildSnapshot } from "@/lib/ingest/build";
import { getDataSourcePanel } from "@/lib/ingest/data-source";
import { __resetOpenDataLogForTests, loadOpenData, startOpenDataLoad } from "@/lib/ingest/load";
import { readManifest } from "@/lib/ingest/snapshot";
import { __setLogSinkForTests } from "@/lib/log";
import { createTestDb, type TestDb } from "../helpers/db";

const SAMPLE = path.join(process.cwd(), "tests", "fixtures", "data-dubai", "transactions-sample.csv");
const SAMPLE_TEXT = readFileSync(SAMPLE, "utf8");
const root = mkdtempSync(path.join(tmpdir(), "fairsquare-load-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
/** Builds a snapshot folder from CSV text (the fixture by default). */
async function snapshot(csvText: string = SAMPLE_TEXT): Promise<string> {
  const dir = path.join(root, `snap-${++n}`);
  const csv = path.join(root, `in-${n}.csv`);
  writeFileSync(csv, csvText, "utf8");
  await buildSnapshot({ inputs: [csv], datasetUrl: "https://data.dubai/en/test-dataset", datasetTitle: "TEST Transactions", downloadedOn: "2026-11-18", outDir: dir });
  return dir;
}

/** The fixture without the row of transaction `dropTx` and with one more ready 2-bed sale in TEST TOWER A. */
function variant(dropTx: string, addTx: string, addDate: string): string {
  const lines = SAMPLE_TEXT.split("\r\n");
  const keptTemplate = lines.find((l) => l.startsWith("1-11-2026-101,")) as string;
  const out = lines.filter((l) => !l.startsWith(`${dropTx},`));
  out.splice(2, 0, keptTemplate.replace("1-11-2026-101,", `${addTx},`).replace("2026-10-15 00:00:00", addDate));
  return out.join("\r\n");
}

const pause = () => new Promise((r) => setTimeout(r, 25));

async function openDataSales(db: Db) {
  return db.select().from(sales).where(eq(sales.source, "open_data"));
}

describe("loadOpenData", () => {
  let t: TestDb;
  let first: string;
  beforeAll(async () => {
    t = await createTestDb({ seed: false });
    first = await snapshot();
  });
  afterAll(() => t.close());

  it("loads buildings (display names, areas, dld_key), aliases, sales and app_meta in one go", async () => {
    // Warm the 60 s alias cache: the load must invalidate it.
    expect(await getAliasRows(t.db)).toEqual([]);
    const r = await loadOpenData({ db: t.db, dir: first });
    expect(r).toMatchObject({ status: "loaded", rows: 12, inserted: 12, deleted: 0, buildings: 4 });

    const bs = await t.db.select().from(buildings).orderBy(buildings.id);
    expect(bs.map((b) => [b.name, b.area, b.areaDld, b.dldKey]).sort()).toEqual(
      [
        ["Test Tower A", "Dubai Marina", "Marsa Dubai", "test tower a|marsa dubai"],
        ["Test Tower A", "Jumeirah Village Circle (JVC)", "Al Barsha South Fourth", "test tower a|al barsha south fourth"],
        ["Test Tower B", "Jumeirah Village Circle (JVC)", "Al Barsha South Fourth", "test tower b|al barsha south fourth"],
        ["The Residences at Test Gate 1", "Dubai Marina", "Marsa Dubai", "residences at test gate 1|marsa dubai"],
      ].sort(),
    );
    const a = bs.find((b) => b.dldKey === "test tower a|marsa dubai");
    expect(a).toMatchObject({ project: "TEST PROJECT A", masterProject: "TEST MASTER ONE" });

    const aliases = await t.db.select().from(buildingAliases);
    expect(aliases.every((x) => x.source === "import")).toBe(true);
    const gate = bs.find((b) => b.dldKey?.startsWith("residences at test gate 1"));
    expect(aliases.filter((x) => x.buildingId === gate?.id).map((x) => x.aliasRaw)).toEqual(["THE RESIDENCES AT TEST GATE 1", "Test Gate 1"]);
    expect(aliases.filter((x) => x.buildingId === a?.id).map((x) => [x.aliasRaw, x.aliasNorm])).toEqual([
      ["TEST TOWER A", "test tower a"],
      ["Test A", "test a"],
    ]);

    // Matching sees the new aliases at once (the cache was invalidated), and both towers named
    // "Test Tower A" come back with their own areas.
    const rows = await getAliasRows(t.db);
    expect(rows.length).toBe(aliases.length);
    const cands = findCandidates("Test Gate 1", rows, "Dubai Marina");
    expect(cands[0]).toMatchObject({ name: "The Residences at Test Gate 1", strength: "strong" });
    const towerA = findCandidates("Test Tower A", rows, null).filter((c) => c.name === "Test Tower A");
    expect(towerA.map((c) => c.area).sort()).toEqual(["Dubai Marina", "Jumeirah Village Circle (JVC)"]);

    const ss = await openDataSales(t.db);
    expect(ss).toHaveLength(12);
    const s101 = ss.find((s) => s.externalRef === "dld:1-11-2026-101");
    expect(s101).toMatchObject({
      buildingId: a?.id,
      saleDate: "2026-10-15",
      bedrooms: 2,
      sizeSqft: 1189.41,
      priceAed: 2_200_000,
      completion: "ready",
      rawBuildingName: "TEST TOWER A",
    });
    expect(s101?.importBatch).toMatch(/^open_data:[0-9a-f]{12}$/);
    expect(ss.filter((s) => s.completion === "off_plan").map((s) => s.externalRef).sort()).toEqual(["dld:1-11-2026-102", "dld:1-11-2026-103"]);
    expect(ss.find((s) => s.externalRef === "dld:1-11-2026-104")?.rawBuildingName).toBe("TEST TOWER B");

    const manifest = await readManifest(first);
    const meta = await getAppMetas(t.db, ["open_data_sha", "data_from", "data_through", "data_source", "data_imported_at"]);
    expect(meta.get("open_data_sha")?.value).toBe(manifest?.snapshotSha256);
    expect(meta.get("data_from")?.value).toBe("2023-10-16");
    expect(meta.get("data_through")?.value).toBe("2026-10-15");
    const source = JSON.parse(meta.get("data_source")?.value ?? "{}") as Record<string, unknown>;
    expect(source).not.toHaveProperty("counts");
    expect(source).toMatchObject({ datasetTitle: "TEST Transactions", licence: "Dubai Open Data Licence", buildings: 4 });
    expect(Number.isNaN(Date.parse(meta.get("data_imported_at")?.value ?? ""))).toBe(false);
  });

  it("skips a snapshot it already loaded (same sha) and changes nothing", async () => {
    const before = await openDataSales(t.db);
    const r = await loadOpenData({ db: t.db, dir: first });
    expect(r).toMatchObject({ status: "up_to_date", skipped: "same_sha", inserted: 0, deleted: 0 });
    const after = await openDataSales(t.db);
    expect(after.map((s) => [s.id, s.createdAt.getTime()])).toEqual(before.map((s) => [s.id, s.createdAt.getTime()]));
  });

  it("a new snapshot adds new refs, keeps created_at of existing ones, deletes vanished refs and leaves admin sales alone", async () => {
    const [b] = await t.db.select().from(buildings).where(eq(buildings.dldKey, "test tower a|marsa dubai"));
    await t.db.insert(sales).values({ buildingId: b.id, saleDate: "2026-10-01", bedrooms: 2, sizeSqft: 1200, priceAed: 2_000_000, source: "admin", externalRef: "ADMIN-1" });
    const before = new Map((await openDataSales(t.db)).map((s) => [s.externalRef, s.createdAt.getTime()]));
    await pause();
    const second = await snapshot(variant("1-11-2026-110", "9-11-2026-900", "2026-10-14 00:00:00"));
    const r = await loadOpenData({ db: t.db, dir: second });
    expect(r).toMatchObject({ status: "loaded", rows: 12, inserted: 1, deleted: 1, buildings: 4 });

    const after = await openDataSales(t.db);
    expect(after.map((s) => s.externalRef).sort()).toEqual(
      [...before.keys()].filter((ref) => ref !== "dld:1-11-2026-110").concat("dld:9-11-2026-900").sort(),
    );
    for (const s of after) {
      if (s.externalRef === "dld:9-11-2026-900") expect(s.createdAt.getTime()).toBeGreaterThan(Math.max(...before.values()));
      else expect(s.createdAt.getTime()).toBe(before.get(s.externalRef));
    }
    expect(await t.db.select().from(sales).where(eq(sales.externalRef, "ADMIN-1"))).toHaveLength(1);
    // Same buildings: upserted by dld_key, not duplicated.
    expect(await t.db.select().from(buildings)).toHaveLength(4);
    expect(await getAppMeta(t.db, "open_data_sha")).toBe((await readManifest(second))?.snapshotSha256);
  });

  it("the Postgres path (advisory lock, then the sha check again) runs too", async () => {
    const third = await snapshot(variant("1-11-2026-111", "9-11-2026-901", "2026-10-13"));
    const r = await loadOpenData({ db: t.db, dir: third, kind: "postgres", batchSize: 5 });
    expect(r).toMatchObject({ status: "loaded", inserted: 2, deleted: 2 });
  });
});

describe("loadOpenData: concurrency, failures and the boot wrapper", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ seed: false });
  });
  afterAll(() => t.close());

  it("a second instance loading the same snapshot at the same time skips (sha checked again inside)", async () => {
    const dir = await snapshot();
    const results = await Promise.all([loadOpenData({ db: t.db, dir }), loadOpenData({ db: t.db, dir })]);
    expect(results.map((r) => r.status).sort()).toEqual(["loaded", "up_to_date"]);
    expect(results.find((r) => r.status === "up_to_date")?.skipped).toMatch(/^(same_sha|loaded_by_other)$/);
    expect(await openDataSales(t.db)).toHaveLength(12);
  });

  it("no manifest: nothing to do, open_data_missing logged once", async () => {
    const lines: string[] = [];
    __setLogSinkForTests((_l, line) => lines.push(line));
    process.env.LOG_LEVEL = "info";
    __resetOpenDataLogForTests();
    try {
      const empty = mkdtempSync(path.join(root, "empty-"));
      expect(await loadOpenData({ db: t.db, dir: empty })).toMatchObject({ status: "missing", rows: 0 });
      expect(await loadOpenData({ db: t.db, dir: empty })).toMatchObject({ status: "missing" });
      expect(lines.filter((l) => l.includes('"open_data_missing"'))).toHaveLength(1);
    } finally {
      __setLogSinkForTests(null);
      process.env.LOG_LEVEL = "error";
    }
  });

  it("a snapshot that does not match its manifest is refused before anything is written; the wrapper only logs", async () => {
    const dir = await snapshot(variant("1-11-2026-105", "9-11-2026-902", "2026-10-12"));
    const gz = path.join(dir, "sales.csv.gz");
    const bytes = readFileSync(gz);
    bytes[bytes.length - 5] ^= 0xff;
    writeFileSync(gz, bytes);
    const before = (await openDataSales(t.db)).length;
    await expect(loadOpenData({ db: t.db, dir })).rejects.toThrow();

    const lines: string[] = [];
    __setLogSinkForTests((_l, line) => lines.push(line));
    try {
      await expect(startOpenDataLoad({ db: t.db, dir })).resolves.toBeNull();
      expect(lines.some((l) => l.includes('"open_data_load_failed"'))).toBe(true);
    } finally {
      __setLogSinkForTests(null);
    }
    expect((await openDataSales(t.db)).length).toBe(before);
    expect(await getAppMeta(t.db, "open_data_sha")).not.toBe((await readManifest(dir))?.snapshotSha256);
  });

  it("a snapshot whose row count differs from the manifest is refused", async () => {
    const dir = await snapshot(variant("1-11-2026-106", "9-11-2026-903", "2026-10-11"));
    const mf = path.join(dir, "manifest.json");
    const m = JSON.parse(readFileSync(mf, "utf8")) as { counts: { kept: number } };
    m.counts.kept = 13;
    writeFileSync(mf, JSON.stringify(m));
    await expect(loadOpenData({ db: t.db, dir })).rejects.toThrow(/has 12 rows; the manifest says 13/);
  });

  it("an invalid manifest fails the load (logged by the wrapper, never thrown)", async () => {
    const dir = mkdtempSync(path.join(root, "bad-"));
    writeFileSync(path.join(dir, "manifest.json"), "{}");
    await expect(loadOpenData({ db: t.db, dir })).rejects.toThrow(/manifest.json is invalid/);
    await expect(startOpenDataLoad({ db: t.db, dir })).resolves.toBeNull();
  });
});

describe("re-loads and 'new since you saved'", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ seed: false });
  });
  afterAll(() => t.close());

  it("an unchanged re-load adds no new sales to a saved listing; a sale new in the next snapshot does", async () => {
    const today = "2026-10-20";
    const first = await snapshot();
    await loadOpenData({ db: t.db, dir: first });
    const [b] = await t.db.select().from(buildings).where(eq(buildings.dldKey, "test tower a|marsa dubai"));
    const anon = "6b1c7f00-8a93-44b5-8a51-6c7d8e9f0a1b";
    await ensureAnonUser(t.db, anon);
    const [check] = await t.db
      .insert(checks)
      .values({
        code: "LOAD01",
        anonId: anon,
        buildingId: b.id,
        buildingName: b.name,
        buildingArea: b.area,
        buildingText: "Test Tower A",
        bedrooms: 2,
        sizeSqft: 1190,
        priceAed: 2_300_000,
        source: "manual",
        band: "above",
        askingPsf: 1932.8,
        windowStart: "2025-10-20",
        windowEnd: today,
        minSales: 3,
        bandPct: 5,
      })
      .returning();
    await pause();
    await saveCheck(t.db, anon, check, today, DEFAULT_RULES);
    await pause();

    // Rebuilding the same data gives the same sha (skipped); force a re-load with an identical row set
    // by clearing the stored sha: ON CONFLICT DO NOTHING keeps every created_at.
    await t.db.execute(sql`delete from app_meta where key = 'open_data_sha'`);
    expect(await loadOpenData({ db: t.db, dir: first })).toMatchObject({ status: "loaded", inserted: 0, deleted: 0 });
    let [item] = await listSaved(t.db, anon, today, DEFAULT_RULES);
    expect(item).toMatchObject({ newSalesSinceSave: 0, unseenNewSales: 0 });

    await pause();
    // Dated on the current data_through, so the 36-month window (and every other row) stays the same.
    const next = await snapshot(variant("1-11-2026-999", "9-11-2026-950", "2026-10-15 00:00:00"));
    expect(await loadOpenData({ db: t.db, dir: next })).toMatchObject({ status: "loaded", inserted: 1, deleted: 0 });
    [item] = await listSaved(t.db, anon, today, DEFAULT_RULES);
    expect(item).toMatchObject({ newSalesSinceSave: 1, unseenNewSales: 1 });
    const added = await t.db.select().from(sales).where(inArray(sales.externalRef, ["dld:9-11-2026-950"]));
    expect(added[0]).toMatchObject({ buildingId: b.id, bedrooms: 2 });
  });

  it("a transaction DLD corrected is updated in place: same id and created_at, not counted as new", async () => {
    const today = "2026-10-20";
    const anon = "6b1c7f00-8a93-44b5-8a51-6c7d8e9f0a1b";
    const [before] = await t.db.select().from(sales).where(eq(sales.externalRef, "dld:1-11-2026-101"));
    expect(before).toMatchObject({ priceAed: 2_200_000, bedrooms: 2 });
    const others = new Map((await openDataSales(t.db)).filter((s) => s.id !== before.id).map((s) => [s.id, s.importBatch]));
    await pause();
    // The previous test's snapshot with transaction 101's worth corrected from 2,200,000 to 2,250,000.
    const corrected = variant("1-11-2026-999", "9-11-2026-950", "2026-10-15 00:00:00").replace(
      /^(1-11-2026-101,.*,110\.5,)2200000,/m,
      "$12250000,",
    );
    expect(corrected).toContain(",110.5,2250000,");
    const r = await loadOpenData({ db: t.db, dir: await snapshot(corrected) });
    expect(r).toMatchObject({ status: "loaded", inserted: 0, updated: 1, deleted: 0 });

    const [after] = await t.db.select().from(sales).where(eq(sales.externalRef, "dld:1-11-2026-101"));
    expect(after).toMatchObject({ id: before.id, priceAed: 2_250_000, source: "open_data" });
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
    expect(after.importBatch).not.toBe(before.importBatch);
    // Unchanged rows are left alone (their batch tag is still the old one).
    for (const s of await openDataSales(t.db)) if (s.id !== before.id) expect(s.importBatch).toBe(others.get(s.id));
    const [item] = await listSaved(t.db, anon, today, DEFAULT_RULES);
    expect(item).toMatchObject({ newSalesSinceSave: 1 });
  });
});

describe("loadOpenData: requests run during a PGlite load, orphan buildings, created_at", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ seed: false });
  });
  afterAll(() => t.close());

  it("PGlite: a query sent while the load runs is answered before the load ends (the health check never waits for it)", async () => {
    const dir = await snapshot();
    const db = t.db;
    const realTx = db.transaction.bind(db);
    const events: string[] = [];
    let calls = 0;
    let probe: Promise<unknown> | null = null;
    const spy = vi.spyOn(db, "transaction").mockImplementation(((fn: Parameters<typeof db.transaction>[0], cfg?: Parameters<typeof db.transaction>[1]) => {
      calls++;
      // Part-way through the load, "a request" asks the database what /api/health asks.
      if (calls === 5 && !probe) probe = db.execute(sql`select 1`).then(() => events.push("select"));
      return realTx(fn, cfg);
    }) as typeof db.transaction);
    try {
      const r = await loadOpenData({ db, dir, batchSize: 2 });
      events.push("load");
      expect(r).toMatchObject({ status: "loaded", rows: 12, inserted: 12 });
      await probe;
      // Many short transactions, and the request was answered between two of them.
      expect(calls).toBeGreaterThan(5);
      expect(events).toEqual(["select", "load"]);
    } finally {
      spy.mockRestore();
    }
    expect(await openDataSales(db)).toHaveLength(12);
  });

  it("removes DLD buildings that left the snapshot and have no sales; keeps those with sales and admin buildings", async () => {
    // From the previous test: the snapshot is loaded. A DLD building whose name DLD respelled
    // (another dld_key) is left with its aliases and no sales.
    const [orphan] = await t.db.insert(buildings).values({ name: "Test Tower A Old", area: "Dubai Marina", areaDld: "Marsa Dubai", dldKey: "test tower a old|marsa dubai" }).returning();
    await t.db.insert(buildingAliases).values({ buildingId: orphan.id, aliasRaw: "TEST TOWER A OLD", aliasNorm: "test tower a old", source: "import" });
    const [withSale] = await t.db.insert(buildings).values({ name: "Test Tower Z", area: "Dubai Marina", areaDld: "Marsa Dubai", dldKey: "test tower z|marsa dubai" }).returning();
    await t.db.insert(sales).values({ buildingId: withSale.id, saleDate: "2026-10-01", bedrooms: 1, sizeSqft: 800, priceAed: 1_000_000, source: "admin" });
    const [adminMade] = await t.db.insert(buildings).values({ name: "Test Admin Tower", area: "Test Area" }).returning();

    const next = await snapshot(variant("1-11-2026-110", "9-11-2026-960", "2026-10-14 00:00:00"));
    const r = await loadOpenData({ db: t.db, dir: next });
    expect(r).toMatchObject({ status: "loaded", removedBuildings: 1, buildings: 4 });
    const ids = (await t.db.select({ id: buildings.id }).from(buildings)).map((b) => b.id);
    expect(ids).not.toContain(orphan.id);
    expect(ids).toEqual(expect.arrayContaining([withSale.id, adminMade.id]));
    expect(await t.db.select().from(buildingAliases).where(eq(buildingAliases.buildingId, orphan.id))).toEqual([]);
  });

  it("Postgres: the sales a load adds are stamped when they become visible, not when its transaction began", async () => {
    const db = t.db;
    const realTx = db.transaction.bind(db);
    let txStart = 0;
    const spy = vi.spyOn(db, "transaction").mockImplementation(((fn: Parameters<typeof db.transaction>[0], cfg?: Parameters<typeof db.transaction>[1]) =>
      realTx(async (tx) => {
        const res = (await (tx as unknown as Db).execute(sql`select extract(epoch from now()) * 1000 as ms`)) as unknown as { rows: Array<{ ms: number | string }> };
        const [row] = res.rows;
        txStart = Number(row.ms);
        await pause(); // a long load: a person may save a listing meanwhile
        return fn(tx);
      }, cfg)) as typeof db.transaction);
    try {
      const next = await snapshot(variant("1-11-2026-110", "9-11-2026-961", "2026-10-14 00:00:00"));
      const r = await loadOpenData({ db, dir: next, kind: "postgres" });
      expect(r).toMatchObject({ status: "loaded", inserted: 1 });
    } finally {
      spy.mockRestore();
    }
    const [added] = await db.select().from(sales).where(eq(sales.externalRef, "dld:9-11-2026-961"));
    expect(added.createdAt.getTime()).toBeGreaterThanOrEqual(txStart + 20);
  });
});

describe("loadOpenData: building facts and parking (buildings.csv.gz)", () => {
  /** The fixture with the given columns set on every data row (the fixture has no quoted commas). */
  function withColumns(values: Record<string, string>, only?: (line: string) => boolean): string {
    const lines = SAMPLE_TEXT.split("\r\n");
    const header = lines[0].replace(/^\uFEFF/, "").split(",");
    return lines
      .map((line, i) => {
        if (i === 0 || line === "" || (only && !only(line))) return line;
        const cells = line.split(",");
        for (const [name, v] of Object.entries(values)) cells[header.indexOf(name)] = v;
        return cells.join(",");
      })
      .join("\r\n");
  }
  const FULL = withColumns({ project_number: "2977.00", nearest_metro_en: "Test Metro Station", nearest_mall_en: "Test Mall", nearest_landmark_en: "Test Landmark" });

  /** Rewrites a snapshot folder as one built before project_number, parking and buildings.csv.gz existed. */
  function asLegacy(dir: string): void {
    const file = path.join(dir, "sales.csv.gz");
    const text = gunzipSync(readFileSync(file)).toString("utf8");
    const old = text
      .trim()
      .split("\n")
      .map((l) => l.split(",").slice(0, 10).join(","))
      .join("\n");
    const gz = gzipSync(Buffer.from(`${old}\n`, "utf8"));
    writeFileSync(file, gz);
    rmSync(path.join(dir, "buildings.csv.gz"));
    const m = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
    delete m.buildingsFile;
    // A snapshot of that time had no adjusted-registered-sales model either (it would name the newer sales file).
    delete m.acs;
    rmSync(path.join(dir, "acs-model.json.gz"));
    m.snapshotSha256 = createHash("sha256").update(gz).digest("hex");
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m));
  }

  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ seed: false });
  });
  afterAll(() => t.close());

  it("a snapshot written before the buildings file existed still loads: no facts, no parking", async () => {
    const legacy = await snapshot(FULL);
    asLegacy(legacy);
    const r = await loadOpenData({ db: t.db, dir: legacy });
    expect(r).toMatchObject({ status: "loaded", rows: 12, inserted: 12, buildings: 4 });
    const [a] = await t.db.select().from(buildings).where(eq(buildings.dldKey, "test tower a|marsa dubai"));
    expect(a).toMatchObject({ projectNumber: null, nearestMetro: null, firstSaleDate: null, offPlanShare: null });
    expect((await openDataSales(t.db)).every((s) => s.hasParking === null)).toBe(true);
    expect(await getAppMeta(t.db, "open_data_buildings_sha")).toBeNull();
  });

  it("the full snapshot then fills the facts and the parking flags without touching created_at or counting corrections", async () => {
    const before = new Map((await openDataSales(t.db)).map((s) => [s.externalRef, [s.id, s.createdAt.getTime(), s.importBatch]]));
    await pause();
    const full = await snapshot(FULL);
    const r = await loadOpenData({ db: t.db, dir: full });
    expect(r).toMatchObject({ status: "loaded", rows: 12, inserted: 0, updated: 0, deleted: 0, buildings: 4 });

    const [a] = await t.db.select().from(buildings).where(eq(buildings.dldKey, "test tower a|marsa dubai"));
    expect(a).toMatchObject({
      project: "TEST PROJECT A",
      projectNumber: 2977,
      nearestMetro: "Test Metro Station",
      nearestMall: "Test Mall",
      nearestLandmark: "Test Landmark",
      firstSaleDate: "2019-01-10", // before the window: it dates the building
      firstReadySaleDate: "2019-01-10",
      lastSaleDate: "2026-10-15",
    });
    expect(a.offPlanShare).toBeCloseTo(2 / 9, 4);
    const [gate] = await t.db.select().from(buildings).where(eq(buildings.dldKey, "residences at test gate 1|marsa dubai"));
    expect(gate).toMatchObject({ firstSaleDate: "2026-05-05", firstReadySaleDate: "2026-05-05", lastSaleDate: "2026-05-05", offPlanShare: 0 });

    const after = await openDataSales(t.db);
    expect(after).toHaveLength(12);
    expect(after.every((s) => s.hasParking === true)).toBe(true);
    for (const s of after) expect([s.id, s.createdAt.getTime(), s.importBatch]).toEqual(before.get(s.externalRef));
    const m = await readManifest(full);
    expect(await getAppMeta(t.db, "open_data_buildings_sha")).toBe(m?.buildingsFile?.sha256);
    expect(await loadOpenData({ db: t.db, dir: full })).toMatchObject({ status: "up_to_date", skipped: "same_sha" });
  });

  it("an older snapshot loaded afterwards never wipes the facts or the parking flags", async () => {
    const legacy = await snapshot(FULL);
    asLegacy(legacy);
    expect(await loadOpenData({ db: t.db, dir: legacy })).toMatchObject({ status: "loaded", inserted: 0, updated: 0 });
    const [a] = await t.db.select().from(buildings).where(eq(buildings.dldKey, "test tower a|marsa dubai"));
    expect(a).toMatchObject({ projectNumber: 2977, nearestMetro: "Test Metro Station", firstSaleDate: "2019-01-10" });
    expect((await openDataSales(t.db)).every((s) => s.hasParking === true)).toBe(true);
  });

  it("loads again when only the buildings file changed, and stores a parking flag of 0 as false", async () => {
    const changed = await snapshot(
      withColumns({ project_number: "2977.00", nearest_metro_en: "Other Metro Station", nearest_mall_en: "Test Mall", nearest_landmark_en: "Test Landmark" }),
    );
    const full = await snapshot(FULL);
    // Same sales, other facts: the sales file is identical, only buildings.csv.gz differs.
    expect((await readManifest(changed))?.snapshotSha256).toBe((await readManifest(full))?.snapshotSha256);
    await loadOpenData({ db: t.db, dir: full });
    const r = await loadOpenData({ db: t.db, dir: changed });
    expect(r).toMatchObject({ status: "loaded", inserted: 0, updated: 0, deleted: 0 });
    const [a] = await t.db.select().from(buildings).where(eq(buildings.dldKey, "test tower a|marsa dubai"));
    expect(a.nearestMetro).toBe("Other Metro Station");

    const noParking = await snapshot(withColumns({ has_parking: "0" }, (line) => line.startsWith("1-11-2026-101,")));
    await loadOpenData({ db: t.db, dir: noParking });
    const ss = await openDataSales(t.db);
    expect(ss.find((s) => s.externalRef === "dld:1-11-2026-101")?.hasParking).toBe(false);
    expect(ss.filter((s) => s.hasParking === true)).toHaveLength(11);
  });

  it("refuses a buildings file that does not match the manifest, before anything is written", async () => {
    const dir = await snapshot(withColumns({ nearest_mall_en: "Changed Mall" }));
    const other = await snapshot(FULL);
    writeFileSync(path.join(dir, "buildings.csv.gz"), readFileSync(path.join(other, "buildings.csv.gz")));
    const metaBefore = await getAppMeta(t.db, "open_data_buildings_sha");
    await expect(loadOpenData({ db: t.db, dir })).rejects.toThrow(/buildings.csv.gz does not match manifest.buildingsFile.sha256/);
    rmSync(path.join(dir, "buildings.csv.gz"));
    await expect(loadOpenData({ db: t.db, dir })).rejects.toThrow(/buildings.csv.gz is missing/);
    expect(await getAppMeta(t.db, "open_data_buildings_sha")).toBe(metaBefore);
  });
});

describe("data-source panel data (REAL_DATA.md section 12)", () => {
  it("reports the manifest, the loaded range, the counts and the last load time", async () => {
    const t = await createTestDb({ seed: false });
    try {
      const empty = mkdtempSync(path.join(root, "panel-empty-"));
      expect(await getDataSourcePanel(t.db, empty)).toMatchObject({ loaded: false, pending: false, manifest: null, loadedAt: null, live: { openDataSales: 0, dldBuildings: 0 } });

      const dir = await snapshot();
      const manifest = await readManifest(dir);
      expect(await getDataSourcePanel(t.db, dir)).toMatchObject({ loaded: false, pending: true });
      await loadOpenData({ db: t.db, dir });
      const p = await getDataSourcePanel(t.db, dir);
      expect(p).toMatchObject({
        loaded: true,
        pending: false,
        dataFrom: "2023-10-16",
        dataThrough: "2026-10-15",
        live: { openDataSales: 12, dldBuildings: 4 },
        manifest: {
          datasetTitle: "TEST Transactions",
          datasetUrl: "https://data.dubai/en/test-dataset",
          downloadedOn: "2026-11-18",
          rows: 12,
          read: 43,
          buildings: 4,
          snapshotSha256: manifest?.snapshotSha256,
        },
      });
      expect(p.manifest?.excluded[0]).toEqual({ reason: "not_sales", count: 2 });
      expect(p.manifest?.excluded.reduce((s, e) => s + e.count, 0)).toBe(31);
      expect(Number.isNaN(Date.parse(p.loadedAt ?? ""))).toBe(false);
    } finally {
      await t.close();
    }
  });
});
