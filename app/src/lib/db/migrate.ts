import "server-only";
/**
 * migrateAndSeed() (A§3.2): runs on server boot (src/instrumentation.ts) and from `npm run db:migrate`.
 * 1. Postgres: pg_advisory_lock(727274) on one dedicated connection (safe with 2 replicas).
 * 2. Apply drizzle/ migrations.
 * 3. Purge expired rate_limits and admin_sessions, and saved_listings removed > 30 days ago.
 * 4. Unlock.
 * There is no seed: sales come from the DLD open-data snapshot, which src/lib/ingest/load.ts loads
 * in the background after this has finished (REAL_DATA.md section 4).
 */
import path from "node:path";
import { and, isNotNull, lt, sql } from "drizzle-orm";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { log } from "@/lib/log";
import { assertDbConfig, dbKind, getDb, getPgPool, type Db, type DbKind } from "./client";
import * as schema from "./schema";
import { adminSessions, rateLimits, savedListings } from "./schema";

export const MIGRATION_LOCK_KEY = 727274;
export const REMOVED_SAVED_RETENTION_DAYS = 30;

export function migrationsFolder(): string {
  return path.join(process.cwd(), "drizzle");
}

/** Apply the drizzle/ migrations to a database of the given kind. */
export async function applyMigrations(db: Db, kind: DbKind, folder: string = migrationsFolder()): Promise<void> {
  if (kind === "postgres") await migratePg(db as unknown as NodePgDatabase<typeof schema>, { migrationsFolder: folder });
  else await migratePglite(db as unknown as PgliteDatabase<typeof schema>, { migrationsFolder: folder });
}

export interface PurgeResult {
  rateLimits: number;
  adminSessions: number;
  savedListings: number;
}

/** Step 3: delete expired platform rows and saved listings removed more than 30 days ago. */
export async function purgeExpired(db: Db): Promise<PurgeResult> {
  const rl = await db.delete(rateLimits).where(lt(rateLimits.expiresAt, sql`now()`)).returning({ k: rateLimits.key });
  const as = await db
    .delete(adminSessions)
    .where(lt(adminSessions.expiresAt, sql`now()`))
    .returning({ k: adminSessions.idHash });
  const sl = await db
    .delete(savedListings)
    .where(
      and(
        isNotNull(savedListings.removedAt),
        lt(savedListings.removedAt, sql`now() - make_interval(days => ${REMOVED_SAVED_RETENTION_DAYS})`),
      ),
    )
    .returning({ id: savedListings.id });
  return { rateLimits: rl.length, adminSessions: as.length, savedListings: sl.length };
}

export interface MigrateOptions {
  /** Defaults to getDb(). Tests pass their in-memory PGlite. */
  db?: Db;
  kind?: DbKind;
}

export interface MigrateResult {
  kind: DbKind;
  purged: PurgeResult;
  ms: number;
}

async function run(db: Db, kind: DbKind): Promise<Omit<MigrateResult, "ms">> {
  await applyMigrations(db, kind);
  const purged = await purgeExpired(db);
  return { kind, purged };
}

/** Kept under its old name: the boot hook and `npm run db:migrate` call it. It no longer seeds. */
export async function migrateAndSeed(opts: MigrateOptions = {}): Promise<MigrateResult> {
  const started = Date.now();
  try {
    let result: Omit<MigrateResult, "ms">;
    if (opts.db) {
      result = await run(opts.db, opts.kind ?? "pglite");
    } else {
      assertDbConfig();
      const kind = dbKind();
      const pool = getPgPool();
      if (kind === "postgres" && pool) {
        // The advisory lock is session-level, so the whole run uses one dedicated connection.
        const conn = await pool.connect();
        try {
          await conn.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
          try {
            const lockedDb = drizzlePg(conn, { schema }) as unknown as Db;
            result = await run(lockedDb, "postgres");
          } finally {
            await conn.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
          }
        } finally {
          conn.release();
        }
      } else {
        result = await run(getDb(), kind);
      }
    }
    const out = { ...result, ms: Date.now() - started };
    log.info("db_migrated", { db: out.kind, purged: out.purged, ms: out.ms });
    return out;
  } catch (err) {
    log.error("db_migrate_failed", { err });
    throw err;
  }
}
