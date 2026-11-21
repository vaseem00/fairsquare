/**
 * The nearby fixtures (tests/fixtures/nearby), cut from the committed snapshot of the fit by
 * scripts/model/nearby/golden-fixture.ts:
 * - golden.json: the 42 cases of the Python reference (scripts/model/nearby/make.py) and what it answers;
 * - index.json.gz: the time index and the size slopes of the snapshot's acs-model.json.gz;
 * - rows.json.gz: the buildings and the registered sales those cases read.
 * The building names in them are DLD's own (open data), as in data/open-data.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { acsDay } from "@/lib/domain/acs";
import type { NearbyIndex, NearbyRequest, NearbySaleRow } from "@/lib/domain/nearby";

export const NEARBY_FIXTURES = path.join(process.cwd(), "tests", "fixtures", "nearby");

const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(path.join(NEARBY_FIXTURES, name))).toString("utf8")) as unknown;

export interface GoldenNearbyInput {
  bedrooms: number;
  basis: 0 | 1;
  sizeSqft: number;
  master?: string;
  area?: string;
  building?: [string, string];
  askingPsf?: number;
}

export interface GoldenNearbyCase {
  id: number;
  input: GoldenNearbyInput;
  expected: Record<string, unknown>;
}

export function goldenNearby(): { dataThrough: string; constantsVersion: number; cases: GoldenNearbyCase[] } {
  return JSON.parse(readFileSync(path.join(NEARBY_FIXTURES, "golden.json"), "utf8")) as { dataThrough: string; constantsVersion: number; cases: GoldenNearbyCase[] };
}

interface RawIndex {
  dataThrough: string;
  epoch: string;
  T: number;
  areas: string[];
  theta: Record<string, number[]>;
  tau: number[][];
  seg: number[][];
}

export function goldenNearbyIndex(): NearbyIndex & { epoch: string; dataThrough: string } {
  const raw = gz("index.json.gz") as RawIndex;
  return { epoch: raw.epoch, dataThrough: raw.dataThrough, T: raw.T, areas: new Map(raw.areas.map((a, i) => [a, i])), theta: raw.theta, tau: raw.tau, seg: raw.seg };
}

interface Building {
  name: string;
  area: string;
  master: string;
  firstSaleDay: number | null;
  firstReadySaleDay: number | null;
}

interface Sale {
  ref: string;
  b: number;
  day: number;
  bed: number;
  basis: number;
  size: number;
  price: number;
}

/** The fixture as a small stand-in for the database: `read` is the one read of the method (SPEC.md section 2). */
export function goldenNearbyData(epoch: string) {
  const raw = gz("rows.json.gz") as { buildings: [string, string, string, string, string][]; sales: string[] };
  const buildings: Building[] = raw.buildings.map(([name, area, master, first, firstReady]) => ({
    name,
    area,
    master,
    firstSaleDay: first ? acsDay(epoch, first) : null,
    firstReadySaleDay: firstReady ? acsDay(epoch, firstReady) : null,
  }));
  const sales: Sale[] = raw.sales.map((line) => {
    const [ref, b, date, bed, basis, size, price] = line.split(",");
    return { ref, b: Number(b), day: acsDay(epoch, date), bed: Number(bed), basis: Number(basis), size: Number(size), price: Number(price) };
  });
  const find = (name: string, area: string) => buildings.findIndex((b) => b.name === name && b.area === area);

  /** The request and the rows of one golden input. */
  const read = (c: GoldenNearbyInput): { request: NearbyRequest; rows: NearbySaleRow[] } => {
    const own = c.building ? find(c.building[0], c.building[1]) : -1;
    if (c.building && own < 0) throw new Error(`not in the fixture: ${c.building.join(", ")}`);
    const master = c.master || (own >= 0 ? buildings[own].master : "");
    const area = c.area || (own >= 0 ? buildings[own].area : "");
    const rows: NearbySaleRow[] = [];
    for (const s of sales) {
      if (s.bed !== c.bedrooms || s.basis !== c.basis || s.b === own) continue;
      const b = buildings[s.b];
      const inCommunity = master !== "" && b.master === master;
      const inArea = area !== "" && b.area === area;
      if (!inCommunity && !inArea) continue;
      rows.push({ ref: s.ref, buildingId: s.b, building: b.name, areaDld: b.area, day: s.day, sizeSqft: s.size, priceAed: s.price, firstSaleDay: b.firstSaleDay, firstReadySaleDay: b.firstReadySaleDay, inCommunity, inArea });
    }
    return {
      request: {
        bedrooms: c.bedrooms,
        basis: c.basis,
        sizeSqft: c.sizeSqft,
        askingPsf: c.askingPsf ?? null,
        own: own >= 0 ? { firstSaleDay: buildings[own].firstSaleDay, firstReadySaleDay: buildings[own].firstReadySaleDay } : null,
        masterKnown: master !== "",
        areaKnown: area !== "",
      },
      rows,
    };
  };
  return { buildings, sales, read };
}
