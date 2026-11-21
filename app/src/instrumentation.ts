/**
 * Boot hook (A§3.2): migrate before the server takes requests, then load the DLD open-data snapshot
 * in the background (REAL_DATA.md section 4).
 * A migration throw fails the boot, so Railway's healthcheck fails and the deploy is not promoted.
 * The open-data load never delays the start or the healthcheck, and its failures are only logged.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return; // never touch the DB during next build
  const { migrateAndSeed } = await import("./lib/db/migrate");
  await migrateAndSeed();
  void import("./lib/ingest/load")
    .then(({ startOpenDataLoad }) => startOpenDataLoad())
    .catch(async (err: unknown) => {
      const { log } = await import("./lib/log");
      log.error("open_data_load_failed", { err });
    });
}
