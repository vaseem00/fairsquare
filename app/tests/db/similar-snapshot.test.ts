/**
 * The committed snapshot (data/open-data) and its similar-buildings model (REAL_DATA.md section 15):
 * the committed cells file is exactly what `npm run data:build` makes from the committed sales and
 * buildings, and the manifest section matches it. This reads every sale of the snapshot once (some
 * seconds), and stays true after any data refresh; the frozen golden cases are in
 * tests/unit/domain/similar.test.ts.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareSimilar, type SimilarConstants } from "@/lib/domain/similar";
import { similarArtifactOf } from "@/lib/ingest/build";
import { artifactFromCellRows, BUILDINGS_FILE, readBuildingFacts, readManifest, readSimilarCells, readSnapshotRows, SIMILAR_CELLS_FILE, similarCellRows, SNAPSHOT_FILE } from "@/lib/ingest/snapshot";
import type { NormalisedSale } from "@/lib/ingest/types";
import { SIMILAR_VERSION } from "@/lib/similar/model";

const DIR = path.join(process.cwd(), "data", "open-data");

// The snapshot is built from Data.Dubai rows, which this repository does not redistribute
// (docs/DATA_COLLECTION.md). Build one with `npm run data:build` and this test runs.
describe.skipIf(!existsSync(path.join(DIR, "manifest.json")))("the committed snapshot's similar-buildings model", () => {
  it("the cells file is what data:build makes from the committed sales, and the manifest describes it", { timeout: 180_000 }, async () => {
    const manifest = await readManifest(DIR);
    expect(manifest?.similar).toBeDefined();
    const similar = manifest!.similar!;
    expect(similar.version).toBe(SIMILAR_VERSION);
    const facts = await readBuildingFacts(path.join(DIR, BUILDINGS_FILE), manifest!.buildingsFile!);
    const sales: NormalisedSale[] = [];
    let sha = "";
    for await (const s of readSnapshotRows(path.join(DIR, SNAPSHOT_FILE), (h) => (sha = h))) sales.push(s);
    expect(sha).toBe(manifest!.snapshotSha256);
    const built = similarArtifactOf(sales, facts);
    sales.length = 0;
    expect(built.dataThrough).toBe(manifest!.dataThrough);
    expect(built.windowStart).toBe(similar.windowStart);

    const committed = await readSimilarCells(path.join(DIR, SIMILAR_CELLS_FILE), similar.cellsFile);
    expect(committed).toHaveLength(similar.cellsFile.rows);
    expect(new Set(committed.map((c) => `${c.building}|${c.areaDld}`)).size).toBe(similar.buildings);
    expect(committed).toEqual([...similarCellRows(built)]);

    // Every combination that is too few today gets an answer without an error, and the share shown
    // is in the range the backtest found (67.0% of 8,825 on the snapshot of 16 Nov 2026 rebuilt with rule
    // 10a at 0.85x to 1.18x, constants version 3; 67.6% with version 2; 90.4% before the consistency rules).
    const artifact = artifactFromCellRows(committed, built.dataThrough, built.windowStart);
    const c = similar.constants as unknown as SimilarConstants;
    let tooFew = 0;
    let shown = 0;
    const reasons: Record<string, number> = {};
    expect(c.version).toBeGreaterThanOrEqual(2);
    for (const cell of artifact.cells) {
      if (cell.n12 >= 5) continue;
      tooFew++;
      const r = compareSimilar(artifact, c, { bedrooms: cell.bed, basis: cell.basis, askingPsf: 1500, buildingKey: artifact.buildings[cell.b].key });
      if (r.shown) {
        shown++;
        expect(r.rangeLowPsf as number).toBeLessThan(r.rangeHighPsf as number);
        expect(r.halfWidth as number).toBeLessThanOrEqual(c.maxHalfWidth);
        expect(cell.bed).toBeLessThanOrEqual(c.maxBedrooms);
        // The consistency rules (REAL_DATA.md section 15.3): something from the building itself, never
        // its 12-month sales alone, its own medians within the ratio, and its 12-month median inside the range.
        expect(["own", "indirect"]).toContain(r.evidenceClass);
        const e = r.evidence;
        if (e.ownSales) {
          expect(e.older12to24 !== null || e.older24to36 !== null || e.otherBedrooms !== null || r.comparableBuildings > 0).toBe(true);
          expect(e.ownSales.medianPsf).toBeGreaterThanOrEqual(r.rangeLowPsf as number);
          expect(e.ownSales.medianPsf).toBeLessThanOrEqual(r.rangeHighPsf as number);
        }
        const medians = [e.ownSales, e.older12to24, e.older24to36].flatMap((x) => (x ? [x.medianPsf] : []));
        if (medians.length > 1) expect(Math.max(...medians) / Math.min(...medians)).toBeLessThanOrEqual(c.maxOwnMedianRatio as number);
      } else {
        expect([r.rangeLowPsf, r.rangeHighPsf, r.verdict]).toEqual([null, null, null]);
        reasons[r.reason as string] = (reasons[r.reason as string] ?? 0) + 1;
      }
    }
    expect(tooFew).toBeGreaterThan(1000);
    expect(shown / tooFew).toBeGreaterThan(0.5);
    expect(shown / tooFew).toBeLessThan(0.85);
    if (manifest!.snapshotSha256 === similar.constants.fittedOn.snapshotSha256) {
      // The snapshot the constants were fitted on: the verified counts exactly.
      expect([artifact.cells.length, artifact.buildings.length, tooFew]).toEqual([13_575, 4_348, 8_825]);
      expect(Math.round((shown / tooFew) * 1000) / 10).toBe(67);
      expect(reasons).toEqual({ evidence_disagrees: 1944, bedrooms_not_validated: 759, own_sales_only: 66, range_too_wide: 147 });
      // The summary the manifest carries (scripts/model) says the same.
      expect((similar.backtest as unknown as { served: { tooFewCombinations: number; shownPct: number } }).served).toMatchObject({ tooFewCombinations: 8_825, shownPct: 67 });
    }
  });
});
