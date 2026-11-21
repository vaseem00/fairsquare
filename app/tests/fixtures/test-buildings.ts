/**
 * Synthetic buildings and sales for tests only (REAL_DATA.md section 0). These are the numbers of the
 * old demo seed with obviously made-up names: "Mockup Crest Tower" (2-bed, 11 sales: "above"), "Fake
 * Vista Residences" (1-bed, 9 sales: "in line") and "Dummyside Heights 2" (3-bed, 2 sales: "thin").
 * The names keep the old word lengths and share no word between families, so the matcher scores
 * them as it scored the old names. Plain data: no imports, so client-side fixtures can build on it.
 */

/** [daysAgo, sizeSqft, priceAed] */
export type TestSale = readonly [daysAgo: number, sizeSqft: number, priceAed: number];

export interface TestBuilding {
  readonly name: string;
  /** The area shown to people. */
  readonly area: string;
  /** The official DLD area name (buildings.area_dld). */
  readonly areaDld: string;
  readonly project: string;
  readonly masterProject: string;
  readonly aliases: readonly string[];
  readonly bedrooms: number;
  /** All ready (completed) sales. */
  readonly sales: readonly TestSale[];
}

export const TEST_BUILDINGS: readonly TestBuilding[] = [
  {
    name: "Mockup Crest Tower",
    area: "Dubai Marina",
    areaDld: "Marsa Dubai",
    project: "MOCKUP CREST",
    masterProject: "Dubai Marina",
    aliases: ["Mockup Crest", "Mockup Crest Twr"],
    bedrooms: 2,
    sales: [
      [40, 1262, 2140000],
      [57, 1284, 2090000],
      [76, 1310, 2310000],
      [95, 1198, 1935000],
      [113, 1284, 2180000],
      [140, 1262, 2010000],
      [182, 1340, 2295000],
      [228, 1284, 2150000],
      [274, 1198, 1985000],
      [312, 1310, 2235000],
      [340, 1262, 2085000],
    ],
  },
  {
    name: "Mockup Crest Tower 2",
    area: "Dubai Marina",
    areaDld: "Marsa Dubai",
    project: "MOCKUP CREST 2",
    masterProject: "Dubai Marina",
    aliases: ["Mockup Crest 2", "Mockup Crest II"],
    bedrooms: 2,
    sales: [
      [22, 1250, 2050000],
      [88, 1250, 1995000],
      [150, 1302, 2160000],
      [260, 1250, 1960000],
    ],
  },
  {
    name: "Fake Vista Residences",
    area: "Jumeirah Village Circle",
    areaDld: "Al Barsha South Fourth",
    project: "FAKE VISTA",
    masterProject: "Jumeirah Village Circle",
    aliases: ["Fake Vista Res", "Fake Vista JVC"],
    bedrooms: 1,
    sales: [
      [28, 742, 880000],
      [46, 760, 905000],
      [67, 735, 860000],
      [104, 742, 899000],
      [125, 780, 915000],
      [168, 742, 870000],
      [209, 735, 845000],
      [253, 760, 925000],
      [293, 742, 890000],
    ],
  },
  {
    name: "Fake Vista Residences 2",
    area: "Jumeirah Village Circle",
    areaDld: "Al Barsha South Fourth",
    project: "FAKE VISTA 2",
    masterProject: "Jumeirah Village Circle",
    aliases: ["Fake Vista Res 2"],
    bedrooms: 1,
    sales: [
      [35, 720, 830000],
      [120, 720, 815000],
      [200, 735, 842000],
    ],
  },
  {
    name: "Dummyside Heights 2",
    area: "Al Jaddaf",
    areaDld: "Al Jaddaf",
    project: "DUMMYSIDE HEIGHTS",
    masterProject: "Al Jaddaf",
    aliases: ["Dummyside Hts 2", "Dummyside Heights II"],
    bedrooms: 3,
    sales: [
      [110, 1880, 3150000],
      [279, 1905, 3240000],
    ],
  },
  {
    name: "Dummyside Heights 1",
    area: "Al Jaddaf",
    areaDld: "Al Jaddaf",
    project: "DUMMYSIDE HEIGHTS 1",
    masterProject: "Al Jaddaf",
    aliases: ["Dummyside Hts 1"],
    bedrooms: 3,
    sales: [
      [60, 1850, 3050000],
      [190, 1850, 3010000],
      [300, 1880, 3120000],
    ],
  },
];

/** The "today" the known results are stated for. */
export const TEST_TODAY = "2026-11-17";
