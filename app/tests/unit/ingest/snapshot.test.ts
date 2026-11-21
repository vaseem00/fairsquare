import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import {
  BUILDING_COLUMNS,
  BUILDINGS_FILE,
  dataSourceMeta,
  LEGACY_SNAPSHOT_COLUMNS,
  ManifestSchema,
  parseBuildingRecord,
  parseSnapshotRecord,
  readBuildingFacts,
  readManifest,
  readSnapshotRows,
  SNAPSHOT_COLUMNS,
  SNAPSHOT_FILE,
  sha256File,
  SnapshotError,
  writeBuildingsFile,
  writeManifest,
  writeSnapshotFile,
  type Manifest,
} from "@/lib/ingest/snapshot";
import type { BuildingFacts, NormalisedSale } from "@/lib/ingest/types";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "fairsquare-snap-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SALES: NormalisedSale[] = [
  {
    ref: "dld:1-11-2026-1",
    date: "2026-06-01",
    building: "TEST TOWER A",
    areaDld: "Marsa Dubai",
    project: "TEST PROJECT, PHASE \"1\"",
    masterProject: null,
    bedrooms: 0,
    sizeSqft: 409.03,
    priceAed: 650_000,
    completion: "off_plan",
    projectNumber: 2977,
    parking: true,
  },
  {
    ref: "dld:1-11-2026-2",
    date: "2026-06-02",
    building: " TEST TOWER B",
    areaDld: "Al Barsha South Fourth",
    project: null,
    masterProject: "TEST MASTER",
    bedrooms: 7,
    sizeSqft: 3229.17,
    priceAed: 6_000_000,
    completion: "ready",
    projectNumber: null,
    parking: null,
  },
];

const FACTS: BuildingFacts[] = [
  {
    building: "TEST TOWER A",
    areaDld: "Marsa Dubai",
    projectNumber: 2977,
    project: "TEST PROJECT, PHASE \"1\"",
    masterProject: null,
    nearestMetro: "Test Metro Station",
    nearestMall: "Test Mall",
    nearestLandmark: null,
    firstSale: "2019-01-10",
    firstReadySale: null,
    lastSale: "2026-06-01",
    sales: 3,
    offPlanSales: 3,
    parkingSales: 2,
  },
  {
    building: "TEST TOWER B",
    areaDld: "Al Barsha South Fourth",
    projectNumber: null,
    project: null,
    masterProject: "TEST MASTER",
    nearestMetro: null,
    nearestMall: null,
    nearestLandmark: "Test Landmark",
    firstSale: "2020-02-02",
    firstReadySale: "2021-03-03",
    lastSale: "2026-06-02",
    sales: 1,
    offPlanSales: 0,
    parkingSales: 0,
  },
];

async function readAll(file: string): Promise<{ rows: NormalisedSale[]; sha: string }> {
  const rows: NormalisedSale[] = [];
  let sha = "";
  for await (const r of readSnapshotRows(file, (h) => (sha = h))) rows.push(r);
  return { rows, sha };
}

function manifest(over: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    source: "data.dubai",
    publisher: "Dubai Land Department",
    datasetTitle: "TEST Transactions",
    datasetUrl: "https://data.dubai/en/test-dataset",
    licence: "Dubai Open Data Licence",
    licenceUrl: "https://data.dubai/en/terms-conditions",
    downloadedOn: "2026-11-18",
    sourceFiles: [{ name: "test.csv", sha256: "a".repeat(64), rows: 3 }],
    dataFrom: "2026-06-01",
    dataThrough: "2026-06-02",
    counts: { read: 3, kept: 2, excluded: { not_sales: 1 } },
    buildings: 2,
    snapshotSha256: "b".repeat(64),
    ...over,
  };
}

describe("snapshot file (REAL_DATA.md section 3)", () => {
  it("round-trips every field, quoting commas, quotes and edge spaces, and reports its sha256", async () => {
    const dir = tmp();
    const out = await writeSnapshotFile(dir, SALES);
    expect(out).toMatchObject({ file: path.join(dir, SNAPSHOT_FILE), rows: 2 });
    expect(out.sha256).toBe(createHash("sha256").update(readFileSync(out.file)).digest("hex"));
    expect(await sha256File(out.file)).toBe(out.sha256);
    const back = await readAll(out.file);
    expect(back.rows).toEqual(SALES);
    expect(back.sha).toBe(out.sha256);
  });

  it("writes the exact header and is deterministic", async () => {
    const a = await writeSnapshotFile(tmp(), SALES);
    const b = await writeSnapshotFile(tmp(), SALES);
    expect(a.sha256).toBe(b.sha256);
    const text = (await import("node:zlib")).gunzipSync(readFileSync(a.file)).toString("utf8");
    expect(text.split("\n")[0]).toBe("ref,date,building,area_dld,project,master_project,bedrooms,size_sqft,price_aed,completion,project_number,parking");
    expect(text).toContain('"TEST PROJECT, PHASE ""1"""');
    expect(text).toContain('," TEST TOWER B",');
    expect(text).toContain(",650000,off_plan,2977,1\n");
    expect(text).toContain(",6000000,ready,,\n");
    expect(SNAPSHOT_COLUMNS).toHaveLength(12);
  });

  it("still reads a snapshot written before project_number and parking existed (10 columns)", async () => {
    const dir = tmp();
    const f = path.join(dir, "old.gz");
    writeFileSync(f, gzipSync(Buffer.from(`${LEGACY_SNAPSHOT_COLUMNS.join(",")}\ndld:1,2026-02-01,B,A,P,,2,1000,1500000,ready\n`, "utf8")));
    expect((await readAll(f)).rows).toEqual([
      { ref: "dld:1", date: "2026-02-01", building: "B", areaDld: "A", project: "P", masterProject: null, bedrooms: 2, sizeSqft: 1000, priceAed: 1_500_000, completion: "ready", projectNumber: null, parking: null },
    ]);
    // A 12-field row under the old header (or the reverse) is refused.
    writeFileSync(f, gzipSync(Buffer.from(`${LEGACY_SNAPSHOT_COLUMNS.join(",")}\ndld:1,2026-02-01,B,A,P,,2,1000,1500000,ready,7,1\n`, "utf8")));
    await expect(readAll(f)).rejects.toThrow(/expected 10 fields/);
  });

  it("refuses a wrong project number or parking flag", () => {
    const ok = ["dld:1", "2026-02-01", "B", "A", "", "", "2", "1000", "1500000", "ready", "12", "0"];
    expect(parseSnapshotRecord(ok, 2)).toMatchObject({ projectNumber: 12, parking: false });
    expect(() => parseSnapshotRecord([...ok.slice(0, 10), "12.5", "0"], 2)).toThrow(SnapshotError);
    expect(() => parseSnapshotRecord([...ok.slice(0, 10), "0", "0"], 2)).toThrow(SnapshotError);
    expect(() => parseSnapshotRecord([...ok.slice(0, 10), "12", "yes"], 2)).toThrow(SnapshotError);
  });

  it("refuses a wrong header, a bad value and an empty file", async () => {
    const dir = tmp();
    const write = (name: string, text: string) => {
      const f = path.join(dir, name);
      writeFileSync(f, gzipSync(Buffer.from(text, "utf8")));
      return f;
    };
    await expect(readAll(write("h.gz", "ref,date\nx,2026-01-01\n"))).rejects.toThrow(SnapshotError);
    const header = SNAPSHOT_COLUMNS.join(",");
    await expect(readAll(write("v.gz", `${header}\ndld:1,2026-02-30,B,A,,,2,1000,1500000,ready,,\n`))).rejects.toThrow(/line 2: invalid value/);
    await expect(readAll(write("c.gz", `${header}\ndld:1,2026-02-01,B,A,,,2,1000,1500000,unknown,,\n`))).rejects.toThrow(/invalid value/);
    await expect(readAll(write("n.gz", `${header}\ndld:1,2026-02-01,B,A,,,2\n`))).rejects.toThrow(/expected 12 fields/);
    await expect(readAll(write("e.gz", ""))).rejects.toThrow(/empty/);
    expect(() => parseSnapshotRecord(["dld:1", "2026-02-01", "B", "A", "", "", "8", "1000", "1500000", "ready", "", ""], 2)).toThrow(SnapshotError);
    expect(() => parseSnapshotRecord(["dld:1", "2026-02-01", "B", "A", "", "", "2", "1000", "1500000.5", "ready", "", ""], 2)).toThrow(SnapshotError);
    expect(() => parseSnapshotRecord(["", "2026-02-01", "B", "A", "", "", "2", "1000", "1500000", "ready", "", ""], 2)).toThrow(SnapshotError);
  });
});

describe("buildings file (buildings.csv.gz)", () => {
  it("round-trips every field and is checked against the manifest's sha and row count", async () => {
    const dir = tmp();
    const out = await writeBuildingsFile(dir, FACTS);
    expect(out).toMatchObject({ file: path.join(dir, BUILDINGS_FILE), rows: 2 });
    expect(await readBuildingFacts(out.file, { sha256: out.sha256, rows: 2 })).toEqual(FACTS);
    const text = (await import("node:zlib")).gunzipSync(readFileSync(out.file)).toString("utf8");
    expect(text.split("\n")[0]).toBe(BUILDING_COLUMNS.join(","));
    expect(text.split("\n")[0]).toBe(
      "building,area_dld,project_number,project,master_project,nearest_metro,nearest_mall,nearest_landmark,first_sale,first_ready_sale,last_sale,sales,off_plan_sales,parking_sales",
    );
    await expect(readBuildingFacts(out.file, { sha256: "0".repeat(64), rows: 2 })).rejects.toThrow(/does not match manifest.buildingsFile.sha256/);
    await expect(readBuildingFacts(out.file, { sha256: out.sha256, rows: 3 })).rejects.toThrow(/has 2 rows; the manifest says 3/);
    await expect(readBuildingFacts(path.join(dir, "nope.gz"), { sha256: out.sha256, rows: 2 })).rejects.toThrow(/missing/);
  });

  it("refuses a wrong header or value", async () => {
    const dir = tmp();
    const f = path.join(dir, "b.gz");
    const gz = gzipSync(Buffer.from("building,area_dld\nB,A\n", "utf8"));
    writeFileSync(f, gz);
    await expect(readBuildingFacts(f, { sha256: createHash("sha256").update(gz).digest("hex"), rows: 1 })).rejects.toThrow(/buildings header does not match/);
    const ok = ["B", "A", "12", "P", "M", "", "", "", "2020-01-01", "", "2026-01-01", "5", "2", "5"];
    expect(parseBuildingRecord(ok, 2)).toMatchObject({ projectNumber: 12, firstReadySale: null, sales: 5, offPlanSales: 2, parkingSales: 5 });
    expect(() => parseBuildingRecord(ok.slice(0, 13), 2)).toThrow(/expected 14 fields/);
    expect(() => parseBuildingRecord(["", ...ok.slice(1)], 2)).toThrow(/line 2: invalid value/);
    expect(() => parseBuildingRecord([...ok.slice(0, 8), "2020-02-30", ...ok.slice(9)], 2)).toThrow(SnapshotError);
    expect(() => parseBuildingRecord([...ok.slice(0, 12), "6", "5"], 2)).toThrow(SnapshotError); // more off-plan than sales
  });
});

describe("manifest", () => {
  it("writes and reads back; data_source is the manifest without counts", async () => {
    const dir = tmp();
    await writeManifest(dir, manifest());
    const m = await readManifest(dir);
    expect(m).toEqual(manifest());
    expect(dataSourceMeta(manifest())).not.toHaveProperty("counts");
    expect(dataSourceMeta(manifest())).toMatchObject({ datasetUrl: "https://data.dubai/en/test-dataset", snapshotSha256: "b".repeat(64) });
    expect(readFileSync(path.join(dir, "manifest.json"), "utf8").endsWith("}\n")).toBe(true);
  });

  it("is null when missing and a SnapshotError when invalid", async () => {
    expect(await readManifest(tmp())).toBeNull();
    const dir = tmp();
    writeFileSync(path.join(dir, "manifest.json"), "{not json");
    await expect(readManifest(dir)).rejects.toThrow(/not valid JSON/);
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ ...manifest(), snapshotSha256: "xyz" }));
    await expect(readManifest(dir)).rejects.toThrow(/snapshotSha256/);
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ ...manifest(), datasetUrl: "http://data.dubai/x" }));
    await expect(readManifest(dir)).rejects.toThrow(/datasetUrl/);
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest({ counts: { read: 1, kept: 1, excluded: { made_up: 1 } } })));
    await expect(readManifest(dir)).rejects.toThrow(/unknown exclusion reason: made_up/);
    writeFileSync(path.join(dir, "manifest.json"), `﻿${JSON.stringify(manifest())}`);
    expect(await readManifest(dir)).toEqual(manifest());
    expect(() => ManifestSchema.parse({ ...manifest(), version: 2 })).toThrow();
    // The buildings file is optional (older snapshots have none) and checked when present.
    const withFile = manifest({ buildingsFile: { sha256: "c".repeat(64), rows: 2 } });
    expect(ManifestSchema.parse(withFile).buildingsFile).toEqual({ sha256: "c".repeat(64), rows: 2 });
    expect(() => ManifestSchema.parse({ ...manifest(), buildingsFile: { sha256: "xyz", rows: 2 } })).toThrow();
    await expect(writeManifest(dir, { ...manifest(), dataFrom: "2026-02-30" })).rejects.toThrow();
  });
});
