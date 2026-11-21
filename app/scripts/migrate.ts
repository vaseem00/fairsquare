/**
 * npm run db:migrate: the same migrateAndSeed() that runs on boot.
 * Loads .env / .env.local like Next does. Do not run while `npm run dev` holds the PGlite lock.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { migrateAndSeed } = await import("@/lib/db/migrate");
  const { closeDb } = await import("@/lib/db/client");
  try {
    await migrateAndSeed();
  } finally {
    await closeDb();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
