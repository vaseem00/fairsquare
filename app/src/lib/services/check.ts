import "server-only";
/**
 * POST /api/checks orchestration (A§4.3, WP3; REAL_DATA.md section 7): validate, load the building,
 * compare the asking price per sq ft with the median of same-bedroom sales of the same completion
 * basis (off-plan listings with off-plan sales; ready or unknown with ready sales) over the 12 months
 * ending at min(today, data_through), leaving unusual sales out, and store the comparison with the
 * sales it used, the unusual ones it set aside and where the size came from (`sizeSource`).
 * - Only when that comparison gives no verdict (too few sales, or no building) does the second tier
 *   run: the similar-buildings comparison (`similarFor`, REAL_DATA.md section 15), stored as
 *   `similar` beside the unchanged same-building result.
 * - For a matched building, adjusted registered sales runs too (`acsFor`, REAL_DATA.md section 16) and
 *   is stored as `acsView`. When it gives a range, that range is the first answer and decides above,
 *   within or below; the same-building result and the second tier are computed and stored as before
 *   either way, so the comparison still reads as it did when that answer is absent, refused,
 *   switched off (ACS_TIER=off) or withdrawn later.
 * - Only when none of the three gives a comparison to show (the same-building result is "too few" or
 *   "not covered", adjusted registered sales shows no range, the second tier shows none) does the last
 *   resort run: nearby registered sales (`nearbyFor`, REAL_DATA.md section 17), stored as `nearbyView`.
 *   With a range, the page gives its outcome and says that it comes from other buildings.
 * - Choosing "None of these" (buildingId null) stores a "none" comparison and **no** building
 *   request: the request is the person's explicit "Request it and track" (POST /api/requests), per A§0.2.
 * - While no sales data is loaded (no data_through) every comparison is "none" (not covered); it keeps
 *   its building, so its recomputed verdict appears once the data has loaded (`publicCheckView`:
 *   the /c page, GET /api/checks/[code] and the OG card show it with its sales).
 */
import { readDataMeta } from "@/lib/data-status";
import type { Db } from "@/lib/db/client";
import { ensureAnonUser } from "@/lib/db/repo/anon";
import { getBuilding, recentSales } from "@/lib/db/repo/buildings";
import { createCheck, SNAPSHOT_MAX, snapshotOf, toCheckView } from "@/lib/db/repo/checks";
import { checkIdForCode, trackEvent } from "@/lib/db/repo/events";
import type { SaleSnapshot } from "@/lib/db/schema";
import { analyseWith, comparisonWindow, completionBasis, type Rules, windowBounds } from "@/lib/domain/analyse";
import type { IsoDate } from "@/lib/domain/dates";
import { normaliseCode } from "@/lib/domain/share-code";
import { httpError } from "@/lib/http/errors";
import { log } from "@/lib/log";
import type { CheckBand, CheckRequest, CheckView } from "@/lib/types";
import { CheckRequestSchema, zodFieldErrors } from "@/lib/validation/api";
import { shownAcs } from "@/lib/acs/shown";
import { shownSimilar } from "@/lib/similar/shown";
import { acsFor } from "./acs";
import { nearbyFor } from "./nearby";
import { similarFor } from "./similar";

export interface RunCheckCtx {
  anonId: string;
  today: IsoDate;
  appUrl: string;
  rules: Rules;
}

/** Computes, stores and returns a comparison. Throws HttpError 422 / 404 for bad input. */
export async function runCheck(db: Db, req: CheckRequest, ctx: RunCheckCtx): Promise<CheckView> {
  const parsed = CheckRequestSchema.safeParse(req);
  if (!parsed.success) throw httpError("validation_failed", { fields: zodFieldErrors(parsed.error) });
  const body = parsed.data;
  const { fields } = body;

  const building = body.buildingId === null ? null : await getBuilding(db, body.buildingId);
  if (body.buildingId !== null && !building) throw httpError("building_not_found");

  const completion = body.completion ?? "unknown";
  const basis = completionBasis(completion);
  const { dataThrough } = await readDataMeta(db);
  const window = comparisonWindow(ctx.today, dataThrough, ctx.rules.windowDays);
  const { start, end } = window ?? windowBounds(ctx.today, ctx.rules.windowDays);
  const askingPsf = fields.priceAed / fields.sizeSqft;

  let band: CheckBand = "none";
  let medianPsf: number | null = null;
  let medianPriceAed: number | null = null;
  let medianSizeSqft: number | null = null;
  let diff: number | null = null;
  let salesCount = 0;
  let outliersDropped = 0;
  let snapshot: SaleSnapshot[] = [];
  let setAsideSnapshot: SaleSnapshot[] = [];

  if (building && window) {
    const rows = await recentSales(db, building.id, fields.bedrooms, basis, window);
    const { analysis: a, used, setAside } = analyseWith(fields.priceAed, fields.sizeSqft, rows, ctx.rules);
    band = a.band;
    medianPsf = a.medianPsf;
    medianPriceAed = a.medianPriceAed;
    medianSizeSqft = a.medianSizeSqft;
    diff = a.diff;
    salesCount = a.count;
    outliersDropped = a.outliersDropped;
    // Every sale behind the verdict, newest first, with where it came from (REAL_DATA.md section 9),
    // and the unusual ones it left out, which the list shows as "set aside" (RESULT_SPEC section 12.2).
    snapshot = used.slice(0, SNAPSHOT_MAX).map(snapshotOf);
    setAsideSnapshot = setAside.slice(0, SNAPSHOT_MAX).map(snapshotOf);
  }

  // The second tier, only when the same-building comparison gave no verdict.
  const similar = await similarFor(db, {
    band,
    building: building ? { id: building.id, area: building.area } : null,
    areaText: fields.areaText ?? null,
    buildingText: fields.buildingText,
    completion,
    bedrooms: fields.bedrooms,
    basis,
    askingPsf,
    window,
  });

  // The first answer: registered sales adjusted to this listing. Null when it does not run at all.
  // A failure here must not cost the comparison: the same-building result and the second tier above
  // are complete without it, so the page then shows exactly what it showed before this existed.
  let acs: Awaited<ReturnType<typeof acsFor>> = null;
  try {
    acs = await acsFor(db, {
      band,
      building: building ? { dldKey: building.dldKey } : null,
      bedrooms: fields.bedrooms,
      basis,
      sizeSqft: fields.sizeSqft,
      askingPsf,
      today: ctx.today,
      window,
    });
  } catch (err) {
    log.error("acs_failed", { err, building: building?.dldKey ?? null, bedrooms: fields.bedrooms, basis });
  }

  // The last resort: registered sales in other buildings nearby, only when nothing above gives a
  // comparison to show. Null when it does not run. A failure here costs nothing: the page is then
  // exactly what it was ("Too few sales to compare yet" or "Not covered yet").
  let nearby: Awaited<ReturnType<typeof nearbyFor>> = null;
  if ((band === "thin" || band === "none") && !(building && band !== "none" && shownAcs(acs)) && !shownSimilar(similar)) {
    try {
      nearby = await nearbyFor(db, {
        band,
        building: building
          ? { id: building.id, area: building.area, areaDld: building.areaDld, masterProject: building.masterProject, firstSaleDate: building.firstSaleDate, firstReadySaleDate: building.firstReadySaleDate }
          : null,
        areaText: fields.areaText ?? null,
        buildingText: fields.buildingText,
        bedrooms: fields.bedrooms,
        basis,
        sizeSqft: fields.sizeSqft,
        askingPsf,
        today: ctx.today,
        window,
      });
    } catch (err) {
      log.error("nearby_failed", { err, building: building?.dldKey ?? null, bedrooms: fields.bedrooms, basis });
    }
  }

  const ref = body.ref ? normaliseCode(body.ref) : null;
  const refCode = ref && (await checkIdForCode(db, ref)) !== null ? ref : null;
  if (refCode) await ensureAnonUser(db, ctx.anonId, refCode); // first touch only (coalesce)

  const row = await createCheck(db, {
    anonId: ctx.anonId,
    buildingId: building?.id ?? null,
    buildingName: building?.name ?? null,
    buildingArea: building?.area ?? null,
    buildingAreaDld: building?.areaDld ?? null,
    buildingText: fields.buildingText,
    areaText: fields.areaText?.trim() ? fields.areaText.trim() : null,
    bedrooms: fields.bedrooms,
    sizeSqft: fields.sizeSqft,
    priceAed: fields.priceAed,
    propertyType: body.propertyType ?? "unknown",
    completion,
    source: body.source,
    editedFields: [...new Set(body.editedFields)],
    band,
    askingPsf,
    medianPsf,
    medianPriceAed,
    salesCount,
    diff,
    windowStart: start,
    windowEnd: end,
    minSales: ctx.rules.minSales,
    bandPct: ctx.rules.bandPct,
    salesSnapshot: snapshot,
    setAsideSnapshot,
    sizeSource: body.sizeSource ?? null,
    completionBasis: basis,
    outliersDropped,
    dataThrough,
    medianSizeSqft,
    similar,
    acsView: acs,
    nearbyView: nearby,
    refCode,
  });

  await trackEvent(db, {
    name: "check_created",
    anonId: ctx.anonId,
    checkId: row.id,
    meta: {
      band,
      source: body.source,
      basis,
      count: salesCount,
      outliers: outliersDropped,
      fromShare: refCode !== null,
      noData: !window,
      sizeSource: body.sizeSource ?? null,
      similar: similar ? (similar.shown ? `shown_${similar.tier}_${similar.verdict}` : similar.reason) : null,
      acs: acs ? (acs.shown ? `shown_${acs.verdict}` : acs.reason) : null,
      nearby: nearby ? (nearby.shown ? `shown_${nearby.kind}_${nearby.verdict}` : nearby.reason) : null,
    },
  });

  return toCheckView(row, ctx.appUrl);
}
