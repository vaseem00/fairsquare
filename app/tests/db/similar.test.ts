/**
 * The similar-buildings comparison end to end (REAL_DATA.md section 15) on in-memory PGlite: a
 * synthetic Data.Dubai file goes through the real `buildSnapshot` (cells file, manifest section) and
 * `loadOpenData` (similar_cells, app_meta), then `runCheck` runs the same-building comparison first
 * and the second tier only when that one gives no verdict. Synthetic names only.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ogDescription, shareText, similarLines } from "@/lib/copy";
import { getAppMeta } from "@/lib/db/meta";
import { ensureAnonUser } from "@/lib/db/repo/anon";
import { getCheckWithCurrent, storedSimilar, toCheckView } from "@/lib/db/repo/checks";
import { readSimilarModel, similarArea, similarKey } from "@/lib/db/repo/similar";
import { buildings, checks, events, similarCells } from "@/lib/db/schema";
import { DEFAULT_RULES } from "@/lib/domain/analyse";
import { __resetEnvForTests } from "@/lib/env";
import { compareSimilar, type SimilarConstants } from "@/lib/domain/similar";
import { buildSnapshot } from "@/lib/ingest/build";
import { loadOpenData, similarShaOf } from "@/lib/ingest/load";
import { artifactFromCellRows, readManifest, readSimilarCells, SIMILAR_CELLS_FILE, writeManifest, type Manifest } from "@/lib/ingest/snapshot";
import { runCheck } from "@/lib/services/check";
import { similarFor } from "@/lib/services/similar";
import { SIMILAR_BACKTEST, SIMILAR_CONSTANTS, SIMILAR_MAX_FIT_AGE_DAYS, SIMILAR_MIN_CONSTANTS_VERSION } from "@/lib/similar/model";
import type { CheckRequest, CheckView } from "@/lib/types";
import { CheckViewSchema, CheckWithCurrentSchema, SimilarViewSchema } from "@/lib/validation/api";
import { createTestDb, type TestDb } from "../helpers/db";

const HEADER = readFileSync(path.join(process.cwd(), "tests", "fixtures", "data-dubai", "e2e-transactions.csv"), "utf8").split(/\r?\n/)[0].split(",");
const root = mkdtempSync(path.join(tmpdir(), "fairsquare-similar-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const THROUGH = "2026-11-10";
const TODAY = "2026-11-18";
const WINDOW_START = "2025-11-10";
const MARINA = "Marsa Dubai";
const JVC = "Al Barsha South Fourth";
const SQM = 100; // 1,076.39 sq ft
const SQFT = 1076.39;

let tx = 0;
const day = (daysAgo: number) => new Date(Date.parse(`${THROUGH}T00:00:00Z`) - daysAgo * 86_400_000).toISOString().slice(0, 10);

interface Spec {
  building: string;
  area?: string;
  master?: string;
  project: number;
  beds: number;
  psf: number[];
  /** Days before THROUGH of the first sale; each next sale is 9 days earlier. */
  from: number;
  offPlan?: boolean;
}

/** Data.Dubai rows for one building, bedroom count and basis, one sale per date, each price its own. */
function rows(s: Spec): string[] {
  return s.psf.map((psf, i) => {
    const o: Record<string, string | number> = {
      transaction_id: `7-11-2026-${++tx}`,
      trans_group_en: "Sales",
      procedure_name_en: s.offPlan ? "Sell - Pre registration" : "Sell",
      instance_date: day(s.from + i * 9),
      property_type_en: "Unit",
      property_sub_type_en: "Flat",
      property_usage_en: "Residential",
      reg_type_en: s.offPlan ? "Off-Plan Properties" : "Existing Properties",
      area_name_en: s.area ?? MARINA,
      building_name_en: s.building,
      project_number: s.project,
      project_name_en: `TEST PROJECT ${s.project}`,
      master_project_en: s.master ?? (s.area ? "" : "TEST MASTER ONE"),
      rooms_en: s.beds === 0 ? "Studio" : `${s.beds} B/R`,
      has_parking: 1,
      procedure_area: SQM,
      actual_worth: Math.round(psf * SQFT),
    };
    return HEADER.map((h) => o[h] ?? "").join(",");
  });
}

const DATA: Spec[] = [
  { building: "TEST SIM REF A", project: 9001, beds: 2, psf: [1500, 1490, 1510, 1500], from: 0 },
  { building: "TEST SIM REF A", project: 9001, beds: 1, psf: [1700, 1690, 1710], from: 20 },
  { building: "TEST SIM REF B", project: 9002, beds: 2, psf: [1560, 1550, 1570, 1560], from: 5 },
  { building: "TEST SIM REF B", project: 9002, beds: 1, psf: [1750, 1740, 1760], from: 25 },
  { building: "TEST SIM REF C", project: 9003, beds: 2, psf: [1620, 1610, 1630, 1620], from: 8 },
  { building: "TEST SIM REF C", project: 9003, beds: 1, psf: [1800, 1790, 1810], from: 28 },
  // A building with a same-building verdict: 6 ready 2-bed sales.
  { building: "TEST SIM RICH", project: 9006, beds: 2, psf: [1580, 1570, 1590, 1580, 1575, 1585], from: 3 },
  // Too few: 2 ready 2-bed sales in the 12 months, 3 older ones, and 3 one-bed sales.
  { building: "TEST SIM THIN", project: 9004, beds: 2, psf: [1650, 1660], from: 30 },
  { building: "TEST SIM THIN", project: 9004, beds: 2, psf: [1500, 1510, 1490], from: 480 },
  { building: "TEST SIM THIN", project: 9004, beds: 1, psf: [1850, 1840, 1860], from: 40 },
  { building: "TEST SIM FOUR", project: 9005, beds: 4, psf: [1400, 1410], from: 12 },
  // Another area, no master project, nothing comparable.
  { building: "TEST SIM LONE", area: JVC, project: 9101, beds: 0, psf: [1300], from: 60 },
  { building: "TEST SIM OLD", area: JVC, project: 9102, beds: 3, psf: [1200], from: 900 },
  // Off-plan sales in three other buildings of the first area: TEST SIM THIN has none on that basis.
  { building: "TEST SIM OFF A", project: 9201, beds: 2, psf: [2000, 2010, 1990], from: 10, offPlan: true },
  { building: "TEST SIM OFF B", project: 9202, beds: 2, psf: [2100, 2110, 2090], from: 14, offPlan: true },
  { building: "TEST SIM OFF C", project: 9203, beds: 2, psf: [2200, 2210, 2190], from: 18, offPlan: true },
];

const C = SIMILAR_CONSTANTS as unknown as SimilarConstants;
const ANON = "0b0f6f0e-7f4e-4c64-9d5e-3a1c1b2d3e4f";

async function snapshot(name: string, similar?: Parameters<typeof buildSnapshot>[0]["similar"]): Promise<string> {
  const dir = path.join(root, name);
  const csv = path.join(root, `${name}.csv`);
  tx = 0;
  writeFileSync(csv, [HEADER.join(","), ...DATA.flatMap(rows)].join("\r\n"), "utf8");
  await buildSnapshot({ inputs: [csv], datasetUrl: "https://data.dubai/en/test-dataset", datasetTitle: "TEST Transactions", downloadedOn: TODAY, outDir: dir, ...(similar ? { similar } : {}) });
  return dir;
}

describe("the similar-buildings model: build, load and compare", () => {
  let t: TestDb;
  let dir: string;
  let manifest: Manifest;
  const ids = new Map<string, number>();

  const check = (building: string | null, fields: Partial<CheckRequest["fields"]>, completion?: "ready" | "off_plan") =>
    runCheck(
      t.db,
      {
        fields: { buildingText: building ?? "Test Unknown Tower", areaText: null, bedrooms: 2, sizeSqft: 1000, priceAed: 1_600_000, ...fields },
        buildingId: building === null ? null : (ids.get(building) as number),
        source: "manual",
        editedFields: [],
        ...(completion ? { completion } : {}),
      },
      { anonId: ANON, today: TODAY, appUrl: "http://localhost:3000", rules: DEFAULT_RULES },
    );

  beforeAll(async () => {
    t = await createTestDb({ seed: false });
    dir = await snapshot("first");
    manifest = (await readManifest(dir)) as Manifest;
    expect(await loadOpenData({ db: t.db, dir })).toMatchObject({ status: "loaded", rows: 48, buildings: 11, similarCells: 15 });
    for (const b of await t.db.select().from(buildings)) ids.set(b.name.toUpperCase(), b.id);
    await ensureAnonUser(t.db, ANON);
  });
  afterAll(() => t.close());

  describe("npm run data:build", () => {
    it("writes the cells file and the manifest's similar section, with the shipped constants and backtest summary", async () => {
      expect(manifest.dataThrough).toBe(THROUGH);
      const s = manifest.similar;
      expect(s).toMatchObject({ version: 1, builtOn: TODAY, windowStart: WINDOW_START, cellsFile: { rows: 15 }, buildings: 11 });
      expect(s?.constants).toEqual(SIMILAR_CONSTANTS);
      expect(s?.backtest).toEqual(SIMILAR_BACKTEST);
      expect(s?.backtest.statement).toMatchObject({ heldOf10: 8, heldLaterOf10: 7 });
      const cells = await readSimilarCells(path.join(dir, SIMILAR_CELLS_FILE), s!.cellsFile);
      expect(cells.find((c) => c.building === "TEST SIM THIN" && c.bedrooms === 2)).toMatchObject({
        areaDld: MARINA,
        projectNumber: "9004",
        masterProject: "TEST MASTER ONE",
        completion: "ready",
        nRaw12: 2,
        n12: 2,
        nOld1: 3,
        nOld2: 0,
        medOld2: null,
      });
      expect(cells.find((c) => c.building === "TEST SIM OLD")).toMatchObject({ nRaw12: 0, n12: 0, med12: null, nOld1: 0, nOld2: 1, masterProject: "" });
    });

    it("is deterministic: the same inputs give the same bytes, and --built is the only date that can differ", async () => {
      const again = await snapshot("again");
      expect(readFileSync(path.join(again, SIMILAR_CELLS_FILE)).equals(readFileSync(path.join(dir, SIMILAR_CELLS_FILE)))).toBe(true);
      const strip = (m: Manifest) => ({ ...m, sourceFiles: m.sourceFiles.map((f) => ({ rows: f.rows })) });
      expect(strip((await readManifest(again)) as Manifest)).toEqual(strip(manifest));
    });

    it("refuses a cells file that does not match the manifest", async () => {
      const file = path.join(dir, SIMILAR_CELLS_FILE);
      await expect(readSimilarCells(file, { sha256: "0".repeat(64), rows: 15 })).rejects.toThrow(/does not match/);
      await expect(readSimilarCells(file, { sha256: manifest.similar!.cellsFile.sha256, rows: 16 })).rejects.toThrow(/has 15 rows/);
      await expect(readSimilarCells(path.join(root, "none.csv.gz"), { sha256: "0".repeat(64), rows: 0 })).rejects.toThrow(/missing/);
    });
  });

  describe("the loader", () => {
    it("fills similar_cells with one row per cell, by building id, and stores the model with its snapshot", async () => {
      const all = await t.db.select().from(similarCells);
      expect(all).toHaveLength(15);
      const thin = all.find((c) => c.buildingId === ids.get("TEST SIM THIN") && c.bedrooms === 2);
      expect(thin).toMatchObject({ basis: "ready", areaDld: MARINA, masterProject: "TEST MASTER ONE", projectNumber: "9004", nRaw12: 2, n12: 2, nOld1: 3, nOld2: 0, medOld2: null });
      // The medians survive the file and the database to the last digit.
      const cells = await readSimilarCells(path.join(dir, SIMILAR_CELLS_FILE), manifest.similar!.cellsFile);
      const fileThin = cells.find((c) => c.building === "TEST SIM THIN" && c.bedrooms === 2);
      expect(thin?.med12).toBe(fileThin?.med12);
      expect(thin?.medOld1).toBe(fileThin?.medOld1);

      const loaded = await readSimilarModel(t.db);
      expect(loaded?.dataThrough).toBe(THROUGH);
      expect(loaded?.model).toMatchObject({ version: 1, windowStart: WINDOW_START, dataThrough: THROUGH, snapshotSha256: manifest.snapshotSha256 });
      expect(loaded?.model.constants).toEqual(SIMILAR_CONSTANTS);
      expect(await getAppMeta(t.db, "open_data_similar_sha")).toBe(similarShaOf(manifest));
      // app_meta.data_source stays the manifest without its counts and without the model.
      const source = JSON.parse((await getAppMeta(t.db, "data_source")) as string) as Record<string, unknown>;
      expect(source).not.toHaveProperty("similar");
      expect(source).not.toHaveProperty("counts");
    });

    it("skips when nothing changed", async () => {
      expect(await loadOpenData({ db: t.db, dir })).toMatchObject({ status: "up_to_date", skipped: "same_sha", similarCells: 0 });
    });

    it("the area query returns what the whole table would: the same result as the file's artifact", async () => {
      const { model } = (await readSimilarModel(t.db))!;
      const cells = await readSimilarCells(path.join(dir, SIMILAR_CELLS_FILE), manifest.similar!.cellsFile);
      const whole = artifactFromCellRows(cells, THROUGH, WINDOW_START);
      for (const [name, beds, area] of [["TEST SIM THIN", 2, MARINA], ["TEST SIM REF A", 2, MARINA], ["TEST SIM REF B", 1, MARINA], ["TEST SIM LONE", 0, JVC], ["TEST SIM OLD", 3, JVC]] as const) {
        const id = ids.get(name) as number;
        const part = await similarArea(t.db, { buildingId: id }, "ready", model);
        const fromDb = compareSimilar(part, C, { bedrooms: beds, basis: "ready", askingPsf: 1600, buildingKey: similarKey(id) });
        const fromFile = compareSimilar(whole, C, { bedrooms: beds, basis: "ready", askingPsf: 1600, buildingKey: `${name}|${area}` });
        expect(fromDb, name).toEqual(fromFile);
      }
      // A building with sales on the other basis only is still in the artifact, with its place: the
      // off-plan request reads the off-plan buildings of its area, as the whole table does.
      const thinId = ids.get("TEST SIM THIN") as number;
      const off = await similarArea(t.db, { buildingId: thinId }, "off_plan", model);
      const offDb = compareSimilar(off, C, { bedrooms: 2, basis: "off_plan", askingPsf: 2000, buildingKey: similarKey(thinId) });
      expect(offDb).toEqual(compareSimilar(whole, C, { bedrooms: 2, basis: "off_plan", askingPsf: 2000, buildingKey: `TEST SIM THIN|${MARINA}` }));
      expect(offDb).toMatchObject({ shown: false, reason: "no_building_evidence", level: "community", comparableBuildings: 3 });
      // Each building of the artifact carries its name as shown, never its id.
      expect(off.buildings.map((b) => b.building).sort()).toEqual(["Test Sim Off A", "Test Sim Off B", "Test Sim Off C", "Test Sim Thin"]);
      expect(off.buildings.find((b) => b.building === "Test Sim Thin")?.key).toBe(similarKey(thinId));
      expect((await similarArea(t.db, { areaDld: "Nowhere" }, "ready", model)).cells).toEqual([]);
      expect((await similarArea(t.db, { buildingId: 999_999 }, "ready", model)).cells).toEqual([]);
    });
  });

  describe("runCheck: the same-building comparison first, the second tier only without a verdict", () => {
    it("a building with enough sales: the same-building verdict, and no second tier", async () => {
      const c = await check("TEST SIM RICH", {});
      expect(c.analysis).toMatchObject({ band: "inline", count: 6, windowStart: WINDOW_START, windowEnd: THROUGH });
      expect(c.similar).toBeNull();
      const [row] = await t.db.select().from(checks).where(eq(checks.code, c.code));
      expect(row.similar).toBeNull();
    });

    it("too few sales, building known: a range from its own sales, its older sales, its other bedrooms and the community", async () => {
      const c = await check("TEST SIM THIN", { priceAed: 1_650_000 });
      // The first tier is exactly as before.
      expect(c.analysis).toMatchObject({ band: "thin", count: 2, diff: null, medianPriceAed: null });
      expect(c.sales).toHaveLength(2);
      const s = c.similar!;
      expect(SimilarViewSchema.parse(s)).toEqual(s);
      expect(s).toMatchObject({
        v: 1,
        modelVersion: SIMILAR_CONSTANTS.version,
        scenario: "building",
        shown: true,
        reason: null,
        level: "community",
        place: "Test Master One",
        comparableBuildings: 4,
        comparableSales: 18,
        evidence: { ownSales: 2, olderSales: 3, otherBedroomSales: 3 },
        windowStart: WINDOW_START,
        windowEnd: THROUGH,
        area: null,
        areaCandidates: [],
        tested: { heldOf10: 8, heldLaterOf10: 7 },
      });
      expect(s.tier).toBe("close");
      expect(s.rangeLowPsf! % 10).toBe(0);
      expect(s.rangeHighPsf! % 10).toBe(0);
      expect(s.rangeLowPsf!).toBeLessThan(1650);
      expect(s.rangeHighPsf!).toBeGreaterThan(1650);
      expect(s.verdict).toBe("within"); // AED 1,650 per sq ft
      // The other buildings by name, most sales first, and how far apart their medians are.
      expect(s.comparables).toEqual([
        { name: "Test Sim Rich", sales: 6, medianPsf: 1580 },
        { name: "Test Sim Ref A", sales: 4, medianPsf: 1500 },
        { name: "Test Sim Ref B", sales: 4, medianPsf: 1560 },
        { name: "Test Sim Ref C", sales: 4, medianPsf: 1620 },
      ]);
      expect(s.comparableSpan).toEqual({ lowPsf: 1500, highPsf: 1620 });
      // The building's own 12-month median (1,655) is inside the range, and its older median is within a quarter of it.
      expect(s.rangeLowPsf!).toBeLessThanOrEqual(1655);
      expect(s.rangeHighPsf!).toBeGreaterThanOrEqual(1655);
      // No single middle figure, no medians and no unrounded bounds leave the server.
      for (const k of ["centrePsf", "lowPsf", "highPsf", "halfWidth", "evidenceClass"]) expect(s).not.toHaveProperty(k);
      // Stored with the comparison, so /c shows the same thing later.
      const [row] = await t.db.select().from(checks).where(eq(checks.code, c.code));
      expect(storedSimilar(row)).toEqual(s);
      expect(toCheckView(row, "http://localhost:3000").similar).toEqual(s);
      const [ev] = await t.db.select().from(events).where(eq(events.checkId, row.id));
      expect(ev.meta).toMatchObject({ band: "thin", similar: "shown_close_within" });
    });

    it("the asking price is judged against the rounded range: above and below", async () => {
      const mid = (await check("TEST SIM THIN", { priceAed: 1_650_000 })).similar!;
      const above = (await check("TEST SIM THIN", { priceAed: (mid.rangeHighPsf! + 1) * 1000 })).similar!;
      const below = (await check("TEST SIM THIN", { priceAed: (mid.rangeLowPsf! - 1) * 1000 })).similar!;
      expect([above.verdict, below.verdict]).toEqual(["above", "below"]);
      expect([above.rangeLowPsf, above.rangeHighPsf, below.rangeLowPsf, below.rangeHighPsf]).toEqual([mid.rangeLowPsf, mid.rangeHighPsf, mid.rangeLowPsf, mid.rangeHighPsf]);
      const edge = (await check("TEST SIM THIN", { priceAed: mid.rangeHighPsf! * 1000 })).similar!;
      expect(edge.verdict).toBe("within");
    });

    it("too few, with 4 own sales and other buildings of the community", async () => {
      const c = await check("TEST SIM REF A", { priceAed: 1_500_000 });
      expect(c.analysis).toMatchObject({ band: "thin", count: 4 });
      expect(c.similar).toMatchObject({ shown: true, tier: "close", level: "community", comparableBuildings: 3, comparableSales: 14, evidence: { ownSales: 4, olderSales: 0, otherBedroomSales: 3 }, verdict: "within" });
      // The similar buildings are named with the range: most sales first, their counts adding up to the
      // stored total, each with 3 or more sales and a whole-number median; never the building itself.
      const list = c.similar!.comparables;
      expect(list).toHaveLength(3);
      expect(list.reduce((n, x) => n + x.sales, 0)).toBe(14);
      expect(list.map((x) => x.sales)).toEqual([...list.map((x) => x.sales)].sort((a, b) => b - a));
      for (const x of list) {
        expect(x.sales).toBeGreaterThanOrEqual(3);
        expect(Number.isInteger(x.medianPsf)).toBe(true);
      }
      // By name as shown (never a database id), ties in name order.
      expect(list.map((x) => x.name)).toEqual(["Test Sim Rich", "Test Sim Ref B", "Test Sim Ref C"]);
      expect(c.similar!.comparableSpan).toEqual({ lowPsf: 1560, highPsf: 1620 });
    });

    it("nothing but the building's one sale of the 12 months: no range (the first tier has just called it too few)", async () => {
      const c = await check("TEST SIM LONE", { bedrooms: 0, sizeSqft: 500, priceAed: 650_000 });
      expect(c.analysis).toMatchObject({ band: "thin", count: 1 });
      expect(c.similar).toMatchObject({ shown: false, reason: "own_sales_only", tier: null, rangeLowPsf: null, rangeHighPsf: null, verdict: null, tested: null, comparableSpan: null });
      expect(c.similar!.comparables).toEqual([]);
      expect(similarLines(c)).toBeNull();
    });

    it("refusals keep the page as it is: more than 3 bedrooms, a range too wide, and nothing on this basis", async () => {
      const four = await check("TEST SIM FOUR", { bedrooms: 4, sizeSqft: 2500, priceAed: 3_500_000 });
      expect(four.analysis.band).toBe("thin");
      expect(four.similar).toMatchObject({ shown: false, reason: "bedrooms_not_validated", tier: null, rangeLowPsf: null, rangeHighPsf: null, verdict: null, tested: null });
      const old = await check("TEST SIM OLD", { bedrooms: 3, sizeSqft: 1500, priceAed: 1_800_000 });
      expect(old.analysis).toMatchObject({ band: "thin", count: 0 });
      expect(old.similar).toMatchObject({ shown: false, reason: "range_too_wide", evidence: { ownSales: 0, olderSales: 1, otherBedroomSales: 0 }, rangeLowPsf: null });
      // Off-plan listing in a building that only has ready sales: ready and off-plan are never pooled.
      const off = await check("TEST SIM THIN", {}, "off_plan");
      expect(off.analysis).toMatchObject({ band: "thin", count: 0, completionBasis: "off_plan" });
      expect(off.similar).toMatchObject({ shown: false, reason: "no_building_evidence", comparableBuildings: 3, evidence: { ownSales: 0, olderSales: 0, otherBedroomSales: 0 } });
      for (const c of [four, old, off]) expect(similarLines(c)).toBeNull();
      // A refusal names no building.
      for (const c of [four, old, off]) expect(c.similar!.comparables).toEqual([]);
    });

    it("building unknown, area resolved: other buildings of an area alone are never shown", async () => {
      const c = await check(null, { areaText: "Dubai Marina, Dubai" });
      expect(c.analysis.band).toBe("none");
      expect(c.building).toBeNull();
      expect(c.similar).toMatchObject({
        scenario: "area",
        shown: false,
        reason: "no_building_evidence",
        // Never shown, so the area's cells are not even read.
        level: null,
        place: null,
        comparableBuildings: 0,
        comparableSales: 0,
        rangeLowPsf: null,
        rangeHighPsf: null,
        verdict: null,
        area: { areaDld: MARINA, masterProject: "Dubai Marina" },
        tested: null,
      });
      expect(similarLines(c)).toBeNull();
    });

    it("building unknown, area ambiguous or unresolved: nothing is guessed", async () => {
      const vague = await check(null, { areaText: "Meydan" });
      expect(vague.similar).toMatchObject({ scenario: "area", shown: false, reason: "area_ambiguous", area: null });
      expect(vague.similar!.areaCandidates.length).toBeGreaterThanOrEqual(2);
      const typo = await check(null, { areaText: "Dubai Marnia" });
      expect(typo.similar).toMatchObject({ reason: "area_ambiguous", areaCandidates: [{ areaDld: MARINA }] });
      for (const areaText of ["Somewhere Else", null]) {
        const c = await check(null, { areaText });
        expect(c.similar).toMatchObject({ scenario: "area", shown: false, reason: "area_unresolved", areaCandidates: [], area: null });
      }
    });
  });

  describe("when the second tier does not run", () => {
    const thin = () => ({ id: ids.get("TEST SIM THIN") as number, area: "Dubai Marina" });
    const input = { band: "thin" as const, areaText: null, bedrooms: 2, basis: "ready" as const, askingPsf: 1650, window: { start: WINDOW_START, end: THROUGH } };

    it("only for too few and not covered, with data loaded, over the model's own 12 months", async () => {
      expect(await similarFor(t.db, { ...input, building: thin() })).toMatchObject({ shown: true });
      for (const band of ["above", "inline", "below"] as const) expect(await similarFor(t.db, { ...input, band, building: thin() })).toBeNull();
      expect(await similarFor(t.db, { ...input, building: thin(), window: null })).toBeNull();
      expect(await similarFor(t.db, { ...input, building: thin(), window: { start: "2025-11-09", end: "2026-11-09" } })).toBeNull();
      expect(await similarFor(t.db, { ...input, building: thin(), window: { start: "2026-05-10", end: THROUGH } })).toBeNull();
      // "none" with a building means no data was loaded when it was made: nothing to say.
      expect(await similarFor(t.db, { ...input, band: "none", building: thin() })).toBeNull();
      // A cell with 5 or more sales beside a "thin" band: the two disagree, so nothing is shown.
      expect(await similarFor(t.db, { ...input, building: { id: ids.get("TEST SIM RICH") as number, area: "Dubai Marina" } })).toBeNull();
      // A building with no cell at all (added by hand): no evidence.
      expect(await similarFor(t.db, { ...input, building: { id: 999_999, area: "" } })).toMatchObject({ shown: false, reason: "no_evidence" });
    });

    it("a model left over from another snapshot, or unreadable, is not used", async () => {
      const raw = (await getAppMeta(t.db, "similar_model")) as string;
      const set = (v: string) => t.db.execute(sql`update app_meta set value = ${v} where key = 'similar_model'`);
      try {
        await set(JSON.stringify({ ...JSON.parse(raw), snapshotSha256: "a".repeat(64) }));
        expect(await readSimilarModel(t.db)).toBeNull();
        expect((await check("TEST SIM THIN", {})).similar).toBeNull();
        await set("{not json");
        expect(await readSimilarModel(t.db)).toBeNull();
        await set(JSON.stringify({ ...JSON.parse(raw), version: 2 }));
        expect(await readSimilarModel(t.db)).toBeNull();
        await set("");
        expect(await readSimilarModel(t.db)).toBeNull();
      } finally {
        await set(raw);
      }
      expect(await readSimilarModel(t.db)).not.toBeNull();
    });
  });

  describe("stored comparisons and the public view", () => {
    it("GET /api/checks/[code] and /c: the stored second tier, as stored", async () => {
      const c = await check("TEST SIM THIN", { priceAed: 1_650_000 });
      const found = await getCheckWithCurrent(t.db, c.code, TODAY, DEFAULT_RULES, "http://localhost:3000");
      expect(found?.check.similar).toEqual(c.similar);
      expect(found?.current.band).toBe("thin");
      // Nothing is recomputed beside it: the response has the comparison and today's same-building verdict only.
      expect(Object.keys(found!).sort()).toEqual(["check", "current"]);
      expect(CheckWithCurrentSchema.parse(JSON.parse(JSON.stringify(found)))).toEqual(found);
      // A comparison with a verdict has none.
      const rich = await check("TEST SIM RICH", {});
      expect(await getCheckWithCurrent(t.db, rich.code, TODAY, DEFAULT_RULES, "http://localhost:3000")).toMatchObject({ check: { similar: null } });
      // Not covered: stored as it was, nothing to recompute.
      const none = await check(null, { areaText: "Dubai Marina" });
      const pub = await getCheckWithCurrent(t.db, none.code, TODAY, DEFAULT_RULES, "http://localhost:3000");
      expect(pub?.check.similar).toMatchObject({ reason: "no_building_evidence" });
    });

    it("withdrawing: SIMILAR_TIER=off and entries of an older constants version show nothing, anywhere", async () => {
      const c = await check("TEST SIM THIN", { priceAed: 1_650_000 });
      expect(c.similar).toMatchObject({ shown: true });
      const [row] = await t.db.select().from(checks).where(eq(checks.code, c.code));
      // An entry made by constants older than the build still shows (version 1: no consistency rules).
      expect(SIMILAR_MIN_CONSTANTS_VERSION).toBe(2);
      expect(storedSimilar({ similar: { ...c.similar, modelVersion: SIMILAR_MIN_CONSTANTS_VERSION - 1 } })).toBeNull();
      expect(storedSimilar({ similar: { ...c.similar, modelVersion: SIMILAR_MIN_CONSTANTS_VERSION } })).toMatchObject({ shown: true });
      // The switch: nothing stored is shown and nothing new is computed; the row itself is untouched.
      expect(storedSimilar(row, "off")).toBeNull();
      process.env.SIMILAR_TIER = "off";
      __resetEnvForTests();
      try {
        const view = toCheckView(row, "http://localhost:3000");
        expect(view.similar).toBeNull();
        expect(similarLines(view)).toBeNull();
        // Adjusted registered sales (REAL_DATA.md section 16) are a separate answer with their own
        // switch: with them aside, no range is worded at all; with them, never in the second tier's words.
        const alone = { ...view, acs: null };
        expect(shareText(alone)).not.toMatch(/range/);
        expect(ogDescription(alone)).not.toMatch(/range/);
        expect(shareText(view)).not.toMatch(/median between|Weaker evidence/);
        expect(ogDescription(view)).not.toMatch(/median between|Weaker evidence/);
        expect((await getCheckWithCurrent(t.db, c.code, TODAY, DEFAULT_RULES, "http://localhost:3000"))?.check.similar).toBeNull();
        expect((await check("TEST SIM THIN", { priceAed: 1_650_000 })).similar).toBeNull();
      } finally {
        delete process.env.SIMILAR_TIER;
        __resetEnvForTests();
      }
      expect(toCheckView(row, "http://localhost:3000").similar).toEqual(c.similar);
      // A loaded model whose constants are older than the build is not used either.
      const raw = (await getAppMeta(t.db, "similar_model")) as string;
      const model = JSON.parse(raw) as { constants: Record<string, unknown> };
      await t.db.execute(sql`update app_meta set value = ${JSON.stringify({ ...model, constants: { ...model.constants, version: 1 } })} where key = 'similar_model'`);
      try {
        expect(await readSimilarModel(t.db)).not.toBeNull();
        expect((await check("TEST SIM THIN", { priceAed: 1_650_000 })).similar).toBeNull();
      } finally {
        await t.db.execute(sql`update app_meta set value = ${raw} where key = 'similar_model'`);
      }
    });

    it("old rows and entries of another version read as no second tier", async () => {
      const c = await check("TEST SIM THIN", {});
      const stored = async (similar: unknown): Promise<CheckView> => {
        await t.db.execute(sql`update checks set similar_view = ${similar === null ? null : JSON.stringify(similar)}::jsonb where code = ${c.code}`);
        const [row] = await t.db.select().from(checks).where(eq(checks.code, c.code));
        return toCheckView(row, "http://localhost:3000");
      };
      expect((await stored(null)).similar).toBeNull();
      expect((await stored({ ...c.similar, v: 2 })).similar).toBeNull();
      expect((await stored({ v: 1, shown: true })).similar).toBeNull();
      expect((await stored("nonsense")).similar).toBeNull();
      expect((await stored(c.similar)).similar).toEqual(c.similar);
      // The DTO schema: a comparison stored before the field existed has no `similar` and stays valid;
      // an entry a client cannot read becomes null and never fails the page.
      const { similar: _similar, ...before } = c;
      void _similar;
      expect(CheckViewSchema.parse(before).similar).toBeUndefined();
      expect(CheckViewSchema.parse({ ...before, similar: null }).similar).toBeNull();
      expect(CheckViewSchema.parse({ ...before, similar: { v: 7, anything: true } }).similar).toBeNull();
      expect(CheckViewSchema.parse(c).similar).toEqual(c.similar);
    });
  });

  describe("refreshing the model", () => {
    it("constants fitted too long before the data: loaded, and the second tier stays off", async () => {
      const stale = { ...SIMILAR_CONSTANTS, fittedOn: { ...SIMILAR_CONSTANTS.fittedOn, dataThrough: "2026-01-01" } };
      expect(SIMILAR_MAX_FIT_AGE_DAYS).toBe(200);
      const staleDir = await snapshot("stale", { constants: stale, backtest: SIMILAR_BACKTEST });
      const m = (await readManifest(staleDir)) as Manifest;
      // Same sales, same cells, other constants: the loader still takes it.
      expect(m.snapshotSha256).toBe(manifest.snapshotSha256);
      expect(m.similar?.cellsFile.sha256).toBe(manifest.similar?.cellsFile.sha256);
      expect(similarShaOf(m)).not.toBe(similarShaOf(manifest));
      expect(await loadOpenData({ db: t.db, dir: staleDir })).toMatchObject({ status: "loaded", inserted: 0, deleted: 0, similarCells: 15 });
      expect((await readSimilarModel(t.db))?.model.constants.fittedOn.dataThrough).toBe("2026-01-01");
      const c = await check("TEST SIM THIN", {});
      expect(c.analysis.band).toBe("thin");
      expect(c.similar).toBeNull();
    });

    it("a snapshot without a model empties the cells and the stored model", async () => {
      const bare = path.join(root, "bare");
      await snapshot("bare");
      const { similar: _similar, ...rest } = (await readManifest(bare)) as Manifest;
      void _similar;
      await writeManifest(bare, rest);
      expect(await loadOpenData({ db: t.db, dir: bare })).toMatchObject({ status: "loaded", similarCells: 0 });
      expect(await t.db.select().from(similarCells)).toEqual([]);
      expect(await getAppMeta(t.db, "similar_model")).toBe("");
      expect(await getAppMeta(t.db, "open_data_similar_sha")).toBe("");
      expect(await readSimilarModel(t.db)).toBeNull();
      expect((await check("TEST SIM THIN", {})).similar).toBeNull();
      expect(await loadOpenData({ db: t.db, dir: bare })).toMatchObject({ status: "up_to_date" });
      // The full snapshot brings it back.
      expect(await loadOpenData({ db: t.db, dir })).toMatchObject({ status: "loaded", similarCells: 15 });
      expect((await check("TEST SIM THIN", {})).similar).toMatchObject({ shown: true });
    });
  });
});
