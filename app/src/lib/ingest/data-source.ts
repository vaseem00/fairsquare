import "server-only";
/**
 * Data for the admin "Data source" panel (REAL_DATA.md section 12): the dataset title and link, the
 * download date, the data range, rows, buildings, the last load time and the exclusion counts.
 * The loaded state comes from app_meta (what the loader wrote); the counts come from the snapshot's
 * manifest.json in OPEN_DATA_DIR (app_meta keeps the manifest without its counts). `pending` is true
 * when the folder holds a snapshot that is not loaded yet (a load still running, or one that failed).
 */
import { count, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { getAppMetas } from "@/lib/db/meta";
import { buildings, sales } from "@/lib/db/schema";
import { isStale } from "@/lib/domain/analyse";
import { dubaiToday, type IsoDate } from "@/lib/domain/dates";
import { log } from "@/lib/log";
import type { DataSourcePanel } from "@/lib/validation/admin";
import { readManifest, type DataSourceMeta, type Manifest } from "./snapshot";
import { EXCLUSION_REASONS } from "./types";

/** The panel's shape lives with the other admin DTOs (client-safe). */
export type { DataSourcePanel };

function panelManifest(m: Manifest): NonNullable<DataSourcePanel["manifest"]> {
  return {
    datasetTitle: m.datasetTitle,
    datasetUrl: m.datasetUrl,
    publisher: m.publisher,
    licence: m.licence,
    licenceUrl: m.licenceUrl,
    downloadedOn: m.downloadedOn,
    rows: m.counts.kept,
    read: m.counts.read,
    buildings: m.buildings,
    snapshotSha256: m.snapshotSha256,
    excluded: EXCLUSION_REASONS.map((reason) => ({ reason, count: m.counts.excluded[reason] ?? 0 })),
  };
}

/**
 * The panel data. `dir` is the snapshot folder (openDataDir() in the app); `today` decides `stale`.
 * Never throws on a bad manifest.
 */
export async function getDataSourcePanel(db: Db, dir: string, today: IsoDate = dubaiToday()): Promise<DataSourcePanel> {
  const [meta, [salesRow], [buildingsRow]] = await Promise.all([
    getAppMetas(db, ["open_data_sha", "data_from", "data_through", "data_source"]),
    db.select({ n: count() }).from(sales).where(eq(sales.source, "open_data")),
    db.select({ n: count() }).from(buildings).where(isNotNull(buildings.dldKey)),
  ]);
  let fileManifest: Manifest | null = null;
  try {
    fileManifest = await readManifest(dir);
  } catch (err) {
    log.warn("open_data_manifest_unreadable", { err });
  }
  const loadedSha = meta.get("open_data_sha")?.value ?? null;
  let stored: DataSourceMeta | null = null;
  try {
    stored = meta.get("data_source") ? (JSON.parse(meta.get("data_source")?.value ?? "") as DataSourceMeta) : null;
  } catch {
    stored = null;
  }
  // Counts exist only in the file: use it when it is the loaded snapshot, or when nothing is loaded.
  const manifest = fileManifest && (loadedSha === null || fileManifest.snapshotSha256 === loadedSha) ? panelManifest(fileManifest) : null;
  const dataThrough = meta.get("data_through")?.value ?? null;
  return {
    loaded: loadedSha !== null,
    pending: fileManifest !== null && fileManifest.snapshotSha256 !== loadedSha,
    dataFrom: meta.get("data_from")?.value ?? null,
    dataThrough,
    stale: isStale(today, dataThrough),
    loadedAt: loadedSha !== null ? (meta.get("open_data_sha")?.updatedAt.toISOString() ?? null) : null,
    manifest:
      manifest ??
      (stored
        ? {
            datasetTitle: stored.datasetTitle,
            datasetUrl: stored.datasetUrl,
            publisher: stored.publisher,
            licence: stored.licence,
            licenceUrl: stored.licenceUrl,
            downloadedOn: stored.downloadedOn,
            rows: Number(salesRow?.n ?? 0),
            read: 0,
            buildings: stored.buildings,
            snapshotSha256: stored.snapshotSha256,
            excluded: [],
          }
        : null),
    live: { openDataSales: Number(salesRow?.n ?? 0), dldBuildings: Number(buildingsRow?.n ?? 0) },
  };
}
