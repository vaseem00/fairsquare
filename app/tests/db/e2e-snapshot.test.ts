/**
 * The synthetic open-data snapshot the Playwright smoke test loads (OPEN_DATA_DIR =
 * tests/fixtures/open-data, see playwright.config.ts). It is built by the real `npm run data:build`
 * from two synthetic Data.Dubai files: the rules fixture (transactions-sample.csv) and
 * e2e-transactions.csv (TEST TOWER D with 11 ready 2-bed sales, 3 off-plan 1-bed sales; TEST
 * TOWER E with 2 ready 3-bed sales in the 12 months and 2 earlier ones; TEST TOWER G, H and J, three
 * other buildings of its community with 3 or 4 ready 3-bed sales each, so the second tier has
 * something to show end to end). The snapshot carries the adjusted-registered-sales model too
 * (acs-model.json.gz, REAL_DATA.md section 16), and Test Tower D gets its first answer from it. This test keeps the committed files in step with the CSVs and
 * pins the numbers the smoke test expects. Rebuild after changing either CSV:
 *   npm run data:build -- --in tests/fixtures/data-dubai/transactions-sample.csv
 *     --in tests/fixtures/data-dubai/e2e-transactions.csv --dataset-url https://example.test/data-dubai/transactions
 *     --downloaded 2026-11-18 --dataset-title "Test Transactions (synthetic)" --out tests/fixtures/open-data
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shownAcs } from "@/lib/acs/shown";
import { ensureAnonUser } from "@/lib/db/repo/anon";
import { getCoverage, getAliasRows, recentSales } from "@/lib/db/repo/buildings";
import { getCheckRowByCode, storedAcs, toCheckView } from "@/lib/db/repo/checks";
import { listSaved, saveCheck } from "@/lib/db/repo/saved";
import { acsLead, verdictHeadText } from "@/lib/copy";
import { buildings } from "@/lib/db/schema";
import { analyse, DEFAULT_RULES } from "@/lib/domain/analyse";
import { findCandidates, preselect } from "@/lib/domain/match";
import { buildSnapshot } from "@/lib/ingest/build";
import { loadOpenData } from "@/lib/ingest/load";
import { readManifest } from "@/lib/ingest/snapshot";
import { runCheck } from "@/lib/services/check";
import { getFromTheData } from "@/lib/services/from-the-data";
import { createTestDb, type TestDb } from "../helpers/db";

const FIXTURES = path.join(process.cwd(), "tests", "fixtures");
const SNAPSHOT_DIR = path.join(FIXTURES, "open-data");
const INPUTS = [
  path.join(FIXTURES, "data-dubai", "transactions-sample.csv"),
  path.join(FIXTURES, "data-dubai", "e2e-transactions.csv"),
];
/** The day the smoke test's numbers are stated for (the window ends at data_through, 10 Nov 2026). */
const TODAY = "2026-11-18";

/** The range the model gives Test Tower D's 2-beds at 1,284 sq ft (AED per sq ft), pinned for the smoke test. */
const E2E_TOWER_D_RANGE = [1550, 1970];

const root = mkdtempSync(path.join(tmpdir(), "fairsquare-e2e-snap-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the e2e open-data snapshot (tests/fixtures/open-data)", () => {
  it("is exactly what data:build makes from the two synthetic CSVs", async () => {
    const out = path.join(root, "rebuilt");
    const report = await buildSnapshot({
      inputs: INPUTS,
      datasetUrl: "https://example.test/data-dubai/transactions",
      datasetTitle: "Test Transactions (synthetic)",
      downloadedOn: "2026-11-18",
      outDir: out,
    });
    const committed = await readManifest(SNAPSHOT_DIR);
    expect(committed).not.toBeNull();
    // File hashes depend on line endings and the zlib build: compare everything else, and the rows.
    const strip = (m: NonNullable<typeof committed>) => ({
      ...m,
      sourceFiles: m.sourceFiles.map(({ name, rows }) => ({ name, rows })),
      snapshotSha256: "",
      buildingsFile: m.buildingsFile && { ...m.buildingsFile, sha256: "" },
      similar: m.similar && { ...m.similar, cellsFile: { ...m.similar.cellsFile, sha256: "" } },
      acs: m.acs && { ...m.acs, modelFile: { sha256: "", bytes: 0 } },
    });
    expect(strip(committed!)).toEqual(strip(report.manifest));
    const rows = (dir: string) => gunzipSync(readFileSync(path.join(dir, "sales.csv.gz"))).toString("utf8");
    expect(rows(SNAPSHOT_DIR)).toBe(rows(out));
    const facts = (dir: string) => gunzipSync(readFileSync(path.join(dir, "buildings.csv.gz"))).toString("utf8");
    expect(facts(SNAPSHOT_DIR)).toBe(facts(out));
    expect(committed?.buildingsFile?.rows).toBe(9);
    // The similar-buildings cells and the model section (REAL_DATA.md section 15) are part of the snapshot.
    const cells = (dir: string) => gunzipSync(readFileSync(path.join(dir, "similar-cells.csv.gz"))).toString("utf8");
    expect(cells(SNAPSHOT_DIR)).toBe(cells(out));
    expect(committed?.similar).toMatchObject({ version: 1, builtOn: "2026-11-18", windowStart: "2025-11-10", cellsFile: { rows: 14 }, buildings: 9 });
    // The adjusted-registered-sales model (REAL_DATA.md section 16) is part of the snapshot too.
    const model = (dir: string) => JSON.parse(gunzipSync(readFileSync(path.join(dir, "acs-model.json.gz"))).toString("utf8")) as { snapshotSha256: string; buildings: { key: string[] } };
    expect({ ...model(SNAPSHOT_DIR), snapshotSha256: "" }).toEqual({ ...model(out), snapshotSha256: "" });
    expect(model(SNAPSHOT_DIR).snapshotSha256).toBe(committed?.snapshotSha256);
    expect(committed?.acs).toMatchObject({ version: 2, constantsVersion: 1, buildings: 9, indexSales: 42 });
    // Synthetic names only (REAL_DATA.md section 0).
    for (const line of rows(SNAPSHOT_DIR).trim().split("\n").slice(1)) expect(line).toMatch(/,(TEST TOWER [A-J]|THE RESIDENCES AT TEST GATE 1),/);
  });

  describe("loaded into a fresh database", () => {
    let t: TestDb;
    beforeAll(async () => {
      t = await createTestDb({ seed: false });
      expect(await loadOpenData({ db: t.db, dir: SNAPSHOT_DIR })).toMatchObject({ status: "loaded", rows: 40, buildings: 9, similarCells: 14 });
    });
    afterAll(() => t.close());

    it("From the data: Test Tower D, Dubai Marina (DLD area Marsa Dubai), 11 ready 2-bed sales", async () => {
      const panel = await getFromTheData(t.db, TODAY, DEFAULT_RULES);
      expect(panel).toMatchObject({
        building: { name: "Test Tower D", area: "Dubai Marina", areaDld: "Marsa Dubai" },
        bedrooms: 2,
        count: 11,
        firstSaleDate: "2026-01-05",
        lastSaleDate: "2026-11-10",
        window: { start: "2025-11-10", end: "2026-11-10" },
      });
      expect(Math.round(panel!.medianPsf)).toBe(1669);
    });

    it("a typed Test Tower D 2-bed (1,284 sq ft, AED 2,450,000) is preselected and above the median of 11", async () => {
      const cands = findCandidates("Test Tower D", await getAliasRows(t.db), null);
      const id = preselect(cands);
      expect(cands[0].name).toBe("Test Tower D");
      expect(id).toBe(cands[0].buildingId);
      const a = analyse(2_450_000, 1284, await recentSales(t.db, id!, 2, "ready", { start: "2025-11-10", end: "2026-11-10" }), DEFAULT_RULES);
      expect(a).toMatchObject({ band: "above", count: 11, outliersDropped: 0 });
      expect(a.diff).toBeCloseTo(0.1433, 3);
    });

    it("adjusted registered sales end to end: Test Tower D 2-bed gets a range from its 12 registered sales; Test Tower E (2 sales) falls back", async () => {
      const anon = "0b0f6f0e-7f4e-4c64-9d5e-3a1c1b2d3e61";
      await ensureAnonUser(t.db, anon);
      const all = await t.db.select().from(buildings);
      const id = (name: string) => all.find((b) => b.name === name)!.id;
      const run = (name: string, fields: { bedrooms: number; sizeSqft: number; priceAed: number }) =>
        runCheck(t.db, { fields: { buildingText: name, areaText: null, ...fields }, buildingId: id(name), source: "manual", editedFields: [] }, { anonId: anon, today: TODAY, appUrl: "http://localhost:3000", rules: DEFAULT_RULES });
      const d = await run("Test Tower D", { bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 });
      // The same-building result is what the smoke test has always seen.
      expect(d.analysis).toMatchObject({ band: "above", count: 11 });
      const acs = shownAcs(d.acs);
      expect(acs).not.toBeNull();
      // The 11 sales of the 12 months and one of June 2025, each moved to 10 Nov 2026 and to 1,284 sq ft.
      expect(acs).toMatchObject({ scenario: "enough", dataThrough: "2026-11-10", evidence: { lead: 1, sales: 12, ownSales: 12, otherBedroomSales: 0, projectSales: 0 }, tested: { heldOf10: 8, heldLaterOf10: 8 } });
      expect(acs!.comparables.map((c) => c.ring)).toEqual(Array(12).fill(1));
      expect(acs!.comparables.at(-1)).toMatchObject({ date: "2025-06-10", sizeSqft: 1189.41 });
      expect([acs!.rangeLowPsf, acs!.rangeHighPsf]).toEqual(E2E_TOWER_D_RANGE);
      // The two rules differ here, as the backtest says they often do (REAL_DATA.md section 16.8): the asking
      // price, AED 1,908 per sq ft, is 14.3% above the median of 11 (above the 5% band) and inside the range.
      expect(acs!.verdict).toBe("within");
      expect(d.analysis.diff).toBeCloseTo(0.1433, 3);
      // Too few sales: no range from adjusted registered sales; the second tier is there as before.
      const e = await run("Test Tower E", { bedrooms: 3, sizeSqft: 1900, priceAed: 2_500_000 });
      expect(e.analysis).toMatchObject({ band: "thin", count: 2 });
      expect(e.acs).toMatchObject({ shown: false, scenario: "few" });
      expect(e.similar?.shown).toBe(true);
      // The other fallbacks the smoke test opens. A 2-bed far larger than any sold: no range, and the
      // same-building median answers as before ("In line"). An off-plan 1-bed with 3 sales: neither a
      // range of adjusted sales nor the second tier, so "Too few sales" with nothing under it.
      const big = await run("Test Tower D", { bedrooms: 2, sizeSqft: 1700, priceAed: 2_900_000 });
      expect(big.analysis).toMatchObject({ band: "inline", count: 11 });
      expect(big.acs).toMatchObject({ shown: false, reason: "too_few_comparables" });
      expect(acsLead(big)).toBeNull();
      expect(verdictHeadText(big)).toBe("In line with registered sales");
      // Above and below the range, as the smoke test's re-settle and screenshots use them.
      expect(acsLead(await run("Test Tower D", { bedrooms: 2, sizeSqft: 1284, priceAed: 2_600_000 }))).toMatchObject({ verdict: "above", rangeLowPsf: 1550, rangeHighPsf: 1970 });
      expect(acsLead(await run("Test Tower D", { bedrooms: 2, sizeSqft: 1190, priceAed: 1_500_000 }))).toMatchObject({ verdict: "below" });

      // Saved: the line of a saved comparison follows the range that leads its page.
      const row = (await getCheckRowByCode(t.db, d.code))!;
      await saveCheck(t.db, anon, row, TODAY, DEFAULT_RULES);
      const saved = await listSaved(t.db, anon, TODAY, DEFAULT_RULES);
      expect(saved.find((s) => s.code === d.code)).toMatchObject({ atSave: { band: "above", count: 11 }, acs: { verdict: "within", rangeLowPsf: 1550, rangeHighPsf: 1970 } });
      // The switch (ACS_TIER=off) and a row stored before this existed: the same stored comparison reads as the median's.
      expect(storedAcs(row, "off")).toBeNull();
      const off = { ...toCheckView(row, "http://localhost:3000"), acs: storedAcs(row, "off") };
      expect(acsLead(off)).toBeNull();
      expect(verdictHeadText(off)).toBe("14.3% above registered sales");
      expect(verdictHeadText({ ...off, acs: storedAcs({ acsView: null }) })).toBe("14.3% above registered sales");
    });

    it("Test Tower E 3-bed has 2 sales (too few), and coverage counts ready and off-plan sales", async () => {
      const cov = await getCoverage(t.db, TODAY, DEFAULT_RULES);
      const d = cov.buildings.find((b) => b.name === "Test Tower D");
      const e = cov.buildings.find((b) => b.name === "Test Tower E");
      expect(d).toMatchObject({ readySales: 11, offPlanSales: 3, area: "Dubai Marina", areaDld: "Marsa Dubai" });
      expect(e).toMatchObject({ readySales: 2, offPlanSales: 0, area: "Jumeirah Village Circle (JVC)" });
      expect(e?.types).toEqual([expect.objectContaining({ bedrooms: 3, readySales: 2, readyComparable: false, offPlanComparable: false })]);
      // Test Tower F: 2-bed with off-plan sales only, never shown as comparable for a ready listing.
      const f = cov.buildings.find((b) => b.name === "Test Tower F");
      const fTwo = f?.types.find((x) => x.bedrooms === 2);
      if (fTwo) expect(fTwo).toMatchObject({ readySales: 0, readyComparable: false });
      expect(cov.buildings[0].name).toBe("Test Tower D");
    });
  });
});
