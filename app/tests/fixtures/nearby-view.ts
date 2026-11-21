/**
 * Nearby-registered-sales results (REAL_DATA.md section 17, DESIGN.md section 6.18) for UI tests.
 * Synthetic names and numbers; no alias imports except a type, so Playwright can load it too.
 *
 * - FIXTURE_NEARBY_OUT: a building that is not in the data (kind "out"): 14 sales in 4 other buildings
 *   of a community, no building-age adjustment.
 * - FIXTURE_NEARBY_IN: a chosen building with too few sales (kind "in"): the same sales, each also
 *   adjusted for the age of its building, read from the community and the rest of its area.
 * - FIXTURE_NEARBY_REFUSED: no range (the page must then be exactly what it was).
 */
import type { NearbyComparableView, NearbyView } from "@/lib/types";

const ROWS: Array<[building: string, date: string, size: number, psf: number, timeAdj: number, sizeAdj: number, adjusted: number, share: number]> = [
  ["Test Court 1", "2026-11-03", 1304.37, 1277.07, 0, -0.0528, 1209.67, 0.1488],
  ["Test Court 2", "2026-10-07", 1295.33, 1405.05, -0.0017, -0.0554, 1324.95, 0.1284],
  ["Test Plaza Tower 2", "2026-05-20", 1489.62, 1359.41, -0.0118, -0.0004, 1342.9, 0.1063],
  ["Test Plaza Tower 2", "2026-02-16", 1428.15, 1417.92, -0.0614, -0.0173, 1307.78, 0.0922],
  ["Test Court 2", "2026-09-17", 1067.89, 1334.41, -0.0017, -0.1266, 1163.59, 0.0863],
  ["Test Gardens A", "2026-08-11", 1502.1, 1190.3, 0.004, 0.0021, 1197.58, 0.0801],
  ["Test Gardens A", "2026-06-23", 1466.4, 1215.8, -0.0092, -0.0047, 1198.94, 0.0712],
  ["Test Court 1", "2026-04-02", 1388.2, 1301.6, -0.0301, -0.0204, 1236.67, 0.0655],
  ["Test Heights", "2026-07-15", 1611.9, 1525.4, -0.0061, 0.0224, 1550.02, 0.0577],
  ["Test Heights", "2026-03-09", 1575.3, 1498.2, -0.0422, 0.0158, 1457.61, 0.0493],
  ["Test Plaza Tower 2", "2025-12-18", 1440.6, 1290.5, -0.0519, -0.0098, 1211.53, 0.0418],
  ["Test Gardens A", "2025-10-04", 1520.8, 1120.4, 0.0312, 0.0056, 1161.83, 0.0331],
  ["Test Court 1", "2025-07-27", 1350.5, 1180.9, 0.0648, -0.0283, 1221.84, 0.0241],
  ["Test Heights", "2025-03-11", 1602.4, 1345.7, 0.0911, 0.0207, 1498.69, 0.0152],
];

const row = (r: (typeof ROWS)[number], ageAdj = 0): NearbyComparableView => ({ building: r[0], date: r[1], sizeSqft: r[2], psf: r[3], timeAdj: r[4], sizeAdj: r[5], ageAdj, adjustedPsf: r[6], weightShare: r[7] });

export const FIXTURE_NEARBY_OUT: NearbyView = {
  v: 1,
  constantsVersion: 1,
  dataThrough: "2026-11-10",
  windowFrom: "2024-11-11",
  kind: "out",
  shown: true,
  reason: null,
  scope: "community",
  community: "Test Science Park",
  area: "Test Barsha South",
  rangeLowPsf: 990,
  rangeHighPsf: 1770,
  verdict: "above",
  ageAdjusted: false,
  tested: { heldOf10: 7 },
  buildings: [
    { name: "Test Court 2", sales: 3, weightShare: 0.2147 },
    { name: "Test Plaza Tower 2", sales: 3, weightShare: 0.2403 },
    { name: "Test Court 1", sales: 3, weightShare: 0.2384 },
    { name: "Test Gardens A", sales: 3, weightShare: 0.1844 },
    { name: "Test Heights", sales: 2, weightShare: 0.1222 },
  ].sort((a, b) => b.weightShare - a.weightShare),
  buildingsTotal: 5,
  comparables: ROWS.map((r) => row(r)),
  comparablesTotal: 14,
};

export const FIXTURE_NEARBY_IN: NearbyView = {
  ...FIXTURE_NEARBY_OUT,
  kind: "in",
  scope: "community_and_area",
  rangeLowPsf: 1130,
  rangeHighPsf: 1620,
  verdict: "within",
  ageAdjusted: true,
  comparables: ROWS.map((r, i) => row(r, i % 3 === 0 ? 0.0312 : i % 3 === 1 ? -0.0145 : 0)),
};

export const FIXTURE_NEARBY_REFUSED: NearbyView = {
  ...FIXTURE_NEARBY_OUT,
  shown: false,
  reason: "too_few_buildings",
  rangeLowPsf: null,
  rangeHighPsf: null,
  verdict: null,
  tested: null,
  buildings: [],
  buildingsTotal: 0,
  comparables: [],
  comparablesTotal: 0,
};
