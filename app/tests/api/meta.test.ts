/**
 * The data status and "From the data" (REAL_DATA.md sections 7, 9 and 10): GET /api/meta, the public
 * config's `data`, the one-hour panel cache and its invalidation, and GET /api/admin/data-source
 * (section 12). Synthetic test buildings only.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as dataSourceGet } from "@/app/api/admin/data-source/route";
import { GET as metaGet } from "@/app/api/meta/route";
import { getPublicConfig } from "@/lib/config";
import {
  DATA_META_CACHE_MS,
  cachedDataMeta,
  invalidateDataMeta,
  readDataMeta,
  salesWindow,
  toDataStatusView,
} from "@/lib/data-status";
import { setAppMeta } from "@/lib/db/meta";
import { appMeta, buildings, sales } from "@/lib/db/schema";
import { addDays } from "@/lib/domain/dates";
import { DEFAULT_RULES, summariseSales } from "@/lib/domain/analyse";
import { __resetEnvForTests } from "@/lib/env";
import { FROM_THE_DATA_TTL_MS, getFromTheData, invalidateFromTheData } from "@/lib/services/from-the-data";
import type { MetaResponse } from "@/lib/types";
import type { DataSourcePanel } from "@/lib/validation/admin";
import { testSalesFor } from "../fixtures/api-fixtures";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";
import { adminCookies } from "./admin-helpers";

const t = setupTestDb();
const TODAY = "2026-11-17";
const NOW = new Date("2026-11-17T08:00:00Z");

const SOURCE = {
  version: 1,
  source: "data.dubai",
  publisher: "Test Publisher",
  datasetTitle: "TEST Transactions",
  datasetUrl: "https://example.test/dataset",
  licence: "Test Licence",
  licenceUrl: "https://example.test/licence",
  downloadedOn: TODAY,
  sourceFiles: [],
  dataFrom: "2023-11-18",
  dataThrough: TODAY,
  buildings: 6,
  snapshotSha256: "a".repeat(64),
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await clearUserData(t.db);
  invalidateDataMeta();
  invalidateFromTheData();
});

async function meta() {
  const res = await call<MetaResponse>(metaGet, { url: "/api/meta" });
  expect(res.status).toBe(200);
  expect(res.setCookies).toEqual([]);
  return res.body;
}

async function setMeta(key: "data_through" | "data_source" | "open_data_sha" | "data_from", value: string | null) {
  if (value === null) await t.db.delete(appMeta).where(eq(appMeta.key, key));
  else await setAppMeta(t.db, key, value);
}

describe("GET /api/meta", () => {
  it("the data status and From the data: the building with the most ready 2-bed sales in the window", async () => {
    const body = await meta();
    expect(body.data).toEqual({
      loaded: true,
      dataFrom: addDays(TODAY, -340),
      dataThrough: TODAY,
      stale: false,
      source: null,
    });
    const sales2 = testSalesFor("Mockup Crest Tower", 2, TODAY);
    const s = summariseSales(sales2);
    const [marina] = await t.db.select().from(buildings).where(eq(buildings.name, "Mockup Crest Tower"));
    expect(body.fromTheData).toEqual({
      building: { id: marina.id, name: "Mockup Crest Tower", area: "Dubai Marina", areaDld: "Marsa Dubai" },
      bedrooms: 2,
      completion: "ready",
      count: 11,
      medianPsf: s.medianPsf,
      outliersDropped: 0,
      firstSaleDate: addDays(TODAY, -340),
      lastSaleDate: addDays(TODAY, -40),
      window: { start: addDays(TODAY, -365), end: TODAY },
    });
    expect(body.fromTheData?.medianPsf).toBeCloseTo(1674.45, 2);
  });

  it("names the dataset and licence once the snapshot's source is stored (REAL_DATA.md section 9)", async () => {
    await setMeta("data_source", JSON.stringify(SOURCE));
    try {
      expect((await meta()).data.source).toEqual({
        title: "TEST Transactions",
        url: "https://example.test/dataset",
        publisher: "Test Publisher",
        licence: "Test Licence",
        licenceUrl: "https://example.test/licence",
      });
      await setMeta("data_source", "{not json");
      expect((await meta()).data.source).toBeNull();
      await setMeta("data_source", JSON.stringify({ datasetTitle: "x" }));
      expect((await meta()).data.source).toBeNull();
    } finally {
      await setMeta("data_source", null);
    }
  });

  it("is stale when data_through is more than 45 days before today; the window then ends there", async () => {
    const through = addDays(TODAY, -46);
    await setMeta("data_through", through);
    try {
      const body = await meta();
      expect(body.data).toMatchObject({ loaded: true, dataThrough: through, stale: true });
      expect(body.fromTheData?.window).toEqual({ start: addDays(through, -365), end: through });
      // The 40-days-ago sale is after data_through: it waits for the next snapshot.
      expect(body.fromTheData?.lastSaleDate).toBe(addDays(TODAY, -57));
      expect(body.fromTheData?.count).toBe(10);
      await setMeta("data_through", addDays(TODAY, -45));
      expect((await meta()).data.stale).toBe(false);
    } finally {
      await setMeta("data_through", TODAY);
    }
  });

  it("before any data is loaded: not loaded and no panel", async () => {
    await setMeta("data_through", null);
    try {
      const body = await meta();
      expect(body).toEqual({
        data: { loaded: false, dataFrom: addDays(TODAY, -340), dataThrough: null, stale: false, source: null },
        fromTheData: null,
      });
      expect((await salesWindow(t.db, TODAY, 365)).window).toBeNull();
    } finally {
      await setMeta("data_through", TODAY);
    }
  });

  it("counts ready sales only, ties go to the lower building id, and an empty window has no panel", async () => {
    const [marina] = await t.db.select().from(buildings).where(eq(buildings.name, "Mockup Crest Tower"));
    const [tower2] = await t.db.select().from(buildings).where(eq(buildings.name, "Mockup Crest Tower 2"));
    // Twelve off-plan 2-bed sales in Tower 2 never beat Marina's eleven ready ones.
    const offPlan = Array.from({ length: 12 }, (_, i) => ({
      buildingId: tower2.id,
      saleDate: addDays(TODAY, -(i + 1)),
      bedrooms: 2,
      sizeSqft: 1250,
      priceAed: 2_100_000,
      source: "admin" as const,
      completion: "off_plan" as const,
    }));
    await t.db.insert(sales).values(offPlan);
    expect((await getFromTheData(t.db, TODAY, DEFAULT_RULES))?.building.id).toBe(marina.id);
    invalidateFromTheData();
    // Seven ready ones give Tower 2 eleven too: the tie goes to the lower id.
    await t.db.insert(sales).values(offPlan.slice(0, 7).map((s) => ({ ...s, completion: "ready" as const })));
    expect((await getFromTheData(t.db, TODAY, DEFAULT_RULES))?.building.id).toBe(Math.min(marina.id, tower2.id));
    await t.db.delete(sales).where(eq(sales.buildingId, tower2.id));
    await t.db.insert(sales).values(
      testSalesFor("Mockup Crest Tower 2", 2, TODAY).map((s, j) => ({
        ...s,
        buildingId: tower2.id,
        bedrooms: 2,
        source: "open_data" as const,
        externalRef: `test:2-${j + 1}`,
      })),
    );
    invalidateFromTheData();
    // A window with no ready 2-bed sale at all (the newest is 22 days old).
    expect(await getFromTheData(t.db, TODAY, { windowDays: 10 })).toBeNull();
  });
});

describe("From the data is kept for an hour", () => {
  afterEach(() => vi.setSystemTime(NOW));

  it("serves the cached panel within the hour, then recomputes; a new snapshot or invalidation recomputes at once", async () => {
    const first = await getFromTheData(t.db, TODAY, DEFAULT_RULES);
    expect(first?.count).toBe(11);
    const [marina] = await t.db.select().from(buildings).where(eq(buildings.name, "Mockup Crest Tower"));
    const sale = { buildingId: marina.id, saleDate: addDays(TODAY, -2), bedrooms: 2, sizeSqft: 1284, priceAed: 2_150_000 };
    await t.db.insert(sales).values([
      { ...sale, source: "open_data", externalRef: "dld:TEST-FTD-1" },
      // The panel shows the DLD open data only: a sale the admin added never counts (REAL_DATA.md section 9).
      { ...sale, saleDate: addDays(TODAY, -3), source: "admin" },
    ]);
    expect(await getFromTheData(t.db, TODAY, DEFAULT_RULES)).toBe(first);
    vi.setSystemTime(new Date(NOW.getTime() + FROM_THE_DATA_TTL_MS - 1));
    expect(await getFromTheData(t.db, TODAY, DEFAULT_RULES)).toBe(first);
    vi.setSystemTime(new Date(NOW.getTime() + FROM_THE_DATA_TTL_MS));
    const later = await getFromTheData(t.db, TODAY, DEFAULT_RULES);
    expect(later?.count).toBe(12);

    // A new snapshot sha changes the key at once.
    await t.db.delete(sales).where(eq(sales.source, "admin"));
    await t.db.delete(sales).where(eq(sales.externalRef, "dld:TEST-FTD-1"));
    await setMeta("open_data_sha", "b".repeat(64));
    try {
      expect((await getFromTheData(t.db, TODAY, DEFAULT_RULES))?.count).toBe(11);
    } finally {
      await setMeta("open_data_sha", null);
    }
    expect(FROM_THE_DATA_TTL_MS).toBe(3_600_000);
  });
});

describe("the data status in the public config", () => {
  it("getPublicConfig carries it, read through a 60 s cache the loader drops", async () => {
    const c = await getPublicConfig({ db: t.db, today: TODAY });
    expect(c.data).toMatchObject({ loaded: true, dataThrough: TODAY, stale: false });
    expect(c).toMatchObject({ leadsEnabled: true, partner: { name: "Test Mortgage Partner" }, consent: { version: "optin-v1" } });

    const cached = await cachedDataMeta(t.db);
    await setMeta("data_through", addDays(TODAY, -60));
    try {
      expect(await cachedDataMeta(t.db)).toBe(cached);
      expect((await readDataMeta(t.db)).dataThrough).toBe(addDays(TODAY, -60));
      vi.setSystemTime(new Date(NOW.getTime() + DATA_META_CACHE_MS));
      expect((await cachedDataMeta(t.db)).dataThrough).toBe(addDays(TODAY, -60));
      vi.setSystemTime(NOW);
      invalidateDataMeta();
      expect((await getPublicConfig({ db: t.db, today: TODAY })).data).toMatchObject({ stale: true, dataThrough: addDays(TODAY, -60) });
    } finally {
      vi.setSystemTime(NOW);
      await setMeta("data_through", TODAY);
      invalidateDataMeta();
    }
    expect(toDataStatusView({ dataFrom: null, dataThrough: null, source: null, sha: null }, TODAY)).toEqual({
      loaded: false,
      dataFrom: null,
      dataThrough: null,
      stale: false,
      source: null,
    });
  });
});

describe("GET /api/admin/data-source (REAL_DATA.md section 12)", () => {
  const env = process.env as Record<string, string | undefined>;
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "fairsquare-ds-"));
  });
  afterAll(() => {
    delete env.OPEN_DATA_DIR;
    __resetEnvForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("needs an admin session", async () => {
    const res = await call<{ error: { code: string } }>(dataSourceGet, { url: "/api/admin/data-source" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("returns the panel: the snapshot in OPEN_DATA_DIR, waiting to load, with its exclusion counts", async () => {
    env.OPEN_DATA_DIR = dir;
    __resetEnvForTests();
    writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ ...SOURCE, counts: { read: 50, kept: 32, excluded: { not_sales: 10, rooms_excluded: 8 } } }),
    );
    const res = await call<{ dataSource: DataSourcePanel }>(dataSourceGet, { url: "/api/admin/data-source", cookies: await adminCookies(t.db) });
    expect(res.status).toBe(200);
    const p = res.body.dataSource;
    expect(p).toMatchObject({ loaded: false, pending: true, dataThrough: TODAY, live: { openDataSales: 32, dldBuildings: 6 } });
    expect(p.manifest).toMatchObject({ datasetTitle: "TEST Transactions", rows: 32, read: 50, buildings: 6, downloadedOn: TODAY });
    expect(p.manifest?.excluded.find((e) => e.reason === "not_sales")).toEqual({ reason: "not_sales", count: 10 });
    expect(p.manifest?.excluded.find((e) => e.reason === "portfolio_deal")).toEqual({ reason: "portfolio_deal", count: 0 });
  });
});
