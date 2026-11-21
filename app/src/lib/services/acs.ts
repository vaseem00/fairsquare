import "server-only";
/**
 * Adjusted registered sales for one listing (REAL_DATA.md section 16): the first answer for a
 * matched building. It reads the open-data sales of the building and of the other buildings of its
 * project family, runs `estimateAcs` and returns what is stored with the comparison
 * (`checks.acs_view`): the range and the position of the asking price, or the reason there is no
 * range, and every registered sale used with its adjustments.
 *
 * Returns null, and nothing is stored, when it does not run at all: it is switched off
 * (ACS_TIER=off), no building was matched, no sales data is loaded, no usable model is loaded (none,
 * another snapshot's, its fit older than ACS_MAX_FIT_AGE_DAYS against the data, or constants under
 * ACS_MIN_CONSTANTS_VERSION), the comparison is not about the model's data date, or the data date is
 * more than ACS_MAX_DATA_AGE_DAYS before today. The caller then shows exactly what it showed before
 * this existed; it does that too when the result here says `shown: false`.
 */
import { ACS_MAX_DATA_AGE_DAYS, ACS_MAX_FIT_AGE_DAYS, ACS_MIN_CONSTANTS_VERSION, ACS_VIEW_VERSION } from "@/lib/acs/model";
import type { Db } from "@/lib/db/client";
import { acsSales, readAcsModel, type LoadedAcsModel } from "@/lib/db/repo/acs";
import { acsDate, acsDay, acsSiblingKeys, estimateAcs, type AcsSaleRow } from "@/lib/domain/acs";
import { diffDays, type IsoDate } from "@/lib/domain/dates";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import type { AcsStored, CheckBand, CompletionBasis } from "@/lib/types";
import { ACS_COMPARABLES_MAX } from "@/lib/validation/api";

export interface AcsInput {
  /** The same-building result: "thin" means the type has too few sales (scenario "few"). */
  band: CheckBand;
  /** The matched building, or null ("None of these"). */
  building: { dldKey: string | null } | null;
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

/** Why adjusted registered sales answers nothing at all right now (never shown; logged and on /how-it-works). */
export type AcsInactiveReason = "switched_off" | "no_model" | "constants_withdrawn" | "fit_too_old" | "data_too_old";
export type AcsStatus = { active: true; loaded: LoadedAcsModel } | { active: false; reason: AcsInactiveReason };

let warned: string | null = null;

/** Tests: forget what was logged. */
export function __resetAcsStatusForTests(): void {
  warned = null;
}

/**
 * Whether adjusted registered sales can answer today: switched on, a usable model of the loaded
 * snapshot, its fit not older than ACS_MAX_FIT_AGE_DAYS against the data, and the data date not more
 * than ACS_MAX_DATA_AGE_DAYS before today. `acsFor` and /how-it-works share it. When a loaded model
 * cannot be used, that is logged once per model and reason (`acs_inactive`), so the return to the
 * median is never silent.
 */
export async function acsStatus(db: Db, today: IsoDate): Promise<AcsStatus> {
  if (getEnv().ACS_TIER === "off") return { active: false, reason: "switched_off" };
  const loaded = await readAcsModel(db);
  if (!loaded) return { active: false, reason: "no_model" };
  const { file } = loaded;
  const reason: AcsInactiveReason | null =
    file.constantsVersion < ACS_MIN_CONSTANTS_VERSION
      ? "constants_withdrawn"
      : diffDays(file.fittedOn.dataThrough, file.dataThrough) > ACS_MAX_FIT_AGE_DAYS
        ? "fit_too_old"
        : diffDays(file.dataThrough, today) > ACS_MAX_DATA_AGE_DAYS
          ? "data_too_old"
          : null;
  if (!reason) return { active: true, loaded };
  const key = `${file.snapshotSha256}:${reason}`;
  if (warned !== key) {
    warned = key;
    log.warn("acs_inactive", { reason, dataThrough: file.dataThrough, fittedOn: file.fittedOn.dataThrough, today });
  }
  return { active: false, reason };
}

export async function acsFor(db: Db, input: AcsInput): Promise<AcsStored | null> {
  if (!input.building || !input.window) return null;
  const status = await acsStatus(db, input.today);
  if (!status.active) return null;
  const { file, index } = status.loaded;
  // The sales are adjusted to the data date: the comparison must end there too.
  if (input.window.end !== file.dataThrough) return null;

  const poolFrom = acsDate(file.epoch, file.poolFromDay);
  const view: AcsStored = {
    v: ACS_VIEW_VERSION,
    modelVersion: file.version,
    constantsVersion: file.constantsVersion,
    dataThrough: file.dataThrough,
    poolFrom,
    scenario: input.band === "thin" || input.band === "none" ? "few" : "enough",
    shown: false,
    reason: "no_comparables",
    rangeLowPsf: null,
    rangeHighPsf: null,
    verdict: null,
    evidence: { lead: null, sales: 0, ownSales: 0, otherBedroomSales: 0, projectSales: 0 },
    typicalSizeSqft: null,
    tested: null,
    comparables: [],
    comparablesTotal: 0,
    server: null,
  };
  // Not tested above 3 bedrooms: nothing to read.
  if (input.bedrooms > file.range.maxBedrooms) return { ...view, reason: "bedrooms_not_validated" };
  // A building added by hand has no key; one that is not in the model has no sale in the pool.
  const key = input.building.dldKey;
  if (!key || !index.b.has(key)) return view;

  const rows = await acsSales(db, [key, ...acsSiblingKeys(index, key)], input.basis, poolFrom, file.dataThrough);
  const names = new Map<string, string>();
  const own: AcsSaleRow[] = [];
  const siblings: AcsSaleRow[] = [];
  for (const r of rows) {
    names.set(r.buildingKey, r.buildingName);
    const row: AcsSaleRow = { ref: r.ref, buildingKey: r.buildingKey, day: acsDay(file.epoch, r.saleDate), bed: r.bedrooms, size: r.sizeSqft, price: r.priceAed };
    if (r.buildingKey === key) own.push(row);
    else siblings.push(row);
  }
  const r = estimateAcs(index, { buildingKey: key, bed: input.bedrooms, basis: input.basis === "off_plan" ? 1 : 0, size: input.sizeSqft, askingPsf: input.askingPsf }, own, siblings);

  const salesOf = (ring: number) => r.comps.reduce((n, c) => n + (c.ring === ring ? c.count : 0), 0);
  const out: AcsStored = {
    ...view,
    shown: r.shown,
    reason: r.reason,
    evidence: {
      lead: r.evidenceClass ?? null,
      sales: salesOf(1) + salesOf(2) + salesOf(3),
      ownSales: salesOf(1),
      otherBedroomSales: salesOf(2),
      projectSales: salesOf(3),
    },
    typicalSizeSqft: r.typicalSize === null ? null : round(r.typicalSize, 2),
    server:
      r.features && r.centrePsf !== undefined
        ? { centrePsf: r.centrePsf, lowPsf: r.lowPsf ?? null, highPsf: r.highPsf ?? null, halfWidth: r.halfWidth ?? null, group: r.group ?? "", groupUsed: r.groupUsed ?? null }
        : null,
  };
  if (!r.shown || r.rangeLowPsf === undefined || r.rangeHighPsf === undefined || !r.verdict || !r.features) return { ...out, shown: false };
  const W = r.features.W;
  return {
    ...out,
    rangeLowPsf: r.rangeLowPsf,
    rangeHighPsf: r.rangeHighPsf,
    verdict: r.verdict,
    tested: { heldOf10: file.tested.heldOf10, heldLaterOf10: file.tested.heldLaterOf10 },
    // Largest weight first; equal weights keep the order of the method (own sales, the project, other bedrooms; latest first).
    comparables: r.comps
      .map((c, i) => ({ c, i }))
      .sort((a, b) => b.c.weight - a.c.weight || a.i - b.i)
      .slice(0, ACS_COMPARABLES_MAX)
      .map(({ c }) => ({
        ring: c.ring,
        building: c.ring === 3 ? (names.get(c.buildingKey) ?? null) : null,
        date: acsDate(file.epoch, c.day),
        bedrooms: c.bed,
        sizeSqft: round(c.size, 2),
        priceAed: c.batch ? null : c.price,
        psf: round(c.psf, 2),
        count: c.count,
        batch: c.batch,
        timeAdj: round(Math.exp(c.timeLn) - 1, 5),
        sizeAdj: round(Math.exp(c.sizeLn - c.bedroomLn) - 1, 5),
        bedroomAdj: round(Math.exp(c.bedroomLn) - 1, 5),
        adjustedPsf: round(c.adjustedPsf, 2),
        weightShare: round(c.weight / W, 5),
      })),
    comparablesTotal: r.comps.length,
  };
}
