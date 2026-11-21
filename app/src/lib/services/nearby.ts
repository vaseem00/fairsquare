import "server-only";
/**
 * Nearby registered sales for one listing (REAL_DATA.md section 17): the last resort. The caller
 * (`runCheck`) asks only when nothing else gave a comparison: the same-building result is "too few"
 * or "not covered", adjusted registered sales shows no range and the second tier shows none.
 *
 * Two kinds (scripts/model/nearby/SPEC.md):
 * - "in": a building was chosen. Its community (master project) and DLD area are the building's own,
 *   and its own sales are never comparables.
 * - "out": no building was chosen. The listing's area text is resolved to a DLD area and, when it is
 *   named, a community (`resolveArea`, the resolver of the second tier); when that names no community,
 *   the project resolver of the project route may add one. When nothing resolves the entry says why
 *   (`area_unresolved`, `area_ambiguous`) and the page stays "Not covered yet".
 *
 * Returns null, and nothing is stored, when it does not run at all: it is switched off
 * (NEARBY_TIER=off), there is a verdict, no sales data or no model of the loaded snapshot is there
 * (the time index and the size slopes are the adjusted-registered-sales model's), the constants are
 * under NEARBY_MIN_CONSTANTS_VERSION or more than NEARBY_MAX_FIT_AGE_DAYS older than the data, the
 * comparison is not about the model's data date, or the data date is more than
 * NEARBY_MAX_DATA_AGE_DAYS before today. The page is then exactly what it was; it is that too when
 * the result here says `shown: false`.
 */
import type { Db } from "@/lib/db/client";
import { readAcsModel, type LoadedAcsModel } from "@/lib/db/repo/acs";
import { nearbySales } from "@/lib/db/repo/nearby";
import { readSimilarModel, similarProjectIndex } from "@/lib/db/repo/similar";
import { acsDate, acsDay } from "@/lib/domain/acs";
import { resolveArea } from "@/lib/domain/area";
import { addDays, diffDays, type IsoDate } from "@/lib/domain/dates";
import { estimateNearby, type NearbyIndex, type NearbySaleRow } from "@/lib/domain/nearby";
import { resolveProject } from "@/lib/domain/project";
import { getEnv } from "@/lib/env";
import { displayArea, displayName } from "@/lib/ingest/identity";
import { log } from "@/lib/log";
import { NEARBY_CONSTANTS, NEARBY_MAX_DATA_AGE_DAYS, NEARBY_MAX_FIT_AGE_DAYS, NEARBY_MIN_CONSTANTS_VERSION, NEARBY_VIEW_VERSION, nearbyDomainConstants } from "@/lib/nearby/model";
import { AREA_ALIASES } from "@/lib/similar/model";
import type { CheckBand, CompletionBasis, NearbyStored } from "@/lib/types";
import { NEARBY_BUILDINGS_MAX, NEARBY_COMPARABLES_MAX } from "@/lib/validation/api";

export interface NearbyInput {
  /** The same-building result: nearby runs for "thin" and "none" only. */
  band: CheckBand;
  /** The chosen building, or null ("None of these"). */
  building: {
    id: number;
    /** The area as shown ("Dubai Marina"). */
    area: string;
    areaDld: string | null;
    masterProject: string | null;
    firstSaleDate: IsoDate | null;
    firstReadySaleDate: IsoDate | null;
  } | null;
  /** The listing's area and building as written; read only when there is no building. */
  areaText: string | null;
  buildingText: string | null;
  bedrooms: number;
  basis: CompletionBasis;
  sizeSqft: number;
  askingPsf: number;
  today: IsoDate;
  /** The same-building comparison's window; null when no sales data is loaded. */
  window: { start: IsoDate; end: IsoDate } | null;
}

const round = (x: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/** Why nearby registered sales answers nothing at all right now (never shown; logged and on /how-it-works). */
export type NearbyInactiveReason = "switched_off" | "no_model" | "constants_withdrawn" | "fit_too_old" | "data_too_old";
export type NearbyStatus = { active: true; loaded: LoadedAcsModel } | { active: false; reason: NearbyInactiveReason };

let warned: string | null = null;

/** Tests: forget what was logged. */
export function __resetNearbyStatusForTests(): void {
  warned = null;
}

/**
 * Whether nearby registered sales can answer today: switched on, a model of the loaded snapshot (for
 * its time index and size slopes), constants that are not withdrawn and not more than
 * NEARBY_MAX_FIT_AGE_DAYS older than the data, and a data date not more than NEARBY_MAX_DATA_AGE_DAYS
 * before today. When loaded data cannot be used, that is logged once per snapshot and reason
 * (`nearby_inactive`).
 */
export async function nearbyStatus(db: Db, today: IsoDate): Promise<NearbyStatus> {
  if (getEnv().NEARBY_TIER === "off") return { active: false, reason: "switched_off" };
  const loaded = await readAcsModel(db);
  if (!loaded) return { active: false, reason: "no_model" };
  const { file } = loaded;
  const reason: NearbyInactiveReason | null =
    NEARBY_CONSTANTS.version < NEARBY_MIN_CONSTANTS_VERSION
      ? "constants_withdrawn"
      : diffDays(NEARBY_CONSTANTS.fittedOn, file.dataThrough) > NEARBY_MAX_FIT_AGE_DAYS
        ? "fit_too_old"
        : diffDays(file.dataThrough, today) > NEARBY_MAX_DATA_AGE_DAYS
          ? "data_too_old"
          : null;
  if (!reason) return { active: true, loaded };
  const key = `${file.snapshotSha256}:${reason}`;
  if (warned !== key) {
    warned = key;
    log.warn("nearby_inactive", { reason, dataThrough: file.dataThrough, fittedOn: NEARBY_CONSTANTS.fittedOn, today });
  }
  return { active: false, reason };
}

const indexes = new WeakMap<object, NearbyIndex>();

/** What the method reads from the loaded model, built once per model. */
function indexOf(loaded: LoadedAcsModel): NearbyIndex {
  let ix = indexes.get(loaded.file);
  if (!ix) {
    const f = loaded.file;
    ix = { T: f.T, areas: new Map(f.areas.map((a, i) => [a, i])), theta: f.theta, tau: f.tau, seg: f.seg };
    indexes.set(loaded.file, ix);
  }
  return ix;
}

type Place = { areaDld: string | null; masterProject: string | null; community: string | null; area: string | null };

/**
 * Where a listing with no building is: its area text resolved to a DLD area and, when named, a
 * community. When the text names no community (or nothing at all), the listing's words may name one
 * project of the data (the project route's resolver); its DLD area and community are then used, but
 * never against a resolved area that is another one.
 */
async function placeOfListing(db: Db, input: Pick<NearbyInput, "areaText" | "buildingText">): Promise<Place | { reason: "area_unresolved" | "area_ambiguous" }> {
  const area = resolveArea(input.areaText, AREA_ALIASES);
  let areaDld = area.status === "resolved" ? area.areaDld : null;
  let master = area.status === "resolved" ? area.masterProject : null;
  if (!master) {
    try {
      const similar = await readSimilarModel(db);
      if (similar) {
        const p = resolveProject({ buildingText: input.buildingText, areaText: input.areaText, areaDld }, await similarProjectIndex(db, similar.model));
        if (p.status === "resolved" && (areaDld === null || p.group.areaDld === areaDld)) {
          areaDld = p.group.areaDld;
          master = p.group.masterProject || null;
        }
      }
    } catch (err) {
      // The project is an extra: without it the area alone decides.
      log.warn("nearby_project_failed", { err });
    }
  }
  if (!areaDld) return { reason: area.status === "ambiguous" ? "area_ambiguous" : "area_unresolved" };
  return { areaDld, masterProject: master, community: master ? displayName(master) : null, area: displayArea(areaDld) };
}

export async function nearbyFor(db: Db, input: NearbyInput): Promise<NearbyStored | null> {
  if (input.band !== "thin" && input.band !== "none") return null;
  if (!input.window) return null;
  const status = await nearbyStatus(db, input.today);
  if (!status.active) return null;
  const { file } = status.loaded;
  // The sales are adjusted to the data date: the comparison must end there too.
  if (input.window.end !== file.dataThrough) return null;
  const constants = nearbyDomainConstants();
  const windowDays = constants.params.windowDays;

  const view: NearbyStored = {
    v: NEARBY_VIEW_VERSION,
    constantsVersion: NEARBY_CONSTANTS.version,
    dataThrough: file.dataThrough,
    windowFrom: addDays(file.dataThrough, 1 - windowDays),
    kind: input.building ? "in" : "out",
    shown: false,
    reason: "no_comparables",
    scope: null,
    community: null,
    area: null,
    rangeLowPsf: null,
    rangeHighPsf: null,
    verdict: null,
    ageAdjusted: false,
    tested: null,
    buildings: [],
    buildingsTotal: 0,
    comparables: [],
    comparablesTotal: 0,
    server: null,
  };

  let place: Place;
  if (input.building) {
    const b = input.building;
    place = {
      areaDld: b.areaDld || null,
      masterProject: b.masterProject || null,
      community: b.masterProject ? displayName(b.masterProject) : null,
      area: b.area || (b.areaDld ? displayArea(b.areaDld) : null),
    };
  } else {
    const p = await placeOfListing(db, input);
    if ("reason" in p) return { ...view, reason: p.reason };
    place = p;
  }
  const withPlace = { ...view, community: place.community, area: place.area };

  const db_rows = await nearbySales(db, {
    bedrooms: input.bedrooms,
    basis: input.basis,
    areaDld: place.areaDld,
    masterProject: place.masterProject,
    excludeBuildingId: input.building?.id ?? null,
    dataThrough: file.dataThrough,
    windowDays,
  });
  const day = (d: IsoDate | null) => (d ? acsDay(file.epoch, d) : null);
  const rows: NearbySaleRow[] = db_rows.map((r) => ({
    ref: r.ref,
    buildingId: r.buildingId,
    building: r.buildingName,
    areaDld: r.areaDld ?? "",
    day: acsDay(file.epoch, r.saleDate),
    sizeSqft: r.sizeSqft,
    priceAed: r.priceAed,
    firstSaleDay: day(r.firstSaleDate),
    firstReadySaleDay: day(r.firstReadySaleDate),
    inCommunity: !!place.masterProject && r.masterProject === place.masterProject,
    inArea: !!place.areaDld && r.areaDld === place.areaDld,
  }));
  const r = estimateNearby(
    indexOf(status.loaded),
    constants,
    {
      bedrooms: input.bedrooms,
      basis: input.basis === "off_plan" ? 1 : 0,
      sizeSqft: input.sizeSqft,
      askingPsf: input.askingPsf,
      own: input.building ? { firstSaleDay: day(input.building.firstSaleDate), firstReadySaleDay: day(input.building.firstReadySaleDate) } : null,
      masterKnown: !!place.masterProject,
      areaKnown: !!place.areaDld,
    },
    rows,
  );

  const out: NearbyStored = {
    ...withPlace,
    shown: r.shown,
    reason: r.reason,
    scope: r.scope ?? null,
    ageAdjusted: r.vintageAdjusted,
    server:
      r.centrePsf !== undefined && r.group !== undefined
        ? { centrePsf: r.centrePsf, lowPsf: r.lowPsf ?? null, highPsf: r.highPsf ?? null, halfWidth: r.halfWidth ?? null, group: r.group, buildings: r.buildings ?? 0, weight: r.weight ?? 0, sizeDistance: r.sizeDistance ?? 0 }
        : null,
  };
  if (!r.shown || r.rangeLowPsf === undefined || r.rangeHighPsf === undefined || !r.verdict) return { ...out, shown: false };
  return {
    ...out,
    rangeLowPsf: r.rangeLowPsf,
    rangeHighPsf: r.rangeHighPsf,
    verdict: r.verdict,
    tested: { heldOf10: NEARBY_CONSTANTS.tested.heldOf10 },
    buildings: r.buildingShares.slice(0, NEARBY_BUILDINGS_MAX).map((b) => ({ name: b.building, sales: b.sales, weightShare: round(b.weightShare, 5) })),
    buildingsTotal: r.buildingShares.length,
    comparables: r.rows.slice(0, NEARBY_COMPARABLES_MAX).map((c) => ({
      building: c.building,
      date: acsDate(file.epoch, c.day),
      sizeSqft: round(c.sizeSqft, 2),
      psf: round(c.registeredPsf, 2),
      timeAdj: round(Math.exp(c.timeLn) - 1, 5),
      sizeAdj: round(Math.exp(c.sizeLn) - 1, 5),
      ageAdj: round(Math.exp(c.vintageLn) - 1, 5),
      adjustedPsf: round(c.adjustedPsf, 2),
      weightShare: round(c.weightShare, 5),
    })),
    comparablesTotal: r.rows.length,
  };
}
