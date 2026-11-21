import "server-only";
/**
 * Database driver selection (A§3.1).
 * - DATABASE_URL set → node-postgres Pool (Railway).
 * - unset → PGlite in-process at PGLITE_DATA_DIR (local dev). Tests inject an in-memory PGlite.
 * - production without DATABASE_URL fails fast unless ALLOW_PGLITE_IN_PRODUCTION=true.
 * PGlite holds an exclusive lock on its data dir: do not run db scripts while `npm run dev` runs.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Common supertype of the node-postgres and PGlite drizzle databases. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type DbKind = "postgres" | "pglite";

interface DbHandle {
  db: Db;
  kind: DbKind;
  /** Closes the pool / PGlite instance. */
  close: () => Promise<void>;
  /** The node-postgres pool (postgres only), for session-level work such as advisory locks. */
  pool?: Pool;
}

const g = globalThis as typeof globalThis & { __mizanDb?: DbHandle };

export class DbConfigError extends Error {
  override name = "DbConfigError";
}

/** Throws when production has no DATABASE_URL (and PGlite is not explicitly allowed). */
export function assertDbConfig(): void {
  const e = getEnv();
  if (e.isProduction && !e.DATABASE_URL && !e.ALLOW_PGLITE_IN_PRODUCTION) {
    const message =
      "DATABASE_URL is not set. Production needs Postgres (Railway: DATABASE_URL=${{Postgres.DATABASE_URL}}), " +
      "or set ALLOW_PGLITE_IN_PRODUCTION=true to accept an ephemeral local database.";
    log.error("db_config_missing", { message });
    throw new DbConfigError(message);
  }
}

function open(): DbHandle {
  assertDbConfig();
  const e = getEnv();
  if (e.DATABASE_URL) {
    const pool = new Pool({ connectionString: e.DATABASE_URL, max: 10 });
    pool.on("error", (err) => log.error("db_pool_error", { err }));
    const db = drizzlePg(pool, { schema }) as unknown as Db;
    return { db, kind: "postgres", pool, close: () => pool.end() };
  }
  // turbopackIgnore: a runtime data directory, not a source path (keeps the build from tracing the whole project).
  const dir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), e.PGLITE_DATA_DIR);
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return { db, kind: "pglite", close: () => client.close() };
}

function handle(): DbHandle {
  g.__mizanDb ??= open();
  return g.__mizanDb;
}

/** Singleton on globalThis.__mizanDb (survives dev HMR). */
export function getDb(): Db {
  return handle().db;
}

export function dbKind(): DbKind {
  return handle().kind;
}

/** The node-postgres pool when running on Postgres, else null. */
export function getPgPool(): Pool | null {
  return handle().pool ?? null;
}

/** Close and forget the singleton (scripts). */
export async function closeDb(): Promise<void> {
  const h = g.__mizanDb;
  g.__mizanDb = undefined;
  if (h) await h.close();
}

/** Inject a database (tests use an in-memory PGlite); null forgets it without closing. */
export function __setDbForTests(db: Db | null, kind: DbKind = "pglite"): void {
  g.__mizanDb = db ? { db, kind, close: async () => {} } : undefined;
}
