/**
 * In-memory PGlite databases for tests (A§8.1).
 *   const t = useTestDb();            // beforeAll: migrate + seed, and __setDbForTests
 *   it("…", async () => { await t.db.select()… });
 * or, for one-off databases:
 *   const { db, close } = await createTestDb({ today: "2026-11-17", seed: true });
 * The seed is the synthetic test data (tests/fixtures/test-buildings.ts, tests/helpers/seed-test-data.ts).
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll } from "vitest";
import { __setDbForTests, type Db } from "@/lib/db/client";
import { applyMigrations } from "@/lib/db/migrate";
import * as schema from "@/lib/db/schema";
import { TEST_TODAY } from "../fixtures/test-buildings";
import { seedTestBuildings } from "./seed-test-data";

export { TEST_TODAY };

export interface TestDbOptions {
  /** The seed day; test sales are dated relative to it. Default "2026-11-17". */
  today?: string;
  /** Seed the 6 synthetic test buildings, 9 aliases and 32 sales. Default true. */
  seed?: boolean;
}

export interface TestDb {
  db: Db;
  client: PGlite;
  today: string;
  close: () => Promise<void>;
}

export async function createTestDb({ today = TEST_TODAY, seed = true }: TestDbOptions = {}): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await applyMigrations(db, "pglite");
  if (seed) await seedTestBuildings(db, today);
  return { db, client, today, close: () => client.close() };
}

/**
 * Creates one database for the file in beforeAll and makes getDb() return it (__setDbForTests).
 * Read `.db` inside tests (it is set once beforeAll has run).
 */
export function useTestDb(opts: TestDbOptions = {}): { readonly db: Db; readonly today: string } {
  let current: TestDb | null = null;
  beforeAll(async () => {
    current = await createTestDb(opts);
    __setDbForTests(current.db, "pglite");
  });
  afterAll(async () => {
    __setDbForTests(null);
    await current?.close();
    current = null;
  });
  return {
    get db(): Db {
      if (!current) throw new Error("useTestDb: the database is ready only inside tests (after beforeAll)");
      return current.db;
    },
    get today(): string {
      return opts.today ?? TEST_TODAY;
    },
  };
}

/**
 * Deletes everything people created (anon users and, by cascade, their checks and saved listings;
 * leads, requests, events, rate limits, admin sessions) and every sale that is not open data.
 * Keeps the seeded test buildings and their `open_data` sales.
 */
export async function clearUserData(db: Db): Promise<void> {
  await db.execute(sql`delete from events`);
  await db.execute(sql`delete from leads`);
  await db.execute(sql`delete from building_requests`);
  await db.execute(sql`delete from saved_listings`);
  await db.execute(sql`delete from checks`);
  await db.execute(sql`delete from anon_users`);
  await db.execute(sql`delete from deleted_anon_ids`);
  await db.execute(sql`delete from rate_limits`);
  await db.execute(sql`delete from admin_sessions`);
  await db.execute(sql`delete from sales where source <> 'open_data'`);
}
