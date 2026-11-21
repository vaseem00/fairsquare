/**
 * Builds the artifact from the committed snapshot, cross-checks the reference against the Python port on every
 * too-few combination, and writes the golden cases.
 * node run.ts <repo>/data/open-data <scratch model dir>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { buildArtifact, compareSimilar, parseCsv, type Artifact, type Basis, type BuildingRow, type Constants, type Request, type SaleRow } from "./similar.ts";

const [snapshotDir, modelDir] = process.argv.slice(2);
const constants: Constants = JSON.parse(readFileSync(join(modelDir, "golden", "constants.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(snapshotDir, "manifest.json"), "utf8"));

function table(file: string): Record<string, string>[] {
  const rows = parseCsv(gunzipSync(readFileSync(join(snapshotDir, file))).toString("utf8"));
  const head = rows[0];
  return rows.slice(1).filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const buildings: BuildingRow[] = table("buildings.csv.gz").map((r) => ({ building: r.building, areaDld: r.area_dld, projectNumber: r.project_number, masterProject: r.master_project }));
function* readSales(): Generator<SaleRow> {
  const rows = parseCsv(gunzipSync(readFileSync(join(snapshotDir, "sales.csv.gz"))).toString("utf8"));
  const h = Object.fromEntries(rows[0].map((name, i) => [name, i]));
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length !== rows[0].length) continue;
    yield { date: r[h.date], building: r[h.building], areaDld: r[h.area_dld], bedrooms: +r[h.bedrooms], sizeSqft: +r[h.size_sqft], priceAed: +r[h.price_aed], completion: r[h.completion] as Basis };
  }
}
const sales = readSales();
const t0 = Date.now();
const artifact: Artifact = buildArtifact(sales, buildings);
console.log(`artifact: ${artifact.buildings.length} buildings, ${artifact.cells.length} cells, through ${artifact.dataThrough}, built in ${Date.now() - t0} ms`);
const artifactJson = JSON.stringify(artifact);
writeFileSync(join(modelDir, "ref", "artifact.json"), artifactJson);
console.log(`artifact.json: ${(artifactJson.length / 1e6).toFixed(2)} MB`);

// ---- agreement with data:build's cells file (the app's own artifact builder) ----
{
  const rows = parseCsv(gunzipSync(readFileSync(join(snapshotDir, "similar-cells.csv.gz"))).toString("utf8"));
  const h = Object.fromEntries(rows[0].map((name, i) => [name, i]));
  const app = new Map<string, string[]>();
  for (const r of rows.slice(1)) if (r.length === rows[0].length) app.set(`${r[h.building]}|${r[h.area_dld]}|${r[h.bedrooms]}|${r[h.completion]}`, r);
  let mism = 0, worstRel = 0;
  const num = (x: string) => (x === "" ? null : +x);
  for (const c of artifact.cells) {
    const b = artifact.buildings[c.b];
    const r = app.get(`${b.building}|${b.areaDld}|${c.bed}|${c.basis}`);
    if (!r) { mism++; if (mism < 5) console.log("MISSING in app cells", b.key, c.bed, c.basis); continue; }
    const pairs: Array<[number | null, number | null]> = [[c.nRaw12, num(r[h.n_raw12])], [c.n12, num(r[h.n12])], [c.med12, num(r[h.med12])], [(c as any).nOld1, num(r[h.n_old1])], [(c as any).medOld1, num(r[h.med_old1])], [(c as any).nOld2, num(r[h.n_old2])], [(c as any).medOld2, num(r[h.med_old2])]];
    for (const [a, z] of pairs) {
      if (a === null || z === null || a === undefined) { if ((a ?? null) !== z) { mism++; if (mism < 5) console.log("NULL MISMATCH", b.key, c, r); } continue; }
      const d = Math.abs(a - z) / Math.max(1, Math.abs(z));
      if (d > worstRel) worstRel = d;
      if (d > 1e-9) { mism++; if (mism < 5) console.log("MISMATCH", b.key, c, r); }
    }
    if (b.projectNumber !== r[h.project_number] || b.masterProject !== r[h.master_project]) { mism++; if (mism < 5) console.log("FACT MISMATCH", b, r); }
  }
  console.log(`agreement with data:build cells: ref ${artifact.cells.length} cells, app ${app.size} cells, ${mism} mismatches, largest relative difference ${worstRel.toExponential(2)}`);
}
// ---- golden cases ----
const cellsOf = new Map<number, typeof artifact.cells>();
for (const c of artifact.cells) (cellsOf.get(c.b) ?? cellsOf.set(c.b, []).get(c.b)!).push(c);
interface Pick { id: string; note: string; request: Request }
const picks: Pick[] = [];
const taken = new Set<string>();
/** A deterministic walk: the first combination (in artifact order, stepping by `step`) that passes `test`. */
function find(note: string, id: string, asking: (r: ReturnType<typeof compareSimilar>) => number, test: (cell: (typeof artifact.cells)[number], r: ReturnType<typeof compareSimilar>) => boolean, step = 1, start = 0) {
  for (let i = start; i < artifact.cells.length; i += step) {
    const cell = artifact.cells[i];
    if (cell.n12 >= 5) continue;
    const key = artifact.buildings[cell.b].key;
    if (taken.has(key)) continue;
    const base: Request = { bedrooms: cell.bed, basis: cell.basis, askingPsf: 1, buildingKey: key };
    const r = compareSimilar(artifact, constants, base);
    if (!test(cell, r)) continue;
    taken.add(key);
    picks.push({ id, note, request: { ...base, askingPsf: Math.round(asking(r)) } });
    return;
  }
  throw new Error(`no case for ${id}`);
}
const mid = (r: any) => Math.sqrt(r.lowPsf * r.highPsf);
const over = (r: any) => r.highPsf * 1.06;
const under = (r: any) => r.lowPsf * 0.94;
let n = 0;
const id = (s: string) => `G${String(++n).padStart(2, "0")}-${s}`;
for (const basis of ["ready", "off_plan"] as const) {
  for (const k of [1, 2, 3, 4]) {
    find(`known building, ${k} own sale(s), ${basis}`, id(`own-${k}-${basis}`), k % 2 ? over : mid, (c, r) => c.basis === basis && c.n12 === k && r.shown && r.evidenceClass === "own" && c.bed <= 3, 7, k * 11);
  }
  find(`known building, own sales, reference from project siblings, ${basis}`, id(`own-project-${basis}`), under, (c, r) => c.basis === basis && c.n12 >= 1 && r.shown && r.level === "project", 5, 3);
  find(`known building, own sales, reference from the area (no master project), ${basis}`, id(`own-area-${basis}`), mid, (c, r) => c.basis === basis && c.n12 >= 1 && r.shown && r.level === "area", 3, 1);
  find(`known building, no sale in 12 months, older sales and other bedrooms, ${basis}`, id(`indirect-all-${basis}`), over, (c, r) => c.basis === basis && c.n12 === 0 && r.shown && !!r.evidence.older12to24 && !!r.evidence.older24to36 && !!r.evidence.otherBedrooms, 3, 2);
  find(`known building, no sale in 12 months, only sales 24 to 36 months old, ${basis}`, id(`indirect-old2-${basis}`), mid, (c, r) => c.basis === basis && c.n12 === 0 && r.shown && !r.evidence.older12to24 && !!r.evidence.older24to36 && !r.evidence.otherBedrooms, 3, 0);
  find(`known building, no sale in 12 months, broad tier, ${basis}`, id(`indirect-broad-${basis}`), under, (c, r) => c.basis === basis && c.n12 === 0 && r.shown && r.tier === "broad", 11, 5);
  find(`known building, own sales but no comparable building at any level, ${basis}`, id(`own-noref-${basis}`), mid, (c, r) => c.basis === basis && c.n12 >= 1 && r.level === null && c.bed <= 3, 1, 0);
}
find("known building, 4 bedrooms: not shown", id("refuse-4bed"), mid, (c, r) => c.bed === 4 && c.n12 >= 1 && r.reason === "bedrooms_not_validated", 3, 0);
find("known building, 5 bedrooms: not shown", id("refuse-5bed"), mid, (c, r) => c.bed === 5 && r.reason === "bedrooms_not_validated", 1, 0);
find("known building, range too wide: not shown", id("refuse-wide-ready"), mid, (c, r) => c.basis === "ready" && r.reason === "range_too_wide" && c.bed <= 3, 1, 0);
find("known building, range too wide (second example): not shown", id("refuse-wide-2"), mid, (c, r) => r.reason === "range_too_wide" && c.bed <= 3 && c.bed >= 1, 1, 4000);

// Unknown building: the scope comes from the area resolver. Use real buildings' places, but do not pass a building key.
function scopeCase(note: string, ident: string, asking: (r: any) => number, withProject: boolean, withMaster: boolean, test: (r: ReturnType<typeof compareSimilar>, c: (typeof artifact.cells)[number]) => boolean, start = 0, step = 13) {
  for (let i = start; i < artifact.cells.length; i += step) {
    const cell = artifact.cells[i];
    const b = artifact.buildings[cell.b];
    if (cell.bed > 3 || taken.has("scope:" + b.key)) continue;
    if (withProject && !b.projectNumber) continue;
    if (withMaster && !b.masterProject) continue;
    const scope = { areaDld: b.areaDld, ...(withMaster ? { masterProject: b.masterProject } : {}), ...(withProject ? { projectNumber: b.projectNumber } : {}) };
    const base: Request = { bedrooms: cell.bed, basis: cell.basis, askingPsf: 1, scope };
    const r = compareSimilar(artifact, constants, base);
    if (!test(r, cell)) continue;
    taken.add("scope:" + b.key);
    picks.push({ id: ident, note, request: { ...base, askingPsf: Math.round(asking(r)) } });
    return;
  }
  throw new Error(`no case for ${ident}`);
}
scopeCase("unknown building, project resolved, off-plan sibling buildings: shown, broad", id("scope-project-offplan-1"), mid, true, true, (r, c) => r.shown && r.level === "project" && c.basis === "off_plan", 10);
scopeCase("unknown building, project resolved, off-plan: asking above the range", id("scope-project-offplan-2"), over, true, true, (r, c) => r.shown && r.level === "project" && c.basis === "off_plan" && r.comparableBuildings >= 2, 500);
scopeCase("unknown building, project resolved, off-plan: asking below the range", id("scope-project-offplan-3"), under, true, true, (r, c) => r.shown && r.level === "project" && c.basis === "off_plan", 4000);
scopeCase("unknown building, project resolved, ready: range too wide, not shown", id("scope-project-ready"), mid, true, true, (r, c) => r.level === "project" && c.basis === "ready" && r.reason === "range_too_wide", 200);
scopeCase("unknown building, community resolved only: never shown", id("scope-community-1"), mid, false, true, (r) => r.level === "community" && r.reason === "no_building_evidence", 50);
scopeCase("unknown building, community resolved only, ready: never shown", id("scope-community-2"), mid, false, true, (r, c) => r.level === "community" && c.basis === "ready" && r.reason === "no_building_evidence", 3000);
scopeCase("unknown building, area resolved only: never shown", id("scope-area-1"), mid, false, false, (r) => r.level === "area" && r.reason === "no_building_evidence", 900);
scopeCase("unknown building, area resolved only, off-plan: never shown", id("scope-area-2"), mid, false, false, (r, c) => r.level === "area" && c.basis === "off_plan" && r.reason === "no_building_evidence", 7000);
picks.push({ id: id("scope-unresolved"), note: "unknown building, area not resolved: no second tier", request: { bedrooms: 1, basis: "ready", askingPsf: 1500, scope: { areaDld: "" } } });
picks.push({ id: id("scope-empty-area"), note: "unknown building, a DLD area with no comparable building for these bedrooms: no evidence", request: { bedrooms: 3, basis: "ready", askingPsf: 1500, scope: { areaDld: "Dubai Investment Park First" } } });
picks.push({ id: id("unknown-key"), note: "a building key that is not in the artifact: no evidence", request: { bedrooms: 1, basis: "ready", askingPsf: 1500, buildingKey: "NO SUCH BUILDING|Nowhere" } });

const cases = picks.map((p) => ({ ...p, expected: compareSimilar(artifact, constants, p.request) }));
const tally: Record<string, number> = {};
for (const c of cases) {
  const k = c.expected.shown ? `shown/${c.expected.tier}/${c.expected.verdict}` : `not shown/${c.expected.reason}`;
  tally[k] = (tally[k] ?? 0) + 1;
}
writeFileSync(
  join(modelDir, "golden", "golden-cases.json"),
  JSON.stringify({ about: "Golden cases for the similar-buildings comparison. Build the artifact from the snapshot named here, apply golden/constants.json, and reproduce `expected` (numbers to 1e-9 relative).",
    snapshot: { salesSha256: manifest.snapshotSha256, buildingsSha256: manifest.buildingsFile?.sha256, dataThrough: manifest.dataThrough, kept: manifest.counts.kept, commit: process.env.GOLDEN_COMMIT ?? "working tree" },
    artifact: { buildings: artifact.buildings.length, cells: artifact.cells.length, windowStart: artifact.windowStart }, cases }, null, 2),
);
console.log(`golden cases: ${cases.length}`, tally);

