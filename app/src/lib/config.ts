import "server-only";
/**
 * getPublicConfig(): the only path for configuration to reach the browser (A§7.1).
 * The root layout passes it to the client ConfigProvider.
 * - `leadsEnabled`, `partner` and `consent` follow REAL_DATA.md section 8: the adviser opt-in exists
 *   only when PARTNER_NAME, PARTNER_REGULATOR and PARTNER_LICENCE are all set.
 * - `data` is the loaded sales data (range, stale flag, dataset and licence links; REAL_DATA.md
 *   sections 7 and 9), read from app_meta and kept for 60 s. A database error never breaks the
 *   page: the data then reads as not loaded.
 * - `readP50Sec` is the median of the last 200 reads in seconds, once 50 exist (read-time.ts, kept
 *   for 60 s): the "Still reading" line says it (RESULT_SPEC 2.3). Null otherwise, or on a DB error.
 */
import { consentFor } from "@/lib/copy";
import { cachedDataMeta, toDataStatusView, UNKNOWN_DATA_STATUS } from "@/lib/data-status";
import { getDb, type Db } from "@/lib/db/client";
import { dubaiToday, type IsoDate } from "@/lib/domain/dates";
import { getEnv, leadPartner } from "@/lib/env";
import { extractionEnabled } from "@/lib/extract-circuit";
import { log } from "@/lib/log";
import { cachedReadTimeP50Sec } from "@/lib/read-time";
import type { DataStatusView, PublicConfig } from "@/lib/types";

/** The data status for `today`; UNKNOWN_DATA_STATUS when the database cannot be read. */
export async function getDataStatus(db?: Db, today: IsoDate = dubaiToday()): Promise<DataStatusView> {
  try {
    return toDataStatusView(await cachedDataMeta(db ?? getDb()), today);
  } catch (err) {
    log.warn("data_status_failed", { err });
    return UNKNOWN_DATA_STATUS;
  }
}

/** The median read time in seconds (read-time.ts), or null when unknown or the database cannot be read. */
export async function getReadP50Sec(db?: Db): Promise<number | null> {
  try {
    return await cachedReadTimeP50Sec(db ?? getDb());
  } catch (err) {
    log.warn("read_time_failed", { err });
    return null;
  }
}

/**
 * The public config for a known data status (the environment and the extraction circuit only), with
 * the measured median read time when it is known (`readP50Sec`, the "Still reading" line).
 */
export function publicConfigWith(data: DataStatusView, readP50Sec: number | null = null): PublicConfig {
  const e = getEnv();
  const partner = leadPartner(e);
  const consent = partner ? consentFor(partner.name) : null;
  return {
    appUrl: e.APP_URL,
    extractEnabled: extractionEnabled(),
    maxImageBytes: e.MAX_IMAGE_BYTES,
    leadsEnabled: partner !== null,
    partner,
    consent: consent ? { version: consent.version, text: consent.text } : null,
    rules: { ...e.rules },
    mortgage: { downPct: e.MORTGAGE_DOWN_PCT, ratePct: e.MORTGAGE_RATE_PCT, years: e.MORTGAGE_YEARS },
    data,
    readP50Sec,
  };
}

export async function getPublicConfig(opts: { db?: Db; today?: IsoDate } = {}): Promise<PublicConfig> {
  const [data, readP50Sec] = await Promise.all([getDataStatus(opts.db, opts.today), getReadP50Sec(opts.db)]);
  return publicConfigWith(data, readP50Sec);
}
