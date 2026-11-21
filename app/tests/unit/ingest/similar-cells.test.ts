/**
 * `similar-cells.csv.gz` (REAL_DATA.md sections 3 and 15.1): the writer and the reader round-trip
 * every digit, the reader refuses wrong values, and the manifest's `similar` section is validated.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildSimilarArtifact } from "@/lib/domain/similar";
import { reportWarnings, similarArtifactOf, similarFitTooOld } from "@/lib/ingest/build";
import {
  artifactFromCellRows,
  dataSourceMeta,
  ManifestSchema,
  parseSimilarCellRecord,
  readSimilarCells,
  SIMILAR_CELL_COLUMNS,
  similarCellRows,
  SnapshotError,
  writeSimilarCellsFile,
  type Manifest,
} from "@/lib/ingest/snapshot";
import type { BuildingFacts, NormalisedSale } from "@/lib/ingest/types";
import { SIMILAR_BACKTEST, SIMILAR_CONSTANTS, SIMILAR_MAX_FIT_AGE_DAYS, SIMILAR_MIN_CONSTANTS_VERSION, SimilarConstantsSchema, SimilarManifestSchema } from "@/lib/similar/model";
import { parseArgs } from "../../../scripts/data-build";

const root = mkdtempSync(path.join(tmpdir(), "fairsquare-cells-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const sale = (building: string, date: string, priceAed: number, sizeSqft: number, bedrooms = 2): NormalisedSale => ({
  ref: `dld:${building}-${date}-${priceAed}`,
  date,
  building,
  areaDld: "Test Area",
  project: null,
  masterProject: null,
  bedrooms,
  sizeSqft,
  priceAed,
  completion: "ready",
  projectNumber: null,
  parking: null,
});
const facts = (building: string, projectNumber: number | null, masterProject: string | null): BuildingFacts => ({
  building,
  areaDld: "Test Area",
  projectNumber,
  project: null,
  masterProject,
  nearestMetro: null,
  nearestMall: null,
  nearestLandmark: null,
  firstSale: "2020-01-01",
  firstReadySale: null,
  lastSale: "2026-11-10",
  sales: 1,
  offPlanSales: 0,
  parkingSales: 0,
});

describe("similar-cells.csv.gz", () => {
  // Prices and sizes chosen so the medians are long decimals.
  const SALES = [
    sale('TEST "QUOTED", TOWER', "2026-11-10", 1_234_567, 1076.39),
    sale('TEST "QUOTED", TOWER', "2026-10-01", 1_000_001, 913.77),
    sale('TEST "QUOTED", TOWER', "2025-06-01", 987_654, 850.31),
    sale("TEST TOWER B", "2024-03-03", 777_777, 640.07, 0),
  ];
  const FACTS = [facts('TEST "QUOTED", TOWER', 2977, "TEST MASTER"), facts("TEST TOWER B", null, null)];
  const artifact = similarArtifactOf(SALES, FACTS);

  it("similarArtifactOf: the kept sales grouped as the loader groups them, with the buildings file's project number and master project", () => {
    expect(artifact).toMatchObject({ dataThrough: "2026-11-10", windowStart: "2025-11-10" });
    expect(artifact.buildings).toEqual([
      { key: 'TEST "QUOTED", TOWER|Test Area', building: 'TEST "QUOTED", TOWER', areaDld: "Test Area", projectNumber: "2977", masterProject: "TEST MASTER" },
      { key: "TEST TOWER B|Test Area", building: "TEST TOWER B", areaDld: "Test Area", projectNumber: "", masterProject: "" },
    ]);
    expect(artifact.cells.map((c) => [c.b, c.bed, c.nRaw12, c.nOld1, c.nOld2])).toEqual([
      [0, 2, 2, 1, 0],
      [1, 0, 0, 0, 1],
    ]);
    // A sale spelled in other capitals is the same building for the loader, and so here.
    const more = similarArtifactOf([...SALES, sale('test "quoted", tower', "2026-09-09", 1_100_000, 1000)], FACTS);
    expect(more.cells[0].nRaw12).toBe(3);
  });

  it("round-trips every digit, quotes and commas included, and rebuilds the same artifact", async () => {
    const written = await writeSimilarCellsFile(root, similarCellRows(artifact));
    expect(written.rows).toBe(2);
    expect(written.sha256).toBe(createHash("sha256").update(readFileSync(written.file)).digest("hex"));
    const rows = await readSimilarCells(written.file, { sha256: written.sha256, rows: 2 });
    expect(rows).toEqual([...similarCellRows(artifact)]);
    expect(rows[0].med12).toBe((1_234_567 / 1076.39 + 1_000_001 / 913.77) / 2);
    expect(rows[0].medOld1).toBe(987_654 / 850.31);
    expect(artifactFromCellRows(rows, artifact.dataThrough, artifact.windowStart)).toEqual(artifact);
    // The same rows give the same bytes.
    const again = await writeSimilarCellsFile(path.join(root, "again"), similarCellRows(artifact));
    expect(again.sha256).toBe(written.sha256);
  });

  it("refuses a record with a wrong value", () => {
    const ok = ["TEST TOWER A", "Test Area", "2977", "TEST MASTER", "2", "ready", "3", "3", "1500.5", "0", "", "2", "1400"];
    expect(ok).toHaveLength(SIMILAR_CELL_COLUMNS.length);
    expect(parseSimilarCellRecord(ok, 2)).toEqual({
      building: "TEST TOWER A",
      areaDld: "Test Area",
      projectNumber: "2977",
      masterProject: "TEST MASTER",
      bedrooms: 2,
      completion: "ready",
      nRaw12: 3,
      n12: 3,
      med12: 1500.5,
      nOld1: 0,
      medOld1: null,
      nOld2: 2,
      medOld2: 1400,
    });
    const bad = (at: number, v: string) => () => parseSimilarCellRecord(ok.map((x, i) => (i === at ? v : x)), 7);
    expect(bad(0, "")).toThrow(SnapshotError);
    expect(bad(1, "")).toThrow(/line 7/);
    expect(bad(2, "29.5")).toThrow(/invalid value/);
    expect(bad(4, "8")).toThrow(/invalid value/);
    expect(bad(5, "sold")).toThrow(/invalid value/);
    expect(bad(6, "-1")).toThrow(/invalid value/);
    expect(bad(7, "4")).toThrow(/invalid value/); // more used than there are
    expect(bad(8, "")).toThrow(/invalid value/); // sales without a median
    expect(bad(8, "0")).toThrow(/invalid value/);
    expect(bad(8, "abc")).toThrow(/invalid value/);
    expect(bad(10, "1500")).toThrow(/invalid value/); // a median without sales
    expect(() => parseSimilarCellRecord(ok.slice(1), 3)).toThrow(/expected 13 fields/);
    // A cell with no sale in any window is not a cell.
    expect(() => parseSimilarCellRecord(["A", "B", "", "", "1", "ready", "0", "0", "", "0", "", "0", ""], 4)).toThrow(/invalid value/);
  });
});

describe("the manifest's similar section and the shipped model", () => {
  const section = {
    version: 1 as const,
    builtOn: "2026-11-17",
    windowStart: "2025-11-16",
    cellsFile: { sha256: "d".repeat(64), rows: 13_575 },
    buildings: 4_348,
    constants: SIMILAR_CONSTANTS,
    backtest: SIMILAR_BACKTEST,
  };
  const manifest = (similar?: unknown): Manifest =>
    ManifestSchema.parse({
      version: 1,
      source: "data.dubai",
      publisher: "Dubai Land Department",
      datasetTitle: "TEST Transactions",
      datasetUrl: "https://data.dubai/en/test-dataset",
      licence: "Dubai Open Data Licence",
      licenceUrl: "https://data.dubai/en/terms-conditions",
      downloadedOn: "2026-11-17",
      sourceFiles: [],
      dataFrom: "2023-11-17",
      dataThrough: "2026-11-16",
      counts: { read: 1, kept: 1, excluded: {} },
      buildings: 1,
      snapshotSha256: "b".repeat(64),
      ...(similar === undefined ? {} : { similar }),
    });

  it("is optional (older snapshots have none), validated when present, and kept out of app_meta.data_source", () => {
    expect(manifest().similar).toBeUndefined();
    expect(manifest(section).similar).toEqual(section);
    expect(dataSourceMeta(manifest(section))).not.toHaveProperty("similar");
    expect(() => manifest({ ...section, version: 2 })).toThrow();
    expect(() => manifest({ ...section, cellsFile: { sha256: "xyz", rows: 1 } })).toThrow();
    expect(() => manifest({ ...section, builtOn: "17-11-2026" })).toThrow();
    expect(() => manifest({ ...section, constants: { ...SIMILAR_CONSTANTS, maxHalfWidth: 0 } })).toThrow();
    expect(() => manifest({ ...section, constants: { ...SIMILAR_CONSTANTS, range80: { ...SIMILAR_CONSTANTS.range80, own: [0.03, 1.5] } } })).toThrow();
    expect(() => manifest({ ...section, backtest: { ...SIMILAR_BACKTEST, statement: { heldOf10: 11, heldLaterOf10: 7 } } })).toThrow();
    expect(SimilarManifestSchema.parse(JSON.parse(JSON.stringify(section)))).toEqual(section);
  });

  it("the shipped constants are the verified ones: the rule's numbers and the wider ranges for thin buildings", () => {
    const c = SIMILAR_CONSTANTS;
    expect(c).toMatchObject({
      version: 4,
      minComparableSales: 3,
      levelMinBuildings: { project: 1, community: 2, area: 3 },
      maxBedrooms: 3,
      countBuckets: [1, 2, 3, 5, 10, 20],
      spreadDivisor: 2.563,
      otherBedroomsWeightK: 3,
      maxHalfWidth: 0.2,
      closeHalfWidth: 0.1,
      // Version 2 (review of 19 Nov 2026): nothing from other buildings alone, and the three consistency rules.
      // Version 4 (19 Nov 2026): the project route for buildings that are not in the data (REAL_DATA.md section 15.8)
      // is its own path; the project class stays never shown for a building that is in the data.
      neverShownClasses: ["project", "community", "area"],
      requireEvidenceBeyondOwnSales: true,
      maxOwnMedianRatio: 1.25,
      ownMedianInsideRange: true,
      displayRounding: 10,
      thinCellFactor: 1.2,
    });
    expect(c.version).toBeGreaterThanOrEqual(SIMILAR_MIN_CONSTANTS_VERSION);
    expect(c.fittedOn).toMatchObject({ dataThrough: "2026-11-16", snapshotSha256: "8f62f3cdc81a541c966b8169417ae400850dd89b03bc17eb43a15dca247a1421" });
    // range80 already includes the factor (refit of 19 Nov 2026 on the snapshot with rule 10a at 0.85x to 1.18x).
    expect(c.range80.own[0]).toBe(0.03);
    expect(c.range80.own[1]).toBeCloseTo(1.2500158759755036 * 1.2, 12);
    expect(c.range80.own[2]).toBeCloseTo(1.668457973851225 * 1.2, 12);
    expect(c.range80.indirect[1]).toBeCloseTo(1.3176237808886644 * 1.2, 12);
    expect(c.range80.indirect[2]).toBeCloseTo(1.8532305012883707 * 1.2, 12);
    expect(c.range80.project).toEqual([0, 4.2, 4.2]);
    // Every upper multiplier is at least the lower one.
    for (const [floor, lo, hi] of Object.values(c.range80)) {
      expect(hi).toBeGreaterThanOrEqual(lo);
      expect(floor).toBeGreaterThanOrEqual(0);
    }
    expect(SimilarConstantsSchema.parse(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(SIMILAR_BACKTEST.fittedOn).toEqual({ dataThrough: c.fittedOn.dataThrough, snapshotSha256: c.fittedOn.snapshotSha256 });
    expect(SIMILAR_BACKTEST.statement).toMatchObject({ heldOf10: 8, heldLaterOf10: 7 });
    // The summary is of these constants, and its two whole numbers are the lower measured share, rounded down.
    const b = SIMILAR_BACKTEST as unknown as {
      constantsVersion: number;
      leaveBuildingOut: Record<"own" | "indirect", { coveragePct: number }>;
      next183Days: { all: Array<{ coveragePct: number }> };
    };
    expect(b.constantsVersion).toBe(c.version);
    expect(Math.floor(Math.min(b.leaveBuildingOut.own.coveragePct, b.leaveBuildingOut.indirect.coveragePct) / 10)).toBe(SIMILAR_BACKTEST.statement.heldOf10);
    expect(Math.floor(Math.min(...b.next183Days.all.map((x) => x.coveragePct)) / 10)).toBe(SIMILAR_BACKTEST.statement.heldLaterOf10);
  });

  it("data:build warns when the data runs more than 200 days past the fit", () => {
    const report = (dataThrough: string) => ({
      excluded: { date_out_of_range: 0 } as never,
      manifest: { ...manifest(section), dataThrough, downloadedOn: dataThrough },
    });
    expect(SIMILAR_MAX_FIT_AGE_DAYS).toBe(200);
    expect(reportWarnings(report("2026-11-16"))).toEqual([]);
    expect(reportWarnings(report("2027-06-04"))).toEqual([]); // 200 days
    const [w] = reportWarnings(report("2027-06-05"));
    expect(w).toMatch(/fitted on data to 2026-11-16, 201 days before this data ends\. The site will not show the similar-buildings comparison/);
    // data:build exits with an error on the same condition (scripts/data-build.ts).
    expect(similarFitTooOld(report("2027-06-04").manifest)).toBe(false);
    expect(similarFitTooOld(report("2027-06-05").manifest)).toBe(true);
  });

  it("--built sets the build date; without it the option is absent", () => {
    const base = ["--in", "a.csv", "--dataset-url", "https://data.dubai/x", "--downloaded", "2026-11-17"];
    expect(parseArgs(base, "/tmp")).not.toHaveProperty("builtOn");
    expect(parseArgs([...base, "--built", "2026-11-19"], "/tmp").builtOn).toBe("2026-11-19");
    expect(parseArgs([...base, "--built=2026-11-20"], "/tmp").builtOn).toBe("2026-11-20");
  });

  it("buildSimilarArtifact is what similarArtifactOf wraps", () => {
    const s = [sale("TEST TOWER A", "2026-11-10", 1_500_000, 1000)];
    const f = [facts("TEST TOWER A", 12, "M")];
    const direct = buildSimilarArtifact(s, [{ building: "TEST TOWER A", areaDld: "Test Area", projectNumber: "12", masterProject: "M" }]);
    expect(similarArtifactOf(s, f)).toEqual(direct);
  });
});
