/**
 * The similar-buildings model as shipped (REAL_DATA.md section 15): the fitted constants, the summary
 * of the verified backtest and the area alias table, with the Zod schemas that guard them wherever
 * they are read back (manifest.json, app_meta). No I/O and no server imports: `npm run data:build`
 * copies the constants and the summary into the snapshot's manifest, and the server uses the copy
 * that was loaded with the cells, so the constants always belong to the loaded data.
 */
import { z } from "zod";
import type { AreaAlias } from "@/lib/domain/area";
import { isIsoDate } from "@/lib/domain/dates";
import type { SimilarConstants } from "@/lib/domain/similar";
import aliasesJson from "./area-aliases.json";
import backtestJson from "./backtest.json";
import constantsJson from "./constants.json";

/** The format of the cells file and of the result stored with a comparison. */
export const SIMILAR_VERSION = 1;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const IsoDate = z.string().refine(isIsoDate, { error: "not a YYYY-MM-DD date" });
const Positive = z.number().positive();
const Pair = z.tuple([z.number().min(0), z.number().min(0)]);
const Triple = z.tuple([z.number().min(0), Positive, Positive]);
const ByBasis = <T extends z.ZodType>(v: T) => z.object({ ready: v, off_plan: v });
const Variances = (keys: readonly string[]) => ByBasis(z.object(Object.fromEntries(keys.map((k) => [k, Positive]))));
const BUCKETS = ["1", "2", "3", "4", "5", "6"] as const;

/**
 * The project route for buildings that are not in the data (REAL_DATA.md section 15.8), from version 4.
 * The range is [reference + lowLog, reference + highLog] around the median of the project's other
 * buildings; `heldOf10` is the tested statement (the lowest out-of-sample share, rounded down).
 */
export const ProjectRouteSchema = z.looseObject({
  basis: z.literal("off_plan"),
  maxBedrooms: z.number().int().min(0),
  minBuildings: z.number().int().positive(),
  minComparableSales: z.number().int().positive(),
  lowLog: z.number().max(0),
  highLog: z.number().min(0),
  heldOf10: z.number().int().min(1).max(10),
});
export type ProjectRoute = z.output<typeof ProjectRouteSchema>;

/** The constants file. Extra keys (the reference tables of the fit) are kept as they are. */
export const SimilarConstantsSchema = z.looseObject({
  version: z.number().int().positive(),
  fittedOn: z.looseObject({ dataThrough: IsoDate, snapshotSha256: Sha256 }),
  minComparableSales: z.number().int().positive(),
  levelMinBuildings: z.object({ project: z.number().int().positive(), community: z.number().int().positive(), area: z.number().int().positive() }),
  maxBedrooms: z.number().int().min(0),
  countBuckets: z.array(z.number().int().positive()).length(6),
  spreadDivisor: Positive,
  otherBedroomsWeightK: Positive,
  referenceVariance: z.object({ project: ByBasis(Pair), community: ByBasis(Pair), area: ByBasis(Pair) }),
  evidenceVariance: z.object({
    own: Variances(["1", "2", "3", "4"]),
    older12to24: Variances(BUCKETS),
    older24to36: Variances(BUCKETS),
    otherBedrooms: Variances(BUCKETS),
  }),
  range80: z.object({ project: Triple, community: Triple, area: Triple, own: Triple, indirect: Triple }),
  maxHalfWidth: Positive,
  closeHalfWidth: Positive,
  neverShownClasses: z.array(z.enum(["project", "community", "area", "own", "indirect"])),
  displayRounding: Positive,
  /** The consistency rules of version 2 (REAL_DATA.md section 15.3); absent in version 1. */
  requireEvidenceBeyondOwnSales: z.boolean().optional(),
  maxOwnMedianRatio: z.number().min(1).optional(),
  ownMedianInsideRange: z.boolean().optional(),
  /** The project route (version 4 and later); absent: buildings that are not in the data get no range. */
  projectRoute: ProjectRouteSchema.optional(),
});
export type SimilarConstantsFile = z.output<typeof SimilarConstantsSchema>;

/** The backtest summary. Only what the product reads is checked; the rest is carried for the docs and the admin. */
export const SimilarBacktestSchema = z.looseObject({
  fittedOn: z.looseObject({ dataThrough: IsoDate, snapshotSha256: Sha256 }),
  statement: z.looseObject({ heldOf10: z.number().int().min(1).max(10), heldLaterOf10: z.number().int().min(1).max(10) }),
});
export type SimilarBacktest = z.output<typeof SimilarBacktestSchema>;

/** The `similar` section of manifest.json (REAL_DATA.md section 3). */
export const SimilarManifestSchema = z.object({
  version: z.literal(SIMILAR_VERSION),
  /** The day of the build (`--built`, default the download day so that a rebuild gives the same bytes). */
  builtOn: IsoDate,
  /** dataThrough - 365 days: the first day of the cells' 12 months. */
  windowStart: IsoDate,
  cellsFile: z.object({ sha256: Sha256, rows: z.number().int().min(0) }),
  /** Buildings with at least one cell. */
  buildings: z.number().int().min(0),
  constants: SimilarConstantsSchema,
  backtest: SimilarBacktestSchema,
});
export type SimilarManifest = z.output<typeof SimilarManifestSchema>;

/** app_meta.similar_model: the manifest section plus the snapshot it was loaded with. */
export const SimilarModelMetaSchema = SimilarManifestSchema.extend({ snapshotSha256: Sha256, dataThrough: IsoDate });
export type SimilarModelMeta = z.output<typeof SimilarModelMetaSchema>;

/** The constants and the backtest summary in the repository (what the next `npm run data:build` ships). */
export const SIMILAR_CONSTANTS: SimilarConstantsFile = SimilarConstantsSchema.parse(constantsJson);
export const SIMILAR_BACKTEST: SimilarBacktest = SimilarBacktestSchema.parse(backtestJson);

/** The constants in the shape the domain function takes. */
export function domainConstants(c: SimilarConstantsFile): SimilarConstants {
  return c as unknown as SimilarConstants;
}

export const AREA_ALIASES: readonly AreaAlias[] = Object.freeze((aliasesJson as { aliases: AreaAlias[] }).aliases);

/**
 * The constants are fitted to one market. With data that runs to more than this many days after the
 * fit, the server stops showing the second tier and `npm run data:build` says so (refit at least
 * twice a year, REAL_DATA.md section 15.7).
 */
export const SIMILAR_MAX_FIT_AGE_DAYS = 200;

/**
 * The oldest constants version the server still shows, new or stored. Version 1 had no consistency
 * rules and showed the project class (review of 19 Nov 2026): a model or a stored range of an older
 * version is treated as absent, so a tightened rule also withdraws what was stored before it.
 */
export const SIMILAR_MIN_CONSTANTS_VERSION = 2;

export { PROJECT_ROUTE_MIN_VERSION } from "./project-version";
