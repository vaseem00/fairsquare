import "server-only";
/**
 * app_meta key/value store (REAL_DATA.md section 4): the loaded open-data snapshot (`open_data_sha`,
 * `data_from`, `data_through`, `data_source`) and `data_imported_at` (open-data load or CSV import).
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { appMeta, type AppMetaKey } from "./schema";

export type { AppMetaKey };

export async function getAppMeta(db: Db, key: AppMetaKey): Promise<string | null> {
  const rows = await db.select({ value: appMeta.value }).from(appMeta).where(eq(appMeta.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

/** Several keys at once; absent keys are missing from the map. */
export async function getAppMetas(db: Db, keys: readonly AppMetaKey[]): Promise<Map<AppMetaKey, { value: string; updatedAt: Date }>> {
  const out = new Map<AppMetaKey, { value: string; updatedAt: Date }>();
  if (keys.length === 0) return out;
  const rows = await db
    .select({ key: appMeta.key, value: appMeta.value, updatedAt: appMeta.updatedAt })
    .from(appMeta)
    .where(inArray(appMeta.key, [...keys]));
  for (const r of rows) out.set(r.key as AppMetaKey, { value: r.value, updatedAt: r.updatedAt });
  return out;
}

export async function setAppMeta(db: Db, key: AppMetaKey, value: string): Promise<void> {
  await db
    .insert(appMeta)
    .values({ key, value })
    .onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: sql`now()` } });
}
