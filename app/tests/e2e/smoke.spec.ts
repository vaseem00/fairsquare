/**
 * Playwright smoke (A§8.3), against `npm run build` + `next start` on PGlite with no mortgage
 * partner. Screenshot reading is on with a placeholder key, and every read is answered in the browser
 * by `fakeRead` (page.route on POST /api/extract): never the real Anthropic API. The fake returns the
 * fields a read would give and the server's own building match for them (GET /api/buildings/match).
 * Sales come from the synthetic open-data snapshot in tests/fixtures/open-data (OPEN_DATA_DIR, loaded
 * in the background at boot; REAL_DATA.md section 4): TEST TOWER D has 11 ready 2-bed sales, TEST
 * TOWER E 2 ready 3-bed sales (tests/db/e2e-snapshot.test.ts pins the numbers). The snapshot carries
 * the adjusted-registered-sales model (REAL_DATA.md section 16), so Test Tower D's first answer is the
 * range of its 12 registered sales adjusted to the listing: AED 1,550 to 1,970 per sq ft. There is no demo
 * seed. Runs once per viewport project (390×844 and 1280×800, see playwright.config.ts), each against
 * its own fresh database. The tests run in order because the admin counts depend on them: the
 * screenshot journeys (docs/REDESIGN.md section 11; the result section's, RESULT_SPEC section 12.3:
 * a clean read, the size buttons, Edit and the in-place re-settle with Back, Wrong building?, the open
 * list, and the attribution, independence and "Not a valuation" on every result) come after the admin
 * test.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FIXTURE_ACS_FEW } from "../fixtures/acs-view";
import { FIXTURE_SIMILAR, FIXTURE_SIMILAR_PROJECT, FIXTURE_SIMILAR_REFUSED } from "../fixtures/similar-view";

test.describe.configure({ mode: "serial" });

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2e-throwaway-admin-pass";
/**
 * A typed listing in the synthetic TEST TOWER D: AED 1,908 per sq ft, inside the range of its 12
 * registered sales adjusted to the listing (and 14.3% above the median of the 11 of the last 12 months,
 * which is what the page says when that range is absent: MEDIAN_HEADLINE).
 */
const LISTING = { building: "Test Tower D", bedrooms: "2 bed", size: "1284", price: "2450000" };
const UNCOVERED = "Nowhere Point Tower";
/** The verdict headline for the Test Tower D listing. */
const HEADLINE = "Within the range of adjusted sales";
/** The same listing without the range of adjusted sales (a stored comparison from before it, or ACS_TIER=off). */
const MEDIAN_HEADLINE = "14.3% above registered sales";
/** A 1×1 PNG: the screenshot the fake read pretends to read. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const READ_D = { buildingText: "Test Tower D", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 };

type ReadFields = { buildingText: string | null; areaText: string | null; bedrooms: number | null; sizeSqft: number | null; priceAed: number | null };

/**
 * Answers POST /api/extract in the browser (never the Anthropic API): the fields a read would give,
 * with the server's own building match for them; or an API error.
 */
async function fakeRead(
  page: Page,
  fields: ReadFields,
  opts: {
    /** Keep only the pre-selected building, as a read of an unambiguous listing would match. */
    clean?: boolean;
    towerCheck?: boolean;
    /** Size buttons on the pre-selected building (RESULT_SPEC section 2.5). */
    sizes?: { sqft: number; sales: number }[];
    error?: { status: number; code: string; message: string; retryAfterSec?: number };
    /** What the read says about completion (default "ready"). */
    completion?: "ready" | "off_plan";
  } = {},
): Promise<void> {
  type Match = {
    candidates: { buildingId: number; sizes?: { sqft: number; sales: number }[] }[];
    preselectId: number | null;
    towerCheck: boolean;
    areaCheck: boolean;
  };
  let match: Match = { candidates: [], preselectId: null, towerCheck: false, areaCheck: false };
  if (fields.buildingText) {
    const q = new URLSearchParams({ q: fields.buildingText, completion: opts.completion ?? "ready", ...(fields.bedrooms !== null ? { beds: String(fields.bedrooms) } : {}) });
    const res = await page.request.get(`/api/buildings/match?${q.toString()}`);
    match = (await res.json()) as Match;
  }
  // The synthetic snapshot has two "Test Tower A" (one name, two areas), so the real match for
  // "Test Tower D" flags areaCheck: `clean` keeps the pre-selected tower alone.
  if (opts.clean && match.preselectId !== null) {
    match = { ...match, candidates: match.candidates.filter((c) => c.buildingId === match.preselectId), towerCheck: false, areaCheck: false };
  }
  if (opts.towerCheck) match = { ...match, towerCheck: true };
  if (opts.sizes) {
    const sizes = opts.sizes;
    match = { ...match, candidates: match.candidates.map((c) => (c.buildingId === match.preselectId ? { ...c, sizes } : c)) };
  }
  await page.unroute("**/api/extract");
  await page.route("**/api/extract", (route) => {
    const e = opts.error;
    void route.fulfill(
      e
        ? {
            status: e.status,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: e.code, message: e.message, requestId: "e2e", ...(e.retryAfterSec ? { retryAfterSec: e.retryAfterSec } : {}) } }),
          }
        : {
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ outcome: "ok", fields, propertyType: "apartment", completion: opts.completion ?? "ready", contactDetailsVisible: false, match }),
          },
    );
  });
}

/**
 * Records whether the details form, a field list or a skeleton ever appears (RESULT_SPEC section 12.3:
 * a read never opens the form by itself, and the scene never shows field data or a loading skeleton).
 */
async function watchForForm(page: Page): Promise<() => Promise<boolean>> {
  await page.evaluate(() => {
    const w = window as unknown as { __sawForm: boolean };
    w.__sawForm = false;
    const seen = "[data-slot=details-form], [data-slot=skeleton], [data-slot=reading-skeleton], [data-slot=read-line], [data-slot=read-blank], dl[data-slot=read-fields]";
    new MutationObserver(() => {
      if (document.querySelector(seen)) w.__sawForm = true;
    }).observe(document.body, { subtree: true, childList: true });
  });
  return () => page.evaluate(() => (window as unknown as { __sawForm: boolean }).__sawForm);
}

async function addScreenshot(page: Page): Promise<void> {
  await page.locator("input[type=file]").setInputFiles({ name: "listing.png", mimeType: "image/png", buffer: PNG });
}

/**
 * Every result shows the attribution, the independence line and "Not a valuation" (RESULT_SPEC section
 * 12.3); a verdict's sales list is open with no ask in front of it.
 */
async function evidenceIsFree(page: Page, sales = 12, list: "used" | "median" = "used"): Promise<void> {
  const provenance = page.locator("[data-slot=provenance]");
  await expect(provenance).toContainText(ATTRIBUTION);
  await expect(provenance).toContainText("Fairsquare is independent.");
  await expect(provenance).toContainText("It is not a valuation or a forecast.");
  await expect(page.locator("[data-slot=evidence-line]")).toContainText("Not a valuation.");
  // An h3 under the result's h2; an h2 on /c, whose one h1 is the verdict (no level skipped).
  const level = new URL(page.url()).pathname.startsWith("/c/") ? 2 : 3;
  // "used": the registered sales adjusted to the listing, each with its adjustments (the first answer).
  // "median": the sales of the 12 months behind the same-building median (the fallback).
  const name = list === "used" ? `The ${sales} registered sales used` : `${sales} registered sales`;
  const slot = list === "used" ? "acs-list" : "sales-list";
  await expect(page.getByRole("heading", { level, name })).toBeVisible();
  // Phones: stacked rows; from 1024px: a table. Either way the rows show at once.
  await expect(page.locator(`[data-slot=${slot}] li, [data-slot=${slot}] tbody tr[data-row]`).first()).toBeVisible();
}
const ATTRIBUTION =
  "Source: Dubai Land Department sales transactions, published as open data on Data.Dubai and used under the Dubai Open Data Licence.";

/** Console errors and CSP violations collected per page; every test asserts none. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(msg.text());
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, "no horizontal page scroll").toBeLessThanOrEqual(iw);
}

/** The snapshot loads in the background after boot: wait until the server reports it loaded. */
async function waitForData(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const res = await page.request.get("/api/meta");
      return res.ok() ? ((await res.json()) as { data: { loaded: boolean } }).data.loaded : false;
    }, { timeout: 30_000 })
    .toBe(true);
}

/** Choose a bedroom count in the base-ui Select. */
async function chooseBedrooms(page: Page, label: string): Promise<void> {
  await page.getByRole("combobox", { name: "Bedrooms" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function typeDetails(page: Page, building: string): Promise<void> {
  await page.getByRole("button", { name: "Type the details" }).click();
  await expect(page.getByLabel("Building", { exact: true })).toBeVisible();
  await page.getByLabel("Building", { exact: true }).fill(building);
  await chooseBedrooms(page, LISTING.bedrooms);
  await page.getByLabel("Size (sq ft)").fill(LISTING.size);
  await page.getByLabel("Asking price (AED)").fill(LISTING.price);
}

async function compareTowerD(page: Page): Promise<void> {
  await typeDetails(page, LISTING.building);
  await expect(page.getByRole("radio", { name: /^Test Tower D\b/ })).toBeChecked();
  await page.getByRole("button", { name: "Compare price" }).click();
  await expect(page.getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();
}

function isMobile(info: TestInfo): boolean {
  return (info.project.use.viewport?.width ?? 1280) < 768;
}

let shareCode = "";

test.beforeEach(async ({ page }) => {
  // The desktop native share sheet cannot be driven headless: use the in-page fallback (Copy link).
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "share", { value: undefined, configurable: true });
    Object.defineProperty(Navigator.prototype, "canShare", { value: undefined, configurable: true });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("1. home shows the real 'From the data' panel, no demo, and does not scroll by itself", async ({ page }) => {
  const problems = watchConsole(page);
  await waitForData(page);
  await page.goto("/");
  const panel = page.getByRole("region", { name: "From the data" });
  await expect(panel.getByText("Test Tower D", { exact: true })).toBeVisible();
  await expect(panel.getByText("Dubai Marina (DLD area: Marsa Dubai)")).toBeVisible();
  // "AED", "sq ft" and dates are kept together with no-break spaces on screen (\s matches them).
  await expect(
    panel.getByText(/had the most registered sales of ready 2-bed apartments in the 12\smonths to 10\sNov\s2026: 11, at a median of AED\s1,669\sper\ssq\sft\./),
  ).toBeVisible();
  await expect(panel.getByText("Registered sales from 5 Jan 2026 to 10 Nov 2026.", { exact: false })).toBeVisible();
  await expect(panel.getByRole("link", { name: "See all buildings Fairsquare covers" })).toHaveAttribute("href", "/coverage");
  await expect(panel.getByText("Sales data runs to 10 Nov 2026.")).toBeVisible();
  // No example card, sample chips or demo labels (REAL_DATA.md section 8).
  await expect(page.locator("[data-slot=example-card], [data-slot=sample-chips]")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/demo|fictional|made-up/i);
  // The footer carries the attribution and independence lines (REAL_DATA.md section 9).
  await expect(page.locator("footer")).toContainText(ATTRIBUTION);
  await expect(page.locator("footer")).toContainText("Fairsquare is independent.");
  // The name is Fairsquare, in English only: the title, the brand link and the footer wordmark, and no
  // Arabic name or old brand anywhere on the page.
  await expect(page).toHaveTitle(/^Fairsquare\b/);
  await expect(page.getByRole("link", { name: "Fairsquare home" })).toBeVisible();
  await expect(page.locator("footer")).toContainText(/^Fairsquare/);
  await expect(page.locator('[lang="ar"]')).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/mizan|ميزان/i);
  const before = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  expect(before).toBe(0);
  await noHorizontalScroll(page);
  expect(problems).toEqual([]);
});

test("2–3. a typed Test Tower D listing is within the range of its adjusted sales, shares, and /c shows the same verdict", async ({ page, context, baseURL }) => {
  const problems = watchConsole(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
  await page.goto("/");
  await compareTowerD(page);
  await expect(page.locator("[data-slot=acs-range]")).toContainText("adjusted each one to this listing");
  await expect(page.locator("[data-slot=acs-verdict]")).toContainText("is within that range.");
  await evidenceIsFree(page);
  await noHorizontalScroll(page);

  // No partner configured: the estimator stays, the adviser opt-in says it isn't available yet.
  await page.locator("[data-slot=cost-row]").first().click();
  await expect(page.getByText("Talking to a mortgage adviser through Fairsquare isn't available yet.")).toBeVisible();
  await page.keyboard.press("Escape");

  // WhatsApp first: the wa.me link carries the section 8.2 text, which ends with the /c link.
  const wa = page.getByRole("link", { name: "Send on WhatsApp" }).first();
  await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=.*Not%20a%20valuation\.%20http/);

  // More ways to share: the card image, Download card, Copy link, Copy text.
  await page.getByRole("button", { name: "More ways to share" }).first().click();
  // Typed with no ready or off-plan: the card, like the fact line, doesn't call the listing ready.
  await expect(page.getByRole("img", { name: /^Fairsquare comparison card\. Test Tower D, 2-bed, / })).toBeVisible();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Link copied").first()).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/c\/[A-Z0-9]{6}$/);
  shareCode = link.split("/c/")[1];
  // The card downloads under the product's name and the listing's own text: fairsquare-{listing-slug}-{code}.png.
  const [card] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download card" }).click()]);
  expect(card.suggestedFilename()).toBe(`fairsquare-test-tower-d-${shareCode}.png`);

  await page.goto(`/c/${shareCode}`);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`${HEADLINE}$`) })).toBeVisible();
  await expect(page.locator("[data-slot=range-scale][data-source=acs]")).toBeVisible();
  await expect(page.getByRole("link", { name: "Compare a listing you're looking at" }).first()).toBeVisible();
  await expect(page.getByText(/^Today:/)).toHaveCount(0);
  // The sales list stays free: no ask in front of it (REAL_DATA.md section 9); attribution, independence, not a valuation.
  await evidenceIsFree(page);
  await noHorizontalScroll(page);
  expect(problems).toEqual([]);
});

test("4. a typed Test Tower D comparison can be saved and shows under Saved", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await compareTowerD(page);
  await page.getByRole("button", { name: "Save and track" }).first().click();
  await expect(page.getByRole("link", { name: "Tracking" }).first()).toBeVisible();

  await page.goto("/saved");
  await expect(page.getByRole("heading", { level: 1, name: "Saved" })).toBeVisible();
  await expect(page.getByText("Test Tower D").first()).toBeVisible();
  await noHorizontalScroll(page);
  expect(problems).toEqual([]);
});

test("5. not covered: Request it and track shows under Buildings you asked for", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await typeDetails(page, UNCOVERED);
  await page.getByRole("radio", { name: /None of these/ }).check();
  await page.getByRole("button", { name: "Compare price" }).click();
  await page.getByRole("button", { name: "Request it and track" }).click();
  await expect(page.getByText(/^Requested\. It shows under Saved\./)).toBeVisible();

  await page.goto("/saved");
  await expect(page.getByRole("heading", { name: "Buildings you asked for" })).toBeVisible();
  await expect(page.getByText(UNCOVERED).first()).toBeVisible();
  expect(problems).toEqual([]);
});

test("6. coverage searches the loaded buildings on the server", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/coverage");
  // While the streamed list replaces its placeholder the line can be in the document twice for a moment: the visible one counts.
  await expect(page.getByText("Counts are registered sales from 10 Nov 2025 to 10 Nov 2026, most sales first.").filter({ visible: true }).first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Search buildings" }).fill("test tower e");
  await expect(page).toHaveURL(/\/coverage\?q=test\+tower\+e$/);
  const list = page.locator("[data-slot=coverage-list]");
  await expect(list.getByText("Test Tower E", { exact: true }).filter({ visible: true })).toHaveCount(1);
  await expect(list.getByText("Test Tower D", { exact: true }).filter({ visible: true })).toHaveCount(0);
  await noHorizontalScroll(page);
  expect(problems).toEqual([]);
});

test("7. admin overview shows 3 comparisons and 1 request; the sales page shows the data source", async ({ page }, info) => {
  const problems = watchConsole(page);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  // Admin has its own shell: no public header or footer (D§3.8).
  await expect(page.getByRole("link", { name: "Fairsquare home" })).toHaveCount(0);
  await expect(page.locator("footer")).toHaveCount(0);
  // KPI grid: the "Comparisons" value (the three typed comparisons of tests 2 to 5).
  const kpi = page
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: /^Comparisons$/ }) })
    .locator("dd .sr-only");
  await expect(kpi).toHaveText("3");
  await expect(page.getByText(UNCOVERED).first()).toBeVisible();
  if (!isMobile(info)) await noHorizontalScroll(page);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

  await page.goto("/admin/sales");
  const source = page.getByRole("region", { name: "Data source" });
  await expect(source.getByRole("link", { name: "Test Transactions (synthetic)" })).toBeVisible();
  await expect(source).toContainText("Data range10 Jun 2025 to 10 Nov 2026");
  await expect(source).toContainText("In the database40 open-data sales in 9 buildings");
  expect(problems).toEqual([]);
});

test("9. a clean screenshot read reaches the result with no form, no field list and no skeleton ever rendered", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await fakeRead(page, READ_D, { clean: true });
  const sawForm = await watchForForm(page);
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();
  await expect(page).toHaveURL(/\?step=result&code=[A-Z0-9]{6}$/);
  expect(await sawForm()).toBe(false);
  // The fact line (the listing's own text, no labels), the scale of adjusted sales (no ASKING stamp on it); no stamped sheet.
  await expect(page.locator("[data-slot=fact-line]")).toContainText(/Test\sTower\sD,\sDubai\sMarina\.\s+Ready\s2-bed,\s1,284\ssq\sft,\sAED\s2,450,000\./);
  await expect(page.locator("[data-slot=range-scale][data-source=acs]")).toBeVisible();
  await expect(page.locator("[data-slot=market-scale], [data-slot=scale-stamp]")).toHaveCount(0);
  await expect(page.locator("[data-slot=stamped-sheet], [data-slot=listing-plate]")).toHaveCount(0);
  await evidenceIsFree(page);
  await noHorizontalScroll(page);
  expect(problems).toEqual([]);
});

test("9b. the size question shows the usual sizes as 3 buttons; one tap compares with 'about'", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/");
  // The synthetic tower's 11 sales form one size cluster; the fake read carries three, as a read of a
  // tower with several layouts would (the owner's Aykon listing: 815, 895 and 945 sq ft).
  await fakeRead(page, { ...READ_D, sizeSqft: null }, { clean: true, sizes: [{ sqft: 1165, sales: 3 }, { sqft: 1190, sales: 5 }, { sqft: 1240, sales: 3 }] });
  const sawForm = await watchForForm(page);
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: "What’s the size?" })).toBeFocused();
  const group = page.getByRole("group", { name: /^Usual 2-bed sizes in Test Tower D$/i });
  await expect(group.getByRole("button")).toHaveCount(3);
  await group.getByRole("button", { name: "About 1,190 sq ft, 5 sales" }).click();
  // AED 2,059 per sq ft at about 1,190 sq ft: above the range the adjusted sales point to for that size.
  await expect(page.getByRole("heading", { level: 2, name: "Above the range of adjusted sales" })).toBeVisible();
  await expect(page.locator("[data-slot=fact-line]")).toContainText(/about\s1,190\ssq\sft/);
  expect(await sawForm()).toBe(false);
  await evidenceIsFree(page);
  expect(problems).toEqual([]);
});

test("10. look-alike towers ask 'Which building is this?'; a row tap compares", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await fakeRead(page, READ_D, { towerCheck: true });
  const sawForm = await watchForForm(page);
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: "Which building is this?" })).toBeFocused();
  await noHorizontalScroll(page);
  await page.getByRole("button", { name: /^Test Tower D, / }).click();
  await expect(page.getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();
  expect(await sawForm()).toBe(false);
  await evidenceIsFree(page);
  expect(problems).toEqual([]);
});

test("11. a missing price asks one question, then compares", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await fakeRead(page, { ...READ_D, priceAed: null }, { clean: true });
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: "What’s the asking price?" })).toBeVisible();
  // No buttons: the price field takes focus, so the keypad opens at once (RESULT_SPEC 2.5 and 11).
  await expect(page.getByLabel("Asking price (AED)")).toBeFocused();
  await page.getByLabel("Asking price (AED)").fill("2450000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();
  await evidenceIsFree(page);
  expect(problems).toEqual([]);
});

test("12. extract_busy shows a countdown, then Try again", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await fakeRead(page, READ_D, { error: { status: 503, code: "extract_busy", message: "Claude is busy right now.", retryAfterSec: 3 } });
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: "Claude is busy right now." })).toBeFocused();
  const wait = page.getByRole("button", { name: /^Try again in \d s$/ });
  await expect(wait).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("button", { name: "Try again", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  // The 503 is an expected answer, not a page error.
  expect(problems.filter((p) => !/503/.test(p))).toEqual([]);
});

test("13. Edit, change the price: the result re-settles in place with a new code; Back shows the first code, then home", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await fakeRead(page, READ_D, { clean: true });
  const sawForm = await watchForForm(page);
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();
  const first = page.url();
  const firstCode = first.split("code=")[1];

  await page.getByRole("button", { name: "Edit the details" }).click();
  await expect(page.getByRole("heading", { name: "Change a detail" })).toBeVisible();
  await page.getByRole("button", { name: /^Asking price/ }).click();
  await expect(page.getByRole("heading", { name: "What’s the asking price?" })).toBeVisible();
  await page.getByLabel("Asking price (AED)").fill("2600000");
  await page.getByRole("button", { name: "Continue" }).click();
  // In place: no scene, no form; the new verdict (AED 2,025 per sq ft, over the range's AED 1,970) and a new code.
  await expect(page.getByRole("heading", { level: 2, name: "Above the range of adjusted sales" })).toBeVisible();
  await expect(page.locator("[data-slot=compare-flow]")).toHaveAttribute("data-view", "result");
  await expect(page.locator("[data-slot=fact-line]")).toContainText(/AED\s2,600,000\./);
  await expect(page).toHaveURL(/\?step=result&code=[A-Z0-9]{6}$/);
  const secondCode = page.url().split("code=")[1];
  expect(secondCode).not.toBe(firstCode);
  expect(await sawForm()).toBe(false);

  await page.goBack();
  await expect(page.getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();
  expect(page.url()).toBe(first);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Weigh the asking price." })).toBeVisible();
  expect(problems).toEqual([]);
});

test("14. Wrong building? opens the building question in the Change a detail sheet", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await fakeRead(page, READ_D, { clean: true });
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();
  await page.getByRole("button", { name: "Wrong building?" }).click();
  await expect(page.getByRole("heading", { name: "Which building is this?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Test Tower D, / })).toBeVisible();
  await expect(page.getByRole("button", { name: /^None of these/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search covered buildings" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).first().click();
  await expect(page.getByRole("heading", { name: "Which building is this?" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Wrong building?" })).toBeFocused();
  expect(problems).toEqual([]);
});

test("15. too few sales: the tally and the open list, with the attribution, independence and Not a valuation", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await fakeRead(page, { buildingText: "Test Tower E", areaText: null, bedrooms: 3, sizeSqft: 1400, priceAed: 2_800_000 }, { clean: true });
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: "Too few sales to compare yet" })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", /^2 of the \d sales needed$/);
  await expect(page.locator("[data-slot=market-scale]")).toHaveCount(0);
  await expect(page.locator("[data-slot=evidence-line]")).toContainText("Not a valuation.");
  const provenance = page.locator("[data-slot=provenance]");
  await expect(provenance).toContainText(ATTRIBUTION);
  await expect(provenance).toContainText("Fairsquare is independent.");
  await expect(provenance).toContainText("It is not a valuation or a forecast.");
  await expect(page.getByRole("heading", { level: 3, name: "2 registered sales" })).toBeVisible();
  expect(problems).toEqual([]);
});

/**
 * The second tier (REAL_DATA.md section 15, DESIGN.md section 6.16). E2E_SHOTS_DIR, when set, receives
 * a screenshot of every state in light and dark (never set in a normal run).
 */
const SHOTS = process.env.E2E_SHOTS_DIR;
async function shots(page: Page, info: TestInfo, name: string, target?: string): Promise<void> {
  if (!SHOTS) return;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${scheme}\\b`));
    const file = `${SHOTS}/${name}-${info.project.name}-${scheme}.png`;
    if (target) await page.locator(target).first().screenshot({ path: file });
    else await page.screenshot({ path: file, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

/** Rewrites the stored comparison's second tier in the response of POST /api/checks (the server's own check otherwise). */
async function withSimilar(page: Page, similar: unknown): Promise<void> {
  await page.unroute("**/api/checks");
  await page.route("**/api/checks", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const res = await route.fetch();
    const body = (await res.json()) as { check: Record<string, unknown> };
    await route.fulfill({ response: res, json: { ...body, check: { ...body.check, similar } } });
  });
}
const READ_E = { buildingText: "Test Tower E", areaText: null, bedrooms: 3, sizeSqft: 1400, priceAed: 2_800_000 };

test("16. too few sales with a range (the server's own comparison): the section, the scale, the named buildings, /c and the link preview", async ({ page }, info) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await fakeRead(page, READ_E, { clean: true });
  await addScreenshot(page);
  // The headline and the first tier are unchanged.
  await expect(page.getByRole("heading", { level: 2, name: "Too few sales to compare yet" })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", /^2 of the \d sales needed$/);
  const section = page.locator("[data-slot=similar-section]");
  await expect(section).toBeVisible();
  // Nothing here is rewritten in the browser: Test Tower E has 2 sales in the 12 months, 2 earlier
  // ones, and three other buildings of its community (Test Tower G, H and J) in the synthetic data.
  await expect(section.getByRole("heading", { level: 3, name: "A range from more registered sales" })).toBeVisible();
  await expect(section.locator("[data-slot=similar-range]")).toContainText(/They point to a median between AED\s[\d,]+ and AED\s[\d,]+\sper\ssq\sft for ready 3-beds in Test Tower E/);
  await expect(section.locator("[data-slot=similar-verdict]")).toContainText(/This asking price, AED\s2,000\sper\ssq\sft, is (within|above|below) that range\./);
  const evidence = section.locator("[data-slot=similar-evidence]");
  await expect(evidence).toContainText(/2\sregistered\ssales in this building in those 12\smonths, 2\searlier sales of the same type here, back to 11\sNov\s2023 and 10\sregistered\ssales of ready 3-beds in 3\sother buildings in Test Master Two\./);
  await expect(evidence).toContainText(/Their medians run from AED\s1,338 to AED\s1,583\sper\ssq\sft\./);
  await expect(evidence).toContainText("Other buildings are not matched on size or price level, and are weaker evidence than sales in this one. Not a valuation.");
  // Buildings matched on place, bedrooms and basis only are never called similar.
  await expect(section).not.toContainText(/similar/i);
  // Weaker than a verdict: no stamp and no percentage anywhere in it.
  await expect(section.locator("[data-slot=scale-stamp], [data-slot=verdict-headline]")).toHaveCount(0);
  await expect(section).not.toContainText("%");
  const scale = section.getByRole("group", { name: "Where this asking price sits against the range" });
  await expect(scale.locator("[data-slot=range-mark][data-kind=own]")).toHaveCount(2);
  await expect(scale.locator("[data-slot=range-mark][data-kind=other]")).toHaveCount(3);
  // The readout names each building as shown, never by a database id.
  await scale.focus();
  await page.keyboard.press("Home");
  await expect(section.locator("[data-slot=range-readout]")).toHaveText(/^Test Tower J: 4\sregistered\ssales, median AED\s1,338\sper\ssq\sft\.$/);
  await page.keyboard.press("End");
  await expect(section.locator("[data-slot=range-readout]")).toHaveText(/^Test Tower H: 3\sregistered\ssales, median AED\s1,583\sper\ssq\sft\.$/);
  await page.keyboard.press("Escape");
  // The list: the three buildings by name, most sales first.
  await section.getByRole("button", { name: "See the 3 other buildings" }).click();
  await expect(section.getByRole("row")).toHaveCount(4);
  await expect(section.getByRole("row").nth(1)).toHaveText(/Test Tower J\s*4\s*1,338/);
  await expect(section.getByRole("row", { name: /Test Tower G\s+3\s+1,444/ })).toBeVisible();
  await expect(section.getByRole("row", { name: /Test Tower H\s+3\s+1,583/ })).toBeVisible();
  // The building's own 12-month sales sit inside the range the page states (the consistency rule).
  const stored = (await (await page.request.get(`/api/checks/${new URL(page.url()).searchParams.get("code")}`)).json()) as { check: { similar: { rangeLowPsf: number; rangeHighPsf: number; modelVersion: number; comparables: Array<{ name: string }> } }; currentSimilar?: unknown };
  expect(stored.check.similar.rangeLowPsf).toBeLessThanOrEqual(1461);
  expect(stored.check.similar.rangeHighPsf).toBeGreaterThanOrEqual(1461);
  // The constants of the loaded snapshot (tests/fixtures/open-data/manifest.json), as data:build copied them.
  const fixtureManifest = JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", "open-data", "manifest.json"), "utf8")) as { similar: { constants: { version: number } } };
  expect(stored.check.similar.modelVersion).toBe(fixtureManifest.similar.constants.version);
  expect(stored.check.similar.comparables.map((c) => c.name)).toEqual(["Test Tower J", "Test Tower G", "Test Tower H"]);
  // The fallback to the second tier: adjusted registered sales ran first and gave no range (4 sales in
  // three years), so nothing of it is on the page and the second tier shows exactly as before.
  const acsStored = (stored.check as unknown as { acs: { shown: boolean; reason: string | null; scenario: string } }).acs;
  expect(acsStored).toMatchObject({ shown: false, reason: "too_few_comparables", scenario: "few" });
  await expect(page.locator("[data-slot=acs-section], [data-slot=acs-list], [data-source=acs]")).toHaveCount(0);
  await shots(page, info, "acs-fallback-tier2");
  expect(stored).not.toHaveProperty("currentSimilar");
  await noHorizontalScroll(page);
  await shots(page, info, "thin-own");

  // /c mirrors it, with the section's heading one level up, and the link preview says it is weaker evidence.
  const code = new URL(page.url()).searchParams.get("code") as string;
  await page.goto(`/c/${code}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Too few sales to compare yet");
  await expect(page.locator("[data-slot=similar-section]").getByRole("heading", { level: 2, name: "A range from more registered sales" })).toBeVisible();
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /^Too few sales in this building to compare\. More registered sales point to a median between AED [\d,]+ and AED [\d,]+ per sq ft\. Weaker evidence\. Not a valuation\.$/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /^Too few sales to compare: Test Tower E 3-bed$/);
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", /A range from more registered sales runs from AED [\d,]+ to AED [\d,]+ per sq ft; the asking price is (within|above|below) it\.$/);
  const og = await page.request.get(`/c/${code}/opengraph-image`);
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toBe("image/png");
  await noHorizontalScroll(page);
  await shots(page, info, "c-thin-own");
  if (SHOTS) (await import("node:fs")).writeFileSync(`${SHOTS}/og-thin-own-${info.project.name}.png`, await og.body());
  expect(problems).toEqual([]);
});

test("17. too few sales with many other buildings: rings, the list, the definitions and the keyboard; a refusal looks as it does today", async ({ page }, info) => {
  const problems = watchConsole(page);
  // The synthetic snapshot has three other buildings for Test Tower E (test 16 shows the server's own
  // answer). Here the stored second tier is replaced in the browser with a fixture that has nine.
  await page.goto("/");
  await withSimilar(page, { ...FIXTURE_SIMILAR, rangeLowPsf: 1880, rangeHighPsf: 2160, comparables: FIXTURE_SIMILAR.comparables.map((c) => ({ ...c, medianPsf: c.medianPsf + 160 })) });
  await fakeRead(page, READ_E, { clean: true });
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: "Too few sales to compare yet" })).toBeVisible();
  const section = page.locator("[data-slot=similar-section]");
  await expect(section.getByRole("heading", { level: 3, name: "A range from more registered sales" })).toBeVisible();
  await expect(section.locator("[data-slot=similar-evidence]")).toContainText("Other buildings are not matched on size or price level, and are weaker evidence than sales in this one. Not a valuation.");
  const scale = section.getByRole("group", { name: "Where this asking price sits against the range" });
  await expect(scale.locator("[data-slot=range-mark][data-kind=other]")).toHaveCount(9);
  await expect(section.locator("[data-slot=range-legend]")).toContainText("another building, at its median");
  await shots(page, info, "thin-similar");

  // The keyboard reaches every mark; the readout names the building.
  await scale.focus();
  await page.keyboard.press("End");
  await expect(section.locator("[data-slot=range-readout]")).toContainText(/^Culture Village Tower B: 5 registered sales, median AED\s2,310\sper\ssq\sft\.$/);
  await shots(page, info, "thin-similar-readout", "[data-slot=similar-section]");
  await page.keyboard.press("Escape");

  // The definitions, from the tier.
  await section.getByRole("button", { name: "Narrow range" }).click();
  await expect(page.getByText("Broad range: its ends are up to about 20% from its middle. Fairsquare shows nothing wider.")).toBeVisible();
  await expect(page.getByText(/held the building's own median in about 8 of 10 cases/)).toBeVisible();
  await shots(page, info, "thin-similar-definitions");
  await page.keyboard.press("Escape");

  // The list: open to everyone, closed until asked for.
  const toggle = section.getByRole("button", { name: "See the 9 other buildings" });
  await toggle.click();
  await expect(section.getByRole("table")).toBeVisible();
  await expect(section.getByRole("row", { name: /Creek Vista Heights\s+22\s+2,010/ })).toBeVisible();
  await section.getByRole("button", { name: "Show all 9" }).click();
  await expect(section.getByRole("row")).toHaveCount(10);
  await noHorizontalScroll(page);
  await shots(page, info, "thin-similar-list");

  // The share card carries the range (desktop shows its preview in the stage).
  if (!isMobile(info)) {
    await expect(page.locator("[data-slot=card-preview] img")).toBeVisible();
    await shots(page, info, "card-thin-similar", "[data-slot=card-preview]");
  }

  // Edit re-settles in place and the section follows the new comparison.
  await page.getByRole("button", { name: "Edit" }).first().click();
  await expect(page.getByRole("heading", { name: "Change a detail" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).first().click();

  // A refusal: the result is the too-few result of today, with no trace of the second tier.
  await page.goto("/");
  await withSimilar(page, FIXTURE_SIMILAR_REFUSED);
  await fakeRead(page, READ_E, { clean: true });
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: "Too few sales to compare yet" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "2 registered sales" })).toBeVisible();
  await expect(page.locator("[data-slot=similar-section], [data-slot=range-scale]")).toHaveCount(0);
  await shots(page, info, "thin-refused");
  if (!isMobile(info)) {
    await expect(page.locator("[data-slot=card-preview] img")).toBeVisible();
    await shots(page, info, "card-thin-refused", "[data-slot=card-preview]");
  }
  await page.unroute("**/api/checks");
  expect(problems).toEqual([]);
});

test("18. a building that is not in the data gets no range, and the pages say when Fairsquare declines", async ({ page }, info) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await typeDetails(page, UNCOVERED);
  await page.getByRole("radio", { name: /None of these/ }).check();
  await page.getByRole("button", { name: "Compare price" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Not covered yet" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-slot=similar-section], [data-slot=range-scale]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Request it and track" })).toBeVisible();
  await shots(page, info, "none");

  await page.goto("/how-it-works#too-few");
  const how = page.locator("#too-few");
  await expect(how.getByRole("heading", { level: 2, name: "When a building has too few sales" })).toBeVisible();
  await expect(how).toContainText("A building that is not in DLD sales data gets no range of this kind, with one exception.");
  await expect(how.locator("[data-slot=similar-project]")).toContainText("An area or a community alone never gives a range of this kind, and a ready building never gets one this way.");
  await expect(how.locator("[data-slot=similar-project-tested]")).toContainText("about 7 of 10 cases");
  await expect(how).toContainText("held the building's own median in about 8 of 10 cases");
  await expect(how).toContainText("about 6 to 8 of 10");
  await noHorizontalScroll(page);
  await shots(page, info, "how-too-few");
  await page.goto("/coverage");
  await expect(page.locator("[data-slot=coverage-similar]")).toContainText("It is weaker evidence.");
  await expect(page.locator("[data-slot=coverage-similar]").getByRole("link", { name: "How that works" })).toHaveAttribute("href", "/how-it-works#too-few");
  await shots(page, info, "coverage");
  expect(problems).toEqual([]);
});

test("19. the project route: an off-plan building that is not in the data, with other buildings of its project", async ({ page }, info) => {
  const problems = watchConsole(page);
  // The synthetic snapshot has no project with a number (the route is tested end to end in
  // tests/db/project-route.test.ts); here the stored entry is replaced in the browser with a fixture,
  // and the listing is made off-plan as the route requires.
  await page.goto("/");
  await page.unroute("**/api/checks");
  await page.route("**/api/checks", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const res = await route.fetch();
    const body = (await res.json()) as { check: { analysis: Record<string, unknown> } & Record<string, unknown> };
    await route.fulfill({ response: res, json: { ...body, check: { ...body.check, completion: "off_plan", analysis: { ...body.check.analysis, completionBasis: "off_plan" }, similar: FIXTURE_SIMILAR_PROJECT } } });
  });
  await typeDetails(page, UNCOVERED);
  await page.getByRole("radio", { name: /None of these/ }).check();
  await page.getByRole("button", { name: "Compare price" }).click();
  // The not-covered result is unchanged above it: headline, sentence and the request button.
  await expect(page.getByRole("heading", { level: 2, name: "Not covered yet" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Request it and track" })).toBeVisible();
  const section = page.locator("[data-slot=similar-section]");
  await expect(section.getByRole("heading", { level: 3, name: "A range from other buildings in the Dummyside Lagoon project" })).toBeVisible();
  await expect(section.locator("[data-slot=similar-range]")).toContainText(
    /^This building has no registered sales in the data, so Fairsquare looked at registered sales in other buildings in the Dummyside Lagoon project\. They point to a median between AED\s1,650 and AED\s2,070\sper\ssq\sft for off-plan [\w-]+ in a new building of this project/,
  );
  await expect(section.locator("[data-slot=similar-verdict]")).toContainText(/This asking price, AED\s[\d,]+\sper\ssq\sft, is (within|above|below) that range\./);
  const evidence = section.locator("[data-slot=similar-evidence]");
  await expect(evidence).toContainText(/^Broad range\. The range is built from 212\sregistered\ssales of off-plan [\w-]+ in 4\sother buildings in the Dummyside Lagoon project\./);
  await expect(evidence).toContainText("The building itself has no registered sales in the data. Other buildings are not matched on size or price level, and are weaker evidence than sales in the building itself. Not a valuation.");
  await expect(section).not.toContainText(/similar/i);
  await expect(section).not.toContainText("%");
  const scale = section.getByRole("group", { name: "Where this asking price sits against the range" });
  await expect(scale.locator("[data-slot=range-mark][data-kind=other]")).toHaveCount(4);
  await expect(scale.locator("[data-slot=range-mark][data-kind=own]")).toHaveCount(0);
  await noHorizontalScroll(page);
  await shots(page, info, "none-project");
  await shots(page, info, "none-project-section", "[data-slot=similar-section]");
  // The definitions: why it reaches further up, and the route's own tested share.
  await section.getByRole("button", { name: "Broad range" }).click();
  await expect(page.getByText("New buildings of a project have sold above its other buildings more often than below, so the range reaches further above their median than below it.")).toBeVisible();
  await expect(page.getByText(/held the median of their first six months of registered sales in about 7 of 10 cases/)).toBeVisible();
  await shots(page, info, "none-project-definitions");
  await page.keyboard.press("Escape");
  await section.getByRole("button", { name: "See the 4 other buildings" }).click();
  await expect(section.getByRole("row", { name: /Dummyside Lagoon 3\s+96\s+1,712/ })).toBeVisible();
  await noHorizontalScroll(page);
  await shots(page, info, "none-project-list");
  await page.unroute("**/api/checks");
  expect(problems).toEqual([]);
});

/**
 * Adjusted registered sales, the first answer (REAL_DATA.md section 16, DESIGN.md section 6.17). Test
 * Tower D's answers are the server's own; a too-few building with a range does not exist in the
 * synthetic snapshot, so that one state is a fixture put on the response in the browser.
 */
async function patchCheck(page: Page, patch: (check: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  await page.unroute("**/api/checks");
  await page.route("**/api/checks", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const res = await route.fetch();
    const body = (await res.json()) as { check: Record<string, unknown> };
    await route.fulfill({ response: res, json: { ...body, check: patch(body.check) } });
  });
}

async function axeClean(page: Page, what: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `axe on ${what}`).toEqual([]);
}

test("20. adjusted registered sales lead a building with 5 or more sales: the range, the outcome, the sales used, /c, the preview and Saved", async ({ page }, info) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await fakeRead(page, READ_D, { clean: true });
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();
  const code = new URL(page.url()).searchParams.get("code") as string;
  // The headline's hue words and its ink words; no percentage in it.
  await expect(page.locator("[data-slot=verdict-headline] [data-slot=verdict-figure]")).toHaveText("Within the range");
  await expect(page.locator("[data-slot=verdict-headline]")).not.toContainText("%");

  // The scale: the range for this listing's size at the data date, the asking pin, a dot per adjusted sale.
  const scale = page.getByRole("group", { name: "Where this asking price sits against the range of adjusted sales" });
  await expect(scale).toHaveAttribute("data-verdict", "within");
  await expect(scale.locator("[data-slot=range-low]")).toHaveText("1,550");
  await expect(scale.locator("[data-slot=range-high]")).toHaveText("1,970");
  await expect(scale.locator("[data-slot=range-asking]")).toHaveText(/Asking\s1,908/);
  await expect(scale.locator("[data-slot=range-mark][data-kind=own]")).toHaveCount(12);
  await expect(scale.locator("[data-slot=range-mark][data-kind=other]")).toHaveCount(0);
  await expect(page.locator("[data-slot=range-legend]")).toContainText("a registered sale, adjusted");
  await expect(page.locator("[data-slot=range-legend]")).toContainText(/the range, AED\s1,550 to 1,970/);
  await scale.focus();
  await page.keyboard.press("Home");
  await expect(page.locator("[data-slot=range-readout]")).toHaveText(/^\d+\s\w+\s\d{4}: [\d,]+\ssq\sft at AED\s[\d,]+\sper\ssq\sft\. Adjusted for date and size: AED\s[\d,]+\sper\ssq\sft\.$/);
  await shots(page, info, "acs-a-readout", "[data-slot=range-scale-block]");
  await page.keyboard.press("Escape");

  // The sentences: what was taken and adjusted, the range, the outcome, the median beside it.
  await expect(page.locator("[data-slot=acs-range]")).toHaveText(
    /^Fairsquare took 12\sregistered\ssales in Test Tower D and adjusted each one to this listing: to 10\sNov\s2026 for its date and to 1,284\ssq\sft for its size\. Adjusted this way, they point to a range of AED\s1,550 to AED\s1,970\sper\ssq\sft\.$/,
  );
  await expect(page.locator("[data-slot=acs-verdict]")).toHaveText(/^This asking price, AED\s1,908\sper\ssq\sft, is within that range\.$/);
  await expect(page.locator("[data-slot=acs-median]")).toHaveText(/^With no adjustment, the median of the 11 sales of the last 12 months is AED\s1,669\sper\ssq\sft\.$/);
  await expect(page.locator("[data-slot=gap-sentence], [data-slot=market-scale], [data-slot=scale-stamp], [data-slot=recent-line]")).toHaveCount(0);
  // The evidence line carries the tested share and names the DLD building.
  const evidence = page.locator("[data-slot=evidence-line]");
  await expect(evidence).toContainText(/The range is built from 12 sales of 2-beds in this building, registered from 10\sJun\s2025 to 10\sNov\s2026\./);
  await expect(evidence).toContainText("In tests, about 8 of 10 later sale prices were inside a range made this way.");
  await expect(evidence).toContainText("DLD building: Test Tower D.");
  await expect(evidence).toContainText("The adjustments are for date, size and, for a sale of another bedroom type, bedrooms. Floor, view and condition are not in DLD sales data. Not a valuation.");
  await expect(page.getByRole("button", { name: "Wrong building?" })).toBeVisible();
  // Never a word the valuation rules forbid.
  await expect(page.locator("[data-slot=result-below]")).not.toContainText(/estimat|predict|forecast|worth|\bvalue|similar|average|\bmodel/i);
  await noHorizontalScroll(page);
  await shots(page, info, "acs-a");

  // How the sales were adjusted: the definitions, with the test as it was run.
  await page.getByRole("button", { name: "How the sales were adjusted" }).click();
  await expect(page.getByText(/^Date: each sale is moved to 10\sNov\s2026 with the movement of registered sale prices in its area since its month\.$/)).toBeVisible();
  await expect(page.getByText(/It built the range from the sales registered before each date, then looked at apartments sold in the six months after\. About 8 of 10 of those later sale prices were inside the range\./)).toBeVisible();
  await shots(page, info, "acs-a-definitions");
  await page.keyboard.press("Escape");

  // The sales used: every registered sale with its date, size, registered and adjusted AED per sq ft.
  const list = page.locator("[data-slot=acs-list]");
  await expect(list.getByRole("heading", { level: 3, name: "The 12 registered sales used" })).toBeVisible();
  await expect(list.locator("[data-slot=acs-list-note]")).toHaveText("Each row is a registered sale and what Fairsquare changed to compare it with this listing. The rows that count most are first.");
  const rows = list.locator("li, tbody tr[data-row]");
  if (isMobile(info)) {
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toHaveText(/^10\sNov\s2026Adjusted: AED\s1,7331,189\ssq\sft at AED\s1,724\sper\ssq\sftFor date: no change\. For size: up 0\.5%\. Counts for 13%\.$/);
    await expect(list.getByRole("heading", { level: 4, name: "This building, 2-beds" })).toBeVisible();
  } else {
    await expect(rows).toHaveCount(8);
    await expect(list.getByRole("columnheader")).toHaveText(["Registered", "Size", "AED per sq ft", "For date", "For size", "Adjusted", "Counts for"]);
    await expect(rows.first().locator("th, td")).toHaveText([/^10\sNov\s2026$/, "1,189", "1,724", "no change", "up 0.5%", "1,733", "13%"]);
  }
  await list.scrollIntoViewIfNeeded();
  await shots(page, info, "acs-a-list", "[data-slot=acs-list]");
  await list.getByRole("button", { name: "Show all 12 rows" }).click();
  await expect(rows).toHaveCount(12);
  await expect(list.getByRole("button", { name: /^Show all/ })).toHaveCount(0);
  // The oldest sale used: June 2025, moved the furthest in date.
  await expect(rows.last()).toContainText(/10\sJun\s2025/);
  await noHorizontalScroll(page);
  await axeClean(page, "the result with a leading range");
  await shots(page, info, "acs-a-list-all");

  // The card (desktop shows its preview in the stage): the range in the median's place.
  if (!isMobile(info)) {
    await expect(page.locator("[data-slot=card-preview] img")).toBeVisible();
    await shots(page, info, "acs-a-card", "[data-slot=card-preview]");
  }
  // WhatsApp: the range and the outcome, no percentage and no median.
  const wa = await page.getByRole("link", { name: "Send on WhatsApp" }).first().getAttribute("href");
  const text = decodeURIComponent((wa as string).split("?text=")[1]);
  expect(text).toMatch(/^Test Tower D, ready 2-bed, 1,284 sq ft, asking AED 2,450,000 \(AED 1,908 per sq ft\)\. Registered sales in this building, each adjusted to this listing, point to AED 1,550 to AED 1,970 per sq ft\. The asking price, AED 1,908 per sq ft, is within that range\. Not a valuation\. Source: DLD open data via Data\.Dubai\. Not a valuation\. http/);
  expect(text).not.toMatch(/%|median/i);

  // Save it: the Saved line states the outcome against the range.
  await page.getByRole("button", { name: "Save and track" }).first().click();
  await expect(page.getByRole("link", { name: "Tracking" }).first()).toBeVisible();

  // /c mirrors it, and the link preview carries it.
  await page.goto(`/c/${code}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(HEADLINE);
  await expect(page.locator("[data-slot=range-scale][data-source=acs]")).toBeVisible();
  await expect(page.locator("[data-slot=acs-verdict]")).toHaveText(/is within that range\.$/);
  await expect(page.locator("[data-slot=acs-list]").getByRole("heading", { level: 2, name: "The 12 registered sales used" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Wrong building?" })).toHaveCount(0);
  await expect(page.getByText(/^Today:/)).toHaveCount(0);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Test Tower D 2-bed: within the range of adjusted sales");
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", "12 registered sales, each adjusted to this listing, point to AED 1,550 to AED 1,970 per sq ft. The asking price is within that range. Not a valuation.");
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", "A range from registered sales adjusted to this listing runs from AED 1,550 to AED 1,970 per sq ft; the asking price is within it.");
  const og = await page.request.get(`/c/${code}/opengraph-image`);
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toBe("image/png");
  if (SHOTS) (await import("node:fs")).writeFileSync(`${SHOTS}/og-acs-a-${info.project.name}.png`, await og.body());
  await noHorizontalScroll(page);
  await shots(page, info, "acs-a-c");

  await page.goto("/saved");
  await expect(page.locator("[data-slot=saved-acs]").first()).toHaveText(/^Saved \d+\s\w+\s\d{4}: within the range of adjusted sales\.$/);
  await noHorizontalScroll(page);
  await shots(page, info, "acs-a-saved");

  // How Fairsquare compares has the section, after the two it refers to.
  await page.goto("/how-it-works#adjusted");
  const how = page.locator("#adjusted");
  await expect(how.getByRole("heading", { level: 2, name: "How registered sales are adjusted to a listing" })).toBeVisible();
  await expect(how.locator("[data-slot=acs-fallback]")).toContainText("only when the range is narrow enough to say something");
  await expect(how.locator("[data-slot=acs-tested]")).toContainText("About 8 of 10 of those later sale prices were inside the range. After prices fall, more of the later sales are under the range than over it.");
  await noHorizontalScroll(page);
  await shots(page, info, "acs-how");
  expect(problems).toEqual([]);
});

test("21. adjusted registered sales, above and below the range: the words, the premium link and the listing check", async ({ page }, info) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await fakeRead(page, { ...READ_D, priceAed: 2_600_000 }, { clean: true });
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: "Above the range of adjusted sales" })).toBeVisible();
  await expect(page.locator("[data-slot=acs-verdict]")).toHaveText(/^This asking price, AED\s2,025\sper\ssq\sft, is above that range\.$/);
  await expect(page.locator("[data-slot=range-scale]")).toHaveAttribute("data-verdict", "above");
  await expect(page.getByRole("button", { name: "Ask what explains the premium" })).toBeVisible();
  await noHorizontalScroll(page);
  await shots(page, info, "acs-a-above");

  await page.goto("/");
  await fakeRead(page, { ...READ_D, sizeSqft: 1190, priceAed: 1_500_000 }, { clean: true });
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: "Below the range of adjusted sales" })).toBeVisible();
  await expect(page.locator("[data-slot=acs-verdict]")).toHaveText(/is below that range\.$/);
  await expect(page.locator("[data-slot=listing-check]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask what explains the premium" })).toHaveCount(0);
  await noHorizontalScroll(page);
  await shots(page, info, "acs-a-below");
  expect(problems).toEqual([]);
});

test("22. adjusted registered sales under 'Too few sales': the section in the second tier's place, its groups, and the size note", async ({ page }, info) => {
  const problems = watchConsole(page);
  // A fixture on the response (the synthetic snapshot has no too-few building with a range): three
  // years of sales of the type, two of another bedroom type, three rows of another building of the
  // project. The usual size is set to 1,800 sq ft so the 1,400 sq ft listing gets the size note.
  await page.goto("/");
  await patchCheck(page, (check) => ({ ...check, acs: { ...FIXTURE_ACS_FEW, typicalSizeSqft: 1800 } }));
  await fakeRead(page, READ_E, { clean: true });
  await addScreenshot(page);
  // The too-few result is unchanged above it: the headline, the tally, the sentence, the DLD building.
  await expect(page.getByRole("heading", { level: 2, name: "Too few sales to compare yet" })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", /^2 of the \d sales needed$/);
  await expect(page.locator("[data-slot=evidence-line]")).toContainText("DLD building: Test Tower E. Not a valuation.");
  // One range on the page: the second tier, which the server also stored, is not shown beside it.
  await expect(page.locator("[data-slot=similar-section]")).toHaveCount(0);
  const section = page.locator("[data-slot=acs-section]");
  await expect(section.getByRole("heading", { level: 3, name: "Registered sales, adjusted to this listing" })).toBeVisible();
  await expect(section.locator("[data-slot=acs-few]")).toHaveText(/^A median needs 5 sales in 12\smonths, so there is none here\. The range below comes from three years of registered sales in this building and in other buildings of its project, each adjusted to this listing\.$/);
  await expect(section.locator("[data-slot=acs-range]")).toHaveText(
    /^Fairsquare took 17\sregistered\ssales in Test Tower E and in other buildings of its project, and adjusted each one to this listing: to 10\sNov\s2026 for its date and to 1,400\ssq\sft for its size\. Adjusted this way, they point to a range of AED\s1,370 to AED\s1,610\sper\ssq\sft\.$/,
  );
  await expect(section.locator("[data-slot=acs-verdict]")).toHaveText(/^This asking price, AED\s2,000\sper\ssq\sft, is above that range\.$/);
  await expect(section.locator("[data-slot=acs-beyond]")).toHaveText(/^It is higher than all 17\sadjusted sales; the highest is AED\s1,526\sper\ssq\sft\.$/);
  await expect(section.locator("[data-slot=size-note]")).toHaveText(/^This listing is 22% smaller than the usual 3-bed sold in this building, 1,800\ssq\sft\. Each sale was adjusted for size; that adjustment is less exact this far from the usual size\.$/);
  await expect(section.locator("[data-slot=acs-evidence]")).toContainText("7 sales of 3-beds in this building, 2 sales of other bedroom types in this building and 8 sales in other buildings of the project");
  await expect(section.locator("[data-slot=acs-evidence]")).toContainText("In tests, about 8 of 10 later sale prices were inside a range made this way.");
  // No headline of its own, no stamp, no percentage above or below.
  await expect(section.locator("[data-slot=scale-stamp], [data-slot=verdict-headline]")).toHaveCount(0);
  const scale = section.getByRole("group", { name: "Where this asking price sits against the range of adjusted sales" });
  await expect(scale).toHaveAttribute("data-verdict", "above");
  await expect(scale.locator("[data-slot=range-mark][data-kind=own]").first()).toBeVisible();
  await expect(scale.locator("[data-slot=range-mark][data-kind=other]").first()).toBeVisible();
  await expect(section.locator("[data-slot=range-legend]")).toContainText("another bedroom type or building, adjusted");
  await noHorizontalScroll(page);
  await shots(page, info, "acs-b");

  // The list: closed until asked for, then grouped by where each sale comes from.
  const toggle = section.getByRole("button", { name: "See the 17 registered sales used" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(section.getByText("This building, 3-beds", { exact: true })).toBeVisible();
  await expect(section.getByText("This building, other bedroom types", { exact: true })).toBeVisible();
  await expect(section.getByText("Other buildings of the project", { exact: true })).toBeVisible();
  await expect(section.locator("[data-slot=acs-row-note]").filter({ hasText: "6 apartments registered at one price per sq ft. The size is their median." })).toBeVisible();
  await expect(section.locator("[data-slot=acs-row-note]").filter({ hasText: "2 sales registered with the same date, size and price." })).toBeVisible();
  // The section sits in the narrow column, so its list is the stacked rows at every width (no table to clip):
  // 5 rows of the first group and 3 of each other group until asked.
  await expect(section.locator("table")).toHaveCount(0);
  await expect(section.locator("li")).toHaveCount(10);
  await section.getByRole("button", { name: "Show all 11 rows" }).click();
  await expect(section.locator("li")).toHaveCount(11);
  // Nothing in the section is wider than the section.
  expect(await section.evaluate((el) => [...el.querySelectorAll("*")].every((n) => n.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1))).toBe(true);
  await noHorizontalScroll(page);
  await axeClean(page, "the too-few result with a range of adjusted sales");
  await shots(page, info, "acs-b-list", "[data-slot=acs-section]");
  // The building's own 12-month sales stay listed, as on every too-few result.
  await expect(page.getByRole("heading", { level: 3, name: "2 registered sales" })).toBeVisible();
  if (!isMobile(info)) {
    await expect(page.locator("[data-slot=card-preview] img")).toBeVisible();
    await shots(page, info, "acs-b-card", "[data-slot=card-preview]");
  }
  await page.unroute("**/api/checks");
  expect(problems).toEqual([]);
});

test("23. the fallbacks: the same-building median when no range is given, 'Too few sales' alone when both decline, and a comparison stored without a range", async ({ page }, info) => {
  const problems = watchConsole(page);
  // To the median: a 2-bed far larger than any sold in Test Tower D. The server's own answer: no
  // range (the size is outside what its sales cover), so the page is the median's, as before.
  await page.goto("/");
  await fakeRead(page, { ...READ_D, sizeSqft: 1700, priceAed: 2_900_000 }, { clean: true });
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: "In line with registered sales" })).toBeVisible();
  let code = new URL(page.url()).searchParams.get("code") as string;
  let stored = (await (await page.request.get(`/api/checks/${code}`)).json()) as { check: { acs: { shown: boolean; reason: string | null } | null; similar: { shown: boolean } | null } };
  expect(stored.check.acs).toMatchObject({ shown: false, reason: "too_few_comparables" });
  await expect(page.locator("[data-slot=market-scale]")).toBeVisible();
  await expect(page.locator("[data-slot=scale-stamp]")).toBeVisible();
  await expect(page.locator("[data-slot=gap-sentence]")).toContainText("above the median");
  await expect(page.locator("[data-slot=size-note]")).toContainText("larger than the typical sale here");
  await expect(page.locator("[data-slot=evidence-line]")).toContainText(/11\sregistered\ssales of ready 2-beds in Test Tower D/);
  await expect(page.locator("[data-slot=acs-list], [data-slot=acs-range], [data-slot=acs-section], [data-source=acs]")).toHaveCount(0);
  await evidenceIsFree(page, 11, "median");
  await noHorizontalScroll(page);
  await shots(page, info, "acs-fallback-tier1");

  // Refused by both: an off-plan 1-bed in Test Tower D has 3 sales. No range of adjusted sales, no
  // second tier: "Too few sales to compare yet" and its list, with nothing under it.
  await page.goto("/");
  await fakeRead(page, { buildingText: "Test Tower D", areaText: "Dubai Marina", bedrooms: 1, sizeSqft: 800, priceAed: 1_400_000 }, { clean: true, completion: "off_plan" });
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: "Too few sales to compare yet" })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", /^3 of the \d sales needed$/);
  code = new URL(page.url()).searchParams.get("code") as string;
  stored = (await (await page.request.get(`/api/checks/${code}`)).json()) as typeof stored;
  expect(stored.check.acs).toMatchObject({ shown: false });
  expect(stored.check.similar).toMatchObject({ shown: false });
  await expect(page.locator("[data-slot=acs-section], [data-slot=similar-section], [data-slot=range-scale]")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "3 registered sales" })).toBeVisible();
  await noHorizontalScroll(page);
  await shots(page, info, "acs-refused");

  // A comparison as it was stored before this existed (no entry at all): the Test Tower D listing
  // reads as it always did, with the fixed band, the market scale and the list of the 12 months.
  await page.goto("/");
  await patchCheck(page, (check) => {
    const { acs: _gone, ...old } = check;
    void _gone;
    return old;
  });
  await fakeRead(page, READ_D, { clean: true });
  await addScreenshot(page);
  await expect(page.getByRole("heading", { level: 2, name: MEDIAN_HEADLINE })).toBeVisible();
  await expect(page.locator("[data-slot=market-scale]")).toBeVisible();
  await expect(page.locator("[data-slot=gap-sentence]")).toContainText("above the median");
  await expect(page.locator("[data-slot=acs-list], [data-slot=acs-range], [data-source=acs]")).toHaveCount(0);
  await evidenceIsFree(page, 11, "median");
  await shots(page, info, "acs-old-stored");
  if (!isMobile(info)) {
    await expect(page.locator("[data-slot=card-preview] img")).toBeVisible();
    await shots(page, info, "acs-old-stored-card", "[data-slot=card-preview]");
  }
  await page.unroute("**/api/checks");
  expect(problems).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`8. axe: no serious or critical violations (${scheme})`, async ({ page }) => {
    expect(shareCode, "the share test ran first").not.toBe("");
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const problems = watchConsole(page);
    for (const path of ["/", "/saved", "/coverage", "/how-it-works", "/privacy", `/c/${shareCode}`]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${scheme}\\b`));
      await noHorizontalScroll(page);
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        serious.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        `axe on ${path} (${scheme})`,
      ).toEqual([]);
    }
    expect(problems, "no console errors or CSP violations").toEqual([]);
  });
}
