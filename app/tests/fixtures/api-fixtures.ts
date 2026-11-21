/**
 * Known API results for the UI and unit tests (tests only, never product code: REAL_DATA.md section
 * 8), built with the real domain and copy functions from the synthetic test buildings, as if compared
 * on 17 Nov 2026 (TEST_TODAY) with data loaded to that day. Client-safe (jsdom tests import it).
 */
import { consentFor } from "@/lib/copy";
import { sizeClusters } from "@/lib/result/scale-model";
import { TEST_BUILDINGS, TEST_TODAY, type TestBuilding } from "./test-buildings";
import {
  DEFAULT_RULES,
  addDays,
  analyseWith,
  completionBasis,
  findCandidates,
  inWindow,
  maskPhone,
  needsAreaCheck,
  needsTowerCheck,
  normalise,
  preselect,
  summariseSales,
  windowBounds,
  type AliasRow,
  type SaleInput,
} from "@/lib/domain";
import type {
  AnalysisView,
  CheckSource,
  CheckView,
  Completion,
  CoverageResponse,
  DataStatusView,
  ExtractResponse,
  MatchResponse,
  MeView,
  PropertyType,
  PublicConfig,
  SavedItemView,
  SaleView,
  SizeSource,
} from "@/lib/types";

export const FIXTURE_TODAY = TEST_TODAY;
export const FIXTURE_APP_URL = "http://localhost:3000";
const CREATED_AT = "2026-11-17T10:05:00.000Z";
/** A synthetic partner for the adviser form (tests only). */
export const FIXTURE_PARTNER = "Test Mortgage Partner";

/** The seeded alias rows (ids 1–6 in test-building order): the name plus each alias, normalised and de-duplicated. */
export const TEST_ALIAS_ROWS: readonly AliasRow[] = TEST_BUILDINGS.flatMap((b, i) =>
  [...new Set([b.name, ...b.aliases].map(normalise))].map((aliasNorm) => ({
    buildingId: i + 1,
    aliasNorm,
    name: b.name,
    area: b.area,
  })),
);

function testBuilding(name: string): { id: number; b: TestBuilding } | null {
  const i = TEST_BUILDINGS.findIndex((b) => b.name === name);
  return i < 0 ? null : { id: i + 1, b: TEST_BUILDINGS[i] };
}

/** The test sales (all ready) of a building and bedroom count inside the 12-month window, newest first. */
export function testSalesFor(buildingName: string, bedrooms: number, today: string = FIXTURE_TODAY): SaleInput[] {
  const found = testBuilding(buildingName);
  if (!found || found.b.bedrooms !== bedrooms) return [];
  const all = found.b.sales.map(([daysAgo, sizeSqft, priceAed]) => ({
    saleDate: addDays(today, -daysAgo),
    sizeSqft,
    priceAed,
  }));
  return inWindow(all, today, DEFAULT_RULES.windowDays).sort((a, b) => b.saleDate.localeCompare(a.saleDate));
}

interface FixtureCheckInput {
  code: string;
  buildingName: string | null;
  buildingText: string;
  areaText: string | null;
  bedrooms: number;
  sizeSqft: number;
  priceAed: number;
  source?: CheckSource;
  completion?: Completion;
  propertyType?: PropertyType;
  sizeSource?: SizeSource;
}

/**
 * Builds a CheckView the way the server does (A§4.3, REAL_DATA.md section 7), from the test data:
 * the test sales are all ready, so an off-plan listing finds no sales of its basis.
 */
export function buildFixtureCheck(i: FixtureCheckInput): CheckView {
  const rules = { ...DEFAULT_RULES };
  const { start, end } = windowBounds(FIXTURE_TODAY, rules.windowDays);
  const found = i.buildingName ? testBuilding(i.buildingName) : null;
  const completion = i.completion ?? "ready";
  const basis = completionBasis(completion);
  const sales = found && basis === "ready" ? testSalesFor(found.b.name, i.bedrooms) : [];
  const window = { windowStart: start, windowEnd: end, completionBasis: basis, dataThrough: FIXTURE_TODAY };
  let analysis: AnalysisView;
  let used: SaleInput[] = [];
  let setAside: SaleInput[] = [];
  if (found) {
    const r = analyseWith(i.priceAed, i.sizeSqft, sales, rules);
    used = r.used;
    setAside = r.setAside;
    analysis = { ...r.analysis, ...window };
  } else {
    analysis = {
      band: "none",
      askingPsf: i.priceAed / i.sizeSqft,
      medianPsf: null,
      medianPriceAed: null,
      count: 0,
      diff: null,
      outliersDropped: 0,
      medianSizeSqft: null,
      ...window,
    };
  }
  const view = (s: SaleInput): SaleView => ({ ...s, psf: s.priceAed / s.sizeSqft });
  const saleViews: SaleView[] = used.map(view);
  return {
    code: i.code,
    url: `${FIXTURE_APP_URL}/c/${i.code}`,
    createdAt: CREATED_AT,
    building: found ? { id: found.id, name: found.b.name, area: found.b.area } : null,
    buildingText: i.buildingText,
    areaText: i.areaText,
    bedrooms: i.bedrooms,
    sizeSqft: i.sizeSqft,
    priceAed: i.priceAed,
    propertyType: i.propertyType ?? "apartment",
    completion,
    source: i.source ?? "claude",
    analysis,
    sales: saleViews,
    setAsideSales: setAside.map(view),
    sizeSource: i.sizeSource ?? null,
    rules,
  };
}

// ---------- config ----------

/** Data loaded through FIXTURE_TODAY (fresh), with a synthetic source. */
export const FIXTURE_DATA_STATUS: DataStatusView = {
  loaded: true,
  dataFrom: "2023-11-18",
  dataThrough: FIXTURE_TODAY,
  stale: false,
  source: {
    title: "Test Transactions",
    url: "https://example.test/dataset",
    publisher: "Test Publisher",
    licence: "Test Licence",
    licenceUrl: "https://example.test/licence",
  },
};

/** Leads on, with the synthetic partner. */
export const FIXTURE_CONFIG: PublicConfig = {
  appUrl: FIXTURE_APP_URL,
  extractEnabled: true,
  maxImageBytes: 8_388_608,
  leadsEnabled: true,
  partner: { name: FIXTURE_PARTNER, regulator: "Test Regulator", licence: "TEST-0001", promise: null },
  consent: consentFor(FIXTURE_PARTNER),
  rules: { ...DEFAULT_RULES },
  mortgage: { downPct: 20, ratePct: 4.25, years: 25 },
  data: FIXTURE_DATA_STATUS,
};

export const FIXTURE_CONFIG_CLAUDE_OFF: PublicConfig = { ...FIXTURE_CONFIG, extractEnabled: false };

/** No partner configured: the money panel shows the estimator only (REAL_DATA.md section 8). */
export const FIXTURE_CONFIG_NO_LEADS: PublicConfig = { ...FIXTURE_CONFIG, leadsEnabled: false, partner: null, consent: null };

// ---------- comparisons ----------

/** Mockup Crest Tower 2-bed: above, +14.0% vs 11 ready sales. */
export const FIXTURE_CHECK_MARINA: CheckView = buildFixtureCheck({
  code: "K7Q2MX",
  buildingName: "Mockup Crest Tower",
  buildingText: "Mockup Crest",
  areaText: "Dubai Marina",
  bedrooms: 2,
  sizeSqft: 1284,
  priceAed: 2_450_000,
});

/** Fake Vista Residences (JVC) 1-bed: in line, −1.7% vs 9. */
export const FIXTURE_CHECK_JVC: CheckView = buildFixtureCheck({
  code: "P4VR8N",
  buildingName: "Fake Vista Residences",
  buildingText: "Fake Vista Res.",
  areaText: "JVC",
  bedrooms: 1,
  sizeSqft: 742,
  priceAed: 865_000,
});

/** Dummyside Heights 2, 3-bed: 2 sales, no verdict ("2 OF 5"). */
export const FIXTURE_CHECK_THIN: CheckView = buildFixtureCheck({
  code: "C2HT3B",
  buildingName: "Dummyside Heights 2",
  buildingText: "Dummyside Hts 2",
  areaText: "Al Jaddaf",
  bedrooms: 3,
  sizeSqft: 1905,
  priceAed: 3_600_000,
});

/** Nowhere Point Tower: not covered. */
export const FIXTURE_CHECK_NONE: CheckView = buildFixtureCheck({
  code: "H8PT5W",
  buildingName: null,
  buildingText: "Nowhere Point Tower",
  areaText: "Dubai Creek Harbour",
  bedrooms: 2,
  sizeSqft: 1150,
  priceAed: 2_300_000,
  source: "manual",
});

/** Marina numbers marked off-plan: compared with off-plan sales only, of which there are none ("0 OF 5"). */
export const FIXTURE_CHECK_OFFPLAN: CheckView = buildFixtureCheck({
  code: "F9PLAN",
  buildingName: "Mockup Crest Tower",
  buildingText: "Mockup Crest",
  areaText: "Dubai Marina",
  bedrooms: 2,
  sizeSqft: 1284,
  priceAed: 2_450_000,
  completion: "off_plan",
});

// ---------- extraction ----------

/**
 * The match the server would return for a query: salesForBedrooms filled when beds is given, and the
 * preselected candidate's size buttons (`sizes`) and sales by basis (`basisSales`, all ready) with them.
 */
export function fixtureMatch(q: string, area: string | null, beds: number | null): MatchResponse {
  const cands = findCandidates(q, TEST_ALIAS_ROWS, area);
  const preselectId = preselect(cands);
  return {
    candidates: cands.map((c) => ({
      buildingId: c.buildingId,
      name: c.name,
      area: c.area,
      strength: c.strength,
      salesForBedrooms: beds === null ? null : testSalesFor(c.name, beds).length,
      ...(beds !== null && c.buildingId === preselectId
        ? {
            sizes: sizeClusters(testSalesFor(c.name, beds).map((s) => s.sizeSqft)).map((k) => ({ sqft: k.sqft, sales: k.sales })),
            basisSales: { ready: testSalesFor(c.name, beds).length, offPlan: 0 },
          }
        : {}),
    })),
    preselectId,
    towerCheck: needsTowerCheck(cands),
    areaCheck: needsAreaCheck(cands),
  };
}

/** Marina fields; preselects Mockup Crest Tower; towerCheck true. */
export const FIXTURE_EXTRACT_OK: ExtractResponse = {
  outcome: "ok",
  fields: { buildingText: "Mockup Crest", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 },
  propertyType: "apartment",
  completion: "ready",
  contactDetailsVisible: false,
  match: fixtureMatch("Mockup Crest", "Dubai Marina", 2),
};

/** Same read, with the agent's contact details visible ("Hide contact details"). */
export const FIXTURE_EXTRACT_CONTACT: ExtractResponse = { ...FIXTURE_EXTRACT_OK, contactDetailsVisible: true };

// ---------- coverage ----------

/** The 6 test buildings, most sales first (then by name), as GET /api/buildings answers. */
export const FIXTURE_COVERAGE: CoverageResponse = (() => {
  const { start, end } = windowBounds(FIXTURE_TODAY, DEFAULT_RULES.windowDays);
  const buildings = TEST_BUILDINGS.map((b, i) => {
    const sales = testSalesFor(b.name, b.bedrooms);
    const latest = sales[0]?.saleDate ?? null;
    return {
      id: i + 1,
      name: b.name,
      area: b.area,
      areaDld: b.areaDld,
      readySales: sales.length,
      offPlanSales: 0,
      latestSaleDate: latest,
      types: [
        {
          bedrooms: b.bedrooms,
          readySales: sales.length,
          offPlanSales: 0,
          medianPsf: summariseSales(sales).medianPsf,
          latestSaleDate: latest,
          readyComparable: summariseSales(sales).count >= DEFAULT_RULES.minSales,
          offPlanComparable: false,
        },
      ],
    };
  }).sort((x, y) => y.readySales - x.readySales || x.name.localeCompare(y.name));
  return {
    buildings,
    total: buildings.length,
    page: 1,
    pageSize: 50,
    q: null,
    window: { start, end },
    dataThrough: FIXTURE_TODAY,
  };
})();

// ---------- saved and me ----------

const snapshot = (c: CheckView) => ({ band: c.analysis.band, diff: c.analysis.diff, count: c.analysis.count });

/** Marina (1 new sale since saving, unseen) and JVC (nothing new). */
export const FIXTURE_SAVED: SavedItemView[] = [
  {
    code: FIXTURE_CHECK_MARINA.code,
    savedAt: "2026-11-03T09:12:00.000Z",
    building: FIXTURE_CHECK_MARINA.building,
    buildingText: FIXTURE_CHECK_MARINA.buildingText,
    bedrooms: FIXTURE_CHECK_MARINA.bedrooms,
    sizeSqft: FIXTURE_CHECK_MARINA.sizeSqft,
    priceAed: FIXTURE_CHECK_MARINA.priceAed,
    atSave: { band: "above", diff: 0.1523, count: 10 },
    now: snapshot(FIXTURE_CHECK_MARINA),
    newSalesSinceSave: 1,
    unseenNewSales: 1,
  },
  {
    code: FIXTURE_CHECK_JVC.code,
    savedAt: "2026-10-28T16:40:00.000Z",
    building: FIXTURE_CHECK_JVC.building,
    buildingText: FIXTURE_CHECK_JVC.buildingText,
    bedrooms: FIXTURE_CHECK_JVC.bedrooms,
    sizeSqft: FIXTURE_CHECK_JVC.sizeSqft,
    priceAed: FIXTURE_CHECK_JVC.priceAed,
    atSave: snapshot(FIXTURE_CHECK_JVC),
    now: snapshot(FIXTURE_CHECK_JVC),
    newSalesSinceSave: 0,
    unseenNewSales: 0,
  },
];

/** 2 saved (1 with new sales), 1 building request and 1 adviser request. */
export const FIXTURE_ME: MeView = {
  savedCount: FIXTURE_SAVED.length,
  savedWithNewSales: FIXTURE_SAVED.filter((s) => s.unseenNewSales > 0).length,
  checksCount: 4,
  requests: [
    {
      id: 1,
      text: "Nowhere Point Tower",
      area: "Dubai Creek Harbour",
      createdAt: CREATED_AT,
      othersAsked: 3,
      covered: false,
      coveredBuilding: null,
    },
  ],
  leads: [
    {
      id: 1,
      partner: FIXTURE_PARTNER,
      status: "new",
      createdAt: "2026-11-17T10:09:00.000Z",
      withdrawnAt: null,
      phoneMasked: maskPhone("+971501234567"),
      checkCode: FIXTURE_CHECK_MARINA.code,
      buildingName: "Mockup Crest Tower",
      bedrooms: 2,
      priceAed: 2_450_000,
    },
  ],
};
