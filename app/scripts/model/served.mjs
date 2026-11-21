/**
 * Who gets a second-tier result on the committed snapshot (REAL_DATA.md section 15.6): every building,
 * bedroom count and basis that is "too few" today (fewer than 5 sales the median would use), through
 * the shipped `compareSimilar` with the shipped constants. Writes <MODEL_WORK>/served.json.
 *
 *   npx tsx scripts/model/served.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { compareSimilar, similarComparables } from "../../src/lib/domain/similar.ts";

const REPO = process.env.FAIRSQUARE_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK = process.env.MODEL_WORK || path.join(REPO, ".data", "model");
const SNAP = process.env.OPEN_DATA_DIR || path.join(REPO, "data", "open-data");
fs.mkdirSync(WORK, { recursive: true });
const K = JSON.parse(fs.readFileSync(path.join(REPO, "src", "lib", "similar", "constants.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(SNAP, "manifest.json"), "utf8"));

/** The cells file has no quoted line breaks, but building names can hold commas in quotes. */
function csv(file) {
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
  const rows = [];
  let row = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(f);
      f = "";
    } else if (ch === "\n") {
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else if (ch !== "\r") f += ch;
  }
  if (f !== "" || row.length) {
    row.push(f);
    rows.push(row);
  }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const index = new Map();
const buildings = [];
const cells = [];
const num = (s) => (s === "" ? null : Number(s));
for (const r of csv(path.join(SNAP, "similar-cells.csv.gz"))) {
  const key = `${r.building}|${r.area_dld}`;
  let b = index.get(key);
  if (b === undefined) {
    b = buildings.length;
    index.set(key, b);
    buildings.push({ key, building: r.building, areaDld: r.area_dld, projectNumber: r.project_number, masterProject: r.master_project });
  }
  cells.push({ b, bed: Number(r.bedrooms), basis: r.completion, nRaw12: Number(r.n_raw12), n12: Number(r.n12), med12: num(r.med12), nOld1: Number(r.n_old1), medOld1: num(r.med_old1), nOld2: Number(r.n_old2), medOld2: num(r.med_old2) });
}
const artifact = { version: 1, dataThrough: manifest.dataThrough, windowStart: manifest.similar.windowStart, buildings, cells };

const few = cells.filter((c) => c.n12 < 5);
const out = { shown: 0, close: 0, broad: 0, sales: 0, salesShown: 0, reasons: {}, upTo3: 0, upTo3Shown: 0, ownOutside: 0, readOthers: 0, over2: 0, over3: 0, byOwnSales: {} };
for (const c of few) {
  const req = { bedrooms: c.bed, basis: c.basis, askingPsf: 1000, buildingKey: buildings[c.b].key };
  const r = compareSimilar(artifact, K, req);
  out.sales += c.nRaw12;
  if (c.bed <= K.maxBedrooms) out.upTo3++;
  const by = (out.byOwnSales[c.n12] ||= { combinations: 0, shown: 0 });
  by.combinations++;
  if (!r.shown) {
    out.reasons[r.reason] = (out.reasons[r.reason] || 0) + 1;
    continue;
  }
  out.shown++;
  out[r.tier]++;
  out.salesShown += c.nRaw12;
  by.shown++;
  if (c.bed <= K.maxBedrooms) out.upTo3Shown++;
  if (r.evidence.ownSales && (r.evidence.ownSales.medianPsf < r.rangeLowPsf || r.evidence.ownSales.medianPsf > r.rangeHighPsf)) out.ownOutside++;
  if (r.comparableBuildings > 0) {
    out.readOthers++;
    const medians = similarComparables(artifact, K, req).map((x) => x.medianPsf);
    const lo = Math.min(...medians);
    const hi = Math.max(...medians);
    if (hi > 2 * lo) out.over2++;
    if (hi > 3 * lo) out.over3++;
  }
}
// A bedroom type the building has no sale of in 36 months (studio to 3 bedrooms, both bases).
const has = new Set(cells.map((c) => `${c.b}|${c.bed}|${c.basis}`));
let neverSold = 0;
let neverSoldShown = 0;
for (let b = 0; b < buildings.length; b++) {
  for (let bed = 0; bed <= K.maxBedrooms; bed++) {
    for (const basis of ["ready", "off_plan"]) {
      if (has.has(`${b}|${bed}|${basis}`)) continue;
      neverSold++;
      if (compareSimilar(artifact, K, { bedrooms: bed, basis, askingPsf: 1000, buildingKey: buildings[b].key }).shown) neverSoldShown++;
    }
  }
}
const pct = (a, b) => Math.round((1000 * a) / b) / 10;
const summary = {
  dataThrough: manifest.dataThrough,
  snapshotSha256: manifest.snapshotSha256,
  constantsVersion: K.version,
  cells: cells.length,
  tooFewCombinations: few.length,
  shown: out.shown,
  shownPct: pct(out.shown, few.length),
  closePct: pct(out.close, few.length),
  broadPct: pct(out.broad, few.length),
  shownWeightedBySalesPct: pct(out.salesShown, out.sales),
  studioTo3Combinations: out.upTo3,
  studioTo3ShownPct: pct(out.upTo3Shown, out.upTo3),
  notShown: out.reasons,
  byOwnSales: out.byOwnSales,
  shownWithOwnMedianOutsideRange: out.ownOutside,
  shownThatReadOtherBuildings: out.readOthers,
  otherBuildingsMediansOver2x: out.over2,
  otherBuildingsMediansOver3x: out.over3,
  bedroomTypeNeverSold: { requests: neverSold, shown: neverSoldShown, shownPct: pct(neverSoldShown, neverSold) },
};
const file = path.join(WORK, "served.json");
fs.writeFileSync(file, `${JSON.stringify(summary, null, 1)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 1)}\nwritten ${file}\n`);
