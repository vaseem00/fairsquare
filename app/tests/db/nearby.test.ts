/**
 * Nearby registered sales end to end (REAL_DATA.md section 17) on in-memory PGlite: a synthetic
 * Data.Dubai file goes through the real `buildSnapshot` and `loadOpenData`, then `runCheck` stores the
 * last resort beside the unchanged results of the other tiers. Covers both kinds ("in": a chosen
 * building; "out": none, the area text resolved), when it does not run, the refusals, the switch, the
 * expiry, a failure inside the step, what never leaves the server, and the marketing names kept by
 * hand. The area and community are real DLD names (the resolver's alias table is real); the building
 * names are synthetic.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { shownAcs } from "@/lib/acs/shown";
import { nearbyLines, nearbyShown, ogDescription, ogTitle, plainNotCovered, shareText, stampProps, verdictAnnouncement, verdictHeadText } from "@/lib/copy";
import { getAppMeta } from "@/lib/db/meta";
import { ensureAnonUser } from "@/lib/db/repo/anon";
import { getAliasRows, invalidateAliasCache } from "@/lib/db/repo/buildings";
import { getCheckWithCurrent, storedNearby, toCheckView } from "@/lib/db/repo/checks";
import * as repoNearby from "@/lib/db/repo/nearby";
import { listSaved, saveCheck } from "@/lib/db/repo/saved";
import { buildingAliases, buildings, checks, events } from "@/lib/db/schema";
import { DEFAULT_RULES } from "@/lib/domain/analyse";
import { addDays } from "@/lib/domain/dates";
import { findCandidates, preselect } from "@/lib/domain/match";
import { __resetEnvForTests } from "@/lib/env";
import { buildSnapshot, nearbyFitTooOld, reportWarnings } from "@/lib/ingest/build";
import { loadOpenData, syncMarketNames } from "@/lib/ingest/load";
import { marketNamesSha } from "@/lib/ingest/market-names";
import { __setLogSinkForTests } from "@/lib/log";
import { NEARBY_CONSTANTS, NEARBY_MAX_DATA_AGE_DAYS, NEARBY_MAX_FIT_AGE_DAYS } from "@/lib/nearby/model";
import { shownNearby } from "@/lib/nearby/shown";
import { runCheck } from "@/lib/services/check";
import { __resetNearbyStatusForTests, nearbyStatus } from "@/lib/services/nearby";
import { shownSimilar } from "@/lib/similar/shown";
import type { CheckRequest } from "@/lib/types";
import { CheckViewSchema, NearbyStoredSchema, NearbyViewSchema } from "@/lib/validation/api";
import { createTestDb, type TestDb } from "../helpers/db";

const HEADER = readFileSync(path.join(process.cwd(), "tests", "fixtures", "data-dubai", "e2e-transactions.csv"), "utf8").split(/\r?\n/)[0].split(",");
const root = mkdtempSync(path.join(tmpdir(), "fairsquare-nearby-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const THROUGH = "2026-11-10";
const TODAY = "2026-11-18";
/** A real DLD area and community: "Dubai Science Park" in a listing resolves to both. */
const AREA = "Al Barshaa South Second";
const COMMUNITY = "Dubai Science Park";
const SQFT_PER_SQM = 10.7639;

let tx = 0;
interface Sale {
  building: string;
  beds: number;
  psf: number;
  sqm: number;
  daysAgo: number;
  offPlan?: boolean;
  area?: string;
  master?: string;
}
function line(s: Sale): string {
  const o: Record<string, string | number> = {
    transaction_id: `8-11-2026-${++tx}`,
    trans_group_en: "Sales",
    procedure_name_en: s.offPlan ? "Sell - Pre registration" : "Sell",
    instance_date: addDays(THROUGH, -s.daysAgo),
    property_type_en: "Unit",
    property_sub_type_en: "Flat",
    property_usage_en: "Residential",
    reg_type_en: s.offPlan ? "Off-Plan Properties" : "Existing Properties",
    area_name_en: s.area ?? AREA,
    building_name_en: s.building,
    project_number: "",
    project_name_en: "",
    master_project_en: s.master ?? COMMUNITY,
    rooms_en: s.beds === 0 ? "Studio" : `${s.beds} B/R`,
    has_parking: 1,
    procedure_area: s.sqm,
    actual_worth: Math.round((s.psf * Math.round(s.sqm * SQFT_PER_SQM * 100)) / 100),
  };
  return HEADER.map((h) => o[h] ?? "").join(",");
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const DATA: Sale[] = [
  // Six buildings of the community, four ready 2-bed sales each around AED 1,300 per sq ft.
  ...LETTERS.flatMap((l, b) => [1270, 1290, 1310, 1330].map((psf, i): Sale => ({ building: `TEST NEAR ${l}`, beds: 2, psf: psf + b * 4, sqm: 98 + i, daysAgo: 12 + b * 5 + i * 28 }))),
  // A building with a verdict of its own: six ready 2-bed sales.
  ...[1500, 1510, 1490, 1505, 1495, 1502].map((psf, i): Sale => ({ building: "TEST NEAR RICH", beds: 2, psf, sqm: 100, daysAgo: i * 30 })),
  // A building with off-plan sales only: a ready 2-bed listing in it has nothing of its own to compare.
  ...[1900, 1910, 1905].map((psf, i): Sale => ({ building: "TEST NEAR OWN", beds: 2, psf, sqm: 100, daysAgo: 30 + i * 20, offPlan: true })),
  // Another community of the same DLD area with two buildings only.
  ...["X", "Y"].flatMap((l) => [1100, 1120, 1140].map((psf, i): Sale => ({ building: `TEST FAR ${l}`, beds: 2, psf, sqm: 100, daysAgo: 20 + i * 25, master: "TEST SMALL COMMUNITY" }))),
];

const ANON = "0b0f6f0e-7f4e-4c64-9d5e-3a1c1b2d3e77";
const LOG_LEVEL = process.env.LOG_LEVEL;

describe("nearby registered sales: build, load and compare", () => {
  let t: TestDb;
  let dir: string;
  const ids = new Map<string, number>();

  const check = (building: string | null, over: Partial<CheckRequest["fields"]> = {}, today = TODAY) =>
    runCheck(
      t.db,
      {
        fields: { buildingText: building ?? "Test Marlow House", areaText: "Dubai Science Park", bedrooms: 2, sizeSqft: 1076, priceAed: 1_900_000, ...over },
        buildingId: building === null ? null : (ids.get(building) as number),
        source: "manual",
        editedFields: [],
        completion: "ready",
      },
      { anonId: ANON, today, appUrl: "http://localhost:3000", rules: DEFAULT_RULES },
    );
  const stored = async (code: string) => {
    const [row] = await t.db.select().from(checks).where(eq(checks.code, code));
    return row;
  };

  beforeAll(async () => {
    t = await createTestDb({ seed: false });
    dir = path.join(root, "snap");
    const csv = path.join(root, "snap.csv");
    writeFileSync(csv, [HEADER.join(","), ...DATA.map(line)].join("\r\n"), "utf8");
    await buildSnapshot({ inputs: [csv], datasetUrl: "https://data.dubai/en/test-dataset", datasetTitle: "TEST Transactions", downloadedOn: TODAY, outDir: dir });
    expect(await loadOpenData({ db: t.db, dir })).toMatchObject({ status: "loaded", rows: DATA.length, buildings: 10 });
    for (const b of await t.db.select().from(buildings)) ids.set(b.name.toUpperCase(), b.id);
    await ensureAnonUser(t.db, ANON);
  });
  afterAll(() => t.close());
  afterEach(() => {
    delete process.env.NEARBY_TIER;
    if (LOG_LEVEL === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = LOG_LEVEL;
    __resetEnvForTests();
    __resetNearbyStatusForTests();
    vi.restoreAllMocks();
    __setLogSinkForTests(null);
  });

  it("a building that is not in the data: the area text names the community, and its other buildings give a range", async () => {
    const view = await check(null);
    expect(view.analysis.band).toBe("none");
    expect(view.building).toBeNull();
    expect(shownSimilar(view.similar)).toBeNull();
    const n = nearbyShown(view);
    expect(n).not.toBeNull();
    expect(n).toMatchObject({ v: 1, constantsVersion: NEARBY_CONSTANTS.version, dataThrough: THROUGH, windowFrom: addDays(THROUGH, -729), kind: "out", shown: true, reason: null, scope: "community", community: "Dubai Science Park", verdict: "above", ageAdjusted: false, tested: { heldOf10: NEARBY_CONSTANTS.tested.heldOf10 } });
    // 7 buildings of the community have ready 2-bed sales (the six, and the one with a verdict of its own): 30 sales.
    expect(n?.buildingsTotal).toBe(7);
    expect(n?.comparablesTotal).toBe(30);
    expect(n?.comparables.length).toBe(30);
    expect(n?.buildings.map((b) => b.name)).toContain("Test Near A");
    expect(n?.buildings.reduce((s, b) => s + b.sales, 0)).toBe(30);
    expect(n?.buildings.reduce((s, b) => s + b.weightShare, 0)).toBeCloseTo(1, 3);
    expect(n?.comparables.reduce((s, c) => s + c.weightShare, 0)).toBeCloseTo(1, 3);
    expect(n?.comparables.every((c, i, all) => i === 0 || all[i - 1].weightShare >= c.weightShare)).toBe(true);
    expect(n?.comparables.every((c) => c.ageAdj === 0)).toBe(true);
    expect((n?.rangeLowPsf as number) % 10).toBe(0);
    expect(n?.rangeLowPsf as number).toBeGreaterThan(1100);
    expect(n?.rangeHighPsf as number).toBeLessThan(1766);
    // No sale of another community or basis is used.
    expect(n?.comparables.some((c) => /Far|Own/.test(c.building))).toBe(false);

    // The page: the outcome is the headline; it says at once that the building was not found and whose sales it reads.
    expect(verdictHeadText(view)).toBe("Above the range of nearby sales");
    expect(plainNotCovered(view)).toBe(false);
    const l = nearbyLines(view);
    expect(l?.own).toBe("Fairsquare could not find “Test Marlow House” in Dubai Land Department sales data, so there are no registered sales of this building to compare.");
    expect(l?.fromOthers).toBe("The range here comes from other buildings in Dubai Science Park, not from this one.");
    expect(l?.intro).toMatch(/^Fairsquare took 30 registered sales of ready 2-beds in 7 other buildings in Dubai Science Park and adjusted each one to this listing: to 10 Nov 2026 for its date and to 1,076 sq ft for its size\.$/);
    expect(l?.tested).toBe(`In tests, about ${NEARBY_CONSTANTS.tested.heldOf10} of 10 later sale prices were inside a range made this way.`);
    expect(l?.weakOut).toMatch(/could not find this building in DLD sales data\. Its name may be registered differently\./);
    expect(l?.dld).toBeNull();
    expect(verdictAnnouncement(view)).toMatch(/^Above the range of nearby sales\. Fairsquare could not find/);
    expect(shareText(view)).toMatch(/^Test Marlow House, ready 2-bed, 1,076 sq ft, asking AED 1,900,000 \(AED 1,766 per sq ft\)\. Fairsquare could not find this building in DLD sales data\. 30 registered sales in other buildings in Dubai Science Park, each adjusted to this listing, point to AED [\d,]+ to AED [\d,]+ per sq ft\. The asking price, AED 1,766 per sq ft, is above that range\. Other buildings are weaker evidence than sales in this one\. Source: DLD open data via Data\.Dubai\. Not a valuation\. http/);
    expect(ogTitle(view)).toBe("Test Marlow House 2-bed: above the range of nearby sales");
    expect(ogDescription(view)).toMatch(/^This building is not in DLD sales data\. 30 registered sales in other buildings in Dubai Science Park point to AED .* Not a valuation\.$/);
    expect(stampProps(view)).toMatchObject({ header: "ABOVE", lines: { c: "AED PER SQ FT, NEARBY REGISTERED SALES", d: ["2-BED", "ADJUSTED TO 10 NOV 2026"] } });
    expect(stampProps(view).figure).toMatch(/^[\d,]+ TO [\d,]+$/);

    // What is stored: the view and, on the server only, the middle figure and the unrounded ends.
    const row = await stored(view.code);
    const full = NearbyStoredSchema.parse(row.nearbyView);
    expect(full.server).toMatchObject({ group: "Rc0", buildings: 7 });
    expect(full.server?.centrePsf as number).toBeGreaterThan(full.rangeLowPsf as number);
    expect(JSON.stringify(view)).not.toMatch(/centrePsf|halfWidth|"server"/);
    expect(JSON.stringify(view)).not.toMatch(/dld:/);
    expect(NearbyViewSchema.parse(view.nearby)).toEqual(view.nearby);
    expect(CheckViewSchema.parse(JSON.parse(JSON.stringify(view))).nearby).toEqual(view.nearby);
    // /c and the API read the same stored entry later.
    const again = await getCheckWithCurrent(t.db, view.code, addDays(TODAY, 200), DEFAULT_RULES, "http://localhost:3000");
    expect(again?.check.nearby).toEqual(view.nearby);
    // The event says what happened.
    const ev = await t.db.select().from(events).where(eq(events.checkId, row.id));
    expect((ev[0].meta as { nearby?: string }).nearby).toBe("shown_out_above");
    // It can be saved, and the Saved line gets the outcome against the range.
    await saveCheck(t.db, ANON, row, TODAY, DEFAULT_RULES);
    const saved = (await listSaved(t.db, ANON, TODAY, DEFAULT_RULES)).find((s) => s.code === view.code);
    expect(saved?.nearby).toEqual({ verdict: "above", rangeLowPsf: n?.rangeLowPsf, rangeHighPsf: n?.rangeHighPsf });
  });

  it("a chosen building with nothing of its own to compare: the community's other buildings, never its own sales", async () => {
    const view = await check("TEST NEAR OWN");
    expect(view.analysis).toMatchObject({ band: "thin", count: 0 });
    expect(shownAcs(view.acs)).toBeNull();
    expect(shownSimilar(view.similar)).toBeNull();
    const n = nearbyShown(view);
    expect(n).toMatchObject({ kind: "in", shown: true, scope: "community", community: "Dubai Science Park", ageAdjusted: true, buildingsTotal: 7, comparablesTotal: 30 });
    expect(n?.comparables.some((c) => c.building === "Test Near Own")).toBe(false);
    expect(n?.comparables.some((c) => c.ageAdj !== 0)).toBe(true);
    const l = nearbyLines(view);
    expect(l?.own).toBe("Test Near Own has no registered sales of ready 2-beds in the 12 months to 10 Nov 2026.");
    expect(l?.intro).toMatch(/for its date, to 1,076 sq ft for its size, and for the age of its building\.$/);
    expect(l?.dld).toBe("DLD building: Test Near Own.");
    expect(l?.weakOut).toBeNull();
    expect(l?.definitions.join(" ")).toMatch(/This building's own registered sales are not part of the range\./);
    expect(shareText(view)).toMatch(/This building has too few registered sales of its own to compare\. 30 registered sales in other buildings in Dubai Science Park/);
    expect(ogDescription(view)).toMatch(/^Too few registered sales in this building to compare\./);
    expect((await t.db.select().from(events).where(eq(events.checkId, (await stored(view.code)).id)))[0].meta).toMatchObject({ nearby: `shown_in_${n?.verdict}` });
  });

  it("does not run when anything else gives a comparison", async () => {
    // A verdict of its own.
    const rich = await check("TEST NEAR RICH");
    expect(["above", "inline", "below"]).toContain(rich.analysis.band);
    expect((await stored(rich.code)).nearbyView).toBeNull();
    expect(rich.nearby).toBeNull();
    // Too few sales, but the building's own sales give something: then that shows, and nearby is not computed.
    const a = await check("TEST NEAR A");
    expect(a.analysis).toMatchObject({ band: "thin", count: 4 });
    const other = shownAcs(a.acs) !== null || shownSimilar(a.similar) !== null;
    expect((await stored(a.code)).nearbyView === null).toBe(other);
    if (!other) expect(nearbyLines(a)?.own).toBe("Test Near A has 4 registered sales of ready 2-beds in the 12 months to 10 Nov 2026. A comparison needs 5.");
  });

  it("a community with under 3 buildings reads the rest of the DLD area too, and says so", async () => {
    // "TEST FAR X" is thin (3 sales) in a community of two buildings; whether nearby runs depends on the other tiers.
    const view = await check("TEST FAR X");
    const row = await stored(view.code);
    if (row.nearbyView !== null) {
      const full = NearbyStoredSchema.parse(row.nearbyView);
      expect(full.scope).toBe("community_and_area");
      expect(full.community).toBe("Test Small Community");
      if (full.shown) expect(nearbyLines(view)?.fromOthers).toBe("The range here comes from other buildings in Test Small Community and the rest of Al Barshaa South Second, not from this one.");
    } else {
      expect(shownAcs(view.acs) !== null || shownSimilar(view.similar) !== null).toBe(true);
    }
  });

  it("declines with a reason, and the page stays as it was", async () => {
    // The area names no place.
    const nowhere = await check(null, { areaText: "Nowhere Bay" });
    expect(NearbyStoredSchema.parse((await stored(nowhere.code)).nearbyView)).toMatchObject({ kind: "out", shown: false, reason: "area_unresolved", comparables: [], server: null });
    expect(nearbyShown(nowhere)).toBeNull();
    expect(plainNotCovered(nowhere)).toBe(true);
    expect(verdictHeadText(nowhere)).toBe("Not covered yet");
    expect(shareText(nowhere)).toMatch(/Fairsquare doesn't cover this building yet/);
    // No area at all.
    expect(NearbyStoredSchema.parse((await stored((await check(null, { areaText: null })).code)).nearbyView)).toMatchObject({ shown: false, reason: "area_unresolved" });
    // A name that spans several DLD areas.
    expect(NearbyStoredSchema.parse((await stored((await check(null, { areaText: "Al Barsha" })).code)).nearbyView)).toMatchObject({ shown: false, reason: "area_ambiguous" });
    // No sale of that bedroom type nearby.
    const three = await check(null, { bedrooms: 3 });
    expect(NearbyStoredSchema.parse((await stored(three.code)).nearbyView)).toMatchObject({ shown: false, reason: "no_comparables", community: "Dubai Science Park" });
    expect(verdictHeadText(three)).toBe("Not covered yet");
    // A size far from every sale: too little weight is left.
    const big = await check(null, { sizeSqft: 2600 });
    const bigStored = NearbyStoredSchema.parse((await stored(big.code)).nearbyView);
    expect(bigStored.shown).toBe(false);
    expect(["too_few_buildings", "size_too_far"]).toContain(bigStored.reason);
    expect(big.nearby?.comparables).toEqual([]);
    expect(nearbyShown(big)).toBeNull();
  });

  it("NEARBY_TIER=off: nothing is computed, and a stored range is hidden everywhere", async () => {
    const before = await check(null);
    expect(nearbyShown(before)).not.toBeNull();
    process.env.NEARBY_TIER = "off";
    __resetEnvForTests();
    const off = await check(null);
    expect((await stored(off.code)).nearbyView).toBeNull();
    expect(off.nearby).toBeNull();
    const row = await stored(before.code);
    expect(row.nearbyView).not.toBeNull();
    expect(storedNearby(row)).toBeNull();
    const view = toCheckView(row, "http://localhost:3000");
    expect(view.nearby).toBeNull();
    expect(verdictHeadText(view)).toBe("Not covered yet");
    expect(plainNotCovered(view)).toBe(true);
    expect(await nearbyStatus(t.db, TODAY)).toEqual({ active: false, reason: "switched_off" });
    // On again: the stored one is back as it was.
    delete process.env.NEARBY_TIER;
    if (LOG_LEVEL === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = LOG_LEVEL;
    __resetEnvForTests();
    expect(toCheckView(row, "http://localhost:3000").nearby).toEqual(before.nearby);
  });

  it("is not served once the data is more than 122 days old, and says so once", async () => {
    const logs: string[] = [];
    process.env.LOG_LEVEL = "warn";
    __resetEnvForTests();
    __setLogSinkForTests((_l, line) => logs.push(line));
    const edge = addDays(THROUGH, NEARBY_MAX_DATA_AGE_DAYS);
    expect((await nearbyStatus(t.db, edge)).active).toBe(true);
    const late = addDays(THROUGH, NEARBY_MAX_DATA_AGE_DAYS + 1);
    expect(await nearbyStatus(t.db, late)).toEqual({ active: false, reason: "data_too_old" });
    const view = await check(null, {}, late);
    expect((await stored(view.code)).nearbyView).toBeNull();
    expect(verdictHeadText(view)).toBe("Not covered yet");
    await check(null, {}, late);
    expect(logs.filter((l) => l.includes("nearby_inactive")).length).toBe(1);
  });

  it("a fit more than 200 days older than the data fails the build and is not used", () => {
    const m = { dataThrough: THROUGH };
    expect(nearbyFitTooOld(m)).toBe(false);
    expect(nearbyFitTooOld(m, addDays(THROUGH, -NEARBY_MAX_FIT_AGE_DAYS))).toBe(false);
    expect(nearbyFitTooOld(m, addDays(THROUGH, -(NEARBY_MAX_FIT_AGE_DAYS + 1)))).toBe(true);
    const late = { dataThrough: addDays(NEARBY_CONSTANTS.fittedOn, NEARBY_MAX_FIT_AGE_DAYS + 1) };
    expect(nearbyFitTooOld(late)).toBe(true);
    const report = { excluded: { date_out_of_range: 0 }, manifest: { ...late, downloadedOn: late.dataThrough } } as unknown as Parameters<typeof reportWarnings>[0];
    expect(reportWarnings(report).join("\n")).toMatch(/nearby-registered-sales constants were fitted on data to 2026-11-16, 201 days before this data ends/);
  });

  it("a failure inside the step costs nothing: the comparison is stored as it was before, and it is logged", async () => {
    const logs: string[] = [];
    process.env.LOG_LEVEL = "warn";
    __resetEnvForTests();
    __setLogSinkForTests((_l, line) => logs.push(line));
    vi.spyOn(repoNearby, "nearbySales").mockRejectedValueOnce(new Error("boom"));
    const view = await check(null);
    expect(view.analysis.band).toBe("none");
    expect((await stored(view.code)).nearbyView).toBeNull();
    expect(verdictHeadText(view)).toBe("Not covered yet");
    expect(logs.filter((l) => l.includes("nearby_failed")).length).toBe(1);
  });

  it("an entry that is not safe to draw shows nothing", async () => {
    const view = await check(null);
    const n = view.nearby as NonNullable<typeof view.nearby>;
    expect(shownNearby(n)).not.toBeNull();
    expect(shownNearby({ ...n, comparables: [] })).toBeNull();
    expect(shownNearby({ ...n, buildings: [] })).toBeNull();
    expect(shownNearby({ ...n, community: null })).toBeNull();
    expect(shownNearby({ ...n, tested: null })).toBeNull();
    expect(shownNearby({ ...n, rangeHighPsf: (n.rangeLowPsf as number) - 10 })).toBeNull();
    expect(shownNearby({ ...n, verdict: null })).toBeNull();
    // Never beside a kind it is not: an "out" entry on a comparison with a building, or with a verdict.
    expect(nearbyShown({ ...view, building: { id: 1, name: "Test Near A", area: "x", areaDld: null } })).toBeNull();
    expect(nearbyShown({ ...view, analysis: { ...view.analysis, band: "inline" } })).toBeNull();
    expect(nearbyShown({ ...view, analysis: { ...view.analysis, band: "thin" } })).toBeNull();
  });

  describe("marketing names kept by hand (market-names.ts)", () => {
    const LIST = [{ building: "TEST NEAR A", areaDld: AREA, names: ["Test Grand Residences Tower 1", "Test Grand Residences 1"], evidence: "test" }];

    it("the load recorded the shipped list; a changed list adds its aliases without a new snapshot", async () => {
      expect(await getAppMeta(t.db, "market_names_sha")).toBe(marketNamesSha());
      // The snapshot is unchanged: the load does nothing, and the names are still added.
      expect(await loadOpenData({ db: t.db, dir })).toMatchObject({ status: "up_to_date", skipped: "same_sha" });
      expect(await syncMarketNames(t.db, { list: LIST })).toBe(2);
      expect(await getAppMeta(t.db, "market_names_sha")).toBe(marketNamesSha(LIST));
      // Run again: nothing to do, and never a duplicate.
      expect(await syncMarketNames(t.db, { list: LIST })).toBe(0);
      expect(await syncMarketNames(t.db, { list: LIST, force: true })).toBe(0);
      const rows = await t.db.select().from(buildingAliases).where(eq(buildingAliases.buildingId, ids.get("TEST NEAR A") as number));
      expect(rows.filter((r) => r.aliasNorm.includes("grand")).map((r) => [r.aliasRaw, r.source]).sort()).toEqual([
        ["Test Grand Residences 1", "import"],
        ["Test Grand Residences Tower 1", "import"],
      ]);
      // A listed building that is not in the data is skipped.
      expect(await syncMarketNames(t.db, { list: [{ building: "TEST NOT THERE", areaDld: AREA, names: ["Test Elsewhere 1"], evidence: "test" }] })).toBe(0);
    });

    it("a listing's marketing name then selects the DLD building", async () => {
      await syncMarketNames(t.db, { list: LIST, force: true });
      invalidateAliasCache();
      const cands = findCandidates("Test Grand Residences Tower 1", await getAliasRows(t.db), "Dubai Science Park");
      expect(cands[0]).toMatchObject({ buildingId: ids.get("TEST NEAR A"), name: "Test Near A", strength: "strong" });
      expect(preselect(cands)).toBe(ids.get("TEST NEAR A"));
    });
  });
});
