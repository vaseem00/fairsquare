/**
 * POST /api/admin/import (A§4.4):
 * - A dry run of tests/fixtures/csv/sales-mixed.csv reports ok 23, rejected 2 (line numbers and
 *   reasons) plus the per-building impact, and writes nothing.
 * - commit=1 runs in one transaction; a forced DB error rolls everything back. Committed rows have
 *   source "import" and the completion from the column (ready when blank); data_imported_at is set.
 * - Re-importing the same file skips every row. size_sqm is converted.
 * - A name shared by buildings in several areas needs the area column.
 * - Buildings (by name and area; DLD buildings untouched) and aliases (unknown building rejected,
 *   duplicates skipped).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/import/route";
import { GET as matchGet } from "@/app/api/buildings/match/route";
import { COPY, t as t2 } from "@/lib/copy";
import { median } from "@/lib/domain/analyse";
import { getAppMeta, setAppMeta } from "@/lib/db/meta";
import { invalidateAliasCache, recentSales } from "@/lib/db/repo/buildings";
import { appMeta, buildingAliases, buildings, sales } from "@/lib/db/schema";
import type { MatchResponse } from "@/lib/types";
import type { ImportResult } from "@/lib/validation/admin";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";
import { adminCookies, buildingId, pinClock } from "./admin-helpers";

vi.mock("@/lib/db/meta", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/meta")>();
  return { ...actual, setAppMeta: vi.fn(actual.setAppMeta) };
});

const t = setupTestDb();
let cookies: Record<string, string>;
const FIXTURE = readFileSync(path.join(process.cwd(), "tests", "fixtures", "csv", "sales-mixed.csv"), "utf8");

beforeEach(async () => {
  pinClock();
  await clearUserData(t.db);
  await t.db.delete(appMeta).where(eq(appMeta.key, "data_imported_at"));
  cookies = await adminCookies(t.db);
});
afterEach(() => vi.useRealTimers());

type Err = { error: { code: string; fields?: Record<string, string> } };

function upload<T = ImportResult>(kind: string, csv: string, commit: 0 | 1 = 0, name = "upload.csv") {
  return call<T>(POST, {
    method: "POST",
    url: `/api/admin/import?kind=${kind}&commit=${commit}`,
    form: { file: new File([csv], name, { type: "text/csv" }) },
    cookies,
  });
}

const countSales = async () => (await t.db.select({ id: sales.id }).from(sales)).length;

describe("sales CSV", () => {
  it("dry run: ok 23, rejected 2 with line numbers and reasons, impact, and no writes", async () => {
    const before = await countSales();
    const res = await upload("sales", FIXTURE, 0);
    expect(res.status).toBe(200);
    const r = res.body;
    expect(r).toMatchObject({ kind: "sales", rows: 25, ok: 23, rejectedCount: 2, created: 23, skippedDuplicates: 0, committed: false });
    expect(r.rejected).toEqual([
      { line: 25, reason: "Unknown building: Nowhere Pt" },
      { line: 26, reason: "Date is in the future" },
    ]);
    expect(await countSales()).toBe(before);
    expect(await getAppMeta(t.db, "data_imported_at")).toBeNull();

    // impact: Marina 2-bed gains 5 rows, 4 of them inside the 12-month window
    const marina = await buildingId(t.db, "Mockup Crest Tower");
    const current = (await recentSales(t.db, marina, 2, "ready", { start: "2025-11-17", end: "2026-11-17" })).map(
      (s) => s.priceAed / s.sizeSqft,
    );
    const addedPsf = [2_236_000 / 1284, 2_210_000 / 1310, 2_105_000 / 1250, 2_150_000 / 1290];
    const m2 = r.impact.find((i) => i.buildingName === "Mockup Crest Tower" && i.bedrooms === 2);
    expect(m2).toBeDefined();
    expect(m2?.completion).toBe("ready");
    expect(m2?.added).toBe(5);
    expect(m2?.beforeMedianPsf).toBeCloseTo(1674.45, 2);
    expect(m2?.afterMedianPsf).toBeCloseTo(median([...current, ...addedPsf]) as number, 9);
    // "Fake Vista Res" resolved through its alias
    expect(r.impact.find((i) => i.buildingName === "Fake Vista Residences" && i.bedrooms === 1)?.added).toBe(3);
    // a building/bedroom pair with no sales before
    const studio = r.impact.find((i) => i.buildingName === "Fake Vista Residences" && i.bedrooms === 0);
    expect(studio).toMatchObject({ beforeMedianPsf: null, added: 1 });
    expect(studio?.afterMedianPsf).toBeCloseTo(560_000 / 455, 9);
    // sorted by building then bedrooms
    const sorted = [...r.impact].sort((a, b) => a.buildingName.localeCompare(b.buildingName) || a.bedrooms - b.bedrooms);
    expect(r.impact).toEqual(sorted);
    expect(r.impact.reduce((s, i) => s + i.added, 0)).toBe(23);
  });

  it("commit: one transaction, source import, data_imported_at set; re-import skips all", async () => {
    const before = await countSales();
    const res = await upload("sales", FIXTURE, 1);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: 23, created: 23, committed: true, rejectedCount: 2 });
    expect(await countSales()).toBe(before + 23);

    const imported = await t.db.select().from(sales).where(eq(sales.source, "import"));
    expect(imported).toHaveLength(23);
    const batches = new Set(imported.map((s) => s.importBatch));
    expect(batches.size).toBe(1);
    expect([...batches][0]).toMatch(/^import-2026-11-17-/);
    const quoted = imported.find((s) => s.saleDate === "2026-04-17" && s.bedrooms === 1);
    expect(quoted?.priceAed).toBe(900_000);
    expect(imported.find((s) => s.externalRef === "TX-2026-0011")?.bedrooms).toBe(0);
    expect(await getAppMeta(t.db, "data_imported_at")).toBe("2026-11-17");

    const again = await upload("sales", FIXTURE, 1);
    expect(again.body).toMatchObject({ ok: 23, created: 0, skippedDuplicates: 23, rejectedCount: 2, committed: true });
    expect(again.body.impact).toEqual([]);
    expect(await countSales()).toBe(before + 23);
  });

  it("two concurrent commits of the same file store each sale once and both answer 200", async () => {
    const before = await countSales();
    const [a, b] = await Promise.all([upload("sales", FIXTURE, 1), upload("sales", FIXTURE, 1)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.created, b.body.created].sort((x, y) => x - y)).toEqual([0, 23]);
    expect([a.body.skippedDuplicates, b.body.skippedDuplicates].sort((x, y) => x - y)).toEqual([0, 23]);
    expect(await countSales()).toBe(before + 23);
  });

  it("a forced DB error during commit rolls everything back", async () => {
    const before = await countSales();
    vi.mocked(setAppMeta).mockRejectedValueOnce(new Error("forced failure"));
    const res = await upload<Err>("sales", FIXTURE, 1);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("internal");
    expect(await countSales()).toBe(before);
    expect(await getAppMeta(t.db, "data_imported_at")).toBeNull();
  });

  it("stores the completion column (blank = ready); off-plan sales get their own impact row", async () => {
    const csv = [
      "building_name,sale_date,bedrooms,size_sqft,price_aed,external_ref,completion",
      "Mockup Crest Tower,2026-10-01,2,1284,2236000,TEST-C-1,off_plan",
      "Mockup Crest Tower,2026-10-02,2,1284,2240000,TEST-C-2,Off-Plan",
      "Mockup Crest Tower,2026-10-03,2,1284,2200000,TEST-C-3,",
      "Mockup Crest Tower,2026-10-04,2,1284,2200000,TEST-C-4,ready",
      "Mockup Crest Tower,2026-10-05,2,1284,2200000,TEST-C-5,soon",
    ].join("\n");
    const dry = await upload("sales", csv, 0);
    expect(dry.body.rejected).toEqual([{ line: 6, reason: COPY["adminUi.csv.completionBad"] }]);
    const rows = dry.body.impact.filter((i) => i.buildingName === "Mockup Crest Tower" && i.bedrooms === 2);
    expect(rows.map((i) => [i.completion, i.added, i.beforeMedianPsf === null])).toEqual([
      ["off_plan", 2, true],
      ["ready", 2, false],
    ]);
    const done = await upload("sales", csv, 1);
    expect(done.body.created).toBe(4);
    const stored = await t.db.select().from(sales).where(eq(sales.source, "import"));
    expect(Object.fromEntries(stored.map((s) => [s.externalRef, s.completion]))).toEqual({
      "TEST-C-1": "off_plan",
      "TEST-C-2": "off_plan",
      "TEST-C-3": "ready",
      "TEST-C-4": "ready",
    });
  });

  it("a name several buildings share needs the area column (shown or DLD area)", async () => {
    const [twin] = await t.db
      .insert(buildings)
      .values({ name: "Mockup Crest Tower", area: "Test Other Area" })
      .returning({ id: buildings.id });
    try {
      const noArea = ["building_name,sale_date,bedrooms,size_sqft,price_aed", "Mockup Crest Tower,2026-10-01,2,1284,2236000"].join("\n");
      const ambiguous = await upload("sales", noArea, 0);
      expect(ambiguous.body.rejected).toEqual([
        { line: 2, reason: t2("adminUi.csv.ambiguousBuilding", { name: "Mockup Crest Tower" }) },
      ]);
      const withArea = [
        "building_name,area,sale_date,bedrooms,size_sqft,price_aed,external_ref",
        "Mockup Crest Tower,Test Other Area,2026-10-01,2,1284,2236000,TEST-A-1",
        "Mockup Crest Tower,marsa dubai,2026-10-01,2,1284,2236000,TEST-A-2",
        "Mockup Crest Tower,Nowhere,2026-10-01,2,1284,2236000,TEST-A-3",
      ].join("\n");
      const res = await upload("sales", withArea, 1);
      expect(res.body.rejected).toEqual([{ line: 4, reason: t2("adminUi.csv.unknownBuilding", { name: "Mockup Crest Tower" }) }]);
      const stored = await t.db.select().from(sales).where(eq(sales.source, "import"));
      const marina = await buildingId(t.db, "Mockup Crest Tower");
      expect(Object.fromEntries(stored.map((s) => [s.externalRef, s.buildingId]))).toEqual({ "TEST-A-1": twin.id, "TEST-A-2": marina });
    } finally {
      await t.db.delete(buildings).where(eq(buildings.id, twin.id));
    }
  });

  it("converts size_sqm and treats duplicates inside one file as skipped", async () => {
    const csv = [
      "building_name,sale_date,bedrooms,size_sqm,price_aed,external_ref",
      "Mockup Crest Tower,2026-10-01,2,119.29,2236000,SQM-1",
      "Mockup Crest Tower,2026-10-01,2,119.29,2236000,SQM-1",
      "Mockup Crest Tower,2026-10-02,2,,2236000,",
    ].join("\n");
    const res = await upload("sales", csv, 1);
    expect(res.body).toMatchObject({ rows: 3, ok: 2, created: 1, skippedDuplicates: 1, rejectedCount: 1 });
    expect(res.body.rejected).toEqual([{ line: 4, reason: "Size is missing" }]);
    const [row] = await t.db.select().from(sales).where(eq(sales.externalRef, "SQM-1"));
    expect(row.sizeSqft).toBeCloseTo(1284.03, 2);
  });

  it("reports plain-word reasons", async () => {
    const csv = [
      "building_name,sale_date,bedrooms,size_sqft,price_aed",
      "Mockup Crest Tower,2026-10-01,2,,2236000",
      "Mockup Crest Tower,2026-10-01,2,1284,9000000",
      "Mockup Crest Tower,17/10/2026,2,1284,2236000",
      "Mockup Crest Tower,2026-10-01,9,1284,2236000",
      "Mockup Crest Tower,2026-10-01,2,1284,",
    ].join("\n");
    const res = await upload("sales", csv, 0);
    expect(res.body.rejected.map((r) => r.reason)).toEqual([
      "Size is missing",
      "Price per sq ft looks wrong",
      "Date must look like 2026-11-17",
      "Bedrooms must be 0 to 7, or studio",
      "Price is missing",
    ]);
  });

  it("file-level problems are 422 on fields.file; bad kind is 422; no file is 422; non-multipart is 415", async () => {
    const missing = await upload<Err>("sales", "building_name,sale_date,bedrooms\nX,2026-01-01,2\n");
    expect(missing.status).toBe(422);
    expect(missing.body.error.fields?.file).toBe("Missing column: price_aed");
    const empty = await upload<Err>("sales", "building_name,sale_date,bedrooms,size_sqft,price_aed\n\n");
    expect(empty.body.error.fields?.file).toBe("The file has no rows.");
    const kind = await upload<Err>("cats", "a\n1\n");
    expect(kind.status).toBe(422);
    expect(kind.body.error.fields?.kind).toBeTruthy();
    const nofile = await call<Err>(POST, {
      method: "POST",
      url: "/api/admin/import?kind=sales",
      form: { other: "x" },
      cookies,
    });
    expect(nofile.status).toBe(422);
    expect(nofile.body.error.fields?.file).toBe("Choose a CSV file.");
    const json = await call(POST, { method: "POST", url: "/api/admin/import?kind=sales", json: {}, cookies });
    expect(json.status).toBe(415);
  });
});

describe("buildings and aliases CSV", () => {
  it("buildings: matched by name and area; DLD buildings untouched; new ones are matchable at once", async () => {
    const csv = [
      "name,area,project,master_project,is_demo",
      "Nowhere Point Tower,Dubai Creek Harbour,Nowhere Point,Creek Harbour,true",
      "Mockup Crest Tower,Dubai Marina,Mockup Crest Project,,true",
      "Fake Vista Residences,Jumeirah Village Circle,,,true",
      "nowhere point tower,Dubai Creek Harbour,,,true",
      "X,Somewhere,,,",
    ].join("\n");
    const dry = await upload("buildings", csv, 0);
    // The two DLD buildings are the snapshot's (each load rewrites them): skipped, not updated.
    expect(dry.body).toMatchObject({ rows: 5, ok: 4, created: 1, updated: 0, skippedDuplicates: 3, rejectedCount: 1 });
    expect(dry.body.rejected).toEqual([{ line: 6, reason: "Name is missing" }]);
    expect(await t.db.select().from(buildings).where(eq(buildings.name, "Nowhere Point Tower"))).toHaveLength(0);

    const warm = await call<MatchResponse>(matchGet, { url: "/api/buildings/match?q=Nowhere%20Point%20Tower" });
    expect(warm.body.candidates).toEqual([]);
    const done = await upload("buildings", csv, 1);
    expect(done.body.committed).toBe(true);
    const [hp] = await t.db.select().from(buildings).where(eq(buildings.name, "Nowhere Point Tower"));
    expect(hp).toMatchObject({ area: "Dubai Creek Harbour", project: "Nowhere Point", masterProject: "Creek Harbour", dldKey: null });
    const [mc] = await t.db.select().from(buildings).where(eq(buildings.name, "Mockup Crest Tower"));
    expect(mc.project).toBe("MOCKUP CREST");
    const m = await call<MatchResponse>(matchGet, { url: "/api/buildings/match?q=Nowhere%20Point%20Tower" });
    expect(m.body.candidates[0]).toMatchObject({ buildingId: hp.id });

    // An admin-added building with that name is updated (area and project); a DLD name in a new area is a new building.
    const second = [
      "name,area,project,master_project",
      "Nowhere Point Tower,Creek Harbour East,Nowhere Point 2,",
      "Fake Vista Residences,Test Other Area,,",
    ].join("\n");
    const r2 = await upload("buildings", second, 1);
    expect(r2.body).toMatchObject({ created: 1, updated: 1 });
    const [hp2] = await t.db.select().from(buildings).where(eq(buildings.id, hp.id));
    expect(hp2).toMatchObject({ area: "Creek Harbour East", project: "Nowhere Point 2", masterProject: "Creek Harbour" });
    const vistas = await t.db.select().from(buildings).where(eq(buildings.name, "Fake Vista Residences"));
    expect(vistas.map((b) => b.area).sort()).toEqual(["Jumeirah Village Circle", "Test Other Area"]);
    await t.db.delete(buildings).where(eq(buildings.area, "Test Other Area"));

    // aliases for it
    const aliases = [
      "building_name,alias",
      "Nowhere Point Tower,Nowhere Pt",
      "Nowhere Point Tower,Nowhere Pt",
      "Nowhere Tower,Nowhere",
      "Nowhere Point Tower,Nowhere Point Tower",
    ].join("\n");
    const ar = await upload("aliases", aliases, 1);
    expect(ar.body).toMatchObject({ rows: 4, ok: 3, created: 1, skippedDuplicates: 2, rejectedCount: 1 });
    expect(ar.body.rejected).toEqual([{ line: 4, reason: "Unknown building: Nowhere Tower" }]);
    const rows = await t.db.select().from(buildingAliases).where(eq(buildingAliases.buildingId, hp.id));
    expect(rows.map((r) => [r.aliasNorm, r.source]).sort()).toEqual([
      ["nowhere point tower", "import"],
      ["nowhere pt", "import"],
    ]);

    await t.db.delete(buildings).where(eq(buildings.id, hp.id));
    invalidateAliasCache();
  });
});
