import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureAnonUser } from "@/lib/db/repo/anon";
import { setAppMeta } from "@/lib/db/meta";
import { createCheck, getCheckRowByCode, getCheckWithCurrent, isUniqueViolation, SNAPSHOT_MAX, toCheckView } from "@/lib/db/repo/checks";
import { appMeta, buildings, checks, sales } from "@/lib/db/schema";
import { addDays } from "@/lib/domain/dates";
import { DEFAULT_RULES } from "@/lib/domain/analyse";
import { HttpError } from "@/lib/http/errors";
import { runCheck, type RunCheckCtx } from "@/lib/services/check";
import { clearUserData, useTestDb as setupTestDb } from "../../helpers/db";

const t = setupTestDb();
const TODAY = "2026-11-17";
const ANON = "3e8f4c77-5d60-4182-9d2e-3f4a5b6c7d8e";
const APP = "http://localhost:3000";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await clearUserData(t.db);
  await ensureAnonUser(t.db, ANON);
});

function ctx(over: Partial<RunCheckCtx> = {}): RunCheckCtx {
  return { anonId: ANON, today: TODAY, appUrl: APP, rules: { ...DEFAULT_RULES }, ...over };
}

/** Sets (or, with null, deletes) an app_meta key directly. */
async function setAppMetaRaw(key: "data_through", value: string | null): Promise<void> {
  if (value === null) await t.db.delete(appMeta).where(eq(appMeta.key, key));
  else await setAppMeta(t.db, key, value);
}

async function idOf(name: string): Promise<number> {
  const [row] = await t.db.select({ id: buildings.id }).from(buildings).where(eq(buildings.name, name));
  return row.id;
}

const MARINA = { buildingText: "Mockup Crest Tower", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 };

describe("runCheck", () => {
  it("computes, stores and returns the Marina verdict", async () => {
    const view = await runCheck(t.db, { fields: MARINA, buildingId: await idOf("Mockup Crest Tower"), source: "manual" }, ctx());
    expect(view.analysis).toMatchObject({ band: "above", count: 11 });
    const row = await getCheckRowByCode(t.db, view.code);
    expect(row?.editedFields).toEqual([]);
    expect(toCheckView(row!, APP)).toEqual(view);
  });

  it("uses the rules it is given (band width, minimum sales, window) and records them", async () => {
    const id = await idOf("Mockup Crest Tower");
    const wide = await runCheck(t.db, { fields: MARINA, buildingId: id, source: "manual" }, ctx({ rules: { minSales: 3, windowDays: 365, bandPct: 15 } }));
    expect(wide.analysis.band).toBe("inline");
    expect(wide.rules.bandPct).toBe(15);
    const strict = await runCheck(t.db, { fields: MARINA, buildingId: id, source: "manual" }, ctx({ rules: { minSales: 12, windowDays: 365, bandPct: 5 } }));
    expect(strict.analysis).toMatchObject({ band: "thin", count: 11, diff: null });
    const short = await runCheck(t.db, { fields: MARINA, buildingId: id, source: "manual" }, ctx({ rules: { minSales: 3, windowDays: 30, bandPct: 5 } }));
    expect(short.rules.windowDays).toBe(30);
    expect(short.analysis.windowStart).toBe(addDays(TODAY, -30));
    expect(short.analysis.count).toBeLessThan(11);
  });

  it("stores every sale it used (newest first), with where each came from, so the list matches the count", async () => {
    const [b] = await t.db.insert(buildings).values({ name: "Busy Test Tower", area: "Downtown" }).returning();
    try {
      await t.db.insert(sales).values(
        Array.from({ length: 230 }, (_, i) => ({
          buildingId: b.id,
          saleDate: addDays(TODAY, -(i + 1)),
          bedrooms: 1,
          sizeSqft: 700,
          priceAed: 700_000 + i * 1000,
          // One sale in ten was registered by the admin, the rest are DLD open data.
          source: i % 10 === 0 ? ("admin" as const) : ("open_data" as const),
        })),
      );
      const view = await runCheck(
        t.db,
        { fields: { buildingText: "Busy", areaText: null, bedrooms: 1, sizeSqft: 700, priceAed: 800_000 }, buildingId: b.id, source: "manual" },
        ctx(),
      );
      expect(view.analysis.count).toBe(230);
      expect(view.sales).toHaveLength(230);
      expect(view.sales[0]).toMatchObject({ saleDate: addDays(TODAY, -1), source: "admin" });
      expect(view.sales[1].saleDate).toBe(addDays(TODAY, -2));
      expect(view.sales[1]).not.toHaveProperty("source");
      expect(view.sales.filter((s) => s.source === "admin")).toHaveLength(23);
      expect(Math.min(...view.sales.map((s) => s.psf))).toBe(1000);
    } finally {
      await t.db.delete(checks);
      await t.db.delete(buildings).where(eq(buildings.id, b.id));
    }
  });

  it(`keeps the newest ${SNAPSHOT_MAX} sales when a comparison uses more, and analyses all of them`, async () => {
    const [b] = await t.db.insert(buildings).values({ name: "Very Busy Test Tower", area: "Downtown" }).returning();
    try {
      const n = SNAPSHOT_MAX + 25;
      await t.db.insert(sales).values(
        Array.from({ length: n }, (_, i) => ({
          buildingId: b.id,
          saleDate: addDays(TODAY, -(1 + (i % 360))),
          bedrooms: 1,
          sizeSqft: 700,
          priceAed: 700_000 + (i % 50) * 1000,
          source: "open_data" as const,
        })),
      );
      const view = await runCheck(
        t.db,
        { fields: { buildingText: "Very Busy", areaText: null, bedrooms: 1, sizeSqft: 700, priceAed: 800_000 }, buildingId: b.id, source: "manual" },
        ctx(),
      );
      expect(view.analysis.count).toBe(n);
      expect(view.sales).toHaveLength(SNAPSHOT_MAX);
      expect(view.sales[0].saleDate).toBe(addDays(TODAY, -1));
      expect(view.sales.every((s, i) => i === 0 || s.saleDate <= view.sales[i - 1].saleDate)).toBe(true);
    } finally {
      await t.db.delete(checks);
      await t.db.delete(buildings).where(eq(buildings.id, b.id));
    }
  });

  it("validates its input itself (422 with fields) and rejects unknown buildings (404)", async () => {
    await expect(
      runCheck(t.db, { fields: { ...MARINA, bedrooms: null as unknown as number }, buildingId: null, source: "manual" }, ctx()),
    ).rejects.toMatchObject({ status: 422, code: "validation_failed", fields: { "fields.bedrooms": expect.any(String) } });
    const err = await runCheck(t.db, { fields: MARINA, buildingId: 123_456, source: "manual" }, ctx()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 404, code: "building_not_found" });
  });

  it("stores property type, completion and de-duplicated edited fields", async () => {
    const view = await runCheck(
      t.db,
      {
        fields: MARINA,
        buildingId: await idOf("Mockup Crest Tower"),
        source: "claude",
        editedFields: ["sizeSqft", "sizeSqft"],
        propertyType: "apartment",
        completion: "off_plan",
      },
      ctx(),
    );
    expect(view).toMatchObject({ propertyType: "apartment", completion: "off_plan", source: "claude" });
    const row = await getCheckRowByCode(t.db, view.code);
    expect(row?.editedFields).toEqual(["sizeSqft"]);
  });

  it("stores the basis, outliers, median size and data_through with the comparison", async () => {
    const view = await runCheck(t.db, { fields: MARINA, buildingId: await idOf("Mockup Crest Tower"), source: "manual" }, ctx());
    expect(view.analysis).toMatchObject({
      completionBasis: "ready",
      outliersDropped: 0,
      medianSizeSqft: 1284,
      dataThrough: TODAY,
      windowStart: addDays(TODAY, -365),
      windowEnd: TODAY,
    });
    const row = await getCheckRowByCode(t.db, view.code);
    expect(row).toMatchObject({ completionBasis: "ready", outliersDropped: 0, medianSizeSqft: 1284, dataThrough: TODAY });
  });
});

describe("runCheck with real-data rules (REAL_DATA.md section 7)", () => {
  async function withOffPlanAndOutlier<T>(fn: (buildingId: number) => Promise<T>): Promise<T> {
    const [b] = await t.db.insert(buildings).values({ name: "TEST TOWER A", area: "Test Area" }).returning();
    const sale = (daysAgo: number, priceAed: number, completion: "ready" | "off_plan") => ({
      buildingId: b.id,
      saleDate: addDays(TODAY, -daysAgo),
      bedrooms: 1,
      sizeSqft: 1000,
      priceAed,
      source: "admin" as const,
      completion,
    });
    try {
      await t.db.insert(sales).values([
        // Ready: AED 1,000 per sq ft, and one unusual sale at 3,000.
        sale(10, 1_000_000, "ready"),
        sale(20, 1_010_000, "ready"),
        sale(30, 990_000, "ready"),
        sale(40, 1_000_000, "ready"),
        sale(50, 1_020_000, "ready"),
        sale(60, 3_000_000, "ready"),
        // Off-plan: AED 1,500 per sq ft.
        sale(15, 1_500_000, "off_plan"),
        sale(25, 1_490_000, "off_plan"),
        sale(35, 1_510_000, "off_plan"),
        sale(45, 1_500_000, "off_plan"),
        sale(55, 1_505_000, "off_plan"),
      ]);
      return await fn(b.id);
    } finally {
      await t.db.delete(checks);
      await t.db.delete(buildings).where(eq(buildings.id, b.id));
    }
  }

  const ONE_BED = { buildingText: "TEST TOWER A", areaText: null, bedrooms: 1, sizeSqft: 1000, priceAed: 1_500_000 };

  it("compares an off-plan listing with off-plan sales and every other listing with ready sales", async () => {
    await withOffPlanAndOutlier(async (id) => {
      const offPlan = await runCheck(t.db, { fields: ONE_BED, buildingId: id, source: "manual", completion: "off_plan" }, ctx());
      expect(offPlan.analysis).toMatchObject({ completionBasis: "off_plan", count: 5, medianPsf: 1500, band: "inline", outliersDropped: 0 });
      for (const completion of ["ready", "unknown", undefined] as const) {
        const ready = await runCheck(t.db, { fields: ONE_BED, buildingId: id, source: "manual", completion }, ctx());
        expect(ready.analysis).toMatchObject({ completionBasis: "ready", count: 5, medianPsf: 1000, band: "above", outliersDropped: 1 });
        // The snapshot holds the sales used: the unusual one is not among them.
        expect(ready.sales).toHaveLength(5);
        expect(ready.sales.some((s) => s.priceAed === 3_000_000)).toBe(false);
      }
    });
  });

  it("with no sales data loaded, every comparison is not covered but keeps its building", async () => {
    await setAppMetaRaw("data_through", null);
    try {
      const view = await runCheck(t.db, { fields: MARINA, buildingId: await idOf("Mockup Crest Tower"), source: "manual" }, ctx());
      expect(view.building?.name).toBe("Mockup Crest Tower");
      expect(view.analysis).toMatchObject({ band: "none", count: 0, dataThrough: null, windowEnd: TODAY });
      expect(view.sales).toEqual([]);
      // Nothing to recompute while no data is loaded …
      expect((await getCheckWithCurrent(t.db, view.code, TODAY, DEFAULT_RULES, APP))?.current.band).toBe("none");
      // … and the real verdict once it is.
      await setAppMetaRaw("data_through", TODAY);
      expect((await getCheckWithCurrent(t.db, view.code, TODAY, DEFAULT_RULES, APP))?.current).toMatchObject({ band: "above", count: 11 });
    } finally {
      await setAppMetaRaw("data_through", TODAY);
    }
  });

  it("the window ends at data_through when the data is older than today", async () => {
    const through = addDays(TODAY, -30);
    await setAppMetaRaw("data_through", through);
    try {
      const view = await runCheck(t.db, { fields: MARINA, buildingId: await idOf("Mockup Crest Tower"), source: "manual" }, ctx());
      expect(view.analysis).toMatchObject({ windowEnd: through, windowStart: addDays(through, -365), dataThrough: through });
    } finally {
      await setAppMetaRaw("data_through", TODAY);
    }
  });
});

describe("createCheck", () => {
  it("retries on a share-code collision and fails after 5 attempts", async () => {
    const base = {
      anonId: ANON,
      buildingText: "X Tower",
      bedrooms: 1,
      sizeSqft: 700,
      priceAed: 700_000,
      source: "manual" as const,
      band: "none" as const,
      askingPsf: 1000,
      windowStart: addDays(TODAY, -365),
      windowEnd: TODAY,
      minSales: 3,
      bandPct: 5,
    };
    const first = await createCheck(t.db, base, () => "AAAAAA");
    expect(first.code).toBe("AAAAAA");
    const codes = ["AAAAAA", "AAAAAA", "BBBBBB"];
    const second = await createCheck(t.db, base, () => codes.shift() ?? "CCCCCC");
    expect(second.code).toBe("BBBBBB");
    let calls = 0;
    await expect(
      createCheck(t.db, base, () => {
        calls += 1;
        return "AAAAAA";
      }),
    ).rejects.toThrow(/no free share code/);
    expect(calls).toBe(5);
  });

  it("isUniqueViolation looks through wrapped errors", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error("x", { cause: { code: "23505" } }))).toBe(true);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("getCheckWithCurrent", () => {
  it("returns null for unknown or malformed codes", async () => {
    expect(await getCheckWithCurrent(t.db, "ZZZZZZ", TODAY, DEFAULT_RULES, APP)).toBeNull();
    expect(await getCheckWithCurrent(t.db, "bad", TODAY, DEFAULT_RULES, APP)).toBeNull();
  });

  it("recomputes current for a later day while the stored check stays fixed", async () => {
    const view = await runCheck(t.db, { fields: MARINA, buildingId: await idOf("Mockup Crest Tower"), source: "manual" }, ctx());
    const later = addDays(TODAY, 300); // most test sales fall out of the window
    // Data still running to TODAY: the window stops there, so nothing changes.
    const same = await getCheckWithCurrent(t.db, view.code, later, DEFAULT_RULES, APP);
    expect(same?.check).toEqual(view);
    expect(same?.current).toMatchObject({ windowEnd: TODAY, count: 11, dataThrough: TODAY });
    // A newer snapshot (data through `later`): the window moves with it.
    await setAppMetaRaw("data_through", later);
    try {
      const res = await getCheckWithCurrent(t.db, view.code, later, DEFAULT_RULES, APP);
      expect(res?.check).toEqual(view);
      expect(res?.current.windowEnd).toBe(later);
      expect(res?.current.dataThrough).toBe(later);
      expect(res?.current.count).toBeLessThan(11);
    } finally {
      await setAppMetaRaw("data_through", TODAY);
    }
  });
});

