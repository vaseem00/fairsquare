import { defineConfig } from "@playwright/test";

/**
 * The ACS_TIER switch, end to end (REAL_DATA.md section 16.5). Run `npm run build` first, then
 * `npx playwright test -c playwright.switch.config.ts`.
 *
 * It is separate from the smoke test because one server cannot change its environment: the spec
 * (tests/e2e-switch/acs-switch.spec.ts) starts and stops its own production servers on one PGlite
 * folder, first with ACS_TIER=off, then on, then off again, so it can show that a comparison stored
 * without a range keeps rendering as it did and that the switch hides stored ranges. One worker: the
 * two viewports run one after the other, never two servers at once.
 */
export default defineConfig({
  testDir: "tests/e2e-switch",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results-switch",
  use: {
    channel: "msedge",
    headless: true,
    locale: "en-GB",
    timezoneId: "Asia/Dubai",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false } },
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false } },
  ],
});
