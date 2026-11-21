/**
 * Adjusted-registered-sales results (REAL_DATA.md section 16, DESIGN.md section 6.17) for UI tests and
 * the e2e screenshots. Synthetic names and numbers; no alias imports except a type, so Playwright can
 * load it too.
 *
 * - FIXTURE_ACS_FEW: a too-few building (scenario "few") that gets a range: sales of the same bedroom
 *   count over three years, two of another bedroom count, and three rows of another building of the
 *   project, one of them several apartments registered at one price per sq ft. The asking price of the
 *   e2e listing (AED 2,000 per sq ft) is above it.
 * - FIXTURE_ACS_LEAD: a building with its 5 or more sales (scenario "enough"), sales of its own type only.
 * - FIXTURE_ACS_REFUSED: no range (the page must then be exactly what it was).
 */
import type { AcsComparableView, AcsView } from "@/lib/types";

const row = (r: Partial<AcsComparableView> & Pick<AcsComparableView, "date" | "sizeSqft" | "psf" | "adjustedPsf" | "weightShare">): AcsComparableView => ({
  ring: 1,
  building: null,
  bedrooms: 3,
  priceAed: Math.round(r.sizeSqft * r.psf),
  count: 1,
  batch: false,
  timeAdj: 0,
  sizeAdj: 0,
  bedroomAdj: 0,
  ...r,
});

export const FIXTURE_ACS_FEW: AcsView = {
  v: 1,
  modelVersion: 2,
  constantsVersion: 1,
  dataThrough: "2026-11-10",
  poolFrom: "2023-11-12",
  scenario: "few",
  shown: true,
  reason: null,
  rangeLowPsf: 1370,
  rangeHighPsf: 1610,
  verdict: "above",
  evidence: { lead: 1, sales: 17, ownSales: 7, otherBedroomSales: 2, projectSales: 8 },
  typicalSizeSqft: 1619.97,
  tested: { heldOf10: 8, heldLaterOf10: 8 },
  comparables: [
    row({ date: "2026-10-14", sizeSqft: 1625.35, psf: 1476.45, timeAdj: 0.012, sizeAdj: 0.021, adjustedPsf: 1525.54, weightShare: 0.214 }),
    row({ date: "2026-06-02", sizeSqft: 1614.59, psf: 1445.5, timeAdj: 0.031, sizeAdj: 0.019, adjustedPsf: 1518.63, weightShare: 0.171 }),
    row({ date: "2025-12-09", sizeSqft: 1582.3, psf: 1402.1, timeAdj: 0.048, sizeAdj: 0.016, adjustedPsf: 1492.91, weightShare: 0.128, count: 2 }),
    row({ date: "2025-05-20", sizeSqft: 1668.4, psf: 1371.2, timeAdj: 0.074, sizeAdj: 0.024, adjustedPsf: 1508.01, weightShare: 0.092 }),
    row({ date: "2024-11-11", sizeSqft: 1603.83, psf: 1310.6, timeAdj: 0.118, sizeAdj: 0.018, adjustedPsf: 1491.62, weightShare: 0.071 }),
    row({ date: "2024-03-05", sizeSqft: 1549.99, psf: 1248.9, timeAdj: 0.163, sizeAdj: 0.013, adjustedPsf: 1471.35, weightShare: 0.049 }),
    row({ ring: 3, building: "Test Tower G", date: "2026-09-18", sizeSqft: 1614.59, psf: 1444.3, timeAdj: 0.015, sizeAdj: -0.004, adjustedPsf: 1460.1, weightShare: 0.066 }),
    row({ ring: 3, building: "Test Tower G", date: "2026-03-30", sizeSqft: 1506.95, psf: 1420.75, priceAed: null, count: 6, batch: true, timeAdj: 0.039, sizeAdj: 0, adjustedPsf: 1476.16, weightShare: 0.058 }),
    row({ ring: 3, building: "Test Tower G", date: "2025-08-07", sizeSqft: 1722.22, psf: 1338.4, timeAdj: 0.066, sizeAdj: 0.009, adjustedPsf: 1439.57, weightShare: 0.041 }),
    row({ ring: 2, bedrooms: 2, date: "2026-08-25", sizeSqft: 1140.97, psf: 1612.7, timeAdj: 0.018, sizeAdj: -0.052, bedroomAdj: -0.034, adjustedPsf: 1503.44, weightShare: 0.062 }),
    row({ ring: 2, bedrooms: 2, date: "2025-10-16", sizeSqft: 1184.03, psf: 1541.2, timeAdj: 0.055, sizeAdj: -0.047, bedroomAdj: -0.034, adjustedPsf: 1496.86, weightShare: 0.048 }),
  ],
  comparablesTotal: 11,
};

export const FIXTURE_ACS_LEAD: AcsView = {
  ...FIXTURE_ACS_FEW,
  scenario: "enough",
  rangeLowPsf: 1550,
  rangeHighPsf: 1970,
  verdict: "within",
  evidence: { lead: 1, sales: 12, ownSales: 12, otherBedroomSales: 0, projectSales: 0 },
  typicalSizeSqft: 1189.41,
  comparables: [
    ["2026-11-10", 1189.41, 1723.54, 0, 0.0054, 1732.82, 0.132],
    ["2026-10-02", 1205.56, 1650.69, 0.0443, 0.0044, 1731.39, 0.122],
    ["2026-09-01", 1189.41, 1647.88, 0.0464, 0.0054, 1733.55, 0.108],
    ["2026-08-04", 1173.26, 1704.65, 0.0391, 0.0063, 1782.46, 0.099],
    ["2026-07-07", 1216.32, 1644.31, 0.0428, 0.0038, 1721.2, 0.094],
    ["2026-06-02", 1162.5, 1720.43, 0.0502, 0.0069, 1819.26, 0.086],
    ["2026-05-05", 1243.23, 1608.71, 0.0561, 0.0023, 1702.87, 0.079],
    ["2026-04-07", 1189.41, 1664.69, 0.0633, 0.0054, 1779.62, 0.073],
    ["2026-03-03", 1227.08, 1670.63, 0.0688, 0.0032, 1791.28, 0.066],
    ["2026-02-03", 1151.74, 1736.5, 0.0742, 0.0075, 1879.34, 0.059],
    ["2026-01-05", 1189.41, 1681.51, 0.0791, 0.0054, 1824.31, 0.052],
    ["2025-06-10", 1189.41, 1597.43, 0.1262, 0.0054, 1808.75, 0.03],
  ].map(([date, sizeSqft, psf, timeAdj, sizeAdj, adjustedPsf, weightShare]) =>
    row({ bedrooms: 2, date: date as string, sizeSqft: sizeSqft as number, psf: psf as number, timeAdj: timeAdj as number, sizeAdj: sizeAdj as number, adjustedPsf: adjustedPsf as number, weightShare: weightShare as number }),
  ),
  comparablesTotal: 12,
};

export const FIXTURE_ACS_REFUSED: AcsView = {
  ...FIXTURE_ACS_FEW,
  shown: false,
  reason: "range_too_wide",
  rangeLowPsf: null,
  rangeHighPsf: null,
  verdict: null,
  tested: null,
  comparables: [],
  comparablesTotal: 0,
};
