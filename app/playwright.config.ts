import { rmSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * Playwright smoke (A§8.3, BUILD_PLAN §6.2). Run `npm run build` first, then `npm run test:e2e`.
 *
 * - Uses the installed Microsoft Edge (`channel: "msedge"`): no browser download.
 * - Each viewport project gets its own production server (`next start`) on its own port with its own
 *   fresh PGlite directory, so admin counts are exact per project.
 * - The servers run with throwaway local values only. Screenshot reading is switched on with a
 *   placeholder key and a dead base URL (port 9 on loopback), and the smoke test answers every
 *   POST /api/extract in the browser with `page.route` (tests/e2e/smoke.spec.ts `fakeRead`): the real
 *   Anthropic API is never called, and a read that escaped the fake would fail locally. No mortgage
 *   partner, so the adviser opt-in is off as in a fresh production deploy.
 * - Sales come from the synthetic open-data snapshot in tests/fixtures/open-data (OPEN_DATA_DIR),
 *   which each server loads in the background at boot like the real one (REAL_DATA.md section 4).
 *   There is no demo seed. tests/db/e2e-snapshot.test.ts keeps that snapshot in step with its CSVs.
 * - Set E2E_BASE_URL to run one project against a server you started yourself (no webServer then;
 *   start it with OPEN_DATA_DIR pointing at tests/fixtures/open-data).
 */
// Playwright loads this file as CommonJS (package.json has no "type": "module"): run from the app root.
const root = process.cwd();
const ADMIN_PASSWORD = (process.env.E2E_ADMIN_PASSWORD ??= "e2e-throwaway-admin-pass");
const external = process.env.E2E_BASE_URL;

const servers = [
  { name: "mobile-390", port: 3110, viewport: { width: 390, height: 844 } },
  { name: "desktop-1280", port: 3111, viewport: { width: 1280, height: 800 } },
] as const;

const dataDir = (port: number) => path.join(root, ".data", `e2e-${port}`);
/** The synthetic snapshot (TEST TOWER A to E); never real data. */
const openDataDir = path.join(root, "tests", "fixtures", "open-data");

// Main process only (workers set TEST_WORKER_INDEX): start every run from an empty database.
if (!external && process.env.TEST_WORKER_INDEX === undefined) {
  for (const s of servers) rmSync(dataDir(s.port), { recursive: true, force: true });
}

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    channel: "msedge",
    headless: true,
    locale: "en-GB",
    timezoneId: "Asia/Dubai",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: servers.map((s) => ({
    name: s.name,
    use: {
      baseURL: external ?? `http://localhost:${s.port}`,
      viewport: s.viewport,
      hasTouch: s.viewport.width < 768,
      isMobile: false,
    },
  })),
  webServer: external
    ? undefined
    : servers.map((s) => ({
        command: `npx next start -p ${s.port}`,
        url: `http://localhost:${s.port}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "ignore" as const,
        stderr: "pipe" as const,
        env: {
          NODE_ENV: "production",
          NEXT_TELEMETRY_DISABLED: "1",
          APP_URL: `http://localhost:${s.port}`,
          PGLITE_DATA_DIR: dataDir(s.port),
          ALLOW_PGLITE_IN_PRODUCTION: "true",
          OPEN_DATA_DIR: openDataDir,
          PARTNER_NAME: "",
          PARTNER_REGULATOR: "",
          PARTNER_LICENCE: "",
          SESSION_SECRET: "e2e-throwaway-session-secret-not-for-production-0123",
          ADMIN_PASSWORD,
          // Reading "on" for the scene; never used: the browser-side fake answers /api/extract.
          ANTHROPIC_API_KEY: "e2e-placeholder-key-never-sent",
          ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
          DATABASE_URL: "",
          LOG_LEVEL: "warn",
        },
      })),
});
