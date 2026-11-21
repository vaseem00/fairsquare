/**
 * ACS_TIER=off and stored comparisons (REAL_DATA.md sections 16.4 and 16.5), against real production
 * servers on one PGlite folder. See playwright.switch.config.ts for how to run it.
 *
 *   1. ACS_TIER=off: the Test Tower D listing reads as it did before adjusted registered sales
 *      existed (the median, the 5% band, the market scale, the list of the 12 months), nothing is
 *      stored for it, and How Fairsquare compares does not describe it.
 *   2. The same database with the switch on: that stored comparison (no range stored, like every
 *      comparison made before this existed) still renders exactly as stored on /c, with its old link
 *      preview. A new comparison of the same listing gets the range.
 *   3. Off again: the comparison stored with a range reads as the median's. Nothing was recomputed.
 *
 * No Anthropic call (details are typed), no Railway, synthetic data only. The servers are stopped in
 * every case, also when a step fails.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const SHOTS = process.env.E2E_SHOTS_DIR;
const MEDIAN_HEADLINE = "14.3% above registered sales";
const ACS_HEADLINE = "Within the range of adjusted sales";

let server: ChildProcess | null = null;

async function stopServer(): Promise<void> {
  const s = server;
  server = null;
  if (!s || s.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    s.once("exit", () => resolve());
    s.kill();
    setTimeout(resolve, 10_000);
  });
}

/** Starts `next start` on `port` over `dataDir` with the switch as given, and waits until the snapshot is loaded. */
async function startServer(port: number, dataDir: string, acsTier: "on" | "off"): Promise<string> {
  await stopServer();
  const base = `http://localhost:${port}`;
  server = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      APP_URL: base,
      PGLITE_DATA_DIR: dataDir,
      ALLOW_PGLITE_IN_PRODUCTION: "true",
      OPEN_DATA_DIR: path.join(root, "tests", "fixtures", "open-data"),
      PARTNER_NAME: "",
      PARTNER_REGULATOR: "",
      PARTNER_LICENCE: "",
      SESSION_SECRET: "e2e-throwaway-session-secret-not-for-production-0123",
      ADMIN_PASSWORD: "e2e-throwaway-admin-pass",
      // Never used: every listing here is typed, and the base URL is a dead loopback port.
      ANTHROPIC_API_KEY: "e2e-placeholder-key-never-sent",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      DATABASE_URL: "",
      LOG_LEVEL: "warn",
      ACS_TIER: acsTier,
    },
  });
  await expect
    .poll(
      async () => {
        try {
          const res = await fetch(`${base}/api/meta`);
          return res.ok ? ((await res.json()) as { data: { loaded: boolean } }).data.loaded : false;
        } catch {
          return false;
        }
      },
      { timeout: 120_000, intervals: [500] },
    )
    .toBe(true);
  return base;
}

test.afterEach(async () => {
  await stopServer();
});

async function compareTowerD(page: Page, base: string): Promise<string> {
  await page.goto(`${base}/`);
  await page.getByRole("button", { name: "Type the details" }).click();
  await page.getByLabel("Building", { exact: true }).fill("Test Tower D");
  await page.getByRole("combobox", { name: "Bedrooms" }).click();
  await page.getByRole("option", { name: "2 bed", exact: true }).click();
  await page.getByLabel("Size (sq ft)").fill("1284");
  await page.getByLabel("Asking price (AED)").fill("2450000");
  await expect(page.getByRole("radio", { name: /^Test Tower D\b/ })).toBeChecked();
  await page.getByRole("button", { name: "Compare price" }).click();
  await expect(page).toHaveURL(/\?step=result&code=[A-Z0-9]{6}$/);
  return new URL(page.url()).searchParams.get("code") as string;
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${info.project.name}-light.png`, fullPage: true });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, "no horizontal page scroll").toBeLessThanOrEqual(iw);
}

/** The page of the median: the fixed band's headline, the market scale, the list of the 12 months; nothing of the range. */
async function expectMedianPage(page: Page, level: 1 | 2): Promise<void> {
  if (level === 1) await expect(page.getByRole("heading", { level: 1 })).toContainText(MEDIAN_HEADLINE);
  else await expect(page.getByRole("heading", { level: 2, name: MEDIAN_HEADLINE })).toBeVisible();
  await expect(page.locator("[data-slot=market-scale]")).toBeVisible();
  await expect(page.locator("[data-slot=gap-sentence]")).toContainText("above the median");
  await expect(page.getByRole("heading", { level: level === 1 ? 2 : 3, name: "11 registered sales" })).toBeVisible();
  await expect(page.locator("[data-slot=acs-list], [data-slot=acs-range], [data-slot=acs-section], [data-slot=acs-median], [data-source=acs]")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/adjusted/i);
}

test("ACS_TIER=off is the app as it was; a comparison stored without a range renders as stored; the switch hides stored ranges", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const port = info.project.name === "mobile-390" ? 3112 : 3113;
  const dataDir = path.join(root, ".data", `e2e-switch-${port}`);
  rmSync(dataDir, { recursive: true, force: true });

  // 1. Switched off.
  let base = await startServer(port, dataDir, "off");
  const oldCode = await compareTowerD(page, base);
  await expectMedianPage(page, 2);
  const off = (await (await page.request.get(`${base}/api/checks/${oldCode}`)).json()) as { check: { acs?: unknown; analysis: { band: string } } };
  expect(off.check.acs ?? null).toBeNull();
  expect(off.check.analysis.band).toBe("above");
  await noHorizontalScroll(page);
  await shot(page, info, "switch-off-result");
  await page.goto(`${base}/how-it-works`);
  await expect(page.locator("#adjusted")).toHaveCount(0);
  await expect(page.locator("#too-few")).toBeVisible();
  await expect(page.getByRole("heading", { name: "How registered sales are adjusted to a listing" })).toHaveCount(0);

  // 2. The same database, switched on: the stored comparison is not recomputed.
  base = await startServer(port, dataDir, "on");
  await page.goto(`${base}/c/${oldCode}`);
  await expectMedianPage(page, 1);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Test Tower D 2-bed: 14.3% above registered sales");
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /^11 registered sales in 12 months\./);
  const ogOld = await page.request.get(`${base}/c/${oldCode}/opengraph-image`);
  expect(ogOld.status()).toBe(200);
  if (SHOTS) writeFileSync(`${SHOTS}/og-switch-old-stored-${info.project.name}.png`, await ogOld.body());
  await noHorizontalScroll(page);
  await shot(page, info, "switch-old-stored-c");
  // A new comparison of the same listing gets the range.
  const newCode = await compareTowerD(page, base);
  expect(newCode).not.toBe(oldCode);
  await expect(page.getByRole("heading", { level: 2, name: ACS_HEADLINE })).toBeVisible();
  await expect(page.locator("[data-slot=range-scale][data-source=acs]")).toBeVisible();
  await page.goto(`${base}/how-it-works`);
  await expect(page.locator("#adjusted")).toBeVisible();

  // 3. Off again: the stored range is not shown; the comparison reads as the median's.
  base = await startServer(port, dataDir, "off");
  await page.goto(`${base}/c/${newCode}`);
  await expectMedianPage(page, 1);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Test Tower D 2-bed: 14.3% above registered sales");
  await noHorizontalScroll(page);
  await shot(page, info, "switch-off-stored-range-c");
  await stopServer();
  rmSync(dataDir, { recursive: true, force: true });
});
