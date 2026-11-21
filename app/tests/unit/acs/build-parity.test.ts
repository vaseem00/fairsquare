/**
 * The TypeScript build of the model's snapshot statistics (src/lib/acs/build.ts) against the Python
 * reference (acs.py `Ctx.build`, tindex.py), on the data of the fit: the committed snapshot plus the
 * 12 months before it (tests/fixtures/acs/older-sales.csv.gz), compared number by number with the
 * model acs.py built (tests/fixtures/acs/acs-model.json.gz), within 1e-9.
 *
 * Slow (it reads 491,268 sales), so it is not part of the default run:
 *   PowerShell:  $env:ACS_PARITY = "1"; npx vitest run tests/unit/acs/build-parity.test.ts
 *   bash:        ACS_PARITY=1 npx vitest run tests/unit/acs/build-parity.test.ts
 * It also skips when data/open-data is no longer the snapshot of the fit (after a data refresh the
 * Python model of that refresh is needed: scripts/model/README.md, the refit).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildAcsStatistics, type AcsBuildSale } from "@/lib/acs/build";
import { ACS_CONSTANTS } from "@/lib/acs/model";
import { readCsvRecords } from "@/lib/ingest/csv-stream";
import { dldKey } from "@/lib/ingest/identity";
import { readSnapshotRows } from "@/lib/ingest/snapshot";
import { ACS_FIXTURES, goldenModel } from "../../fixtures/acs/load";

const DATA = path.join(process.cwd(), "data", "open-data");
const manifest = JSON.parse(readFileSync(path.join(DATA, "manifest.json"), "utf8")) as { snapshotSha256: string };
const run = process.env.ACS_PARITY === "1" && manifest.snapshotSha256 === ACS_CONSTANTS.fittedOn.snapshotSha256;
const TOL = 1e-9;

describe.skipIf(!run)("buildAcsStatistics against acs.py on the data of the fit", () => {
  it("gives the same time index, slopes, families and cell statistics within 1e-9", { timeout: 600_000 }, async () => {
    const want = goldenModel();
    const keys = new Map<string, string>();
    const keyOf = (building: string, area: string) => {
      const pair = `${building}\u0000${area}`;
      let k = keys.get(pair);
      if (k === undefined) {
        k = dldKey(building, area);
        keys.set(pair, k);
      }
      return k;
    };
    const sales: AcsBuildSale[] = [];
    let line = 0;
    for await (const rec of readCsvRecords(Readable.from([gunzipSync(readFileSync(path.join(ACS_FIXTURES, "older-sales.csv.gz")))]))) {
      if (line++ === 0) continue;
      const [date, building, area, bed, completion, size, price] = rec;
      sales.push({ ref: `old:${String(line).padStart(7, "0")}`, building: keyOf(building, area), area, date, bedrooms: Number(bed), basis: completion === "off_plan" ? 1 : 0, sizeSqft: Number(size), priceAed: Number(price) });
    }
    expect(sales.length).toBe(87_401);
    for await (const s of readSnapshotRows(path.join(DATA, "sales.csv.gz"))) {
      sales.push({ ref: s.ref, building: keyOf(s.building, s.areaDld), area: s.areaDld, date: s.date, bedrooms: s.bedrooms, basis: s.completion === "off_plan" ? 1 : 0, sizeSqft: s.sizeSqft, priceAed: s.priceAed });
    }
    expect(sales.length).toBe(491_268);
    const famRaw = JSON.parse(gunzipSync(readFileSync(path.join(ACS_FIXTURES, "families.json.gz"))).toString("utf8")) as Record<string, string>;
    const families = new Map<string, string>();
    for (const [name, fam] of Object.entries(famRaw)) {
      const cut = name.lastIndexOf("|");
      families.set(keyOf(name.slice(0, cut), name.slice(cut + 1)), fam);
    }

    const t0 = Date.now();
    const got = buildAcsStatistics({ dataThrough: want.dataThrough, sales, families });
    const ms = Date.now() - t0;

    let largest = 0;
    const near = (a: number, b: number, where: string) => {
      const d = Math.abs(a - b) / Math.max(1, Math.abs(b));
      largest = Math.max(largest, d);
      if (d > TOL) throw new Error(`${where}: ${a} != ${b}`);
    };
    expect(got.T).toBe(want.T);
    expect(got.poolFromDay).toBe(want.poolFromDay);
    expect(got.areas).toEqual(want.areas);
    expect([...got.buildings.key].sort()).toEqual([...want.buildings.key].sort());
    const wantAt = new Map(want.buildings.key.map((k, i) => [k, i]));
    for (const s of [0, 1]) {
      for (let k = 0; k < 5; k++) {
        near(got.seg[s][k], want.seg[s][k], `seg ${s} ${k}`);
        near(got.prem[s][k], want.prem[s][k], `prem ${s} ${k}`);
      }
      near(got.beta2[s], want.beta2[s], `beta2 ${s}`);
      for (let m = 0; m < 48; m++) near(got.tau[s][m], want.tau[s][m], `tau ${s} ${m}`);
    }
    expect(Object.keys(got.theta).sort()).toEqual(Object.keys(want.theta).sort());
    for (const [k, th] of Object.entries(want.theta)) for (let m = 0; m < 48; m++) near(got.theta[k][m], th[m], `theta ${k} ${m}`);
    // Buildings: the same area; the same partition into families (the ids mean nothing).
    const famOf = (m: typeof want, members: Map<number, string[]>) => m.buildings.key.forEach((k, i) => m.buildings.family[i] > 0 && members.set(m.buildings.family[i], [...(members.get(m.buildings.family[i]) ?? []), k]));
    const a = new Map<number, string[]>();
    const b = new Map<number, string[]>();
    famOf(got as unknown as typeof want, a);
    famOf(want, b);
    const sets = (m: Map<number, string[]>) => [...m.values()].map((l) => l.sort().join("\n")).sort();
    expect(sets(a)).toEqual(sets(b));
    got.buildings.key.forEach((k, i) => expect(got.areas[got.buildings.area[i]], k).toBe(want.areas[want.buildings.area[wantAt.get(k) as number]]));
    // Cell statistics, by building key.
    const cellsOf = (m: typeof want) => new Map(m.cellSlope.map(([bi, bed, basis, sxx, sxy]) => [`${m.buildings.key[bi]}#${bed}#${basis}`, [sxx, sxy]]));
    const gc = cellsOf(got as unknown as typeof want);
    const wc = cellsOf(want);
    expect(gc.size).toBe(wc.size);
    for (const [k, [sxx, sxy]] of wc) {
      const g = gc.get(k);
      if (!g) throw new Error(`cell ${k} is missing`);
      near(g[0], sxx, `sxx ${k}`);
      near(g[1], sxy, `sxy ${k}`);
    }
    // eslint-disable-next-line no-console -- the measured numbers are the point of this run
    console.log(JSON.stringify({ buildMs: ms, largestRelativeDifference: largest, buildings: got.buildings.key.length, areaIndexes: Object.keys(got.theta).length, cells: got.cellSlope.length }));
    expect(largest).toBeLessThan(TOL);
  });
});
