import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BuildError, buildSnapshot, checkDatasetUrl, formatReport, reportWarnings } from "@/lib/ingest/build";
import { SourceFormatError } from "@/lib/ingest/data-dubai";
import { readBuildingFacts, readManifest, readSnapshotRows, sha256File } from "@/lib/ingest/snapshot";
import type { NormalisedSale } from "@/lib/ingest/types";
import { DEFAULT_DATASET_TITLE, parseArgs } from "../../../scripts/data-build";
import { makeZip } from "../../helpers/zip-writer";

const FIXTURES = path.join(process.cwd(), "tests", "fixtures", "data-dubai");
const SAMPLE = path.join(FIXTURES, "transactions-sample.csv");
const WEBSITE = path.join(FIXTURES, "dubailand-website-export.csv");
const URL_OK = "https://data.dubai/en/test-dataset";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "fairsquare-build-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function rowsOf(dir: string): Promise<NormalisedSale[]> {
  const out: NormalisedSale[] = [];
  for await (const r of readSnapshotRows(path.join(dir, "sales.csv.gz"))) out.push(r);
  return out;
}

const build = (inputs: string[], outDir = tmp()) =>
  buildSnapshot({ inputs, datasetUrl: URL_OK, datasetTitle: "TEST Transactions", downloadedOn: "2026-11-18", outDir });

describe("buildSnapshot on the synthetic Data.Dubai file (every filter branch)", () => {
  it("counts every exclusion reason, keeps 12 sales and writes the snapshot and manifest", async () => {
    const out = tmp();
    const r = await build([SAMPLE], out);
    expect(r.read).toBe(43);
    expect(r.kept).toBe(12);
    expect(r.excluded).toEqual({
      not_sales: 2,
      procedure_excluded: 3,
      not_flat: 2,
      not_residential: 1,
      rooms_excluded: 5,
      no_building_name: 1,
      no_area: 0,
      no_size_or_price: 2,
      size_out_of_range: 2,
      psf_out_of_range: 2,
      bad_date: 3,
      date_out_of_range: 0,
      no_transaction_id: 1,
      repeated_in_other_file: 0,
      multi_unit_deal: 2,
      portfolio_deal: 3,
      size_unlike_building: 0,
      outside_window: 2,
    });
    expect(r.kept + Object.values(r.excluded).reduce((a, b) => a + b, 0)).toBe(r.read);
    expect(r.dataThrough).toBe("2026-10-15");
    expect(r.dataFrom).toBe("2023-10-16");
    expect(r.buildings).toBe(4);

    const m = await readManifest(out);
    expect(m).toMatchObject({
      version: 1,
      source: "data.dubai",
      publisher: "Dubai Land Department",
      datasetTitle: "TEST Transactions",
      datasetUrl: URL_OK,
      licence: "Dubai Open Data Licence",
      licenceUrl: "https://data.dubai/en/terms-conditions",
      downloadedOn: "2026-11-18",
      dataFrom: "2023-10-16",
      dataThrough: "2026-10-15",
      counts: { read: 43, kept: 12, excluded: r.excluded },
      buildings: 4,
    });
    expect(m?.sourceFiles).toEqual([{ name: "transactions-sample.csv", sha256: await sha256File(SAMPLE), rows: 43 }]);
    expect(m?.snapshotSha256).toBe(await sha256File(path.join(out, "sales.csv.gz")));
    // buildings.csv.gz: one row per building, checked by the manifest.
    expect(m?.buildingsFile).toEqual({ sha256: await sha256File(path.join(out, "buildings.csv.gz")), rows: 4 });
    const facts = await readBuildingFacts(path.join(out, "buildings.csv.gz"), m!.buildingsFile!);
    expect(facts.map((f) => [f.building, f.areaDld, f.sales])).toEqual([
      ["TEST TOWER A", "Al Barsha South Fourth", 1],
      ["TEST TOWER A", "Marsa Dubai", 9],
      ["TEST TOWER B", "Al Barsha South Fourth", 1],
      ["THE RESIDENCES AT TEST GATE 1", "Marsa Dubai", 1],
    ]);
    // TEST TOWER A (Marsa Dubai): the 2019 sale is outside the window but dates the building.
    expect(facts[1]).toMatchObject({ project: "TEST PROJECT A", masterProject: "TEST MASTER ONE", firstSale: "2019-01-10", firstReadySale: "2019-01-10", lastSale: "2026-10-15", offPlanSales: 2, parkingSales: 9 });
    expect(formatReport(r)).toContain(`Buildings file sha256: ${m?.buildingsFile?.sha256}`);

    const rows = await rowsOf(out);
    expect(rows).toHaveLength(12);
    expect(rows.map((s) => s.ref)).toEqual([...rows.map((s) => s.ref)].sort());
    expect(rows.every((s) => s.ref.startsWith("dld:1-11-2026-"))).toBe(true);
    const byRef = new Map(rows.map((s) => [s.ref, s]));
    expect(byRef.get("dld:1-11-2026-101")).toEqual({
      ref: "dld:1-11-2026-101",
      date: "2026-10-15",
      building: "TEST TOWER A",
      areaDld: "Marsa Dubai",
      project: "TEST PROJECT A",
      masterProject: "TEST MASTER ONE",
      bedrooms: 2,
      sizeSqft: 1189.41,
      priceAed: 2_200_000,
      completion: "ready",
      projectNumber: null,
      parking: true,
    });
    expect(byRef.get("dld:1-11-2026-102")).toMatchObject({ date: "2026-09-15", bedrooms: 1, completion: "off_plan" });
    expect(byRef.get("dld:1-11-2026-103")).toMatchObject({ date: "2026-08-05", bedrooms: 0, completion: "off_plan" });
    expect(byRef.get("dld:1-11-2026-104")).toMatchObject({ date: "2026-07-20", bedrooms: 3, building: "TEST TOWER B", areaDld: "Al Barsha South Fourth" });
    expect(byRef.get("dld:1-11-2026-105")).toMatchObject({ date: "2026-01-31", bedrooms: 4 });
    expect(byRef.get("dld:1-11-2026-106")).toMatchObject({ bedrooms: 7 });
    expect(byRef.get("dld:1-11-2026-109")).toMatchObject({ completion: "ready" });
    expect(byRef.get("dld:1-11-2026-112")).toMatchObject({ date: "2023-10-16" });

    const report = formatReport(r);
    expect(report).toContain("Rows read: 43");
    expect(report).toContain("Kept:      12");
    expect(report).toMatch(/portfolio_deal\s+3/);
    expect(report).toContain("Dates: 2023-10-16 to 2026-10-15");
    expect(report).toContain("Buildings: 4");
    expect(report).toContain("Top procedure_name_en (all rows read):");
    expect(report).toMatch(/\d+\s+Sell\n/);
  });

  it("reads the same data from a .zip (Node built-ins) and writes the identical snapshot", async () => {
    const zipDir = tmp();
    const zip = path.join(zipDir, "Transactions.zip");
    writeFileSync(zip, makeZip([{ name: "Transactions.csv", data: readFileSync(SAMPLE) }]));
    const a = await build([SAMPLE]);
    const b = await build([zip]);
    expect(b.manifest.snapshotSha256).toBe(a.manifest.snapshotSha256);
    expect(b.files[0]).toMatchObject({ name: "Transactions.zip", csvEntry: "Transactions.csv", rows: 43 });
    expect(formatReport(b)).toContain("Transactions.zip (Transactions.csv)");
  });

  it("a second, overlapping file never doubles a sale", async () => {
    const r = await build([SAMPLE, SAMPLE]);
    expect(r.read).toBe(86);
    expect(r.kept).toBe(12);
    // The 12 kept rows and the 2 rows of the multi-unit deal repeat in the second file; the portfolio
    // and window rows too (they pass the per-row rules), so they are counted as repeats there.
    expect(r.excluded.repeated_in_other_file).toBe(12 + 2 + 3 + 2);
    expect(r.excluded.multi_unit_deal).toBe(2);
    expect(r.manifest.sourceFiles).toHaveLength(2);
  });

  it("refuses the dubailand.gov.ae website export and writes nothing", async () => {
    const out = tmp();
    const err = await build([WEBSITE], out).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceFormatError);
    expect(err).toMatchObject({
      code: "dubailand_export",
      message:
        "This is the dubailand.gov.ae website export. Its terms allow personal, non-commercial use only and it has no building names. Download the Transactions dataset from data.dubai instead.",
    });
    expect(await readManifest(out)).toBeNull();
  });

  it("checks its options and refuses files with nothing to keep", async () => {
    await expect(buildSnapshot({ inputs: [], datasetUrl: URL_OK, datasetTitle: "t", downloadedOn: "2026-11-18", outDir: tmp() })).rejects.toThrow(BuildError);
    await expect(buildSnapshot({ inputs: [SAMPLE], datasetUrl: URL_OK, datasetTitle: "t", downloadedOn: "18-11-2026", outDir: tmp() })).rejects.toThrow(/--downloaded/);
    expect(() => checkDatasetUrl("not a url")).toThrow(/not a URL/);
    expect(() => checkDatasetUrl("http://data.dubai/x")).toThrow(/https/);
    expect(() => checkDatasetUrl("https://dubailand.gov.ae/en/open-data/real-estate-data")).toThrow(/dubailand.gov.ae website export/);
    expect(() => checkDatasetUrl("https://www.dubailand.gov.ae/x")).toThrow(/dubailand.gov.ae website export/);
    expect(checkDatasetUrl(URL_OK)).toBe(URL_OK);

    const d = tmp();
    const empty = path.join(d, "empty.csv");
    writeFileSync(empty, "");
    await expect(build([empty])).rejects.toMatchObject({ code: "empty_file" });
    const headerOnly = path.join(d, "header.csv");
    writeFileSync(headerOnly, `${readFileSync(SAMPLE, "utf8").split("\r\n")[0]}\r\n`);
    await expect(build([headerOnly])).rejects.toThrow(/No sale passed the rules/);
  });
});

describe("the builder keeps only rows the loader accepts", () => {
  /** A file with the sample's header and the given rows (a kept row with fields changed). */
  function fileWith(rows: Array<Record<string, string>>): string {
    const [header, first] = readFileSync(SAMPLE, "utf8").split("\r\n");
    const cols = header.replace(/^﻿/, "").split(",");
    const base = first.split(",");
    const lines = rows.map((over) => cols.map((c, i) => over[c] ?? base[i]).join(","));
    const file = path.join(tmp(), "rows.csv");
    writeFileSync(file, [header, ...lines].join("\r\n"));
    return file;
  }

  it("leaves out a sale with no DLD area (counted), so the snapshot reads back in full", async () => {
    const out = tmp();
    const r = await build(
      [
        fileWith([
          { transaction_id: "1-11-2026-901", area_name_en: "" },
          { transaction_id: "1-11-2026-902", area_name_en: "   " },
          { transaction_id: "1-11-2026-903", building_name_en: "TEST TOWER C" },
        ]),
      ],
      out,
    );
    expect(r.excluded.no_area).toBe(2);
    expect(r.kept).toBe(1);
    // Before the fix the empty area reached the file and the server refused the whole snapshot.
    const rows = await rowsOf(out);
    expect(rows.map((s) => [s.ref, s.areaDld])).toEqual([["dld:1-11-2026-903", "Marsa Dubai"]]);
    expect(formatReport(r)).toMatch(/no_area\s+2/);
  });

  it("leaves out a sale dated after the download, so one bad date never moves the 36-month window", async () => {
    const out = tmp();
    const r = await build(
      [
        fileWith([
          { transaction_id: "1-11-2026-911", instance_date: "2026-10-15" },
          { transaction_id: "1-11-2026-912", instance_date: "2026-11-18" },
          // A mis-keyed year, and a pre-2000 two-digit year that reads as 2098.
          { transaction_id: "1-11-2026-913", instance_date: "15-01-2206" },
          { transaction_id: "1-11-2026-914", instance_date: "01-01-98" },
        ]),
      ],
      out,
    );
    expect(r.excluded.date_out_of_range).toBe(2);
    expect(r.kept).toBe(2);
    expect(r.excluded.outside_window).toBe(0);
    expect(r.dataThrough).toBe("2026-11-18");
    expect((await rowsOf(out)).map((s) => s.ref)).toEqual(["dld:1-11-2026-911", "dld:1-11-2026-912"]);
    expect(formatReport(r)).toContain("WARNING: 2 rows are dated after the download date 2026-11-18 and were left out.");
  });

  it("warns when the newest sale is long before the download date", async () => {
    const r = await build([fileWith([{ transaction_id: "1-11-2026-921", instance_date: "2026-08-01" }])]);
    // These one-sale files are also far short of the 48 months the time index needs; that warning is tested in tests/db/acs.test.ts.
    const lag = (w: string[]) => w.filter((s) => !/time index/.test(s));
    expect(lag(reportWarnings(r))).toEqual([
      "The newest sale is 109 days before the download date, so the site will show the stale-data note at once. Is this the latest file?",
    ]);
    expect(reportWarnings(r).filter((s) => /time index/.test(s))).toEqual([
      "The download's first usable sale is dated 2026-08-01; adjusted registered sales needs sales from 2022-08-02 (48 months) for its time index. Download the full history before committing this snapshot.",
    ]);
    expect(lag(reportWarnings(await build([fileWith([{ transaction_id: "1-11-2026-922", instance_date: "2026-11-01" }])])))).toEqual([]);
  });
});

describe("npm run data:build arguments", () => {
  it("parses repeated --in, --name=value and defaults", () => {
    const a = parseArgs(["--in", "../raw-data/a.csv", "--in=b.zip", "--dataset-url", URL_OK, "--downloaded=2026-11-18"], "/work/app");
    expect(a.inputs).toEqual([path.resolve("/work/app", "../raw-data/a.csv"), path.resolve("/work/app", "b.zip")]);
    expect(a).toMatchObject({
      datasetUrl: URL_OK,
      downloadedOn: "2026-11-18",
      datasetTitle: DEFAULT_DATASET_TITLE,
      outDir: path.resolve("/work/app", "data", "open-data"),
    });
    const b = parseArgs(["--in", "a.csv", "--dataset-url", URL_OK, "--downloaded", "2026-11-18", "--dataset-title", "TEST", "--out", "x"], "/w");
    expect(b).toMatchObject({ datasetTitle: "TEST", outDir: path.resolve("/w", "x") });
  });

  it("explains what is missing", () => {
    expect(() => parseArgs([])).toThrow(/--in is missing/);
    expect(() => parseArgs(["--in", "a.csv", "--downloaded", "2026-11-18"])).toThrow(/--dataset-url is missing/);
    expect(() => parseArgs(["--in", "a.csv", "--dataset-url", URL_OK])).toThrow(/--downloaded is missing/);
    expect(() => parseArgs(["--in"])).toThrow(/--in needs a value/);
    expect(() => parseArgs(["--in", "--out"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--colour", "x"])).toThrow(/Unknown option --colour/);
    expect(() => parseArgs(["a.csv"])).toThrow(/Unexpected argument/);
  });
});
