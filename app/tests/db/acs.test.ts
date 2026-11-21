/**
 * Adjusted registered sales end to end (REAL_DATA.md section 16) on in-memory PGlite: a synthetic
 * Data.Dubai file goes through the real `buildSnapshot` (acs-model.json.gz, the manifest section) and
 * `loadOpenData` (app_meta), then `runCheck` stores the first answer beside the unchanged
 * same-building result and second tier. Covers the fallbacks, the switch, the expiry of the fit, the
 * versions of the stored result and what never leaves the server. Synthetic names only.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ACS_CONSTANTS, ACS_MAX_DATA_AGE_DAYS, ACS_MAX_FIT_AGE_DAYS, ACS_MODEL_FILE, AcsModelFileSchema } from "@/lib/acs/model";
import { shownAcs } from "@/lib/acs/shown";
import { getAppMeta, setAppMeta } from "@/lib/db/meta";
import * as repoAcs from "@/lib/db/repo/acs";
import { __resetAcsModelForTests, acsSales, readAcsModel } from "@/lib/db/repo/acs";
import { ensureAnonUser } from "@/lib/db/repo/anon";
import { getCheckWithCurrent, storedAcs, toCheckView } from "@/lib/db/repo/checks";
import { buildings, checks, events } from "@/lib/db/schema";
import { DEFAULT_RULES } from "@/lib/domain/analyse";
import { addDays } from "@/lib/domain/dates";
import { __resetEnvForTests } from "@/lib/env";
import { acsFitTooOld, buildSnapshot, reportWarnings } from "@/lib/ingest/build";
import { acsShaOf, loadOpenData } from "@/lib/ingest/load";
import { readManifest, type Manifest } from "@/lib/ingest/snapshot";
import { __resetAcsStatusForTests, acsFor, acsStatus } from "@/lib/services/acs";
import { __setLogSinkForTests } from "@/lib/log";
import { runCheck } from "@/lib/services/check";
import type { AcsStored, CheckRequest } from "@/lib/types";
import { AcsStoredSchema, AcsViewSchema, CheckViewSchema, CheckWithCurrentSchema } from "@/lib/validation/api";
import { createTestDb, type TestDb } from "../helpers/db";

const HEADER = readFileSync(path.join(process.cwd(), "tests", "fixtures", "data-dubai", "e2e-transactions.csv"), "utf8").split(/\r?\n/)[0].split(",");
const root = mkdtempSync(path.join(tmpdir(), "fairsquare-acs-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const THROUGH = "2026-11-10";
const TODAY = "2026-11-18";
const MARINA = "Marsa Dubai";
const SQFT_PER_SQM = 10.7639;

let tx = 0;
const day = (daysAgo: number) => addDays(THROUGH, -daysAgo);

interface Sale {
  building: string;
  project: string;
  number: number;
  beds: number;
  /** AED per sq ft. */
  psf: number;
  sqm: number;
  daysAgo: number;
  offPlan?: boolean;
}

function line(s: Sale): string {
  const o: Record<string, string | number> = {
    transaction_id: `9-11-2026-${++tx}`,
    trans_group_en: "Sales",
    procedure_name_en: s.offPlan ? "Sell - Pre registration" : "Sell",
    instance_date: day(s.daysAgo),
    property_type_en: "Unit",
    property_sub_type_en: "Flat",
    property_usage_en: "Residential",
    reg_type_en: s.offPlan ? "Off-Plan Properties" : "Existing Properties",
    area_name_en: MARINA,
    building_name_en: s.building,
    project_number: s.number,
    project_name_en: s.project,
    master_project_en: "TEST MASTER ONE",
    rooms_en: s.beds === 0 ? "Studio" : `${s.beds} B/R`,
    has_parking: 1,
    procedure_area: s.sqm,
    actual_worth: Math.round(s.psf * Math.round(s.sqm * SQFT_PER_SQM * 100) / 100),
  };
  return HEADER.map((h) => o[h] ?? "").join(",");
}

const many = (base: Omit<Sale, "psf" | "sqm" | "daysAgo">, list: Array<[psf: number, sqm: number, daysAgo: number]>): Sale[] =>
  list.map(([psf, sqm, daysAgo]) => ({ ...base, psf, sqm, daysAgo }));

const RICH = { building: "TEST ACS RICH", project: "TEST RICH PROJECT", number: 9301, beds: 2 };
const DATA: Sale[] = [
  // Ten ready 2-bed sales in 12 months, sizes 95 to 110 sq m, close prices; and four 1-bed sales.
  ...many(RICH, [
    [1500, 100, 0],
    [1512, 104, 30],
    [1490, 96, 61],
    [1505, 100, 95],
    [1498, 110, 130],
    [1510, 95, 170],
    [1495, 102, 215],
    [1502, 100, 260],
    [1488, 98, 300],
    [1507, 105, 340],
  ]),
  ...many({ ...RICH, beds: 1 }, [
    [1650, 70, 20],
    [1660, 72, 80],
    [1645, 68, 150],
    [1655, 70, 250],
  ]),
  // Too few in 12 months (4), with five earlier sales and three 1-bed sales: the first tier says "thin".
  ...many({ building: "TEST ACS THIN", project: "TEST THIN PROJECT", number: 9302, beds: 2 }, [
    [1650, 100, 20],
    [1660, 101, 45],
    [1645, 99, 75],
    [1655, 100, 100],
    [1650, 100, 400],
    [1640, 99, 430],
    [1655, 100, 460],
    [1648, 101, 490],
    [1652, 100, 520],
  ]),
  ...many({ building: "TEST ACS THIN", project: "TEST THIN PROJECT", number: 9302, beds: 1 }, [
    [1850, 70, 40],
    [1840, 71, 90],
    [1860, 69, 140],
  ]),
  // Six 4-bed sales: the first tier answers, adjusted registered sales is not tested for 4-beds.
  ...many({ building: "TEST ACS FOUR", project: "TEST FOUR PROJECT", number: 9303, beds: 4 }, [
    [1400, 300, 10],
    [1410, 305, 50],
    [1395, 298, 90],
    [1405, 300, 130],
    [1402, 302, 170],
    [1398, 300, 210],
  ]),
  // Two phases of one project: phase 1 has a single 2-bed sale, phase 2 has ten.
  ...many({ building: "TEST PARK TOWER 1", project: "TEST PARK 1", number: 9304, beds: 2 }, [[1700, 100, 25]]),
  ...many(
    { building: "TEST PARK TOWER 2", project: "TEST PARK 2", number: 9305, beds: 2 },
    Array.from({ length: 10 }, (_, i): [number, number, number] => [1720 + (i % 3) * 4, 100, 12 + i * 21]),
  ),
  // Prices far apart: the range would be too wide. Off-plan, so its prices do not move the ready time index.
  ...many({ building: "TEST ACS WIDE", project: "TEST WIDE PROJECT", number: 9306, beds: 2, offPlan: true }, [
    [1000, 100, 8],
    [2100, 100, 12],
    [1200, 100, 40],
    [1900, 100, 44],
    [1050, 100, 70],
    [2200, 100, 74],
    [1400, 100, 100],
    [1750, 100, 104],
  ]),
  // Five unlike units registered at one price per sq ft on one day (a batch), and five ordinary sales.
  ...many({ building: "TEST ACS BATCH", project: "TEST BATCH PROJECT", number: 9307, beds: 2 }, [
    [1300, 90, 50],
    [1300, 100, 50],
    [1300, 110, 50],
    [1300, 120, 50],
    [1300, 95, 50],
    [1450, 100, 15],
    [1460, 102, 80],
    [1440, 98, 140],
    [1455, 100, 200],
    [1448, 101, 260],
  ]),
];

const ANON = "0b0f6f0e-7f4e-4c64-9d5e-3a1c1b2d3e50";

/** A copy of `o` without some keys. */
function without<T extends object, K extends keyof T>(o: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...o };
  for (const k of keys) delete copy[k];
  return copy;
}

async function snapshot(name: string, acs?: Parameters<typeof buildSnapshot>[0]["acs"]) {
  const dir = path.join(root, name);
  const csv = path.join(root, `${name}.csv`);
  tx = 0;
  writeFileSync(csv, [HEADER.join(","), ...DATA.map(line)].join("\r\n"), "utf8");
  const report = await buildSnapshot({ inputs: [csv], datasetUrl: "https://data.dubai/en/test-dataset", datasetTitle: "TEST Transactions", downloadedOn: TODAY, outDir: dir, ...(acs ? { acs } : {}) });
  return { dir, report };
}

describe("adjusted registered sales: build, load and compare", () => {
  let t: TestDb;
  let dir: string;
  let manifest: Manifest;
  const ids = new Map<string, number>();

  const check = (building: string | null, fields: Partial<CheckRequest["fields"]> = {}, completion?: "ready" | "off_plan") =>
    runCheck(
      t.db,
      {
        fields: { buildingText: building ?? "Test Unknown Tower", areaText: null, bedrooms: 2, sizeSqft: 1076, priceAed: 1_650_000, ...fields },
        buildingId: building === null ? null : (ids.get(building) as number),
        source: "manual",
        editedFields: [],
        ...(completion ? { completion } : {}),
      },
      { anonId: ANON, today: TODAY, appUrl: "http://localhost:3000", rules: DEFAULT_RULES },
    );
  const stored = async (code: string) => {
    const [row] = await t.db.select().from(checks).where(eq(checks.code, code));
    return row;
  };

  beforeAll(async () => {
    t = await createTestDb({ seed: false });
    ({ dir } = await snapshot("first"));
    manifest = (await readManifest(dir)) as Manifest;
    expect(await loadOpenData({ db: t.db, dir })).toMatchObject({ status: "loaded", rows: DATA.length, buildings: 7 });
    for (const b of await t.db.select().from(buildings)) ids.set(b.name.toUpperCase(), b.id);
    await ensureAnonUser(t.db, ANON);
  });
  afterAll(() => t.close());
  afterEach(() => {
    delete process.env.ACS_TIER;
    __resetEnvForTests();
  });

  describe("npm run data:build", () => {
    it("writes the model file and the manifest's acs section with the shipped fit", async () => {
      expect(manifest.acs).toMatchObject({
        version: 2,
        constantsVersion: ACS_CONSTANTS.version,
        fittedOn: { dataThrough: ACS_CONSTANTS.fittedOn.dataThrough },
        buildings: 7,
        indexSales: DATA.length,
      });
      const model = AcsModelFileSchema.parse(JSON.parse(gunzipSync(readFileSync(path.join(dir, ACS_MODEL_FILE))).toString("utf8")));
      expect(model.snapshotSha256).toBe(manifest.snapshotSha256);
      expect(model.dataThrough).toBe(THROUGH);
      expect(model.params).toEqual(ACS_CONSTANTS.params);
      expect(model.range).toEqual(ACS_CONSTANTS.range);
      expect(model.tested).toEqual({ heldOf10: 8, heldLaterOf10: 8 });
      // The two phases of TEST PARK are one project family; no other building has a sibling.
      const fam = Object.fromEntries(model.buildings.key.map((k, i) => [k, model.buildings.family[i]]));
      expect(fam["test park tower 1|marsa dubai"]).toBeGreaterThan(0);
      expect(fam["test park tower 1|marsa dubai"]).toBe(fam["test park tower 2|marsa dubai"]);
      expect(Object.values(fam).filter((f) => f > 0).length).toBe(2);
      // No sale is in the model.
      expect(JSON.stringify(model)).not.toMatch(/dld:/);
    });

    it("a rebuild gives the same model, byte for byte", async () => {
      const again = await snapshot("again");
      expect((await readManifest(again.dir))?.acs).toEqual(manifest.acs);
    });

    it("says so, and fails the build, when the fit is too old for the data", async () => {
      expect(acsFitTooOld(manifest)).toBe(false);
      const old = { ...ACS_CONSTANTS, fittedOn: { ...ACS_CONSTANTS.fittedOn, dataThrough: addDays(THROUGH, -(ACS_MAX_FIT_AGE_DAYS + 1)) } };
      const { report } = await snapshot("old-fit", { constants: old });
      expect(acsFitTooOld(report.manifest)).toBe(true);
      expect(reportWarnings(report).join("\n")).toMatch(/adjusted-registered-sales fit was made on data to .* 201 days before/);
      const edge = { ...ACS_CONSTANTS, fittedOn: { ...ACS_CONSTANTS.fittedOn, dataThrough: addDays(THROUGH, -ACS_MAX_FIT_AGE_DAYS) } };
      expect(acsFitTooOld((await snapshot("edge-fit", { constants: edge })).report.manifest)).toBe(false);
      // A download shorter than the 48 months of the time index still builds; the report says so.
      expect(report.manifest.acs?.indexFrom).toMatch(/^20\d\d-\d\d-\d\d$/);
      expect(reportWarnings(report).join("\n")).toMatch(/needs sales from 2022-11-11 \(48 months\) for its time index/);
      expect(reportWarnings({ ...report, manifest: { ...report.manifest, acs: { ...report.manifest.acs!, indexFrom: "2022-12-01" } } }).join("\n")).not.toMatch(/time index/);
    });
  });

  describe("the load", () => {
    it("stores the model with the sales it belongs to, and serves it parsed", async () => {
      expect(await getAppMeta(t.db, "open_data_acs_sha")).toBe(acsShaOf(manifest));
      const loaded = await readAcsModel(t.db);
      expect(loaded?.file.snapshotSha256).toBe(manifest.snapshotSha256);
      expect(loaded?.index.b.size).toBe(7);
      expect(await loadOpenData({ db: t.db, dir })).toMatchObject({ status: "up_to_date", skipped: "same_sha" });
    });

    it("reads one building's sales of one basis in the pool window, and its project siblings", async () => {
      const rows = await acsSales(t.db, ["test park tower 1|marsa dubai", "test park tower 2|marsa dubai"], "ready", "2023-11-12", THROUGH);
      expect(rows.length).toBe(11);
      expect(new Set(rows.map((r) => r.buildingName))).toEqual(new Set(["Test Park Tower 1", "Test Park Tower 2"]));
      expect(await acsSales(t.db, ["test park tower 2|marsa dubai"], "off_plan", "2023-11-12", THROUGH)).toEqual([]);
      expect(await acsSales(t.db, [], "ready", "2023-11-12", THROUGH)).toEqual([]);
    });

    it("a model left over from another snapshot, or an unreadable one, is not used", async () => {
      const keep = (await getAppMeta(t.db, "open_data_sha")) as string;
      await setAppMeta(t.db, "open_data_sha", "0".repeat(64));
      expect(await readAcsModel(t.db)).toBeNull();
      expect((await check("TEST ACS RICH")).acs).toBeNull();
      await setAppMeta(t.db, "open_data_sha", keep);
      const text = (await getAppMeta(t.db, "acs_model")) as string;
      await setAppMeta(t.db, "acs_model", text.replace('"version":2', '"version":3'));
      __resetAcsModelForTests();
      expect(await readAcsModel(t.db)).toBeNull();
      await setAppMeta(t.db, "acs_model", "{not json");
      __resetAcsModelForTests();
      expect(await readAcsModel(t.db)).toBeNull();
      await setAppMeta(t.db, "acs_model", text);
      __resetAcsModelForTests();
      expect(await readAcsModel(t.db)).not.toBeNull();
    });
  });

  describe("a building with 5 or more sales", () => {
    it("gets a range from its registered sales, each adjusted for date and size, and the range decides", async () => {
      const view = await check("TEST ACS RICH");
      // The same-building result is computed and stored exactly as before.
      expect(view.analysis).toMatchObject({ band: "inline", count: 10, completionBasis: "ready" });
      expect(view.sales.length).toBe(10);
      expect(view.similar).toBeNull();
      const acs = shownAcs(view.acs);
      expect(acs).not.toBeNull();
      expect(acs).toMatchObject({ v: 1, modelVersion: 2, constantsVersion: 1, dataThrough: THROUGH, poolFrom: "2023-11-12", scenario: "enough", shown: true, reason: null, verdict: "within" });
      expect(acs!.tested).toEqual({ heldOf10: 8, heldLaterOf10: 8 });
      // The asking price per sq ft sits against exactly the rounded range.
      expect(acs!.rangeLowPsf % 10).toBe(0);
      expect(acs!.rangeHighPsf % 10).toBe(0);
      expect(acs!.rangeLowPsf).toBeLessThan(view.analysis.askingPsf);
      expect(acs!.rangeHighPsf).toBeGreaterThan(view.analysis.askingPsf);
      // Ten own 2-bed sales and four 1-bed sales of the building, nothing from another building.
      expect(acs!.evidence).toEqual({ lead: 1, sales: 14, ownSales: 10, otherBedroomSales: 4, projectSales: 0 });
      expect(acs!.comparablesTotal).toBe(14);
      expect(acs!.comparables.length).toBe(14);
      expect(acs!.typicalSizeSqft).toBeCloseTo(1076.39, 1);
      // Largest weight first; the weights are shares of one whole.
      const shares = acs!.comparables.map((c) => c.weightShare);
      expect([...shares].sort((a, b) => b - a)).toEqual(shares);
      expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
      const latest = acs!.comparables[0];
      expect(latest).toMatchObject({ ring: 1, building: null, date: day(0), bedrooms: 2, count: 1, batch: false, bedroomAdj: 0 });
      expect(latest.priceAed).toBe(Math.round(1500 * 1076.39));
      // A registered sale adjusted, never a price made up: adjusted = registered x (1 + time) x (1 + size) x (1 + bedrooms).
      for (const c of acs!.comparables) {
        expect(c.adjustedPsf / (c.psf * (1 + c.timeAdj) * (1 + c.sizeAdj) * (1 + c.bedroomAdj))).toBeCloseTo(1, 3);
        expect(c.ring === 2 ? c.bedrooms : 2).toBe(c.ring === 2 ? 1 : 2);
      }
      // A sale of another bedroom count carries its step between bedroom counts.
      expect(acs!.comparables.filter((c) => c.ring === 2).every((c) => c.bedroomAdj !== 0)).toBe(true);
    });

    it("an asking price above the range is above, one under it is below", async () => {
      const mid = await check("TEST ACS RICH");
      const a = shownAcs(mid.acs)!;
      const above = await check("TEST ACS RICH", { priceAed: Math.round((a.rangeHighPsf + 15) * 1076) });
      expect(above.acs).toMatchObject({ shown: true, verdict: "above", rangeLowPsf: a.rangeLowPsf, rangeHighPsf: a.rangeHighPsf });
      const below = await check("TEST ACS RICH", { priceAed: Math.round((a.rangeLowPsf - 15) * 1076) });
      expect(below.acs).toMatchObject({ shown: true, verdict: "below" });
      // The stored same-building verdict keeps its own rule (5% around the median).
      expect(above.analysis.band).toBe(above.analysis.diff! > 0.05 ? "above" : "inline");
    });

    it("the middle figure and the unrounded ends stay on the server", async () => {
      const view = await check("TEST ACS RICH");
      const row = await stored(view.code);
      const kept = AcsStoredSchema.parse(row.acsView);
      expect(kept.server).toMatchObject({ group: "0|1|0|0|0", groupUsed: "0|1|0|0|0" });
      expect(kept.server!.centrePsf).toBeGreaterThan(kept.server!.lowPsf!);
      expect(kept.server!.centrePsf).toBeLessThan(kept.server!.highPsf!);
      expect(kept.server!.halfWidth).toBeLessThanOrEqual(0.2);
      expect(Math.round(kept.server!.lowPsf! / 10) * 10).toBe(kept.rangeLowPsf);
      // Nothing of it in the DTO, on /c or in the API schema.
      const text = JSON.stringify(view);
      for (const k of ["server", "centrePsf", "lowPsf", "highPsf", "halfWidth", "groupUsed"]) expect(text).not.toContain(`"${k}"`);
      const current = await getCheckWithCurrent(t.db, view.code, TODAY, DEFAULT_RULES, "http://localhost:3000");
      expect(JSON.stringify(current)).not.toContain("centrePsf");
      expect(CheckWithCurrentSchema.parse(current).check.acs).toEqual(view.acs);
      expect(Object.keys(AcsViewSchema.shape)).not.toContain("server");
    });

    it("a size outside the building's sizes gets no range; the same-building result stands", async () => {
      // 1.25x and 0.79x the building's usual size: its sales are read, but they are too far in size.
      const view = await check("TEST ACS RICH", { sizeSqft: 1350, priceAed: 2_025_000 });
      expect(view.acs).toMatchObject({ shown: false, reason: "size_too_far", rangeLowPsf: null, rangeHighPsf: null, verdict: null, tested: null, comparables: [], comparablesTotal: 0 });
      expect(view.acs!.evidence.ownSales).toBe(10);
      expect(shownAcs(view.acs)).toBeNull();
      expect(view.analysis.band).toBe("inline");
      const small = await check("TEST ACS RICH", { sizeSqft: 850, priceAed: 1_275_000 });
      expect(small.acs).toMatchObject({ shown: false, reason: "size_too_far" });
      // Over 1.5x (or under 0.67x) the size of every sale of the type: none of them is read at all.
      const far = await check("TEST ACS RICH", { sizeSqft: 1800, priceAed: 2_700_000 });
      expect(far.acs).toMatchObject({ shown: false, reason: "too_few_comparables", evidence: { ownSales: 0, otherBedroomSales: 4 } });
      const tiny = await check("TEST ACS RICH", { sizeSqft: 400, priceAed: 600_000 });
      expect(tiny.acs).toMatchObject({ shown: false });
      for (const v of [view, small, far, tiny]) expect(v.analysis).toMatchObject({ band: "inline", count: 10 });
    });

    it("4 bedrooms and more are not answered: the same-building median answers as before", async () => {
      const view = await check("TEST ACS FOUR", { bedrooms: 4, sizeSqft: 3229, priceAed: 4_520_000 });
      expect(view.analysis).toMatchObject({ band: "inline", count: 6 });
      expect(view.acs).toMatchObject({ shown: false, reason: "bedrooms_not_validated", scenario: "enough", evidence: { sales: 0 } });
      expect((await stored(view.code)).acsView).toMatchObject({ server: null });
    });

    it("prices far apart give no range", async () => {
      const view = await check("TEST ACS WIDE", {}, "off_plan");
      expect(view.acs).toMatchObject({ shown: false, reason: "range_too_wide", comparables: [] });
      expect(view.analysis.count).toBe(8);
    });

    it("several unlike units registered at one price per sq ft count as one row", async () => {
      const view = await check("TEST ACS BATCH", { priceAed: 1_560_000 });
      const acs = shownAcs(view.acs)!;
      expect(acs).not.toBeNull();
      // One row for the five (their median size, no single price), five rows for the ordinary sales: ten registered sales.
      expect(acs.comparables.filter((c) => c.batch)).toEqual([expect.objectContaining({ ring: 1, count: 5, priceAed: null, psf: 1300, sizeSqft: 1076.39, date: day(50) })]);
      expect(acs.evidence.ownSales).toBe(10);
      expect(acs.comparablesTotal).toBe(6);
      // The same-building median still counts each of the ten.
      expect(view.analysis.count).toBe(10);
    });
  });

  describe("a building with too few sales", () => {
    it("can get a range from its sales of three years and its other bedroom counts; the second tier is stored as before", async () => {
      const view = await check("TEST ACS THIN");
      expect(view.analysis).toMatchObject({ band: "thin", count: 4 });
      expect(view.acs).toMatchObject({ scenario: "few" });
      const acs = shownAcs(view.acs);
      expect(acs).not.toBeNull();
      expect(acs!.evidence).toEqual({ lead: 1, sales: 12, ownSales: 9, otherBedroomSales: 3, projectSales: 0 });
      // Sales older than the 12 months of the same-building comparison are used, moved to the data date.
      expect(acs!.comparables.filter((c) => c.ring === 1 && c.date < "2025-11-10").length).toBe(5);
      // Today's second tier ran too and is stored: it shows whenever the first answer is absent.
      expect(view.similar).not.toBeNull();
      expect(view.similar?.scenario).toBe("building");
    });

    it("one own sale and many in another building of the project: no range (the other building would lead)", async () => {
      const view = await check("TEST PARK TOWER 1", { priceAed: 1_830_000 });
      expect(view.analysis.band).toBe("thin");
      expect(view.acs).toMatchObject({ shown: false, scenario: "few" });
      expect(["no_close_comparables", "too_few_comparables"]).toContain(view.acs!.reason);
      expect(view.acs!.comparables).toEqual([]);
    });

    it("a building with many sales reads its project sibling's sales as rows of another building", async () => {
      const view = await check("TEST PARK TOWER 2", { priceAed: 1_855_000 });
      const acs = shownAcs(view.acs);
      expect(acs).not.toBeNull();
      expect(acs!.evidence).toMatchObject({ lead: 1, ownSales: 10, projectSales: 1 });
      expect(acs!.comparables.filter((c) => c.ring === 3)).toEqual([expect.objectContaining({ building: "Test Park Tower 1", bedrooms: 2, date: day(25), bedroomAdj: 0 })]);
    });
  });

  describe("when it does not run at all", () => {
    it("no building matched: nothing is stored", async () => {
      const view = await check(null);
      expect(view.acs).toBeNull();
      expect((await stored(view.code)).acsView).toBeNull();
    });

    it("a building added by hand has no key in the data: no range, no read", async () => {
      const [b] = await t.db.insert(buildings).values({ name: "Test Hand Tower", area: "Dubai Marina" }).returning();
      ids.set("TEST HAND TOWER", b.id);
      const view = await check("TEST HAND TOWER");
      expect(view.acs).toMatchObject({ shown: false, reason: "no_comparables" });
      expect(view.analysis.band).toBe("thin");
    });

    it("ACS_TIER=off: nothing is computed, and a stored result is not shown; switched on again it is back", async () => {
      const on = await check("TEST ACS RICH");
      expect(on.acs?.shown).toBe(true);
      process.env.ACS_TIER = "off";
      __resetEnvForTests();
      const off = await check("TEST ACS RICH");
      expect(off.acs).toBeNull();
      expect((await stored(off.code)).acsView).toBeNull();
      // Everything else is what the switched-on comparison stored too.
      const strip = (v: typeof on) => without(v, "code", "url", "createdAt", "acs");
      expect(strip(off)).toEqual(strip(on));
      // The earlier comparison keeps its stored result, hidden while the switch is off.
      const row = await stored(on.code);
      expect(toCheckView(row, "http://localhost:3000").acs).toBeNull();
      expect((await getCheckWithCurrent(t.db, on.code, TODAY, DEFAULT_RULES, "http://localhost:3000"))?.check.acs).toBeNull();
      expect(storedAcs(row, "on")?.shown).toBe(true);
      delete process.env.ACS_TIER;
      __resetEnvForTests();
      expect(toCheckView(row, "http://localhost:3000").acs).toEqual(on.acs);
    });

    it("the fit is too old for the data, or the data is too old for today: today's answer only", async () => {
      const input = { band: "inline" as const, building: { dldKey: "test acs rich|marsa dubai" }, bedrooms: 2, basis: "ready" as const, sizeSqft: 1076, askingPsf: 1500, today: TODAY, window: { start: addDays(THROUGH, -365), end: THROUGH } };
      expect((await acsFor(t.db, input))?.shown).toBe(true);
      // The window must end at the model's data date.
      expect(await acsFor(t.db, { ...input, window: { start: addDays(THROUGH, -366), end: addDays(THROUGH, -1) } })).toBeNull();
      expect(await acsFor(t.db, { ...input, window: null })).toBeNull();
      expect(await acsFor(t.db, { ...input, building: null })).toBeNull();
      // Shown for 122 days after the data date, not longer: past that the tested share was under 8 of 10.
      expect(ACS_MAX_DATA_AGE_DAYS).toBe(122);
      expect((await acsFor(t.db, { ...input, today: addDays(THROUGH, ACS_MAX_DATA_AGE_DAYS) }))?.shown).toBe(true);
      expect(await acsStatus(t.db, addDays(THROUGH, ACS_MAX_DATA_AGE_DAYS))).toMatchObject({ active: true });
      // It never stops silently: one warning per model and reason.
      __resetAcsStatusForTests();
      const logged: string[] = [];
      const level = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = "warn";
      __setLogSinkForTests((_l, line) => logged.push(line));
      const lines = () => logged.filter((s) => s.includes("acs_inactive"));
      expect(await acsFor(t.db, { ...input, today: addDays(THROUGH, ACS_MAX_DATA_AGE_DAYS + 1) })).toBeNull();
      expect(await acsFor(t.db, { ...input, today: addDays(THROUGH, ACS_MAX_DATA_AGE_DAYS + 2) })).toBeNull();
      expect(await acsStatus(t.db, addDays(THROUGH, ACS_MAX_DATA_AGE_DAYS + 1))).toEqual({ active: false, reason: "data_too_old" });
      expect(lines()).toHaveLength(1);
      expect(lines()[0]).toContain("data_too_old");
      // A model whose fit is more than 200 days older than its data.
      const text = (await getAppMeta(t.db, "acs_model")) as string;
      const model = JSON.parse(text) as { fittedOn: { dataThrough: string }; constantsVersion: number };
      await setAppMeta(t.db, "acs_model", JSON.stringify({ ...model, fittedOn: { ...model.fittedOn, dataThrough: addDays(THROUGH, -(ACS_MAX_FIT_AGE_DAYS + 1)) } }));
      __resetAcsModelForTests();
      expect(await acsFor(t.db, input)).toBeNull();
      expect(await acsStatus(t.db, TODAY)).toEqual({ active: false, reason: "fit_too_old" });
      expect(lines()).toHaveLength(2);
      expect(lines()[1]).toContain("fit_too_old");
      __setLogSinkForTests(null);
      process.env.LOG_LEVEL = level;
      expect((await check("TEST ACS RICH")).acs).toBeNull();
      await setAppMeta(t.db, "acs_model", JSON.stringify({ ...model, fittedOn: { ...model.fittedOn, dataThrough: addDays(THROUGH, -ACS_MAX_FIT_AGE_DAYS) } }));
      __resetAcsModelForTests();
      expect((await acsFor(t.db, input))?.shown).toBe(true);
      await setAppMeta(t.db, "acs_model", text);
      __resetAcsModelForTests();
    });

    it("an error inside it does not cost the comparison: today's answer is stored and the failure is logged", async () => {
      const read = vi.spyOn(repoAcs, "acsSales").mockRejectedValueOnce(new Error("read failed"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      const view = await check("TEST ACS RICH");
      expect(read).toHaveBeenCalledTimes(1);
      expect(view.acs).toBeNull();
      expect(view.analysis).toMatchObject({ band: "inline", count: 10 });
      expect((await stored(view.code)).acsView).toBeNull();
      expect([...err.mock.calls, ...out.mock.calls].some((a) => String(a[0]).includes("acs_failed"))).toBe(true);
      read.mockRestore();
      err.mockRestore();
      out.mockRestore();
      expect((await check("TEST ACS RICH")).acs?.shown).toBe(true);
    });
  });

  describe("stored comparisons", () => {
    it("one stored before this existed (no acs_view) reads exactly as it did", async () => {
      const view = await check("TEST ACS RICH");
      const before = await stored(view.code);
      await t.db.execute(sql`update checks set acs_view = null where code = ${view.code}`);
      const old = toCheckView(await stored(view.code), "http://localhost:3000");
      expect(old.acs).toBeNull();
      expect(without(old, "acs")).toEqual(without(view, "acs"));
      expect(CheckViewSchema.parse(old).acs).toBeNull();
      await t.db.update(checks).set({ acsView: before.acsView }).where(eq(checks.code, view.code));
    });

    it("a result of another version, of withdrawn constants or of a wrong shape is taken as absent; nothing is recomputed", async () => {
      const view = await check("TEST ACS RICH");
      const row = await stored(view.code);
      const good = row.acsView as AcsStored;
      const before = (await t.db.select().from(events)).length;
      for (const bad of [{ ...good, v: 2 }, { ...good, constantsVersion: 0 }, { ...good, verdict: "cheap" }, { ...good, comparables: [{ ring: 9 }] }, "nonsense", 7]) {
        expect(storedAcs({ acsView: bad }, "on"), JSON.stringify(bad).slice(0, 40)).toBeNull();
        await t.db.update(checks).set({ acsView: bad }).where(eq(checks.code, view.code));
        const got = await getCheckWithCurrent(t.db, view.code, TODAY, DEFAULT_RULES, "http://localhost:3000");
        expect(got?.check.acs).toBeNull();
        expect(got?.check.analysis).toEqual(view.analysis);
        expect(got?.check.sales).toEqual(view.sales);
      }
      expect((await t.db.select().from(events)).length).toBe(before);
      // The API schema itself turns an unreadable entry into null instead of failing the response.
      expect(CheckViewSchema.parse({ ...view, acs: { ...view.acs, v: 2 } }).acs).toBeNull();
      await t.db.update(checks).set({ acsView: good }).where(eq(checks.code, view.code));
      expect((await getCheckWithCurrent(t.db, view.code, TODAY, DEFAULT_RULES, "http://localhost:3000"))?.check.acs).toEqual(view.acs);
    });

    it("the last line of defence: a stored 'shown' without its ends, its outcome or its sales shows nothing", async () => {
      const acs = (await check("TEST ACS RICH")).acs!;
      expect(shownAcs(acs)).not.toBeNull();
      expect(shownAcs(null)).toBeNull();
      expect(shownAcs({ ...acs, rangeLowPsf: null })).toBeNull();
      expect(shownAcs({ ...acs, verdict: null })).toBeNull();
      expect(shownAcs({ ...acs, rangeHighPsf: acs.rangeLowPsf! - 10 })).toBeNull();
      expect(shownAcs({ ...acs, comparables: [] })).toBeNull();
      expect(shownAcs({ ...acs, evidence: { ...acs.evidence, ownSales: 0 } })).toBeNull();
      expect(shownAcs({ ...acs, shown: false })).toBeNull();
    });

    it("the event of a comparison says what the first answer was", async () => {
      const view = await check("TEST ACS RICH");
      const row = await stored(view.code);
      const [e] = await t.db.select().from(events).where(eq(events.checkId, row.id));
      expect(e.meta).toMatchObject({ band: "inline", acs: "shown_within" });
      const four = await check("TEST ACS FOUR", { bedrooms: 4, sizeSqft: 3229, priceAed: 4_520_000 });
      const [e4] = await t.db.select().from(events).where(eq(events.checkId, (await stored(four.code)).id));
      expect(e4.meta).toMatchObject({ acs: "bedrooms_not_validated" });
    });
  });

  describe("a snapshot without a model", () => {
    it("empties the stored model, so an old one is never used with new sales", async () => {
      const bare = path.join(root, "bare");
      const { dir: src } = await snapshot("bare-src");
      const m = (await readManifest(src)) as Manifest;
      const rest = without(m, "acs");
      const { cpSync } = await import("node:fs");
      cpSync(src, bare, { recursive: true });
      rmSync(path.join(bare, ACS_MODEL_FILE));
      writeFileSync(path.join(bare, "manifest.json"), JSON.stringify(rest, null, 2));
      expect(await loadOpenData({ db: t.db, dir: bare })).toMatchObject({ status: "loaded" });
      expect(await getAppMeta(t.db, "acs_model")).toBe("");
      expect(await getAppMeta(t.db, "open_data_acs_sha")).toBe("");
      expect(await readAcsModel(t.db)).toBeNull();
      expect((await check("TEST ACS RICH")).acs).toBeNull();
      // A model file that does not match its manifest stops the load before anything is written.
      const broken = path.join(root, "broken");
      cpSync(src, broken, { recursive: true });
      writeFileSync(path.join(broken, ACS_MODEL_FILE), "not a gzip");
      await expect(loadOpenData({ db: t.db, dir: broken })).rejects.toThrow(/acs-model\.json\.gz does not match/);
      rmSync(path.join(broken, ACS_MODEL_FILE));
      await expect(loadOpenData({ db: t.db, dir: broken })).rejects.toThrow(/acs-model\.json\.gz is missing/);
      // The full snapshot again: the model is back.
      expect(await loadOpenData({ db: t.db, dir: src })).toMatchObject({ status: "loaded" });
      expect((await check("TEST ACS RICH")).acs?.shown).toBe(true);
    });
  });
});
