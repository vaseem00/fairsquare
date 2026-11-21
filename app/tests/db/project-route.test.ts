/**
 * The project route end to end (REAL_DATA.md section 15.8) on in-memory PGlite: a synthetic Data.Dubai
 * file through the real `buildSnapshot` and `loadOpenData`, then `runCheck` for listings whose building
 * is not in the data. Synthetic names only: three numbered phases of "TEST LAGOON VIEWS" with off-plan
 * 2-bed sales, one ready building of its own, and one other project.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ogDescription, shareText, similarLines } from "@/lib/copy";
import { ensureAnonUser } from "@/lib/db/repo/anon";
import { storedSimilar, toCheckView } from "@/lib/db/repo/checks";
import { checks } from "@/lib/db/schema";
import { DEFAULT_RULES } from "@/lib/domain/analyse";
import { __resetEnvForTests } from "@/lib/env";
import { buildSnapshot } from "@/lib/ingest/build";
import { loadOpenData } from "@/lib/ingest/load";
import { runCheck } from "@/lib/services/check";
import { SIMILAR_CONSTANTS } from "@/lib/similar/model";
import type { CheckRequest } from "@/lib/types";
import { CheckViewSchema } from "@/lib/validation/api";
import { createTestDb, type TestDb } from "../helpers/db";

const HEADER = readFileSync(path.join(process.cwd(), "tests", "fixtures", "data-dubai", "e2e-transactions.csv"), "utf8").split(/\r?\n/)[0].split(",");
const root = mkdtempSync(path.join(tmpdir(), "fairsquare-project-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const THROUGH = "2026-11-10";
const TODAY = "2026-11-18";
const AREA = "Marsa Dubai";
const SQM = 100;
const SQFT = 1076.39;
let tx = 0;
const day = (daysAgo: number) => new Date(Date.parse(`${THROUGH}T00:00:00Z`) - daysAgo * 86_400_000).toISOString().slice(0, 10);

interface Spec {
  building: string;
  project: number;
  projectName: string;
  beds: number;
  psf: number[];
  from: number;
  offPlan: boolean;
}
function rows(s: Spec): string[] {
  return s.psf.map((psf, i) => {
    const o: Record<string, string | number> = {
      transaction_id: `8-11-2026-${++tx}`,
      trans_group_en: "Sales",
      procedure_name_en: s.offPlan ? "Sell - Pre registration" : "Sell",
      instance_date: day(s.from + i * 9),
      property_type_en: "Unit",
      property_sub_type_en: "Flat",
      property_usage_en: "Residential",
      reg_type_en: s.offPlan ? "Off-Plan Properties" : "Existing Properties",
      area_name_en: AREA,
      building_name_en: s.building,
      project_number: s.project,
      project_name_en: s.projectName,
      master_project_en: "TEST LAGOONS MASTER",
      rooms_en: s.beds === 0 ? "Studio" : `${s.beds} B/R`,
      has_parking: 1,
      procedure_area: SQM,
      actual_worth: Math.round(psf * SQFT),
    };
    return HEADER.map((h) => o[h] ?? "").join(",");
  });
}

const DATA: Spec[] = [
  { building: "TEST LAGOON VIEWS 1 A", project: 9301, projectName: "TEST LAGOON VIEWS 1", beds: 2, psf: [1500, 1510, 1490, 1500], from: 5, offPlan: true },
  { building: "TEST LAGOON VIEWS 2 A", project: 9302, projectName: "TEST LAGOON VIEWS 2", beds: 2, psf: [1600, 1610, 1590], from: 9, offPlan: true },
  { building: "TEST LAGOON VIEWS 2 B", project: 9302, projectName: "TEST LAGOON VIEWS 2", beds: 1, psf: [1800, 1810, 1790], from: 15, offPlan: true },
  { building: "TEST LAGOON VIEWS 2 C", project: 9302, projectName: "TEST LAGOON VIEWS 2", beds: 2, psf: [1300, 1310, 1290, 1300], from: 20, offPlan: false },
  { building: "TEST HARBOUR POINT", project: 9401, projectName: "TEST HARBOUR POINT", beds: 2, psf: [2500, 2510, 2490], from: 7, offPlan: true },
];

const ANON = "1b0f6f0e-7f4e-4c64-9d5e-3a1c1b2d3e4f";

describe("the project route: build, load and compare a building that is not in the data", () => {
  let t: TestDb;
  const check = (buildingText: string, fields: Partial<CheckRequest["fields"]> = {}, completion: "ready" | "off_plan" | "unknown" | null = "off_plan") =>
    runCheck(
      t.db,
      {
        fields: { buildingText, areaText: null, bedrooms: 2, sizeSqft: 1000, priceAed: 1_600_000, ...fields },
        buildingId: null,
        source: "manual",
        editedFields: [],
        ...(completion ? { completion } : {}),
      },
      { anonId: ANON, today: TODAY, appUrl: "http://localhost:3000", rules: DEFAULT_RULES },
    );

  beforeAll(async () => {
    t = await createTestDb({ seed: false });
    const dir = path.join(root, "snap");
    const csv = path.join(root, "snap.csv");
    writeFileSync(csv, [HEADER.join(","), ...DATA.flatMap(rows)].join("\r\n"), "utf8");
    await buildSnapshot({ inputs: [csv], datasetUrl: "https://data.dubai/en/test-dataset", datasetTitle: "TEST Transactions", downloadedOn: TODAY, outDir: dir });
    expect(await loadOpenData({ db: t.db, dir })).toMatchObject({ status: "loaded" });
    await ensureAnonUser(t.db, ANON);
  });
  afterAll(() => t.close());

  it("an off-plan listing that names the project: a range from its other buildings, saying the building has no sales", async () => {
    const c = await check("Test Lagoon Views 3, Dubai Marina");
    expect(c.analysis.band).toBe("none");
    const route = SIMILAR_CONSTANTS.projectRoute!;
    const ref = Math.exp((Math.log(1500) + Math.log(1600)) / 2);
    expect(c.similar).toMatchObject({
      scenario: "project",
      shown: true,
      reason: null,
      tier: "broad",
      level: "project",
      place: null,
      comparableBuildings: 2,
      comparableSales: 7,
      rangeLowPsf: Math.round((ref * Math.exp(route.lowLog)) / 10) * 10,
      rangeHighPsf: Math.round((ref * Math.exp(route.highLog)) / 10) * 10,
      evidence: { ownSales: 0, olderSales: 0, otherBedroomSales: 0 },
      project: { name: "Test Lagoon Views", areaDld: AREA },
      tested: { heldOf10: route.heldOf10 },
      modelVersion: SIMILAR_CONSTANTS.version,
    });
    // Only the off-plan 2-bed buildings of the project are named; never the ready one, never another project.
    expect(c.similar?.comparables.map((x) => x.name).sort()).toEqual(["Test Lagoon Views 1 A", "Test Lagoon Views 2 A"]);
    expect(CheckViewSchema.parse(JSON.parse(JSON.stringify(c))).similar?.scenario).toBe("project");
    const l = similarLines(c)!;
    expect(l.heading).toBe("A range from other buildings in the Test Lagoon Views project");
    expect(l.intro).toContain("This building has no registered sales in the data");
    expect(shareText(c)).toContain("The building itself has no registered sales in the data.");
    expect(ogDescription(c)).toMatch(/^No registered sales for this building in the data\./);
    // Stored and read back the same way.
    const [row] = await t.db.select().from(checks).where(eq(checks.code, c.code));
    expect(toCheckView(row, "http://localhost:3000").similar).toEqual(c.similar);
  });

  it("refuses: ready, unknown completion, 4 or more bedrooms, a bedroom type the project has not sold, a numbered project in the data, an area alone", async () => {
    const ready = await check("Test Lagoon Views 3", {}, "ready");
    expect(ready.similar?.shown ?? false).toBe(false);
    const unknown = await check("Test Lagoon Views 3", {}, "unknown");
    expect(unknown.similar?.shown ?? false).toBe(false);
    const unstated = await check("Test Lagoon Views 3", {}, null);
    expect(unstated.similar?.shown ?? false).toBe(false);
    const four = await check("Test Lagoon Views 3", { bedrooms: 4 });
    expect(four.similar?.shown ?? false).toBe(false);
    const studio = await check("Test Lagoon Views 3", { bedrooms: 0 });
    expect(studio.similar?.shown ?? false).toBe(false);
    // "Test Lagoon Views 2" is a project of the data: the listing may be one of its buildings.
    const inData = await check("Test Lagoon Views 2");
    expect(inData.similar?.shown ?? false).toBe(false);
    const areaOnly = await check("Some New Tower", { areaText: "Dubai Marina" });
    expect(areaOnly.similar).toMatchObject({ scenario: "area", shown: false });
    const developer = await check("Test Lagoon");
    expect(developer.similar?.shown ?? false).toBe(false);
    for (const c of [ready, unknown, unstated, four, studio, inData, areaOnly, developer]) expect(similarLines(c)).toBeNull();
  });

  it("SIMILAR_TIER=off: nothing is computed and nothing stored is shown", async () => {
    const shown = await check("Test Lagoon Views 3");
    const [row] = await t.db.select().from(checks).where(eq(checks.code, shown.code));
    expect(storedSimilar(row)).not.toBeNull();
    expect(storedSimilar(row, "off")).toBeNull();
    process.env.SIMILAR_TIER = "off";
    __resetEnvForTests();
    try {
      expect(toCheckView(row, "http://localhost:3000").similar).toBeNull();
      const fresh = await check("Test Lagoon Views 3");
      expect(fresh.similar).toBeNull();
    } finally {
      delete process.env.SIMILAR_TIER;
      __resetEnvForTests();
    }
  });
});
