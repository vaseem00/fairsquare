import "server-only";
/**
 * The measured read time behind the "Still reading" line (RESULT_SPEC sections 2.3 and 9.1, item 7):
 * the median of the last READ_TIME_SAMPLE successful reads (`extract_ok` events and their `meta.ms`),
 * rounded to whole seconds, once READ_TIME_MIN_READS of them exist. Null before that: the line then
 * keeps "This can take up to 20 seconds." (`read.slowFallback`). The root layout reads it with the
 * public config on every page, so it is kept for 60 s per database, like the data meta.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { events } from "@/lib/db/schema";
import { median } from "@/lib/domain/analyse";

/** The reads the median is taken over (the newest first). */
export const READ_TIME_SAMPLE = 200;
/** No measured note until this many reads exist. */
export const READ_TIME_MIN_READS = 50;
export const READ_TIME_CACHE_MS = 60_000;

/** The median read time of the newest READ_TIME_SAMPLE reads in whole seconds (at least 1), or null with fewer than READ_TIME_MIN_READS. */
export async function readTimeP50Sec(db: Db): Promise<number | null> {
  const rows = await db
    .select({ ms: sql<number | string | null>`(${events.meta}->>'ms')::double precision` })
    .from(events)
    .where(and(eq(events.name, "extract_ok"), sql`jsonb_typeof(${events.meta}->'ms') = 'number'`))
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(READ_TIME_SAMPLE);
  const ms = rows.map((r) => Number(r.ms)).filter((v) => Number.isFinite(v) && v > 0);
  if (ms.length < READ_TIME_MIN_READS) return null;
  const m = median(ms);
  return m === null ? null : Math.max(1, Math.round(m / 1000));
}

let cache: { db: Db; value: number | null; at: number } | null = null;

/** `readTimeP50Sec`, kept for 60 s per database. */
export async function cachedReadTimeP50Sec(db: Db): Promise<number | null> {
  const now = Date.now();
  if (cache && cache.db === db && now - cache.at >= 0 && now - cache.at < READ_TIME_CACHE_MS) return cache.value;
  const value = await readTimeP50Sec(db);
  cache = { db, value, at: now };
  return value;
}

/** Drops the cached value (tests). */
export function __resetReadTimeForTests(): void {
  cache = null;
}
