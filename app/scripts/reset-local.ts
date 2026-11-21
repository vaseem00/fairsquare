/**
 * npm run db:reset: deletes the local PGlite database directory (PGLITE_DATA_DIR, default .data/pglite).
 * Refuses when DATABASE_URL is set. Stop `npm run dev` first. The next boot migrates and seeds again.
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { getEnv } = await import("@/lib/env");
  const { log } = await import("@/lib/log");
  const env = getEnv();
  if (env.DATABASE_URL) {
    log.error("reset_refused", { reason: "DATABASE_URL is set; db:reset only deletes the local PGlite directory" });
    process.exitCode = 1;
    return;
  }
  const root = process.cwd();
  const dir = path.resolve(root, env.PGLITE_DATA_DIR);
  if (!dir.startsWith(root + path.sep)) {
    log.error("reset_refused", { reason: "PGLITE_DATA_DIR must be inside the project folder", dir });
    process.exitCode = 1;
    return;
  }
  if (!existsSync(dir)) {
    log.info("reset_nothing_to_do", { dir });
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  log.info("reset_done", { dir });
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
