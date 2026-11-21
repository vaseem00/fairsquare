import "server-only";
/**
 * The similar-buildings comparison of one listing (REAL_DATA.md section 15): the second tier. It
 * runs only after the same-building comparison, and only when that one could not give a verdict:
 * - "building": the building is matched but has fewer than the minimum same-bedroom sales ("thin");
 * - "project": the building was not matched ("none"), the listing is off-plan, and its words name one
 *   project of the data (`resolveProject`): a range from the other buildings of that project
 *   (`compareProjectRoute`, REAL_DATA.md section 15.8). Shown only when that range passes its rule;
 *   otherwise the "area" scenario below runs as before.
 * - "area": the building was not matched ("none"); the listing's area text is resolved to a DLD area.
 *   With the shipped rule this never shows a range (other buildings of an area or a community alone
 *   mislead for a building that is not in the data), so the page keeps "Not covered yet"; the stored
 *   entry says why, and names the candidate areas when the text was ambiguous.
 * Returns null when the second tier does not apply at all: a verdict exists, the tier is switched off
 * (SIMILAR_TIER=off), no model is loaded, the model does not belong to the loaded sales, its constants
 * are of a version this build no longer shows or are too old for the data, or the window is not the
 * model's.
 */
import type { Db } from "@/lib/db/client";
import { readSimilarModel, similarArea, similarKey, similarProjectIndex } from "@/lib/db/repo/similar";
import { resolveArea } from "@/lib/domain/area";
import { resolveProject } from "@/lib/domain/project";
import { compareProjectRoute, projectRouteComparables } from "@/lib/domain/project-route";
import { diffDays, type IsoDate } from "@/lib/domain/dates";
import { compareSimilar, similarComparables, type SimilarBasis, type SimilarComparable, type SimilarResult } from "@/lib/domain/similar";
import { getEnv } from "@/lib/env";
import { displayArea, displayName } from "@/lib/ingest/identity";
import { AREA_ALIASES, domainConstants, PROJECT_ROUTE_MIN_VERSION, SIMILAR_MAX_FIT_AGE_DAYS, SIMILAR_MIN_CONSTANTS_VERSION, type SimilarModelMeta } from "@/lib/similar/model";
import type { CheckBand, SimilarView } from "@/lib/types";
import { SIMILAR_COMPARABLES_MAX } from "@/lib/validation/api";

export interface SimilarInput {
  /** The same-building result: the second tier runs for "thin" and "none" only. */
  band: CheckBand;
  /** The matched building, or null ("None of these"). */
  building: { id: number; area: string } | null;
  /** The listing's area as written; read only when there is no building. */
  areaText: string | null;
  /** The listing's building as written; read only when there is no building (the project route). */
  buildingText?: string | null;
  /** The completion the listing states; the project route runs for "off_plan" only (never for an unknown one). */
  completion?: "ready" | "off_plan" | "unknown";
  bedrooms: number;
  basis: SimilarBasis;
  askingPsf: number;
  /** The same-building comparison's window; null when no sales data is loaded. */
  window: { start: IsoDate; end: IsoDate } | null;
}

function base(model: SimilarModelMeta, scenario: SimilarView["scenario"]): SimilarView {
  return {
    v: 1,
    modelVersion: model.constants.version,
    scenario,
    shown: false,
    reason: "no_evidence",
    tier: null,
    level: null,
    place: null,
    comparableBuildings: 0,
    comparableSales: 0,
    rangeLowPsf: null,
    rangeHighPsf: null,
    verdict: null,
    evidence: { ownSales: 0, olderSales: 0, otherBedroomSales: 0 },
    windowStart: model.windowStart,
    windowEnd: model.dataThrough,
    area: null,
    areaCandidates: [],
    tested: null,
    comparables: [],
    comparableSpan: null,
    project: null,
  };
}

/** The stored view of a domain result. The centre and the unrounded bounds stay on the server. */
function viewOf(model: SimilarModelMeta, scenario: SimilarView["scenario"], r: SimilarResult, place: string | null, comparables: SimilarComparable[]): SimilarView {
  return {
    ...base(model, scenario),
    shown: r.shown,
    reason: r.reason,
    tier: r.tier,
    level: r.level,
    place: r.level === null || r.level === "project" ? null : place,
    comparableBuildings: r.comparableBuildings,
    comparableSales: r.comparableSales,
    rangeLowPsf: r.rangeLowPsf,
    rangeHighPsf: r.rangeHighPsf,
    verdict: r.verdict,
    evidence: {
      ownSales: r.evidence.ownSales?.n ?? 0,
      olderSales: (r.evidence.older12to24?.n ?? 0) + (r.evidence.older24to36?.n ?? 0),
      otherBedroomSales: r.evidence.otherBedrooms?.n ?? 0,
    },
    tested: r.shown ? { heldOf10: model.backtest.statement.heldOf10, heldLaterOf10: model.backtest.statement.heldLaterOf10 } : null,
    // Named only beside a shown range: a refusal shows nothing. `building.building` is the name as shown (buildings.name).
    comparables: r.shown
      ? comparables.slice(0, SIMILAR_COMPARABLES_MAX).map((x) => ({ name: x.building.building, sales: x.sales, medianPsf: Math.round(x.medianPsf) }))
      : [],
    comparableSpan:
      r.shown && comparables.length > 0
        ? { lowPsf: Math.round(Math.min(...comparables.map((x) => x.medianPsf))), highPsf: Math.round(Math.max(...comparables.map((x) => x.medianPsf))) }
        : null,
  };
}

export async function similarFor(db: Db, input: SimilarInput): Promise<SimilarView | null> {
  if (input.band !== "thin" && input.band !== "none") return null;
  if (getEnv().SIMILAR_TIER === "off") return null;
  if (!input.window) return null;
  const loaded = await readSimilarModel(db);
  if (!loaded) return null;
  const { model } = loaded;
  if (model.constants.version < SIMILAR_MIN_CONSTANTS_VERSION) return null;
  // The cells describe the 12 months to data_through: the comparison must be about the same months.
  if (input.window.end !== model.dataThrough || input.window.start !== model.windowStart) return null;
  if (diffDays(model.constants.fittedOn.dataThrough, model.dataThrough) > SIMILAR_MAX_FIT_AGE_DAYS) return null;
  const constants = domainConstants(model.constants);
  const request = { bedrooms: input.bedrooms, basis: input.basis, askingPsf: input.askingPsf };

  if (input.building) {
    if (input.band !== "thin") return null;
    const artifact = await similarArea(db, { buildingId: input.building.id }, input.basis, model);
    const key = similarKey(input.building.id);
    const at = artifact.buildings.findIndex((b) => b.key === key);
    // A building with 5 or more sales in its cell has a same-building verdict in the open data; a
    // "thin" band beside it means the two disagree (other rules, or sales added by hand): say nothing.
    if (at >= 0 && artifact.cells.some((c) => c.b === at && c.bed === input.bedrooms && c.n12 > 4)) return null;
    const r = compareSimilar(artifact, constants, { ...request, buildingKey: key });
    const comparables = r.shown ? similarComparables(artifact, constants, { ...request, buildingKey: key }) : [];
    const b = at >= 0 ? artifact.buildings[at] : null;
    const place = r.level === "community" && b?.masterProject ? displayName(b.masterProject) : r.level === "area" ? input.building.area : null;
    return viewOf(model, "building", r, place, comparables);
  }

  const area = resolveArea(input.areaText, AREA_ALIASES);

  // The project route (REAL_DATA.md section 15.8): off-plan only, and only from constants that carry it.
  const route = model.constants.projectRoute;
  if (route && model.constants.version >= PROJECT_ROUTE_MIN_VERSION && input.completion === "off_plan" && input.basis === route.basis && input.bedrooms <= route.maxBedrooms) {
    const index = await similarProjectIndex(db, model);
    const p = resolveProject({ buildingText: input.buildingText, areaText: input.areaText, areaDld: area.status === "resolved" ? area.areaDld : null }, index);
    if (p.status === "resolved") {
      const artifact = await similarArea(db, { areaDld: p.group.areaDld }, input.basis, model);
      const req = { ...request, areaDld: p.group.areaDld, projectNumbers: p.group.projectNumbers };
      const r = compareProjectRoute(artifact, constants, route, req);
      if (r.shown) {
        const name = displayName(p.group.name);
        return { ...viewOf(model, "project", r, null, projectRouteComparables(artifact, route, req)), tested: { heldOf10: route.heldOf10, heldLaterOf10: route.heldOf10 }, project: { name, areaDld: p.group.areaDld } };
      }
    }
  }

  if (area.status === "unresolved") return { ...base(model, "area"), reason: "area_unresolved" };
  if (area.status === "ambiguous") return { ...base(model, "area"), reason: "area_ambiguous", areaCandidates: area.candidates };
  const resolved = { areaDld: area.areaDld, masterProject: area.masterProject };
  // Other buildings of an area or a community alone are never shown (REAL_DATA.md section 15.3):
  // while that holds there is nothing to compute, so the cells are not read.
  if (constants.neverShownClasses.includes("community") && constants.neverShownClasses.includes("area")) {
    return { ...base(model, "area"), reason: "no_building_evidence", area: resolved };
  }
  const artifact = await similarArea(db, { areaDld: area.areaDld }, input.basis, model);
  const scope = { areaDld: area.areaDld, ...(area.masterProject ? { masterProject: area.masterProject } : {}) };
  const r = compareSimilar(artifact, constants, { ...request, scope });
  const comparables = r.shown ? similarComparables(artifact, constants, { ...request, scope }) : [];
  const place = r.level === "community" && area.masterProject ? displayName(area.masterProject) : r.level === "area" ? displayArea(area.areaDld) : null;
  return { ...viewOf(model, "area", r, place, comparables), area: resolved };
}
