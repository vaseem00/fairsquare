/**
 * Adjusted registered sales (REAL_DATA.md section 16): the fit as shipped (`constants.json`: the
 * method's parameters, the range multipliers, the rule and the tested statement) and the Zod schemas
 * that guard the model wherever it is read back (acs-model.json.gz, manifest.json, app_meta).
 * No I/O and no server imports.
 *
 * Two parts with different lifetimes:
 * - the fit is made by the Python backtest (scripts/model/acs) and expires: with data more than
 *   ACS_MAX_FIT_AGE_DAYS after it, `npm run data:build` exits with an error and the server does not
 *   use the model;
 * - the snapshot statistics (time index, size slopes, project families) are rebuilt by every
 *   `npm run data:build` (src/lib/acs/build.ts) and belong to one snapshot.
 */
import { z } from "zod";
import { isIsoDate } from "@/lib/domain/dates";
import type { AcsModel } from "@/lib/domain/acs";
import constantsJson from "./constants.json";

/** The format of acs-model.json. */
export const ACS_MODEL_VERSION = 2;
/** The format of the result stored with a comparison (`checks.acs_view`). */
export const ACS_VIEW_VERSION = 1;
/** The file of the model next to sales.csv.gz. */
export const ACS_MODEL_FILE = "acs-model.json.gz";
/** Day numbers count from here. */
export const ACS_EPOCH = "2020-01-01";

/**
 * With data that runs to more than this many days after the fit, the server stops using the model and
 * `npm run data:build` says so (refit at least twice a year, as the second tier).
 */
export const ACS_MAX_FIT_AGE_DAYS = 200;

/**
 * The oldest constants version the server still uses and shows, new or stored. Raise it only when
 * ranges stored with older constants must stop showing.
 */
export const ACS_MIN_CONSTANTS_VERSION = 1;

/**
 * The backtest followed prices for 183 days after each data date, and the range held less as the data
 * aged: off-plan sales 123 to 183 days after the data date were inside it in 79.7% of cases, under the
 * "about 8 of 10" the page states (REAL_DATA.md section 16.7). A comparison made more than 122 days
 * after the data date therefore gets today's answer instead.
 */
export const ACS_MAX_DATA_AGE_DAYS = 122;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const IsoDate = z.string().refine(isIsoDate, { error: "not a YYYY-MM-DD date" });
const Finite = z.number().refine(Number.isFinite, { error: "not a finite number" });
const Positive = Finite.refine((n) => n > 0, { error: "not positive" });

export const AcsParamsSchema = z.object({
  nmax: z.number().int().positive(),
  size_lo: Positive,
  size_hi: Positive,
  age_half: Positive,
  size_half: Positive,
  W0: Positive,
  r3: Positive,
  r2: Positive,
  bed2: Positive,
  lam: Positive,
  cap: Positive,
  slope_lo: Finite,
  slope_hi: Finite,
});

export const AcsRangeSchema = z.object({
  floor: Positive,
  d0: Positive,
  k0: Positive,
  thinW: Positive,
  oldAge: Positive,
  farLsr: Positive,
  q: z.record(z.string().regex(/^[01](\|\d){1,4}$/), z.tuple([Positive, Positive])),
  minComps: z.number().int().positive(),
  minWeight: Positive,
  minWeightKnown: Positive,
  minOwn: z.number().int().min(0),
  maxLsr: Positive,
  typLo: Positive,
  typHi: Positive,
  maxHalfWidth: Positive,
  maxBedrooms: z.number().int().min(0),
  refuseClasses: z.array(z.number().int()),
  rounding: Positive,
  nominal: z.array(Positive).length(2).optional(),
});

const FittedOn = z.looseObject({ dataThrough: IsoDate, snapshotSha256: Sha256 });
/** Of 10 later registered sales, how many were inside the range: over all tested data dates, and at the later ones. */
const Tested = z.looseObject({ heldOf10: z.number().int().min(1).max(10), heldLaterOf10: z.number().int().min(1).max(10) });

/** `src/lib/acs/constants.json`. Extra keys (the reference tables of the fit) are kept as they are. */
export const AcsConstantsSchema = z.looseObject({
  version: z.number().int().positive(),
  fittedOn: FittedOn,
  params: AcsParamsSchema,
  range: AcsRangeSchema,
  tested: Tested,
});
export type AcsConstantsFile = z.output<typeof AcsConstantsSchema>;

/** The fit in the repository (what the next `npm run data:build` ships). */
export const ACS_CONSTANTS: AcsConstantsFile = AcsConstantsSchema.parse(constantsJson);

const Months = z.array(Finite).length(48);
const Beds = z.array(Finite).length(5);

/** acs-model.json: the model of one snapshot with the fit and the snapshot it belongs to. */
export const AcsModelFileSchema = z
  .object({
    version: z.literal(ACS_MODEL_VERSION),
    kind: z.literal("acs-model"),
    dataThrough: IsoDate,
    epoch: z.literal(ACS_EPOCH),
    T: z.number().int().positive(),
    poolFromDay: z.number().int(),
    params: AcsParamsSchema,
    range: AcsRangeSchema,
    areas: z.array(z.string().min(1)),
    tau: z.array(Months).length(2),
    theta: z.record(z.string().regex(/^\d+\|[01]$/), Months),
    seg: z.array(Beds).length(2),
    beta2: z.array(Finite).length(2),
    prem: z.array(Beds).length(2),
    buildings: z.object({
      key: z.array(z.string().min(1)),
      area: z.array(z.number().int().min(0)),
      family: z.array(z.number().int().min(0)),
    }),
    cellSlope: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0).max(7), z.union([z.literal(0), z.literal(1)]), Finite, Finite])),
    /** The fit this model was built with. */
    constantsVersion: z.number().int().positive(),
    fittedOn: FittedOn,
    tested: Tested,
    /** The sales file the snapshot statistics were computed from. */
    snapshotSha256: Sha256,
  })
  .refine((m) => m.buildings.area.length === m.buildings.key.length && m.buildings.family.length === m.buildings.key.length, { error: "buildings: lists of unequal length" })
  .refine((m) => new Set(m.buildings.key).size === m.buildings.key.length, { error: "buildings: a key is there twice" })
  .refine((m) => m.buildings.area.every((a) => a < m.areas.length), { error: "buildings: an area index is out of range" });
export type AcsModelFile = z.output<typeof AcsModelFileSchema>;

/** The `acs` section of manifest.json. */
export const AcsManifestSchema = z.object({
  version: z.literal(ACS_MODEL_VERSION),
  modelFile: z.object({ sha256: Sha256, bytes: z.number().int().positive() }),
  constantsVersion: z.number().int().positive(),
  fittedOn: FittedOn,
  /** Buildings, DLD areas with a time index, and building types with a size slope of their own. */
  buildings: z.number().int().min(0),
  areaIndexes: z.number().int().min(0),
  cellSlopes: z.number().int().min(0),
  /** The cleaned sales of the 1,461 days to the data date the time index was fitted on. */
  indexSales: z.number().int().min(0),
  /** The date of the earliest of those sales (absent in a manifest written before 19 Nov 2026). */
  indexFrom: IsoDate.optional(),
});
export type AcsManifest = z.output<typeof AcsManifestSchema>;

/** The model file as the domain functions take it. */
export function domainModel(m: AcsModelFile): AcsModel {
  return m as unknown as AcsModel;
}
