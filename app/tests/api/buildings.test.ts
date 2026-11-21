import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/buildings/route";
import { setAppMeta } from "@/lib/db/meta";
import {
  COVERAGE_PAGE_SIZE,
  countRecentSalesByBuilding,
  getBuilding,
  getCoverage,
  listCoverage,
  recentSales,
} from "@/lib/db/repo/buildings";
import { TEST_BUILDINGS } from "../fixtures/test-buildings";
import { appMeta, buildings, sales } from "@/lib/db/schema";
import { addDays } from "@/lib/domain/dates";
import { DEFAULT_RULES, inWindow, summariseSales, windowBounds } from "@/lib/domain/analyse";
import type { CoverageResponse } from "@/lib/types";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";

const t = setupTestDb();
const TODAY = "2026-11-17";
const WINDOW = windowBounds(TODAY, 365);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await clearUserData(t.db);
});

async function idOf(name: string): Promise<number> {
  const [row] = await t.db.select({ id: buildings.id }).from(buildings).where(eq(buildings.name, name));
  return row.id;
}

type ErrBody = { error: { code: string; fields?: Record<string, string> } };

async function coverage(query = "") {
  return call<CoverageResponse & ErrBody>(GET, { url: `/api/buildings${query}` });
}

/** The test buildings in the expected default order: most sales in the window first, then by name. */
const EXPECTED_ORDER = [...TEST_BUILDINGS]
  .map((b) => ({ name: b.name, n: b.sales.filter(([d]) => d <= 365).length }))
  .sort((x, y) => y.n - x.n || x.name.localeCompare(y.name))
  .map((b) => b.name);

describe("GET /api/buildings (REAL_DATA.md section 11)", () => {
  it("returns the first page: most sales in the window first, with ready and off-plan counts and the latest sale", async () => {
    const res = await coverage();
    expect(res.status).toBe(200);
    expect(res.setCookies).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.body).toMatchObject({ total: 6, page: 1, pageSize: COVERAGE_PAGE_SIZE, q: null, window: WINDOW, dataThrough: TODAY });
    const list = res.body.buildings;
    expect(list.map((b) => b.name)).toEqual(EXPECTED_ORDER);

    for (const tb of TEST_BUILDINGS) {
      const b = list.find((x) => x.name === tb.name);
      expect(b, tb.name).toBeDefined();
      if (!b) continue;
      const windowed = tb.sales.filter(([d]) => d <= 365);
      const latest = addDays(TODAY, -Math.min(...tb.sales.map((s) => s[0])));
      expect(b).toMatchObject({ area: tb.area, areaDld: tb.areaDld, readySales: windowed.length, offPlanSales: 0, latestSaleDate: latest });
      expect(b.types).toHaveLength(1);
      const type = b.types[0];
      const ready = windowed.map(([d, sizeSqft, priceAed]) => ({ saleDate: addDays(TODAY, -d), sizeSqft, priceAed }));
      expect(type).toMatchObject({
        bedrooms: tb.bedrooms,
        readySales: windowed.length,
        offPlanSales: 0,
        latestSaleDate: latest,
        readyComparable: summariseSales(ready).count >= 5,
        offPlanComparable: false,
      });
      expect(type).not.toHaveProperty("sales12m");
      expect(type.medianPsf).toBeCloseTo(summariseSales(ready).medianPsf ?? NaN, 6);
    }

    const avail = Object.fromEntries(list.map((b) => [b.name, b.types[0].readyComparable]));
    expect(avail).toEqual({
      "Mockup Crest Tower": true,
      "Mockup Crest Tower 2": false,
      "Fake Vista Residences": true,
      "Fake Vista Residences 2": false,
      "Dummyside Heights 2": false,
      "Dummyside Heights 1": false,
    });
    expect(list[0]).toMatchObject({ name: "Mockup Crest Tower", readySales: 11 });
    expect(list[0].types[0].medianPsf).toBeCloseTo(1674.45, 2);
  });

  it("searches name or area on the server (2+ characters; shorter is ignored)", async () => {
    const byName = await coverage("?q=vista");
    expect(byName.body.q).toBe("vista");
    expect(byName.body.total).toBe(2);
    expect(byName.body.buildings.map((b) => b.name)).toEqual(["Fake Vista Residences", "Fake Vista Residences 2"]);

    const byArea = await coverage(`?q=${encodeURIComponent("al jaddaf")}`);
    expect(byArea.body.buildings.map((b) => b.name).sort()).toEqual(["Dummyside Heights 1", "Dummyside Heights 2"]);

    // The official DLD area name matches too ("Marsa Dubai" is shown as "Dubai Marina").
    const byDldArea = await coverage("?q=marsa");
    expect(byDldArea.body.buildings.map((b) => b.name)).toEqual(["Mockup Crest Tower", "Mockup Crest Tower 2"]);

    const short = await coverage("?q=v");
    expect(short.body).toMatchObject({ q: null, total: 6 });

    // LIKE wildcards match only themselves.
    expect((await coverage(`?q=${encodeURIComponent("%%")}`)).body.total).toBe(0);
    expect((await coverage(`?q=${encodeURIComponent("_o")}`)).body.total).toBe(0);
    expect((await coverage("?q=nothing+here")).body).toMatchObject({ total: 0, buildings: [] });
  });

  it("pages by 50 and still reports the total past the last page", async () => {
    const extra = await t.db
      .insert(buildings)
      .values(Array.from({ length: 55 }, (_, i) => ({ name: `TEST TOWER P${String(i).padStart(2, "0")}`, area: "Test Paging Area" })))
      .returning({ id: buildings.id });
    try {
      await t.db.insert(sales).values(
        extra.map((b, i) => ({
          buildingId: b.id,
          saleDate: addDays(TODAY, -(10 + i)),
          bedrooms: 1,
          sizeSqft: 700,
          priceAed: 700_000,
          source: "admin" as const,
        })),
      );
      const first = await coverage();
      expect(first.body.total).toBe(61);
      expect(first.body.buildings).toHaveLength(50);
      const second = await coverage("?page=2");
      expect(second.body).toMatchObject({ page: 2, total: 61 });
      expect(second.body.buildings).toHaveLength(11);
      const seen = new Set([...first.body.buildings, ...second.body.buildings].map((b) => b.id));
      expect(seen.size).toBe(61);
      const past = await coverage("?page=9");
      expect(past.body).toMatchObject({ page: 9, total: 61, buildings: [] });
      const searched = await coverage("?q=paging&page=2");
      expect(searched.body).toMatchObject({ total: 55, page: 2 });
      expect(searched.body.buildings).toHaveLength(5);
    } finally {
      await t.db.delete(buildings).where(eq(buildings.area, "Test Paging Area"));
    }
  });

  it("an invalid page → 422; an empty page counts as the first", async () => {
    for (const q of ["?page=0", "?page=-1", "?page=x", "?page=1.5"]) {
      const res = await coverage(q);
      expect(res.status, q).toBe(422);
      expect(res.body.error.fields?.page).toBeTruthy();
    }
    expect((await coverage("?page=")).body.page).toBe(1);
  });

  it("is empty while no sales data is loaded", async () => {
    await t.db.delete(appMeta).where(eq(appMeta.key, "data_through"));
    try {
      const res = await coverage();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ buildings: [], total: 0, window: null, dataThrough: null });
    } finally {
      await setAppMeta(t.db, "data_through", TODAY);
    }
  });
});

describe("buildings repo", () => {
  it("coverage counts ready and off-plan sales apart, lists buildings with any sale and stops at the window end", async () => {
    const [extra] = await t.db.insert(buildings).values({ name: "TEST EMPTY TOWER", area: "Nowhere" }).returning({ id: buildings.id });
    const marina = await idOf("Mockup Crest Tower");
    await t.db.insert(sales).values([
      { buildingId: marina, saleDate: addDays(TODAY, -400), bedrooms: 1, sizeSqft: 800, priceAed: 1_200_000, source: "admin" },
      { buildingId: marina, saleDate: addDays(TODAY, 1), bedrooms: 3, sizeSqft: 1800, priceAed: 3_000_000, source: "admin" },
      { buildingId: marina, saleDate: addDays(TODAY, -5), bedrooms: 2, sizeSqft: 1300, priceAed: 2_600_000, source: "admin", completion: "off_plan" },
    ]);
    try {
      const res = await getCoverage(t.db, TODAY, DEFAULT_RULES);
      // A building without any sale is not covered.
      expect(res.total).toBe(6);
      expect(res.buildings.find((b) => b.id === extra.id)).toBeUndefined();
      const m = res.buildings.find((b) => b.id === marina);
      expect(m).toMatchObject({ readySales: 11, offPlanSales: 1, latestSaleDate: addDays(TODAY, -5) });
      expect(m?.types.map((x) => x.bedrooms)).toEqual([1, 2]); // the future 3-bed sale is excluded
      expect(m?.types[0]).toMatchObject({
        bedrooms: 1,
        readySales: 0,
        offPlanSales: 0,
        medianPsf: null,
        readyComparable: false,
        offPlanComparable: false,
        latestSaleDate: addDays(TODAY, -400),
      });
      // Never pooled: 11 ready sales can be compared, the 1 off-plan sale cannot.
      expect(m?.types[1]).toMatchObject({ bedrooms: 2, readySales: 11, offPlanSales: 1, readyComparable: true, offPlanComparable: false });
      // The off-plan sale never moves the ready median.
      expect(m?.types[1].medianPsf).toBeCloseTo(1674.45, 2);

      // Data running only to 10 days ago: the 5-days-ago sale is past the window end.
      const through = addDays(TODAY, -10);
      const older = await listCoverage(t.db, { window: windowBounds(through, 365), dataThrough: through }, DEFAULT_RULES);
      expect(older.buildings.find((b) => b.id === marina)).toMatchObject({ offPlanSales: 0, latestSaleDate: addDays(TODAY, -40) });
    } finally {
      await t.db.delete(buildings).where(eq(buildings.id, extra.id));
    }
  });

  it("judges each basis on its own sales, after unusual ones are left out (as a comparison does)", async () => {
    const [b] = await t.db.insert(buildings).values({ name: "TEST TOWER F", area: "Test Area F" }).returning({ id: buildings.id });
    const sale = (days: number, priceAed: number, completion: "ready" | "off_plan", bedrooms = 2) => ({
      buildingId: b.id,
      saleDate: addDays(TODAY, -days),
      bedrooms,
      sizeSqft: 1000,
      priceAed,
      source: "open_data" as const,
      completion,
    });
    await t.db.insert(sales).values([
      // 2-bed: 0 ready, 7 off-plan.
      ...Array.from({ length: 7 }, (_, i) => sale(10 + i, 1_500_000 + i * 10_000, "off_plan")),
      // 1-bed: 5 ready, one of them far below the median (left out), so 4 are used: too few.
      ...[1_000_000, 1_020_000, 1_040_000, 1_060_000, 300_000].map((p, i) => sale(20 + i, p, "ready", 1)),
      // 3-bed: 3 ready and 3 off-plan: never pooled into 6.
      ...[0, 1, 2].map((i) => sale(30 + i, 2_000_000, "ready", 3)),
      ...[0, 1, 2].map((i) => sale(40 + i, 2_000_000, "off_plan", 3)),
    ]);
    try {
      const res = await getCoverage(t.db, TODAY, DEFAULT_RULES, { q: "TEST TOWER F" });
      const types = res.buildings[0].types;
      expect(types.map((x) => [x.bedrooms, x.readySales, x.offPlanSales, x.readyComparable, x.offPlanComparable])).toEqual([
        [1, 5, 0, false, false],
        [2, 0, 7, false, true],
        [3, 3, 3, false, false],
      ]);
    } finally {
      await t.db.delete(buildings).where(eq(buildings.id, b.id));
    }
  });

  it("recentSales is newest first, bounded by the window (start inclusive) and one completion basis", async () => {
    const marina = await idOf("Mockup Crest Tower");
    await t.db.insert(sales).values([
      { buildingId: marina, saleDate: addDays(TODAY, -365), bedrooms: 2, sizeSqft: 1200, priceAed: 2_000_000, source: "admin" },
      { buildingId: marina, saleDate: addDays(TODAY, -366), bedrooms: 2, sizeSqft: 1200, priceAed: 2_000_000, source: "admin" },
      { buildingId: marina, saleDate: addDays(TODAY, 1), bedrooms: 2, sizeSqft: 1200, priceAed: 2_000_000, source: "admin" },
      { buildingId: marina, saleDate: addDays(TODAY, -3), bedrooms: 2, sizeSqft: 1200, priceAed: 2_100_000, source: "admin", completion: "off_plan" },
    ]);
    const rows = await recentSales(t.db, marina, 2, "ready", WINDOW);
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.saleDate)).toEqual([...rows.map((r) => r.saleDate)].sort().reverse());
    expect(rows.at(-1)?.saleDate).toBe(addDays(TODAY, -365));
    expect(inWindow(rows, TODAY, 365)).toHaveLength(12);
    const offPlan = await recentSales(t.db, marina, 2, "off_plan", WINDOW);
    expect(offPlan.map((r) => r.completion)).toEqual(["off_plan"]);
  });

  it("countRecentSalesByBuilding and getBuilding", async () => {
    const a = await idOf("Mockup Crest Tower");
    const b = await idOf("Mockup Crest Tower 2");
    const counts = await countRecentSalesByBuilding(t.db, [a, b], 2, "ready", WINDOW);
    expect(counts.get(a)).toBe(11);
    expect(counts.get(b)).toBe(4);
    expect((await countRecentSalesByBuilding(t.db, [a, b], 2, "off_plan", WINDOW)).size).toBe(0);
    expect((await countRecentSalesByBuilding(t.db, [], 2, "ready", WINDOW)).size).toBe(0);
    expect((await getBuilding(t.db, a))?.name).toBe("Mockup Crest Tower");
    expect(await getBuilding(t.db, 999_999)).toBeNull();
    expect(await getBuilding(t.db, -1)).toBeNull();
  });
});
