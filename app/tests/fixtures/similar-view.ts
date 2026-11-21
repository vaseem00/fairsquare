/**
 * A shown similar-buildings comparison (the second tier) for UI tests and the e2e screenshots: nine
 * other buildings of one community, two own sales. Synthetic names and numbers; no alias imports, so
 * Playwright can load it too.
 */
import type { SimilarView } from "@/lib/types";

export const FIXTURE_SIMILAR: SimilarView = {
  v: 1,
  modelVersion: 2,
  scenario: "building",
  shown: true,
  reason: null,
  tier: "close",
  level: "community",
  place: "Al Jaddaf",
  comparableBuildings: 9,
  comparableSales: 96,
  rangeLowPsf: 1720,
  rangeHighPsf: 1980,
  verdict: "within",
  evidence: { ownSales: 2, olderSales: 7, otherBedroomSales: 1 },
  windowStart: "2025-11-16",
  windowEnd: "2026-11-16",
  area: null,
  areaCandidates: [],
  tested: { heldOf10: 8, heldLaterOf10: 7 },
  comparables: [
    { name: "Creek Vista Heights", sales: 22, medianPsf: 1850 },
    { name: "Jaddaf Waterfront 1", sales: 18, medianPsf: 1795 },
    { name: "Dummyside Heights 1", sales: 14, medianPsf: 1905 },
    { name: "Azure Rise", sales: 11, medianPsf: 1760 },
    { name: "Palace Gate Residences", sales: 9, medianPsf: 2010 },
    { name: "Al Jaddaf Views", sales: 8, medianPsf: 1688 },
    { name: "Binghatti Canal", sales: 6, medianPsf: 1840 },
    { name: "Culture Village Tower B", sales: 5, medianPsf: 2150 },
    { name: "Riverside Court", sales: 3, medianPsf: 1930 },
  ],
  comparableSpan: { lowPsf: 1688, highPsf: 2150 },
  project: null,
};

/**
 * The project route (REAL_DATA.md section 15.8): a building that is not in the data, off-plan, and
 * four other buildings of the project its listing names. Synthetic names and numbers.
 */
export const FIXTURE_SIMILAR_PROJECT: SimilarView = {
  ...FIXTURE_SIMILAR,
  modelVersion: 4,
  scenario: "project",
  tier: "broad",
  level: "project",
  place: null,
  comparableBuildings: 4,
  comparableSales: 212,
  rangeLowPsf: 1650,
  rangeHighPsf: 2070,
  verdict: "within",
  evidence: { ownSales: 0, olderSales: 0, otherBedroomSales: 0 },
  tested: { heldOf10: 7, heldLaterOf10: 7 },
  comparables: [
    { name: "Dummyside Lagoon 3", sales: 96, medianPsf: 1712 },
    { name: "Dummyside Lagoon 1", sales: 61, medianPsf: 1688 },
    { name: "Dummyside Lagoon 2", sales: 38, medianPsf: 1745 },
    { name: "Dummyside Lagoon 4", sales: 17, medianPsf: 1640 },
  ],
  comparableSpan: { lowPsf: 1640, highPsf: 1745 },
  project: { name: "Dummyside Lagoon", areaDld: "Al Hebiah Fifth" },
};

/** A range resting on the building's own sales over three years: no other building was read. */
export const FIXTURE_SIMILAR_OWN: SimilarView = {
  ...FIXTURE_SIMILAR,
  tier: "broad",
  level: null,
  place: null,
  comparableBuildings: 0,
  comparableSales: 0,
  rangeLowPsf: 1600,
  rangeHighPsf: 2240,
  evidence: { ownSales: 2, olderSales: 3, otherBedroomSales: 0 },
  comparables: [],
  comparableSpan: null,
};

/** Never shown, whatever its flags say: nothing but the 12 months' own sales (the first tier's "too few"). */
export const FIXTURE_SIMILAR_OWN_ONLY: SimilarView = { ...FIXTURE_SIMILAR_OWN, evidence: { ownSales: 2, olderSales: 0, otherBedroomSales: 0 } };

/** A refusal: nothing is shown and the page stays as it was. */
export const FIXTURE_SIMILAR_REFUSED: SimilarView = {
  ...FIXTURE_SIMILAR,
  shown: false,
  reason: "range_too_wide",
  tier: null,
  rangeLowPsf: null,
  rangeHighPsf: null,
  verdict: null,
  tested: null,
  comparables: [],
  comparableSpan: null,
};
