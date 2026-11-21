import "server-only";
/**
 * The loaded adjusted-registered-sales model (REAL_DATA.md section 16) and the one read a request
 * makes. The model (about 0.9 MB of JSON in app_meta) is parsed once per loaded snapshot and kept in
 * memory, indexed; a request reads three small app_meta values to see that it is still the loaded
 * one. The sales are not in the model: they are the `sales` table, read per request for the
 * listing's building and the other buildings of its project family.
 */
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { AcsModelFileSchema, domainModel, type AcsModelFile } from "@/lib/acs/model";
import { prepareAcs, type AcsIndex } from "@/lib/domain/acs";
import { isIsoDate, type IsoDate } from "@/lib/domain/dates";
import { log } from "@/lib/log";
import type { Db } from "../client";
import { getAppMeta, getAppMetas } from "../meta";
import { buildings, sales } from "../schema";

export interface LoadedAcsModel {
  file: AcsModelFile;
  index: AcsIndex;
}

let cached: { key: string; model: LoadedAcsModel | null } | null = null;

/** Tests: forget the parsed model. */
export function __resetAcsModelForTests(): void {
  cached = null;
}

function parseModel(raw: string | null): LoadedAcsModel | null {
  if (!raw) return null;
  try {
    const r = AcsModelFileSchema.safeParse(JSON.parse(raw));
    if (r.success) return { file: r.data, index: prepareAcs(domainModel(r.data)) };
    log.warn("acs_model_invalid", { paths: r.error.issues.slice(0, 5).map((i) => i.path.join(".")) });
  } catch {
    log.warn("acs_model_unreadable");
  }
  return null;
}

/**
 * The model that belongs to the loaded sales, or null: none loaded, unreadable, of another format
 * version, or left over from another snapshot (its snapshotSha256 is not app_meta.open_data_sha, or
 * its data date is not app_meta.data_through).
 */
export async function readAcsModel(db: Db): Promise<LoadedAcsModel | null> {
  const m = await getAppMetas(db, ["open_data_acs_sha", "open_data_sha", "data_through"]);
  const acsSha = m.get("open_data_acs_sha")?.value;
  const snapshotSha = m.get("open_data_sha")?.value;
  const through = m.get("data_through")?.value;
  if (!acsSha || !snapshotSha || !through || !isIsoDate(through)) return null;
  const key = `${acsSha}:${snapshotSha}`;
  if (!cached || cached.key !== key) cached = { key, model: parseModel(await getAppMeta(db, "acs_model")) };
  const model = cached.model;
  if (!model || model.file.snapshotSha256 !== snapshotSha || model.file.dataThrough !== through) return null;
  return model;
}

/** One open-data sale as a request reads it. */
export interface AcsSaleDbRow {
  ref: string;
  buildingKey: string;
  /** The building as shown (buildings.name). */
  buildingName: string;
  saleDate: IsoDate;
  bedrooms: number;
  sizeSqft: number;
  priceAed: number;
}

/**
 * The open-data sales of the buildings `keys` (dld_key) on one basis, registered from `from` to
 * `through`: every bedroom count (a batch registered at one price spans bedroom counts). Sales
 * added by hand are not part of the model's pool and are not read.
 */
export async function acsSales(db: Db, keys: readonly string[], basis: "ready" | "off_plan", from: IsoDate, through: IsoDate): Promise<AcsSaleDbRow[]> {
  if (keys.length === 0) return [];
  const rows = await db
    .select({
      ref: sales.externalRef,
      buildingKey: buildings.dldKey,
      buildingName: buildings.name,
      saleDate: sales.saleDate,
      bedrooms: sales.bedrooms,
      sizeSqft: sales.sizeSqft,
      priceAed: sales.priceAed,
    })
    .from(sales)
    .innerJoin(buildings, eq(buildings.id, sales.buildingId))
    .where(
      and(
        inArray(buildings.dldKey, [...keys]),
        eq(sales.completion, basis),
        eq(sales.source, "open_data"),
        isNotNull(sales.externalRef),
        gte(sales.saleDate, from),
        lte(sales.saleDate, through),
      ),
    );
  return rows.map((r) => ({
    ref: r.ref as string,
    buildingKey: r.buildingKey as string,
    buildingName: r.buildingName,
    saleDate: r.saleDate,
    bedrooms: Number(r.bedrooms),
    sizeSqft: Number(r.sizeSqft),
    priceAed: Number(r.priceAed),
  }));
}
