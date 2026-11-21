/**
 * npx tsx --conditions=react-server scripts/model/nearby/golden-fixture.ts [open-data folder] [fixture folder]
 *
 * Cuts the fixtures of the nearby golden test (tests/unit/domain/nearby-golden.test.ts) from the
 * committed snapshot, so the test does not load the whole snapshot:
 * - golden.json: a copy of scripts/model/nearby/golden.json (the 42 cases of the Python reference);
 * - index.json.gz: what the method reads from acs-model.json.gz (T, areas, theta, tau, seg);
 * - rows.json.gz: the buildings and the registered sales the golden cases read (same bedroom count
 *   and basis, the 730 days to the data date, the case's DLD area or community).
 * Run it after `make.py` wrote new golden cases (scripts/model/README.md). The snapshot must be the
 * one the golden cases were made from (golden.json `dataThrough`).
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { acsDay } from "@/lib/domain/acs";
import { readBuildingFacts, readManifest, readSnapshotRows } from "@/lib/ingest/snapshot";

interface GoldenInput {
  bedrooms: number;
  basis: 0 | 1;
  master?: string;
  area?: string;
  building?: [string, string];
}

async function main() {
  const dataDir = path.resolve(process.argv[2] ?? path.join("data", "open-data"));
  const dir = path.resolve(process.argv[3] ?? path.join("tests", "fixtures", "nearby"));
  const here = path.join("scripts", "model", "nearby");
  mkdirSync(dir, { recursive: true });
  const golden = JSON.parse(readFileSync(path.join(here, "golden.json"), "utf8")) as { dataThrough: string; cases: { input: GoldenInput }[] };
  const manifest = await readManifest(dataDir);
  if (!manifest || !manifest.buildingsFile) throw new Error(`no manifest with a buildings file in ${dataDir}`);
  if (manifest.dataThrough !== golden.dataThrough) throw new Error(`the snapshot ends ${manifest.dataThrough}; the golden cases were made on ${golden.dataThrough}`);
  const model = JSON.parse(gunzipSync(readFileSync(path.join(dataDir, "acs-model.json.gz"))).toString("utf8")) as {
    dataThrough: string;
    epoch: string;
    T: number;
    areas: string[];
    theta: Record<string, number[]>;
    tau: number[][];
    seg: number[][];
  };
  const index = { dataThrough: model.dataThrough, epoch: model.epoch, T: model.T, areas: model.areas, theta: model.theta, tau: model.tau, seg: model.seg };

  const facts = await readBuildingFacts(path.join(dataDir, "buildings.csv.gz"), manifest.buildingsFile);
  const pair = (name: string, area: string) => `${name}\u0000${area}`;
  const at = new Map(facts.map((f, i) => [pair(f.building, f.areaDld), i]));

  // What each case reads: its bedroom count and basis, in its DLD area or its community.
  const areas = new Set<string>();
  const masters = new Set<string>();
  for (const { input: c } of golden.cases) {
    let master = c.master ?? "";
    let area = c.area ?? "";
    if (c.building) {
      const b = at.get(pair(c.building[0], c.building[1]));
      if (b === undefined) throw new Error(`a golden building is not in the snapshot: ${c.building.join(", ")}`);
      master = master || (facts[b].masterProject ?? "");
      area = area || facts[b].areaDld;
    }
    if (area) areas.add(`${c.bedrooms}|${c.basis}|${area}`);
    if (master) masters.add(`${c.bedrooms}|${c.basis}|${master}`);
  }

  const first = model.T - 730;
  const used = new Set<number>();
  const lines: string[] = [];
  for await (const s of readSnapshotRows(path.join(dataDir, "sales.csv.gz"))) {
    const day = acsDay(model.epoch, s.date);
    if (!(day > first && day <= model.T)) continue;
    const b = at.get(pair(s.building, s.areaDld));
    if (b === undefined) throw new Error(`no building facts for ${s.ref}`);
    const basis = s.completion === "off_plan" ? 1 : 0;
    const master = facts[b].masterProject ?? "";
    if (!areas.has(`${s.bedrooms}|${basis}|${facts[b].areaDld}`) && !(master && masters.has(`${s.bedrooms}|${basis}|${master}`))) continue;
    used.add(b);
    lines.push([s.ref, b, s.date, s.bedrooms, basis, s.sizeSqft, s.priceAed].join(","));
  }
  for (const { input: c } of golden.cases) if (c.building) used.add(at.get(pair(c.building[0], c.building[1])) as number);
  // Only the buildings that are read, renumbered.
  const order = [...used].sort((x, y) => x - y);
  const renumber = new Map(order.map((b, i) => [b, i]));
  const buildings = order.map((b) => [facts[b].building, facts[b].areaDld, facts[b].masterProject ?? "", facts[b].firstSale, facts[b].firstReadySale ?? ""]);
  const sales = lines.map((l) => {
    const p = l.split(",");
    p[1] = String(renumber.get(Number(p[1])));
    return p.join(",");
  });

  copyFileSync(path.join(here, "golden.json"), path.join(dir, "golden.json"));
  writeFileSync(path.join(dir, "index.json.gz"), gzipSync(Buffer.from(JSON.stringify(index), "utf8"), { level: 9 }));
  writeFileSync(path.join(dir, "rows.json.gz"), gzipSync(Buffer.from(JSON.stringify({ columns: "ref,building,date,bedrooms,basis,size_sqft,price_aed", buildings, sales }), "utf8"), { level: 9 }));
  process.stdout.write(`${sales.length} sales of ${buildings.length} buildings for ${golden.cases.length} cases written to ${dir}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
