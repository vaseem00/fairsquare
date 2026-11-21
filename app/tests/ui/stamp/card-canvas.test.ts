// @vitest-environment jsdom
/**
 * The share card (RESULT_SPEC section 8.1): a 1080 x 1350 document, never the listing screenshot. The
 * fake canvas records every fillText, so the card's words can be read back in drawing order.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_ACS_FEW, FIXTURE_ACS_LEAD, FIXTURE_ACS_REFUSED } from "../../fixtures/acs-view";
import { FIXTURE_CHECK_MARINA, FIXTURE_CHECK_NONE, FIXTURE_CHECK_THIN } from "../../fixtures/api-fixtures";
import { FIXTURE_SIMILAR, FIXTURE_SIMILAR_OWN, FIXTURE_SIMILAR_OWN_ONLY } from "../../fixtures/similar-view";
import { ctx2d, makeCanvas } from "@/lib/stamp/canvas";
import { cardAlt, fitCardLink, renderCard } from "@/lib/stamp/card-canvas";
import { analyseWith } from "@/lib/domain/analyse";
import type { CheckView } from "@/lib/types";
import { CheckViewSchema } from "@/lib/validation/api";
import { installFakeCanvas, pngSize, type FakeCanvasEnv } from "./fake-canvas";

let env: FakeCanvasEnv;
beforeEach(() => {
  env = installFakeCanvas();
});
afterEach(() => env.restore());

/** The owner's listing, FYZ79D (tests/fixtures/aykon-check.json, real DLD sales). */
const AYKON: CheckView = CheckViewSchema.parse(
  (JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", "aykon-check.json"), "utf8")) as { check: unknown }).check,
);
function asking(priceAed: number): CheckView {
  const { analysis } = analyseWith(priceAed, AYKON.sizeSqft, AYKON.sales, AYKON.rules);
  return { ...AYKON, priceAed, analysis: { ...AYKON.analysis, ...analysis } };
}

/**
 * Aykon's 43 sales plus `extra` copies of its older ones (registered before the last 90 days), compared
 * at the same asking price: a taller mini scale (and above 80 sales, quantile dots).
 */
function withOlder(extra: number, over: Partial<CheckView> = {}): CheckView {
  const older = AYKON.sales.filter((s) => s.saleDate < "2026-08-18");
  const copies = Array.from({ length: extra }, (_, i) => ({ ...older[i % older.length] }));
  const { analysis, used } = analyseWith(AYKON.priceAed, AYKON.sizeSqft, [...AYKON.sales, ...copies], AYKON.rules);
  return { ...AYKON, ...over, sales: used, analysis: { ...AYKON.analysis, ...analysis } };
}

/** The card's words: whole strings as drawn, plus the stamp text joined (it is drawn a character at a time). */
const words = () => env.texts.join(" ");
const stampText = () => env.texts.filter((s) => s.length === 1 && s !== " ").join("");

describe("renderCard (RESULT_SPEC section 8.1)", () => {
  it("the owner's listing: a 1080 x 1350 PNG named after the listing's own text", async () => {
    const file = await renderCard({ check: AYKON });
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("fairsquare-aykon-city-tower-c-FYZ79D.png");
    expect(file.type).toBe("image/png");
    const size = await pngSize(file);
    expect(size.signature).toBe(true);
    expect([size.width, size.height]).toEqual([1080, 1350]);
  });

  it("in line: the header, the listing, the verdict, the two figures, the recent line, the scale labels, the source and the link", async () => {
    await renderCard({ check: AYKON });
    expect(env.texts).toEqual(
      expect.arrayContaining([
        "Fairsquare",
        "Aykon City Tower C",
        "Ready 2-bed, 812 sq ft, asking AED 1,450,000",
        "In line",
        " with",
        "registered sales",
        "Asking, per sq ft",
        "AED 1,786",
        "Median of 43 sales, per sq ft",
        "AED 1,761",
        "Last 90 days: median AED 1,602 per sq ft (11 sales).",
        "Recent sales are lower.",
        "Asking 1,786",
        "Median",
        "1,761",
        "2,500",
        "3,000",
        "Each dot is one registered sale. Filled: since 18 Aug.",
        "See all 43 sales: fairsquare.example/c/FYZ79D",
      ]),
    );
    expect(env.texts.some((s) => /^Compared \d{1,2} \w{3} 2026$/.test(s))).toBe(true);
    expect(words()).toContain("Registered sales, 16 Nov 2025 to 16 Nov 2026. DLD open data via Data.Dubai.");
    expect(words()).toContain("Not a valuation. Fairsquare is independent of DLD.");
    // The verdict stamp: FAIRSQUARE [scale] IN LINE / +1.4% / VS MEDIAN OF 43 REGISTERED SALES / 2-BED 12 MONTHS TO 16 NOV 2026.
    expect(stampText()).toContain("FAIRSQUAREINLINE");
    expect(stampText()).toContain("+1.4%");
    expect(stampText()).toContain("VSMEDIANOF43REGISTEREDSALES");
    expect(stampText()).toContain("2-BED12MONTHSTO16NOV2026");
    expect(stampText()).not.toContain("READY");
    // A document, not a screenshot: no adviser, no monthly payment, no petrol footer copy.
    expect(words()).not.toMatch(/a month|adviser|See the sales:|Floor, view and condition/);
  });

  it("above (AED 1,650,000): ABOVE and +15.4% on the stamp, the verdict's figure words", async () => {
    await renderCard({ check: asking(1_650_000) });
    expect(env.texts).toEqual(expect.arrayContaining(["15.4% above", "registered sales", "AED 2,032", "Asking 2,032"]));
    expect(stampText()).toContain("FAIRSQUAREABOVE");
    expect(stampText()).toContain("+15.4%");
  });

  it("a leading range of adjusted registered sales: the outcome, the range in the median's place, its stamp, its scale, source and link", async () => {
    await renderCard({ check: { ...FIXTURE_CHECK_MARINA, acs: FIXTURE_ACS_LEAD } });
    expect(env.texts).toEqual(
      expect.arrayContaining([
        "Within the range",
        "of adjusted sales",
        "Asking, per sq ft",
        "AED 1,908",
        "Adjusted sales, per sq ft",
        "AED 1,550 to 1,970",
        "Registered sales adjusted to this listing, AED per sq ft",
        "Asking 1,908",
        "1,550",
        "1,970",
        "Each dot is one registered sale, adjusted to this listing.",
        "See the 12 sales used: localhost:3000/c/K7Q2MX",
      ]),
    );
    expect(words()).toContain("Registered sales, 10 Jun 2025 to 10 Nov 2026, each adjusted to 10 Nov 2026. DLD open data via Data.Dubai.");
    expect(words()).toContain("Not a valuation. Fairsquare is independent of DLD.");
    expect(stampText()).toContain("FAIRSQUAREWITHIN");
    expect(stampText()).toContain("1,550TO1,970");
    expect(stampText()).toContain("AEDPERSQFTFROM12REGISTEREDSALES");
    expect(stampText()).toContain("2-BEDADJUSTEDTO10NOV2026");
    // No percentage, no median and no recent-sales line anywhere on it.
    expect(words()).not.toMatch(/%|Median|Last 90 days|registered sales$/);
  });

  it("a refused or absent range draws the card exactly as before", async () => {
    await renderCard({ check: FIXTURE_CHECK_MARINA });
    const before = [...env.texts];
    env.restore();
    env = installFakeCanvas();
    await renderCard({ check: { ...FIXTURE_CHECK_MARINA, acs: FIXTURE_ACS_REFUSED } });
    expect(env.texts).toEqual(before);
  });

  it("too few with a range of adjusted registered sales: TOO FEW stays, the range scale is theirs", async () => {
    await renderCard({ check: { ...FIXTURE_CHECK_THIN, acs: FIXTURE_ACS_FEW } });
    expect(env.texts).toEqual(expect.arrayContaining(["Too few sales", "to compare yet", "Registered sales adjusted to this listing, AED per sq ft", "1,370", "1,610", "Each dot is one or more registered sales, adjusted.", "See the 17 sales used: localhost:3000/c/C2HT3B"]));
    // The source line names the sales drawn (their dates and the project), not the 12-month window; no "See all 2 sales".
    expect(words()).toContain("Registered sales in this building and its project, 5 Mar 2024 to 14 Oct 2026, each adjusted to 10 Nov 2026.");
    expect(words()).not.toMatch(/See all 2 sales/);
    expect(stampText()).toContain("FAIRSQUARETOOFEW");
    expect(words()).not.toContain("The range from more registered sales");
  });

  it("with no drift there is no recent line (the scale moves up)", async () => {
    await renderCard({ check: { ...AYKON, analysis: { ...AYKON.analysis, medianPsf: 1610 } } });
    expect(words()).not.toContain("Last 90 days");
    expect(words()).toContain("Each dot is one registered sale.");
  });

  it("too few: the tally figure, TOO FEW on the stamp and the count sentence instead of the scale", async () => {
    await renderCard({ check: FIXTURE_CHECK_THIN });
    expect(env.texts).toEqual(
      expect.arrayContaining(["Too few sales", "to compare yet", "Asking, per sq ft", "Registered sales found", "2 of the 5 needed", "See all 2 sales: localhost:3000/c/C2HT3B"]),
    );
    expect(words()).toContain("Only 2 registered sales of ready 3-beds in this building in 12 months.");
    expect(words()).not.toContain("Each dot");
    expect(stampText()).toContain("FAIRSQUARETOOFEW");
    expect(stampText()).toContain("2OF5");
    expect(stampText()).toContain("SALESNEEDEDTOCOMPARE");
  });

  it("too few with no range: the registered sales found are listed, so the middle of the card is evidence", async () => {
    await renderCard({ check: FIXTURE_CHECK_THIN });
    const s = FIXTURE_CHECK_THIN.sales[0];
    expect(env.texts).toEqual(expect.arrayContaining([`${Math.round(s.sizeSqft).toLocaleString("en-US")} sq ft`, `AED ${Math.round(s.priceAed).toLocaleString("en-US")}`, `AED ${Math.round(s.psf).toLocaleString("en-US")} per sq ft`]));
    expect(env.texts.filter((x) => / per sq ft$/.test(x) && /^AED/.test(x))).toHaveLength(FIXTURE_CHECK_THIN.sales.length);
    expect(words()).not.toContain("The range from more registered sales");
  });

  it("too few with a range: its label, the two ends, the asking label and the weaker-evidence caption; still the TOO FEW stamp and no percentage", async () => {
    const check = { ...FIXTURE_CHECK_THIN, similar: FIXTURE_SIMILAR };
    await renderCard({ check });
    expect(env.texts).toEqual(
      expect.arrayContaining([
        "Too few sales",
        "to compare yet",
        "2 of the 5 needed",
        "The range from more registered sales, AED per sq ft",
        "1,720",
        "1,980",
        "Asking 1,890",
        "Rings: other buildings, at their median. Weaker evidence.",
        "See all 2 sales: localhost:3000/c/C2HT3B",
      ]),
    );
    expect(words()).toContain("Only 2 registered sales of ready 3-beds in this building in 12 months.");
    expect(stampText()).toContain("FAIRSQUARETOOFEW");
    expect(stampText()).toContain("2OF5");
    expect(words()).not.toMatch(/\d%/);
    // The sales rows give way to the range scale.
    expect(env.texts.filter((x) => /^AED [\d,]+ per sq ft$/.test(x))).toHaveLength(0);
    // Resting on the building's own sales: no rings to explain.
    env.texts.length = 0;
    await renderCard({ check: { ...FIXTURE_CHECK_THIN, similar: FIXTURE_SIMILAR_OWN } });
    expect(env.texts).toContain("Weaker evidence than 5 or more sales in 12 months.");
    expect(words()).not.toContain("Rings:");
    // Nothing but the 12 months' own sales: the card is the plain too-few card, with its sales listed.
    env.texts.length = 0;
    await renderCard({ check: { ...FIXTURE_CHECK_THIN, similar: FIXTURE_SIMILAR_OWN_ONLY } });
    expect(words()).not.toContain("The range from more registered sales");
    expect(env.texts.filter((x) => /^AED [\d,]+ per sq ft$/.test(x))).toHaveLength(FIXTURE_CHECK_THIN.sales.length);
  });

  it("the footer link is never cut: a long host shrinks the line, then drops the words, and the code always shows", async () => {
    const ctx = ctx2d(makeCanvas(1, 1));
    const full = (host: string) => `See all 43 sales: ${host}/c/FYZ79D`;
    const short = (host: string) => `${host}/c/FYZ79D`;
    expect(fitCardLink(ctx, full("fairsquare.example"), short("fairsquare.example"), 952, "sans")).toEqual({ text: full("fairsquare.example"), size: 30 });
    const long = "mizan-app-production-3c1f.up.railway.app";
    const fitted = fitCardLink(ctx, full(long), short(long), 952, "sans");
    expect(fitted.text.endsWith("/c/FYZ79D")).toBe(true);
    expect(fitted.text).not.toContain("…");
    ctx.font = `700 ${fitted.size}px sans`;
    expect(ctx.measureText(fitted.text).width).toBeLessThanOrEqual(952);
    const huge = `${"very-long-subdomain-".repeat(8)}example.app`;
    const cut = fitCardLink(ctx, full(huge), short(huge), 952, "sans");
    expect(cut.text.startsWith("…")).toBe(true);
    expect(cut.text.endsWith("/c/FYZ79D")).toBe(true);
    // On the card itself.
    await renderCard({ check: { ...AYKON, url: `https://${long}/c/FYZ79D` } });
    expect(env.texts.some((x) => x.endsWith(`${long}/c/FYZ79D`))).toBe(true);
    expect(words()).not.toContain("…");
  });

  it("an off-plan comparison adds OFF-PLAN to row D", async () => {
    await renderCard({ check: { ...FIXTURE_CHECK_MARINA, analysis: { ...FIXTURE_CHECK_MARINA.analysis, completionBasis: "off_plan" } } });
    expect(stampText()).toContain("12MONTHSTO17NOV2026OFF-PLAN");
    expect(env.texts).toContain("Off-plan 2-bed, 1,284 sq ft, asking AED 2,450,000");
  });

  it("a listing that didn't say ready or off-plan is not called ready on the card", async () => {
    await renderCard({ check: { ...AYKON, completion: "unknown" } });
    expect(env.texts).toContain("2-bed, 812 sq ft, asking AED 1,450,000");
    expect(words()).not.toContain("Ready 2-bed");
  });

  it("the caption under the mini scale: no 'Filled' claim when no dot is filled; 'about k sales' a dot above 80 sales", async () => {
    // A year later every sale is older than 90 days: no filled dot.
    await renderCard({ check: { ...AYKON, analysis: { ...AYKON.analysis, dataThrough: "2027-11-16" } } });
    expect(env.texts).toContain("Each dot is one registered sale.");
    expect(words()).not.toContain("Filled");
    env.texts.length = 0;
    // 120 sales: 40 quantile dots of about 3 sales each.
    await renderCard({ check: withOlder(77) });
    expect(env.texts.find((s) => s.startsWith("Each dot"))).toMatch(/^Each dot is about 3 registered sales\./);
    expect(words()).not.toContain("Each dot is one registered sale");
    expect(words()).toContain("See all 120 sales:");
  });

  it("a tall scale under a two-line building and the recent line never pushes the link off the 1350px card", async () => {
    const building = "Aykon City Tower C at Sheikh Zayed Road, Business Bay Waterfront";
    for (const extra of [15, 20, 30, 37]) {
      env.draws.length = 0;
      const check = withOlder(extra, { buildingText: building });
      await renderCard({ check });
      const at = (re: RegExp) => env.draws.find((d) => re.test(d.text));
      const link = at(/^See all \d+ sales:/);
      const caption = at(/^Each dot is/);
      const source = at(/^Registered sales, /);
      expect(at(/^Last 90 days:/), `recent line, +${extra}`).toBeDefined();
      expect(link, `link, +${extra}`).toBeDefined();
      // The link's 38px line ends at 1310 at the latest (its baseline about 9px above that).
      expect(link?.y ?? Infinity, `link y, +${extra}`).toBeLessThanOrEqual(1310 - 8);
      // The caption sits above the footer's source line, which sits above the link.
      expect((caption?.y ?? Infinity) + 36, `caption, +${extra}`).toBeLessThan(source?.y ?? 0);
      expect((source?.y ?? Infinity) + 28, `source, +${extra}`).toBeLessThan(link?.y ?? 0);
    }
  });

  it("not covered: no card", async () => {
    await expect(renderCard({ check: FIXTURE_CHECK_NONE })).rejects.toThrow(/no card/);
    expect(cardAlt(FIXTURE_CHECK_NONE)).toBeNull();
  });

  it("the card's text alternative", () => {
    expect(cardAlt(AYKON)).toBe(
      "Fairsquare comparison card. Aykon City Tower C, ready 2-bed, 812 sq ft, asking AED 1,450,000. In line with registered sales. Asking AED 1,786 per sq ft, median of 43 sales AED 1,761 per sq ft. Not a valuation.",
    );
    expect(cardAlt(FIXTURE_CHECK_THIN)).toBe(
      "Fairsquare comparison card. Dummyside Hts 2, ready 3-bed, 1,905 sq ft, asking AED 3,600,000. Too few sales to compare yet: 2 of the 5 registered sales needed. Not a valuation.",
    );
  });
});
