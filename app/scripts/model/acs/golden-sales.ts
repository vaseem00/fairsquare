/**
 * npx tsx scripts/model/acs/golden-sales.ts [open-data folder] [fixture folder]
 *
 * Cuts tests/fixtures/acs/golden-sales.csv.gz from the snapshot: the registered sales the golden cases
 * read (each case's building and the other buildings of its project family), so the golden test does
 * not load the whole snapshot. Run it after the golden cases change (scripts/model/README.md). The
 * snapshot must be the one the golden cases were made from (constants.json `fittedOn`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { acsSiblingKeys, prepareAcs, type AcsModel, type AcsRequest } from "@/lib/domain/acs";
import { dldKey } from "@/lib/ingest/identity";
import { readSnapshotRows } from "@/lib/ingest/snapshot";

async function main() {
  const dataDir = path.resolve(process.argv[2] ?? path.join("data", "open-data"));
  const dir = path.resolve(process.argv[3] ?? path.join("tests", "fixtures", "acs"));
  const model = JSON.parse(gunzipSync(readFileSync(path.join(dir, "acs-model.json.gz"))).toString("utf8")) as AcsModel;
  const cases = JSON.parse(readFileSync(path.join(dir, "cases.json"), "utf8")) as AcsRequest[];
  const ix = prepareAcs(model);
  const need = new Set<string>();
  for (const c of cases) {
    for (const k of [c.buildingKey, ...acsSiblingKeys(ix, c.buildingKey)]) need.add(`${k}#${c.basis}`);
  }
  const keys = new Map<string, string>();
  const lines = ["ref,key,date,bedrooms,basis,size_sqft,price_aed"];
  for await (const s of readSnapshotRows(path.join(dataDir, "sales.csv.gz"))) {
    const pair = `${s.building}\u0000${s.areaDld}`;
    let key = keys.get(pair);
    if (key === undefined) {
      key = dldKey(s.building, s.areaDld);
      keys.set(pair, key);
    }
    const basis = s.completion === "off_plan" ? 1 : 0;
    if (!need.has(`${key}#${basis}`)) continue;
    if (/[",\n]/.test(key)) throw new Error(`a building key needs quoting: ${key}`);
    lines.push([s.ref, key, s.date, s.bedrooms, basis, s.sizeSqft, s.priceAed].join(","));
  }
  const out = path.join(dir, "golden-sales.csv.gz");
  writeFileSync(out, gzipSync(Buffer.from(`${lines.join("\n")}\n`, "utf8"), { level: 9 }));
  process.stdout.write(`${lines.length - 1} sales of ${need.size} building and basis pairs written to ${out}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
