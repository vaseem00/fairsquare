/**
 * Admin sales and buildings (A§4.4):
 * - Register a sale: stored with source "admin"; a future date is rejected.
 * - Preview returns admin.impact with exact before/after medians and the saved listings affected
 *   (Marina 2-bed plus a 2,236,000 / 1,284 sale).
 * - Delete removes the sale.
 * - Buildings: adding a building and an alias works, and matching sees the alias at once.
 */
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as matchGet } from "@/app/api/buildings/match/route";
import { GET as optionsGet } from "@/app/api/admin/buildings/options/route";
import { GET as buildingsGet, POST as buildingsPost } from "@/app/api/admin/buildings/route";
import { POST as aliasPost } from "@/app/api/admin/buildings/[id]/aliases/route";
import { POST as previewPost } from "@/app/api/admin/sales/preview/route";
import { DELETE as saleDelete } from "@/app/api/admin/sales/[id]/route";
import { GET as salesGet, POST as salesPost } from "@/app/api/admin/sales/route";
import { COPY } from "@/lib/copy";
import { median } from "@/lib/domain/analyse";
import { invalidateAliasCache, recentSales } from "@/lib/db/repo/buildings";
import { appMeta, buildingAliases, buildings, sales } from "@/lib/db/schema";
import type { MatchResponse } from "@/lib/types";
import type { AdminBuilding, AdminSale, SalePreview } from "@/lib/validation/admin";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";
import { addAnon, addCheck, addSaved, adminCookies, buildingId, pinClock } from "./admin-helpers";

const t = setupTestDb();
let cookies: Record<string, string>;
let marina: number;

type Err = { error: { code: string; fields?: Record<string, string> } };

beforeEach(async () => {
  pinClock();
  await clearUserData(t.db);
  cookies = await adminCookies(t.db);
  marina = await buildingId(t.db, "Mockup Crest Tower");
});
afterEach(() => vi.useRealTimers());

const sale = (over: Record<string, unknown> = {}) => ({
  buildingId: marina,
  saleDate: "2026-11-10",
  bedrooms: 2,
  sizeSqft: 1284,
  priceAed: 2_236_000,
  ...over,
});

describe("POST /api/admin/sales/preview", () => {
  it("Marina 2-bed + 2,236,000 / 1,284: exact medians, saved listings affected, admin.impact", async () => {
    const anon = await addAnon(t.db);
    for (let i = 0; i < 3; i++) {
      const c = await addCheck(t.db, { anonId: anon, buildingId: marina, bedrooms: 2 });
      await addSaved(t.db, anon, c.id);
    }
    const other = await addCheck(t.db, { anonId: anon, buildingId: marina, bedrooms: 1 });
    await addSaved(t.db, anon, other.id);

    const current = await recentSales(t.db, marina, 2, "ready", { start: "2025-11-17", end: "2026-11-17" });
    expect(current).toHaveLength(11);
    const psfs = current.map((s) => s.priceAed / s.sizeSqft);
    const expectedAfter = median([...psfs, 2_236_000 / 1284]) as number;

    const before = await t.db.select().from(sales);
    const res = await call<SalePreview>(previewPost, { method: "POST", url: "/api/admin/sales/preview", json: sale(), cookies });
    expect(res.status).toBe(200);
    expect(res.body.before.count).toBe(11);
    expect(res.body.before.medianPsf).toBeCloseTo(1674.45, 2);
    expect(res.body.after.count).toBe(12);
    expect(res.body.after.medianPsf).toBeCloseTo(expectedAfter, 9);
    expect(res.body.after.medianPsf).not.toBeCloseTo(res.body.before.medianPsf as number, 1);
    expect(res.body.savedListingsAffected).toBe(3);
    expect(res.body.inWindow).toBe(true);
    expect(res.body.impact).toBe(
      `The 2-bed median in Mockup Crest Tower moves from AED 1,674 to AED ${Math.round(expectedAfter).toLocaleString("en-US")} per sq ft. 3 saved listings will show a new sale.`,
    );
    // writes nothing
    expect(await t.db.select().from(sales)).toHaveLength(before.length);
  });

  it("a sale older than the window changes nothing", async () => {
    const res = await call<SalePreview>(previewPost, {
      method: "POST",
      url: "/x",
      json: sale({ saleDate: "2024-01-10" }),
      cookies,
    });
    expect(res.body.inWindow).toBe(false);
    expect(res.body.after).toEqual(res.body.before);
    expect(res.body.savedListingsAffected).toBe(0);
  });

  it("a building with no sales yet uses the 'becomes' sentence", async () => {
    const res = await call<SalePreview>(previewPost, {
      method: "POST",
      url: "/x",
      json: sale({ bedrooms: 4, sizeSqft: 2600, priceAed: 4_500_000 }),
      cookies,
    });
    expect(res.body.before.medianPsf).toBeNull();
    expect(res.body.impact).toMatch(/^The 4-bed median in Mockup Crest Tower becomes AED 1,731 per sq ft\./);
  });

  it("an off-plan sale only moves the off-plan median and off-plan saved listings", async () => {
    const anon = await addAnon(t.db);
    const ready = await addCheck(t.db, { anonId: anon, buildingId: marina, bedrooms: 2 });
    await addSaved(t.db, anon, ready.id);
    const offPlan = await addCheck(t.db, { anonId: anon, buildingId: marina, bedrooms: 2, completionBasis: "off_plan" });
    await addSaved(t.db, anon, offPlan.id);
    const res = await call<SalePreview>(previewPost, { method: "POST", url: "/x", json: sale({ completion: "off_plan" }), cookies });
    expect(res.status).toBe(200);
    expect(res.body.before).toEqual({ count: 0, medianPsf: null, medianPriceAed: null });
    expect(res.body.after.count).toBe(1);
    expect(res.body.savedListingsAffected).toBe(1);
  });

  it("a sale after data_through is outside the window (it waits for the comparisons' window)", async () => {
    await t.db.update(appMeta).set({ value: "2026-11-01" }).where(eq(appMeta.key, "data_through"));
    try {
      const res = await call<SalePreview>(previewPost, { method: "POST", url: "/x", json: sale({ saleDate: "2026-11-10" }), cookies });
      expect(res.body.inWindow).toBe(false);
      expect(res.body.impact).toBe(COPY["adminUi.impactOutside"]);
    } finally {
      await t.db.update(appMeta).set({ value: "2026-11-17" }).where(eq(appMeta.key, "data_through"));
    }
  });
});

describe("POST /api/admin/sales", () => {
  it("stores the sale with source admin", async () => {
    const res = await call<{ sale: AdminSale }>(salesPost, { method: "POST", url: "/api/admin/sales", json: sale(), cookies });
    expect(res.status).toBe(201);
    expect(res.body.sale).toMatchObject({
      buildingId: marina,
      buildingName: "Mockup Crest Tower",
      saleDate: "2026-11-10",
      bedrooms: 2,
      sizeSqft: 1284,
      priceAed: 2_236_000,
      source: "admin",
      completion: "ready",
      externalRef: null,
    });
    expect(res.body.sale).not.toHaveProperty("isDemo");
    const [row] = await t.db.select().from(sales).where(eq(sales.id, res.body.sale.id));
    expect(row).toMatchObject({ source: "admin", completion: "ready" });

    const withRef = await call<{ sale: AdminSale }>(salesPost, {
      method: "POST",
      url: "/x",
      json: sale({ externalRef: "TEST-REF-1", priceAed: 2_240_000, completion: "off_plan", isDemo: true }),
      cookies,
    });
    // An old client's isDemo is ignored; the completion is stored.
    expect(withRef.body.sale).toMatchObject({ externalRef: "TEST-REF-1", source: "admin", completion: "off_plan" });
    const [offPlan] = await t.db.select().from(sales).where(eq(sales.id, withRef.body.sale.id));
    expect(offPlan.completion).toBe("off_plan");

    const bad = await call<Err>(salesPost, { method: "POST", url: "/x", json: sale({ completion: "unknown" }), cookies });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields?.completion).toBe(COPY["adminUi.err.completion"]);
  });

  it("rounds a price with fils to whole dirhams instead of failing the bigint insert", async () => {
    const res = await call<{ sale: AdminSale }>(salesPost, { method: "POST", url: "/x", json: sale({ priceAed: 2_236_000.5 }), cookies });
    expect(res.status).toBe(201);
    expect(res.body.sale.priceAed).toBe(2_236_001);
  });

  it("rejects a future date, a wrong price per sq ft and missing fields", async () => {
    const future = await call<Err>(salesPost, { method: "POST", url: "/x", json: sale({ saleDate: "2026-11-18" }), cookies });
    expect(future.status).toBe(422);
    expect(future.body.error.fields?.saleDate).toBe("The date can't be in the future.");
    const today = await call(salesPost, { method: "POST", url: "/x", json: sale({ saleDate: "2026-11-17" }), cookies });
    expect(today.status).toBe(201);

    const psf = await call<Err>(salesPost, { method: "POST", url: "/x", json: sale({ priceAed: 9_000_000 }), cookies });
    expect(psf.status).toBe(422);
    expect(psf.body.error.fields?.sizeSqft).toMatch(/per sq ft, which looks wrong/);
    expect(psf.body.error.fields?.priceAed).toMatch(/per sq ft, which looks wrong/);

    const empty = await call<Err>(salesPost, { method: "POST", url: "/x", json: {}, cookies });
    expect(empty.status).toBe(422);
    expect(Object.keys(empty.body.error.fields ?? {}).sort()).toEqual(["bedrooms", "buildingId", "priceAed", "saleDate", "sizeSqft"]);

    const studio = await call(salesPost, {
      method: "POST",
      url: "/x",
      json: sale({ bedrooms: 0, sizeSqft: 450, priceAed: 700_000 }),
      cookies,
    });
    expect(studio.status).toBe(201);
  });

  it("an unknown building is 404; a reference used twice is 422", async () => {
    const unknown = await call<Err>(salesPost, { method: "POST", url: "/x", json: sale({ buildingId: 99999 }), cookies });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("building_not_found");
    expect((await call(salesPost, { method: "POST", url: "/x", json: sale({ externalRef: "TX-9" }), cookies })).status).toBe(201);
    const dup = await call<Err>(salesPost, { method: "POST", url: "/x", json: sale({ externalRef: "TX-9" }), cookies });
    expect(dup.status).toBe(422);
    expect(dup.body.error.fields?.externalRef).toBe("A sale with this reference is already registered.");
  });
});

describe("GET /api/admin/sales and DELETE /api/admin/sales/[id]", () => {
  it("filters by building and bedrooms, newest first, and deletes", async () => {
    const created = await call<{ sale: AdminSale }>(salesPost, { method: "POST", url: "/x", json: sale(), cookies });
    const list = await call<{ sales: AdminSale[] }>(salesGet, { url: `/api/admin/sales?buildingId=${marina}&bedrooms=2`, cookies });
    expect(list.status).toBe(200);
    expect(list.body.sales).toHaveLength(12);
    expect(list.body.sales.every((s) => s.buildingId === marina && s.bedrooms === 2)).toBe(true);
    const dates = list.body.sales.map((s) => s.saleDate);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(list.body.sales[0].psf).toBeCloseTo(list.body.sales[0].priceAed / list.body.sales[0].sizeSqft, 9);

    const all = await call<{ sales: AdminSale[] }>(salesGet, { url: "/api/admin/sales", cookies });
    expect(all.body.sales).toHaveLength(33);

    const id = created.body.sale.id;
    const del = await call(saleDelete, { method: "DELETE", url: `/api/admin/sales/${id}`, params: { id: String(id) }, cookies });
    expect(del.status).toBe(204);
    expect(await t.db.select().from(sales).where(eq(sales.id, id))).toHaveLength(0);
    const again = await call(saleDelete, { method: "DELETE", url: "/x", params: { id: String(id) }, cookies });
    expect(again.status).toBe(404);
  });

  it("rejects a bad filter", async () => {
    expect((await call(salesGet, { url: "/api/admin/sales?bedrooms=9", cookies })).status).toBe(422);
  });
});

describe("buildings and aliases", () => {
  async function match(q: string): Promise<MatchResponse> {
    const res = await call<MatchResponse>(matchGet, { url: `/api/buildings/match?q=${encodeURIComponent(q)}` });
    expect(res.status).toBe(200);
    return res.body;
  }

  it("adds a building with aliases; matching sees it at once", async () => {
    // warm the 60 s alias cache first
    expect((await match("Nowhere Point Tower")).candidates).toEqual([]);
    const res = await call<{ building: AdminBuilding }>(buildingsPost, {
      method: "POST",
      url: "/api/admin/buildings",
      json: { name: "Nowhere Point Tower", area: "Dubai Creek Harbour", aliases: ["Nowhere Pt", "Nowhere Point"] },
      cookies,
    });
    expect(res.status).toBe(201);
    const b = res.body.building;
    expect(b).toMatchObject({ name: "Nowhere Point Tower", area: "Dubai Creek Harbour", areaDld: null, project: null, fromOpenData: false, salesCount: 0 });
    expect(b.aliases.map((a) => a.alias)).toEqual(["Nowhere Point Tower", "Nowhere Pt", "Nowhere Point"]);
    expect(b.aliases.every((a) => a.source === "admin")).toBe(true);
    const m = await match("Nowhere Point Tower");
    expect(m.candidates[0]).toMatchObject({ buildingId: b.id, name: "Nowhere Point Tower" });

    const list = await call<{ buildings: AdminBuilding[] }>(buildingsGet, { url: "/api/admin/buildings", cookies });
    expect(list.body.buildings.map((x) => x.name)).toContain("Nowhere Point Tower");
    expect(list.body.buildings.find((x) => x.name === "Mockup Crest Tower")).toMatchObject({
      salesCount: 11,
      areaDld: "Marsa Dubai",
      fromOpenData: true,
    });

    // tidy up for the other tests (cascade removes its aliases)
    await t.db.execute(`delete from buildings where name = 'Nowhere Point Tower'`);
  });

  it("GET is searched and paged on the server (50 a page, by name); options lists every building", async () => {
    // 60 more synthetic buildings, so the list runs to two pages.
    const extra = await t.db
      .insert(buildings)
      .values(Array.from({ length: 60 }, (_, i) => ({ name: `TEST PAGED ${String(i + 1).padStart(3, "0")}`, area: "Test Paged Area", areaDld: "Test Dld Paged" })))
      .returning({ id: buildings.id });
    try {
      type Page = { buildings: AdminBuilding[]; total: number; page: number; pageSize: number; q: string | null };
      const get = (qs = "") => call<Page>(buildingsGet, { url: `/api/admin/buildings${qs}`, cookies });
      const all = await t.db.select({ id: buildings.id }).from(buildings);
      const p1 = await get();
      expect(p1.status).toBe(200);
      expect(p1.body).toMatchObject({ total: all.length, page: 1, pageSize: 50, q: null });
      expect(p1.body.buildings).toHaveLength(50);
      const names = p1.body.buildings.map((b) => b.name);
      expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      const p2 = await get("?page=2");
      expect(p2.body.buildings).toHaveLength(all.length - 50);
      expect(new Set([...names, ...p2.body.buildings.map((b) => b.name)]).size).toBe(all.length);
      expect((await get("?page=9")).body).toMatchObject({ buildings: [], total: all.length, page: 9 });

      // Name, area, DLD area and aliases; one character is no search.
      expect((await get("?q=paged%2005")).body.buildings.map((b) => b.name)).toEqual(["TEST PAGED 050", "TEST PAGED 051", "TEST PAGED 052", "TEST PAGED 053", "TEST PAGED 054", "TEST PAGED 055", "TEST PAGED 056", "TEST PAGED 057", "TEST PAGED 058", "TEST PAGED 059"]);
      expect((await get("?q=test%20dld%20paged")).body.total).toBe(60);
      expect((await get("?q=marsa")).body.buildings.map((b) => b.name)).toContain("Mockup Crest Tower");
      // A word that is only in an alias.
      await t.db.insert(buildingAliases).values({ buildingId: marina, aliasRaw: "TEST OTHER NAME", aliasNorm: "test other name", source: "admin" });
      expect((await get("?q=other%20name")).body.buildings.map((b) => b.id)).toEqual([marina]);
      await t.db.delete(buildingAliases).where(eq(buildingAliases.aliasNorm, "test other name"));
      expect((await get("?q=%25")).body).toMatchObject({ q: null, total: all.length });
      expect((await get("?q=100%25")).body.total).toBe(0);
      expect((await get("?page=0")).status).toBe(422);
      expect((await get("?page=x")).status).toBe(422);

      const opts = await call<{ options: Array<{ id: number; name: string; area: string }> }>(optionsGet, { url: "/api/admin/buildings/options", cookies });
      expect(opts.status).toBe(200);
      expect(opts.body.options).toHaveLength(all.length);
      expect(Object.keys(opts.body.options[0]).sort()).toEqual(["area", "id", "name"]);
      expect((await call(optionsGet, { url: "/api/admin/buildings/options" })).status).toBe(401);
    } finally {
      await t.db.delete(buildings).where(inArray(buildings.id, extra.map((e) => e.id)));
    }
  });

  it("adds an alias and matching uses it immediately", async () => {
    expect((await match("Azure Quay")).candidates).toEqual([]);
    const res = await call<{ alias: { alias: string; aliasNorm: string }; created: boolean }>(aliasPost, {
      method: "POST",
      url: `/api/admin/buildings/${marina}/aliases`,
      params: { id: String(marina) },
      json: { alias: "Azure Quay" },
      cookies,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: true, alias: { alias: "Azure Quay", aliasNorm: "azure quay" } });
    const m = await match("Azure Quay");
    expect(m.candidates[0]).toMatchObject({ buildingId: marina, name: "Mockup Crest Tower", strength: "strong" });

    const dup = await call<{ created: boolean }>(aliasPost, {
      method: "POST",
      url: "/x",
      params: { id: String(marina) },
      json: { alias: "azure  QUAY" },
      cookies,
    });
    expect(dup.status).toBe(200);
    expect(dup.body.created).toBe(false);
    await t.db.execute(`delete from building_aliases where alias_norm = 'azure quay'`);
  });

  it("rejects a duplicate name in the same area, an unknown building and an empty alias", async () => {
    for (const area of ["Dubai Marina", "marsa dubai"]) {
      const dup = await call<Err>(buildingsPost, {
        method: "POST",
        url: "/x",
        json: { name: "mockup crest tower", area },
        cookies,
      });
      expect(dup.status, area).toBe(422);
      expect(dup.body.error.fields?.name).toBe(COPY["adminUi.err.nameTaken"]);
    }
    // DLD names repeat across areas (REAL_DATA.md section 5): the same name elsewhere is a new building.
    const elsewhere = await call<{ building: AdminBuilding }>(buildingsPost, {
      method: "POST",
      url: "/x",
      json: { name: "Mockup Crest Tower", area: "Test Other Area" },
      cookies,
    });
    expect(elsewhere.status).toBe(201);
    await t.db.delete(buildings).where(eq(buildings.id, elsewhere.body.building.id));
    invalidateAliasCache();
    const missing = await call<Err>(buildingsPost, { method: "POST", url: "/x", json: { name: "X" }, cookies });
    expect(missing.status).toBe(422);
    expect(Object.keys(missing.body.error.fields ?? {}).sort()).toEqual(["area", "name"]);
    const unknown = await call<Err>(aliasPost, { method: "POST", url: "/x", params: { id: "99999" }, json: { alias: "Abc" }, cookies });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("building_not_found");
    const blank = await call<Err>(aliasPost, { method: "POST", url: "/x", params: { id: String(marina) }, json: { alias: "!!!" }, cookies });
    expect(blank.status).toBe(422);
    expect(blank.body.error.fields?.alias).toBeTruthy();
  });
});
