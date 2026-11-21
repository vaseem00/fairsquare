/**
 * Nearby registered sales (REAL_DATA.md section 17): the fit as shipped (`constants.json`, a copy of
 * scripts/model/nearby/constants.json: the method's parameters, the rule, the building-age curves, the
 * range multipliers and the tested statement) and its limits. No I/O and no server imports.
 *
 * Nothing of it is built per snapshot: the method reads the `sales` and `buildings` tables and the
 * time index and size slopes of the adjusted-registered-sales model (acs-model.json.gz), which every
 * `npm run data:build` rebuilds. Only the constants expire: with data more than
 * NEARBY_MAX_FIT_AGE_DAYS after the fit, `npm run data:build` exits with an error and the server does
 * not use them.
 */
import { z } from "zod";
import { isIsoDate } from "@/lib/domain/dates";
import type { NearbyConstants } from "@/lib/domain/nearby";
import constantsJson from "./constants.json";

/** The format of the result stored with a comparison (`checks.nearby_view`). */
export const NEARBY_VIEW_VERSION = 1;

/** With data that runs to more than this many days after the fit, the server stops using the constants (as adjusted registered sales). */
export const NEARBY_MAX_FIT_AGE_DAYS = 200;

/**
 * The oldest constants version the server still uses and shows, new or stored. Raise it only when
 * ranges stored with older constants must stop showing.
 */
export const NEARBY_MIN_CONSTANTS_VERSION = 1;

/**
 * The range was tested on sales up to 183 days after each data date; like adjusted registered sales,
 * a comparison made more than 122 days after the data date gets today's page instead.
 */
export const NEARBY_MAX_DATA_AGE_DAYS = 122;

const IsoDate = z.string().refine(isIsoDate, { error: "not a YYYY-MM-DD date" });
const Finite = z.number().refine(Number.isFinite, { error: "not a finite number" });
const Positive = Finite.refine((n) => n > 0, { error: "not positive" });
const Curve = z.array(Finite).min(2);
const Multipliers = z.record(z.string().regex(/^[RO](a|b|t|c[012])$/), z.tuple([Positive, Positive]));

/** `src/lib/nearby/constants.json`. Extra keys (the reference tables of the fit) are kept as they are. */
export const NearbyConstantsSchema = z
  .looseObject({
    version: z.number().int().positive(),
    kind: z.literal("nearby-constants"),
    fittedOn: IsoDate,
    params: z.object({
      windowDays: z.number().int().positive(),
      ageHalfMonths: Positive,
      sizeHalf: Positive,
      cap: Positive,
      areaWeight: Positive,
      vintageHalfYears: Positive,
      minCommunityBuildings: z.number().int().positive(),
      countWeight: Positive,
      floor: Positive,
      far: z.tuple([Positive, Positive]),
      thinBuildings: z.number().int().positive(),
    }),
    rule: z.object({
      maxBedrooms: z.number().int().min(0),
      minBuildings: z.number().int().positive(),
      minWeight: Positive,
      maxSizeDistance: Positive,
      maxHalfWidth: Positive,
      rounding: Positive,
    }),
    vintage: z.object({ readyAges: Curve, ready: Curve, offPlanAges: Curve, offPlan: Curve }),
    range: z.object({ in: Multipliers, out: Multipliers }),
    /** `heldOf10` is the number the page may state: of 10 later registered sales, how many were inside the range. */
    tested: z.looseObject({ heldOf10: z.number().int().min(1).max(10) }),
  })
  .refine((c) => c.vintage.readyAges.length === c.vintage.ready.length && c.vintage.offPlanAges.length === c.vintage.offPlan.length, { error: "vintage: lists of unequal length" });
export type NearbyConstantsFile = z.output<typeof NearbyConstantsSchema>;

/** The fit in the repository. */
export const NEARBY_CONSTANTS: NearbyConstantsFile = NearbyConstantsSchema.parse(constantsJson);

/** The constants as the domain function takes them. */
export function nearbyDomainConstants(c: NearbyConstantsFile = NEARBY_CONSTANTS): NearbyConstants {
  return c as unknown as NearbyConstants;
}
