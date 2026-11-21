import "server-only";
/**
 * The loaded sales data (REAL_DATA.md sections 4, 7 and 9), read from app_meta:
 * - `data_from` / `data_through`: the range of the loaded snapshot. Comparisons use the 12 months that
 *   end at min(today, data_through); no `data_through` means no data is loaded yet ("not covered").
 * - `data_source`: the manifest without its counts, for the attribution links (dataset and licence).
 * - stale: data_through is more than 45 days before today.
 * `readDataMeta` always reads the database (comparisons); `cachedDataMeta` keeps it for 60 s for the
 * root layout's public config, and the open-data loader drops it with `invalidateDataMeta()`.
 */
import type { Db } from "@/lib/db/client";
import { getAppMetas } from "@/lib/db/meta";
import { comparisonWindow, isStale } from "@/lib/domain/analyse";
import { isIsoDate, type IsoDate } from "@/lib/domain/dates";
import type { DataSourceMeta } from "@/lib/ingest/snapshot";
import { log } from "@/lib/log";
import type { DataStatusView } from "@/lib/types";

export interface DataMeta {
  dataFrom: IsoDate | null;
  dataThrough: IsoDate | null;
  /** app_meta.data_source: the loaded snapshot's manifest without its counts. */
  source: DataSourceMeta | null;
  /** app_meta.open_data_sha: changes with every new snapshot. */
  sha: string | null;
}

export const DATA_META_CACHE_MS = 60_000;

const date = (v: string | undefined): IsoDate | null => (v && isIsoDate(v) ? v : null);

function parseSource(raw: string | undefined): DataSourceMeta | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DataSourceMeta> | null;
    if (!v || typeof v.datasetTitle !== "string" || typeof v.datasetUrl !== "string" || typeof v.licenceUrl !== "string") return null;
    return v as DataSourceMeta;
  } catch {
    log.warn("data_source_meta_unreadable");
    return null;
  }
}

/** The loaded data's range and source, straight from app_meta. */
export async function readDataMeta(db: Db): Promise<DataMeta> {
  const m = await getAppMetas(db, ["data_from", "data_through", "data_source", "open_data_sha"]);
  return {
    dataFrom: date(m.get("data_from")?.value),
    dataThrough: date(m.get("data_through")?.value),
    source: parseSource(m.get("data_source")?.value),
    sha: m.get("open_data_sha")?.value ?? null,
  };
}

let cache: { db: Db; meta: DataMeta; at: number } | null = null;

/** `readDataMeta`, kept for 60 s per database (the root layout reads it on every page). */
export async function cachedDataMeta(db: Db): Promise<DataMeta> {
  const now = Date.now();
  if (cache && cache.db === db && now - cache.at >= 0 && now - cache.at < DATA_META_CACHE_MS) return cache.meta;
  const meta = await readDataMeta(db);
  cache = { db, meta, at: now };
  return meta;
}

/** Drops the cached meta (the open-data loader calls this after a load). */
export function invalidateDataMeta(): void {
  cache = null;
}

/**
 * The comparison window for `today` (REAL_DATA.md section 7) and the data_through it was cut at.
 * `window` is null when no data is loaded.
 */
export async function salesWindow(
  db: Db,
  today: IsoDate,
  windowDays: number,
): Promise<{ window: { start: IsoDate; end: IsoDate } | null; dataThrough: IsoDate | null }> {
  const { dataThrough } = await readDataMeta(db);
  return { window: comparisonWindow(today, dataThrough, windowDays), dataThrough };
}

/** The public view of the data state: what every page needs for the stale note and attribution. */
export function toDataStatusView(meta: DataMeta, today: IsoDate): DataStatusView {
  return {
    loaded: meta.dataThrough !== null,
    dataFrom: meta.dataFrom,
    dataThrough: meta.dataThrough,
    stale: isStale(today, meta.dataThrough),
    source: meta.source
      ? {
          title: meta.source.datasetTitle,
          url: meta.source.datasetUrl,
          publisher: meta.source.publisher,
          licence: meta.source.licence,
          licenceUrl: meta.source.licenceUrl,
        }
      : null,
  };
}

/** The data state when it cannot be read (nothing loaded as far as the page can tell). */
export const UNKNOWN_DATA_STATUS: DataStatusView = Object.freeze({
  loaded: false,
  dataFrom: null,
  dataThrough: null,
  stale: false,
  source: null,
}) as DataStatusView;
