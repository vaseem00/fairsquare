import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/checks/route";
import { GET as GET_CHECK } from "@/app/api/checks/[code]/route";
import { anonUsers, buildingRequests, buildings, checks, events, rateLimits, sales } from "@/lib/db/schema";
import { CODE_RE } from "@/lib/domain/share-code";
import { COPY } from "@/lib/copy";
import type { AnalysisView, CheckView } from "@/lib/types";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";

const t = setupTestDb();
const APP_URL = "http://localhost:3000";

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

async function buildingId(name: string): Promise<number> {
  const [row] = await t.db.select({ id: buildings.id }).from(buildings).where(eq(buildings.name, name));
  return row.id;
}

type ErrBody = { error: { code: string; message: string; fields?: Record<string, string> } };

const MARINA_FIELDS = { buildingText: "Mockup Crest", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 };

async function postCheck(json: unknown, cookies?: Record<string, string>) {
  return call<{ check: CheckView } & ErrBody>(POST, { method: "POST", url: "/api/checks", json, cookies });
}

describe("POST /api/checks", () => {
  it("Mockup Crest Tower 2-bed: 201, above, +13.95%, 11 ready sales, stored with edited fields and ref", async () => {
    // a comparison to refer from
    const first = await postCheck({ fields: MARINA_FIELDS, buildingId: await buildingId("Mockup Crest Tower"), source: "manual" });
    const refCode = first.body.check.code;

    const res = await postCheck({
      fields: MARINA_FIELDS,
      buildingId: await buildingId("Mockup Crest Tower"),
      source: "claude",
      editedFields: ["priceAed", "buildingText"],
      ref: ` ${refCode.toLowerCase()} `,
    });
    expect(res.status).toBe(201);
    expect(res.cookies.mz_aid).toBeDefined();
    const c = res.body.check;
    expect(c.analysis.band).toBe("above");
    expect(c.analysis.diff).toBeCloseTo(0.13953, 4);
    expect(c.analysis.count).toBe(11);
    expect(c.analysis.medianPsf).toBeCloseTo(1674.45, 2);
    expect(c.analysis.medianPriceAed).toBe(2_140_000);
    expect(c.analysis.askingPsf).toBeCloseTo(1908.1, 1);
    expect(c.analysis.windowStart).toBe("2025-11-17");
    expect(c.analysis.windowEnd).toBe("2026-11-17");
    expect(c.sales).toHaveLength(11);
    expect(c.sales[0].saleDate >= c.sales[10].saleDate).toBe(true);
    expect(c.sales[0].psf).toBeCloseTo(c.sales[0].priceAed / c.sales[0].sizeSqft, 6);
    expect(c).not.toHaveProperty("isSample");
    expect(c).not.toHaveProperty("isDemo");
    expect(c.analysis).toMatchObject({ completionBasis: "ready", outliersDropped: 0, medianSizeSqft: 1284, dataThrough: "2026-11-17" });
    expect(c.source).toBe("claude");
    // The official DLD area is kept with the comparison (REAL_DATA.md section 6).
    expect(c.building).toEqual({ id: await buildingId("Mockup Crest Tower"), name: "Mockup Crest Tower", area: "Dubai Marina", areaDld: "Marsa Dubai" });
    expect(c.buildingText).toBe("Mockup Crest");
    expect(c.rules).toEqual({ minSales: 5, windowDays: 365, bandPct: 5 });
    expect(c.code).toMatch(CODE_RE);
    expect(c.url).toBe(`${APP_URL}/c/${c.code}`);
    expect(c.propertyType).toBe("unknown");
    expect(c.completion).toBe("unknown");
    // Nothing set aside, and no size source when the client gives none (RESULT_SPEC section 12.2).
    expect(c.setAsideSales).toEqual([]);
    expect(c.sizeSource).toBeNull();

    const [row] = await t.db.select().from(checks).where(eq(checks.code, c.code));
    expect(row).toMatchObject({ setAsideSnapshot: [], sizeSource: null });
    expect(row.editedFields.sort()).toEqual(["buildingText", "priceAed"]);
    expect(row.refCode).toBe(refCode);
    expect(row.salesSnapshot).toHaveLength(11);
    expect(row.anonId).toBeTruthy();
    const [anon] = await t.db.select().from(anonUsers).where(eq(anonUsers.id, row.anonId));
    expect(anon.refCode).toBe(refCode);

    expect(row).toMatchObject({ completionBasis: "ready", outliersDropped: 0, dataThrough: "2026-11-17" });

    const created = await t.db.select().from(events).where(and(eq(events.name, "check_created"), eq(events.checkId, row.id)));
    expect(created).toHaveLength(1);
    expect(created[0].meta).toMatchObject({ band: "above", source: "claude", basis: "ready", fromShare: true });
  });

  it("stores and returns the size source: a size button is 'cluster' (RESULT_SPEC sections 2.5 and 12.2)", async () => {
    const id = await buildingId("Mockup Crest Tower");
    const res = await postCheck({ fields: { ...MARINA_FIELDS, sizeSqft: 1285 }, buildingId: id, source: "text", sizeSource: "cluster" });
    expect(res.status).toBe(201);
    expect(res.body.check.sizeSource).toBe("cluster");
    const [row] = await t.db.select().from(checks).where(eq(checks.code, res.body.check.code));
    expect(row.sizeSource).toBe("cluster");
    const got = await call<{ check: CheckView }>(GET_CHECK, { url: `/api/checks/${row.code}`, params: { code: row.code } });
    expect(got.body.check.sizeSource).toBe("cluster");
    for (const sizeSource of ["read", "typed"]) {
      const ok = await postCheck({ fields: MARINA_FIELDS, buildingId: id, source: "claude", sizeSource });
      expect(ok.body.check.sizeSource).toBe(sizeSource);
    }
    const bad = await postCheck({ fields: MARINA_FIELDS, buildingId: id, source: "claude", sizeSource: "guess" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields?.sizeSource).toBeTruthy();
  });

  it("an unusual sale is set aside: not compared, stored and returned as setAsideSales (RESULT_SPEC section 12.2)", async () => {
    const id = await buildingId("Mockup Crest Tower");
    // AED 4,673 per sq ft: more than twice the median (1,674), so it is left out.
    await t.db.insert(sales).values({ buildingId: id, saleDate: "2026-11-05", bedrooms: 2, sizeSqft: 1284, priceAed: 6_000_000, source: "admin" });
    try {
      const res = await postCheck({ fields: MARINA_FIELDS, buildingId: id, source: "manual" });
      expect(res.status).toBe(201);
      const c = res.body.check;
      expect(c.analysis).toMatchObject({ count: 11, outliersDropped: 1, band: "above" });
      expect(c.sales).toHaveLength(11);
      expect(c.sales.some((s) => s.priceAed === 6_000_000)).toBe(false);
      expect(c.setAsideSales).toHaveLength(1);
      expect(c.setAsideSales[0]).toMatchObject({ saleDate: "2026-11-05", sizeSqft: 1284, priceAed: 6_000_000, source: "admin" });
      expect(c.setAsideSales[0].psf).toBeCloseTo(6_000_000 / 1284, 6);
      const [row] = await t.db.select().from(checks).where(eq(checks.code, c.code));
      expect(row.setAsideSnapshot).toEqual([{ saleDate: "2026-11-05", sizeSqft: 1284, priceAed: 6_000_000, source: "admin" }]);
      const got = await call<{ check: CheckView }>(GET_CHECK, { url: `/api/checks/${c.code}`, params: { code: c.code } });
      expect(got.body.check.setAsideSales).toEqual(c.setAsideSales);
    } finally {
      await t.db.delete(sales).where(eq(sales.priceAed, 6_000_000));
    }
  });

  it("a sample source → 422 (samples are gone, REAL_DATA.md section 8)", async () => {
    const res = await postCheck({ fields: MARINA_FIELDS, buildingId: await buildingId("Mockup Crest Tower"), source: "sample" });
    expect(res.status).toBe(422);
    expect(res.body.error.fields?.source).toBeTruthy();
  });

  it("an off-plan listing is compared with off-plan sales only (none here: 0 of 5)", async () => {
    const res = await postCheck({
      fields: MARINA_FIELDS,
      buildingId: await buildingId("Mockup Crest Tower"),
      source: "manual",
      completion: "off_plan",
    });
    expect(res.status).toBe(201);
    expect(res.body.check.completion).toBe("off_plan");
    expect(res.body.check.analysis).toMatchObject({ completionBasis: "off_plan", band: "thin", count: 0 });
  });

  it("ignores an invalid or unknown ref", async () => {
    const id = await buildingId("Mockup Crest Tower");
    const a = await postCheck({ fields: MARINA_FIELDS, buildingId: id, source: "manual", ref: "nope!" });
    const b = await postCheck({ fields: MARINA_FIELDS, buildingId: id, source: "manual", ref: "ZZZZZZ" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const rows = await t.db.select({ ref: checks.refCode }).from(checks);
    expect(rows.every((r) => r.ref === null)).toBe(true);
  });

  it("JVC 1-bed: inline, −1.7%", async () => {
    const res = await postCheck({
      fields: { buildingText: "Fake Vista Residences", areaText: "Jumeirah Village Circle", bedrooms: 1, sizeSqft: 742, priceAed: 865_000 },
      buildingId: await buildingId("Fake Vista Residences"),
      source: "text",
    });
    expect(res.status).toBe(201);
    expect(res.body.check.analysis.band).toBe("inline");
    expect(res.body.check.analysis.diff).toBeCloseTo(-0.01705, 4);
    expect(res.body.check.analysis.count).toBe(9);
    expect(res.body.check.source).toBe("text");
  });

  it("Dummyside Heights 2 3-bed: thin, 2 sales, no diff", async () => {
    const res = await postCheck({
      fields: { buildingText: "Dummyside Heights 2", areaText: "Al Jaddaf", bedrooms: 3, sizeSqft: 1905, priceAed: 3_600_000 },
      buildingId: await buildingId("Dummyside Heights 2"),
      source: "manual",
    });
    expect(res.status).toBe(201);
    const a = res.body.check.analysis;
    expect(a.band).toBe("thin");
    expect(a.count).toBe(2);
    expect(a.diff).toBeNull();
    expect(a.medianPriceAed).toBeNull();
    expect(a.medianPsf).toBeCloseTo(1688.16, 2);
    expect(res.body.check.sales).toHaveLength(2);
  });

  it("Fake Vista Residences 2 1-bed: 3 sales are too few with MIN_SALES 5", async () => {
    const res = await postCheck({
      fields: { buildingText: "Fake Vista Res 2", areaText: null, bedrooms: 1, sizeSqft: 720, priceAed: 830_000 },
      buildingId: await buildingId("Fake Vista Residences 2"),
      source: "text",
    });
    expect(res.status).toBe(201);
    expect(res.body.check.analysis).toMatchObject({ count: 3, band: "thin", diff: null });
    expect(res.body.check.rules.minSales).toBe(5);
  });

  it("Mockup Crest Tower 1-bed: thin with no sales", async () => {
    const res = await postCheck({
      fields: { ...MARINA_FIELDS, bedrooms: 1, sizeSqft: 800, priceAed: 1_400_000 },
      buildingId: await buildingId("Mockup Crest Tower"),
      source: "manual",
    });
    expect(res.body.check.analysis).toMatchObject({ band: "thin", count: 0, medianPsf: null, diff: null });
    expect(res.body.check.sales).toEqual([]);
  });

  it("bedrooms: null → 422 with fields.bedrooms", async () => {
    const res = await postCheck({
      fields: { ...MARINA_FIELDS, bedrooms: null },
      buildingId: await buildingId("Mockup Crest Tower"),
      source: "manual",
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
    expect(res.body.error.fields?.["fields.bedrooms"]).toBe(COPY["err.bedrooms"]);
    expect(await t.db.select().from(checks)).toHaveLength(0);
  });

  it("AED 2,450,000 for 200 sq ft → 422 with the psf message on both size and price", async () => {
    const res = await postCheck({
      fields: { ...MARINA_FIELDS, sizeSqft: 200 },
      buildingId: await buildingId("Mockup Crest Tower"),
      source: "manual",
    });
    expect(res.status).toBe(422);
    const f = res.body.error.fields ?? {};
    expect(f["fields.sizeSqft"]).toBeTruthy();
    expect(f["fields.sizeSqft"]).toBe(f["fields.priceAed"]);
  });

  it("an unknown buildingId → 404 building_not_found", async () => {
    const res = await postCheck({ fields: MARINA_FIELDS, buildingId: 999_999, source: "manual" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("building_not_found");
  });

  it("buildingId: null → 201 band none and no building request", async () => {
    const res = await postCheck({
      fields: { buildingText: "Nowhere Point Tower", areaText: "Dubai Creek Harbour", bedrooms: 2, sizeSqft: 1150, priceAed: 2_300_000 },
      buildingId: null,
      source: "manual",
    });
    expect(res.status).toBe(201);
    const c = res.body.check;
    expect(c.building).toBeNull();
    expect(c.analysis).toMatchObject({ band: "none", count: 0, medianPsf: null, diff: null, medianPriceAed: null });
    expect(c.analysis.askingPsf).toBeCloseTo(2_300_000 / 1150, 6);
    expect(c.sales).toEqual([]);
    expect(c.areaText).toBe("Dubai Creek Harbour");
    expect(await t.db.select().from(buildingRequests)).toHaveLength(0);
  });

  it("rejects cross-site posts", async () => {
    const res = await call(POST, {
      method: "POST",
      url: "/api/checks",
      json: { fields: MARINA_FIELDS, buildingId: null, source: "manual" },
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
  });

  it("allows 100 checks per Dubai day, the 101st → 429", async () => {
    const id = await buildingId("Mockup Crest Tower");
    const first = await postCheck({ fields: MARINA_FIELDS, buildingId: id, source: "manual" });
    const cookie = first.cookies.mz_aid.value;
    const anonId = (await t.db.select().from(checks))[0].anonId;
    // 99 more are allowed: set the counter to 99, then the 100th passes and the 101st is denied.
    await t.db.update(rateLimits).set({ count: 99 }).where(eq(rateLimits.key, `checks:anon:${anonId}`));
    const hundredth = await postCheck({ fields: MARINA_FIELDS, buildingId: id, source: "manual" }, { mz_aid: cookie });
    expect(hundredth.status).toBe(201);
    const res = await postCheck({ fields: MARINA_FIELDS, buildingId: id, source: "manual" }, { mz_aid: cookie });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("rate_limited");
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(await t.db.select().from(checks)).toHaveLength(2);
  });

  it("a price with fils (2,450,000.50) is rounded to whole dirhams and stored, not a 500", async () => {
    const id = await buildingId("Mockup Crest Tower");
    const res = await postCheck({ fields: { ...MARINA_FIELDS, priceAed: 2_450_000.5 }, buildingId: id, source: "manual" });
    expect(res.status).toBe(201);
    const [row] = await t.db.select().from(checks);
    expect(row.priceAed).toBe(2_450_001);
  });

  it("the per-IP daily limit applies when a script drops its cookie on every call", async () => {
    const id = await buildingId("Mockup Crest Tower");
    await postCheck({ fields: MARINA_FIELDS, buildingId: id, source: "manual" });
    const [row] = await t.db.select().from(rateLimits).where(like(rateLimits.key, "checks:ip:%"));
    await t.db.update(rateLimits).set({ count: 499 }).where(eq(rateLimits.key, row.key));
    expect((await postCheck({ fields: MARINA_FIELDS, buildingId: id, source: "manual" })).status).toBe(201);
    const res = await postCheck({ fields: MARINA_FIELDS, buildingId: id, source: "manual" });
    expect(res.status).toBe(429);
    expect(await t.db.select().from(checks)).toHaveLength(2);
  });
});

describe("GET /api/checks/[code]", () => {
  it("returns the stored check and today's verdict; a new sale moves current only", async () => {
    const id = await buildingId("Mockup Crest Tower");
    const created = await postCheck({ fields: MARINA_FIELDS, buildingId: id, source: "manual" });
    const code = created.body.check.code;

    const before = await call<{ check: CheckView; current: AnalysisView }>(GET_CHECK, {
      url: `/api/checks/${code}`,
      params: { code },
    });
    expect(before.status).toBe(200);
    expect(before.body.check.code).toBe(code);
    expect(before.body.current.count).toBe(11);
    expect(before.body.current.band).toBe("above");
    expect(before.setCookies).toEqual([]);
    expect(before.headers.get("cache-control")).toBe("no-store");

    await t.db.insert(sales).values({
      buildingId: id,
      saleDate: "2026-11-10",
      bedrooms: 2,
      sizeSqft: 1300,
      priceAed: 2_500_000,
      source: "admin",
    });

    const after = await call<{ check: CheckView; current: AnalysisView }>(GET_CHECK, {
      url: `/api/checks/${code.toLowerCase()}`,
      params: { code: code.toLowerCase() },
    });
    expect(after.status).toBe(200);
    expect(after.body.current.count).toBe(12);
    expect(after.body.check.analysis.count).toBe(11);
    expect(after.body.check.sales).toHaveLength(11);
    expect(after.setCookies).toEqual([]);
  });

  it("a none comparison keeps its stored analysis as current", async () => {
    const created = await postCheck({
      fields: { buildingText: "Nowhere Point Tower", areaText: null, bedrooms: 2, sizeSqft: 1150, priceAed: 2_300_000 },
      buildingId: null,
      source: "manual",
    });
    const code = created.body.check.code;
    const res = await call<{ check: CheckView; current: AnalysisView }>(GET_CHECK, { url: `/api/checks/${code}`, params: { code } });
    expect(res.status).toBe(200);
    expect(res.body.current).toEqual(res.body.check.analysis);
  });

  it("unknown or malformed code → 404 not_found, and never sets mz_aid", async () => {
    for (const code of ["ZZZZZZ", "nope", "ABCDE0"]) {
      const res = await call<ErrBody>(GET_CHECK, { url: `/api/checks/${code}`, params: { code } });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("not_found");
      expect(res.setCookies).toEqual([]);
    }
  });
});
