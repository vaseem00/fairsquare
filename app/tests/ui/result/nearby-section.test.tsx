// @vitest-environment jsdom
/**
 * Nearby registered sales on a result (DESIGN.md section 6.18; REAL_DATA.md section 17): the headline,
 * the note directly under it, the scale of rings, the sentences, the weakness note, the sales used, the
 * fallbacks (the result is then exactly what it was), the /c mirror, the stamp, the card's words, the
 * link preview, the share text and the Saved line. The fixtures are synthetic.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { linkMock, renderWithProviders, setMedia } from "../shell/test-utils";

vi.mock("@/lib/api/client", async () => ({ api: (await import("../shell/api-mock")).makeApiMock() }));
vi.mock("next/link", () => linkMock);
vi.mock("@/lib/stamp/card-canvas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stamp/card-canvas")>()),
  renderCard: vi.fn(async () => new File(["png"], "card.png", { type: "image/png" })),
}));

import { ogLines } from "@/app/c/[code]/opengraph-image";
import { resultSlots, useCardGetter, useResultUi } from "@/components/check/result-view";
import { NEARBY_LIST_ROWS } from "@/components/result/nearby-section";
import { VerdictHeadline } from "@/components/result/verdict-summary";
import { nowLine, thenLine } from "@/components/saved/saved-item";
import { SharePageView } from "@/components/share/share-page";
import { cardAlt, howBody, nearbyLines, nearbyPlace, nearbyShown, ogAlt, ogDescription, ogTitle, plainNotCovered, shareText, stampProps, verdictAnnouncement, verdictHeadOf, verdictHeadText } from "@/lib/copy";
import { shownNearby } from "@/lib/nearby/shown";
import { nearbyScale } from "@/lib/result/nearby-scale";
import { cardNearbyCaption, nearbyRangeLegend, nearbyRangeReadout, nearbyRangeSummary } from "@/lib/result/words";
import { layoutStamp, STAMP_WIDTH } from "@/lib/stamp/geometry";
import type { CheckView, NearbyView } from "@/lib/types";
import { NearbyViewSchema } from "@/lib/validation/api";
import { FIXTURE_ACS_FEW } from "../../fixtures/acs-view";
import { FIXTURE_CHECK_MARINA, FIXTURE_CHECK_NONE, FIXTURE_CHECK_THIN, FIXTURE_SAVED } from "../../fixtures/api-fixtures";
import { FIXTURE_NEARBY_IN, FIXTURE_NEARBY_OUT, FIXTURE_NEARBY_REFUSED } from "../../fixtures/nearby-view";
import { FIXTURE_SIMILAR } from "../../fixtures/similar-view";

const plain = (s: string | null | undefined) => (s ?? "").replace(/ /g, " ").replace(/⁠/g, "").replace(/\s+/g, " ").trim();
const OUT: CheckView = { ...FIXTURE_CHECK_NONE, nearby: FIXTURE_NEARBY_OUT };
const IN: CheckView = { ...FIXTURE_CHECK_THIN, similar: null, acs: null, nearby: FIXTURE_NEARBY_IN };

/** The legal word rules (copy-nearby.test.ts): no sentence the page builds may break them. */
const BANNED =
  /estimat|forecast|predict|\bworth\b|\bvalues?\b|\bvalued\b|fair price|overpriced|underpriced|\bdeals?\b|checked|verified|approved|certified|average|outlier|trimmed|percentile|\bmodels?\b|similar|·|→/i;
const clean = (s: string) => !BANNED.test(s) && !/valuation/i.test(s.replace(/Not a valuation/g, "")) && !/\bfair\w*/i.test(s.replace(/Fairsquare/g, ""));

function Slots({ check, desktop = false, onEdit }: { check: CheckView; desktop?: boolean; onEdit?: (entry: string) => void }) {
  const ui = useResultUi();
  const getCard = useCardGetter(check);
  const s = resultSlots({ check, image: null, match: null, desktop, getCard, ui: onEdit ? { ...ui, openEdit: onEdit } : ui, onAnother: () => undefined, onPickBuilding: () => undefined, onCompareReady: () => undefined });
  return (
    <>
      <div data-testid="chart">{s.chart}</div>
      <div data-testid="below">{s.below}</div>
      <div data-testid="rest">{s.rest}</div>
    </>
  );
}
const noIds = (html: string) => html.replace(/_r_[0-9a-z]+_/g, "_r_");
const slotsHtml = (r: ReturnType<typeof renderWithProviders>) => noIds(["chart", "below", "rest"].map((id) => r.getByTestId(id).innerHTML).join("|"));

describe("when it shows: nearbyShown", () => {
  it("only as the last resort: never beside a verdict, a range of adjusted sales or of the second tier, and only for its own kind", () => {
    expect(nearbyShown(OUT)?.verdict).toBe("above");
    expect(nearbyShown(IN)?.verdict).toBe("within");
    expect(plainNotCovered(OUT)).toBe(false);
    expect(plainNotCovered(FIXTURE_CHECK_NONE)).toBe(true);
    // A verdict of the building's own.
    expect(nearbyShown({ ...FIXTURE_CHECK_MARINA, nearby: FIXTURE_NEARBY_IN })).toBeNull();
    // Another answer shows on the too-few result.
    expect(nearbyShown({ ...IN, acs: FIXTURE_ACS_FEW })).toBeNull();
    expect(nearbyShown({ ...IN, similar: FIXTURE_SIMILAR })).toBeNull();
    // The wrong kind for the comparison.
    expect(nearbyShown({ ...FIXTURE_CHECK_NONE, nearby: FIXTURE_NEARBY_IN })).toBeNull();
    expect(nearbyShown({ ...FIXTURE_CHECK_THIN, similar: null, acs: null, nearby: FIXTURE_NEARBY_OUT })).toBeNull();
  });

  it("nothing for no entry, a refusal, an unsafe entry or another version: every page, card and text is what it was", () => {
    const unsafe: (NearbyView | null | undefined)[] = [null, undefined, FIXTURE_NEARBY_REFUSED, { ...FIXTURE_NEARBY_OUT, comparables: [] }, { ...FIXTURE_NEARBY_OUT, rangeLowPsf: null }, { ...FIXTURE_NEARBY_OUT, community: null }, { ...FIXTURE_NEARBY_OUT, tested: null }];
    for (const nearby of unsafe) {
      const c = { ...FIXTURE_CHECK_NONE, nearby } as CheckView;
      expect(nearbyShown(c)).toBeNull();
      for (const f of [shareText, ogTitle, ogDescription, ogAlt, cardAlt, verdictAnnouncement, verdictHeadText, howBody] as const) expect(f(c)).toBe(f(FIXTURE_CHECK_NONE));
      expect(stampProps(c)).toEqual(stampProps(FIXTURE_CHECK_NONE));
      expect(ogLines(c)).toEqual(ogLines(FIXTURE_CHECK_NONE));
    }
    const t1 = renderWithProviders(<Slots check={{ ...FIXTURE_CHECK_THIN, nearby: FIXTURE_NEARBY_REFUSED }} />);
    const thinHtml = slotsHtml(t1);
    t1.unmount();
    const t2 = renderWithProviders(<Slots check={FIXTURE_CHECK_THIN} />);
    expect(slotsHtml(t2)).toBe(thinHtml);
    expect(NearbyViewSchema.safeParse({ ...FIXTURE_NEARBY_OUT, v: 2 }).success).toBe(false);
    expect(shownNearby(FIXTURE_NEARBY_OUT)).not.toBeNull();
  });
});

describe("a building that is not in the data (kind out)", () => {
  it("the headline gives the result, not 'Not covered yet'", () => {
    expect(verdictHeadOf(OUT)).toEqual({ figure: "Above the range", rest: "of nearby sales", tone: "above" });
    renderWithProviders(<VerdictHeadline check={OUT} />);
    const h = screen.getByRole("heading", { level: 2, name: "Above the range of nearby sales" });
    expect(h.querySelector("[data-slot=verdict-figure]")).toHaveTextContent("Above the range");
    expect(h.querySelector("[data-slot=verdict-figure]")?.className).toMatch(/text-verdict-above/);
    expect(h.textContent).not.toMatch(/%|Not covered/);
  });

  it("directly under it: the building was not found, and the range comes from other buildings, named; then the scale, the sentences, the weakness note", () => {
    const onEdit = vi.fn();
    renderWithProviders(<Slots check={OUT} onEdit={onEdit} />);
    const chart = screen.getByTestId("chart");
    const below = screen.getByTestId("below");
    // The note is above the scale, in the chart slot (the slot right under the headline and the fact line).
    const own = chart.querySelector("[data-slot=nearby-own]") as HTMLElement;
    expect(plain(own.textContent)).toBe(
      `Fairsquare could not find “${OUT.buildingText}” in Dubai Land Department sales data, so there are no registered sales of this building to compare.The range here comes from other buildings in Test Science Park, not from this one.`,
    );
    const scale = chart.querySelector("[data-slot=range-scale][data-source=nearby]") as HTMLElement;
    expect(scale).not.toBeNull();
    expect(own.compareDocumentPosition(scale) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scale.getAttribute("data-verdict")).toBe("above");
    // Every mark is a ring (another building); nothing is drawn as this building's.
    expect(chart.querySelectorAll("[data-slot=range-mark][data-kind=own]").length).toBe(0);
    expect(chart.querySelectorAll("[data-slot=range-mark][data-kind=other]").length).toBeGreaterThan(0);
    expect(plain(chart.querySelector("[data-slot=range-summary]")?.textContent)).toMatch(/^The range runs from AED 990 to AED 1,770 per sq ft\. The asking price, AED [\d,]+ per sq ft, is above it\. 14 adjusted registered sales in other buildings are marked\.$/);
    expect(plain(chart.querySelector("[data-slot=range-legend]")?.textContent)).toMatch(/a registered sale in another building, adjusted.*the range, AED 990 to 1,770/);
    expect(plain(below.querySelector("[data-slot=nearby-range]")?.textContent)).toMatch(
      /^Fairsquare took 14 registered sales of ready [\w-]+ in 5 other buildings in Test Science Park and adjusted each one to this listing: to 10 Nov 2026 for its date and to [\d,]+ sq ft for its size\. Adjusted this way, they point to a range of AED 990 to AED 1,770 per sq ft\.$/,
    );
    expect(plain(below.querySelector("[data-slot=nearby-verdict]")?.textContent)).toMatch(/^This asking price, AED [\d,]+ per sq ft, is above that range\.$/);
    expect(plain(below.querySelector("[data-slot=nearby-weak]")?.textContent)).toBe(
      "These sales are in other buildings. A building priced above or below its neighbours, for its brand, quality, view or age, will read above or below this range. In tests, about 7 of 10 later sale prices were inside a range made this way. Fairsquare could not find this building in DLD sales data. Its name may be registered differently.",
    );
    const evidence = below.querySelector("[data-slot=evidence-line][data-tier=nearby]") as HTMLElement;
    expect(plain(evidence.querySelector("p")?.textContent)).toBe("Not a valuation.");
    // The way to the building question, worded for a building that was not found.
    const pick = within(evidence).getByRole("button", { name: "Find the building in DLD data" });
    fireEvent.click(pick);
    expect(onEdit).toHaveBeenCalledWith("building");
    // No "Not covered" page furniture, and the actions of a result.
    expect(below.textContent).not.toMatch(/Request it and track|Search covered buildings|couldn't match/);
    expect(below.querySelector("[data-slot=share-whatsapp]")).not.toBeNull();
    // No percentage, no single figure, no gap in AED.
    expect(`${chart.textContent}${below.textContent}`).not.toMatch(/\d%\s*(above|below)|median of/i);
  });

  it("the sales used: the buildings with their share, then every sale with its adjustments, most weight first", () => {
    setMedia({ "(min-width: 1024px)": true });
    renderWithProviders(<Slots check={OUT} desktop />);
    const list = screen.getByTestId("rest").querySelector("[data-slot=nearby-list]") as HTMLElement;
    expect(within(list).getByRole("heading", { name: "The 14 registered sales used" })).toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: "The 5 buildings they are in" })).toBeInTheDocument();
    const buildings = [...list.querySelectorAll("[data-slot=nearby-buildings] tbody tr")].map((tr) => plain(tr.textContent));
    expect(buildings[0]).toBe("Test Plaza Tower 2324%");
    expect(buildings).toHaveLength(5);
    const table = list.querySelector("[data-slot=nearby-table]") as HTMLElement;
    expect([...table.querySelectorAll("thead th")].map((th) => plain(th.textContent))).toEqual(["Building", "Registered", "Size", "AED per sq ft", "For date", "For size", "Adjusted", "Counts for"]);
    const rows = [...table.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(NEARBY_LIST_ROWS.desktop);
    expect([...rows[0].children].map((td) => plain(td.textContent))).toEqual(["Test Court 1", "3 Nov 2026", "1,304", "1,277", "no change", "down 5.3%", "1,210", "15%"]);
    fireEvent.click(within(list).getByRole("button", { name: "Show all 14 rows" }));
    expect(table.querySelectorAll("tbody tr")).toHaveLength(14);
    setMedia({ "(min-width: 1024px)": false });
  });

  it("phones: stacked rows, the building first", () => {
    renderWithProviders(<Slots check={OUT} />);
    const list = screen.getByTestId("rest").querySelector("[data-slot=nearby-list]") as HTMLElement;
    expect(list.querySelector("[data-slot=nearby-table]")).toBeNull();
    const rows = [...list.querySelectorAll("[data-slot=nearby-rows] li")];
    expect(rows).toHaveLength(NEARBY_LIST_ROWS.phone);
    expect(plain(rows[0].textContent)).toBe("Test Court 1Adjusted: AED 1,2103 Nov 2026: 1,304 sq ft at AED 1,277 per sq ftFor date: no change. For size: down 5.3%. Counts for 15%.");
  });

  it("sharing: the stamp, the card, the link preview and the WhatsApp text all say other buildings; a not-covered comparison now has a card", () => {
    expect(stampProps(OUT)).toMatchObject({ header: "ABOVE", figure: "990 TO 1,770", lines: { c: "AED PER SQ FT, NEARBY REGISTERED SALES" } });
    // The stamp's rows fit its width like every stamp.
    expect(layoutStamp(stampProps(OUT), STAMP_WIDTH.card).rows.length).toBeGreaterThan(2);
    expect(ogTitle(OUT)).toBe(`${OUT.buildingText} ${OUT.bedrooms}-bed: above the range of nearby sales`);
    expect(ogDescription(OUT)).toBe("This building is not in DLD sales data. 14 registered sales in other buildings in Test Science Park point to AED 990 to AED 1,770 per sq ft. The asking price is above that range. Not a valuation.");
    expect(ogAlt(OUT)).toBe("A range from registered sales in other buildings in Test Science Park runs from AED 990 to AED 1,770 per sq ft; the asking price is above it.");
    const og = ogLines(OUT);
    expect(og.head).toMatchObject({ figure: "Above the range", line2: "of nearby sales" });
    expect(og.figures).toMatch(/^Asking AED [\d,]+ per sq ft, 14 registered sales in other buildings$/);
    expect(og.range).toBe("Other buildings nearby: AED 990 to 1,770 per sq ft");
    expect(cardAlt(OUT)).toMatch(/Above the range of nearby sales\. Asking AED [\d,]+ per sq ft; 14 registered sales in other buildings in Test Science Park, each adjusted to this listing, point to AED 990 to AED 1,770 per sq ft\. Not a valuation\.$/);
    expect(shareText(OUT)).toMatch(/Fairsquare could not find this building in DLD sales data\. 14 registered sales in other buildings in Test Science Park, each adjusted to this listing, point to AED 990 to AED 1,770 per sq ft\. The asking price, AED [\d,]+ per sq ft, is above that range\. Other buildings are weaker evidence than sales in this one\. Source: DLD open data via Data\.Dubai\. Not a valuation\./);
    expect(howBody(OUT)).toMatch(/^This building has no usable registered sales of its own\./);
    expect(verdictAnnouncement(OUT)).toMatch(/^Above the range of nearby sales\. Fairsquare could not find .* The range here comes from other buildings in Test Science Park, not from this one\./);
    for (const s of [shareText(OUT), ogTitle(OUT), ogDescription(OUT), ogAlt(OUT), cardAlt(OUT) ?? "", verdictAnnouncement(OUT), howBody(OUT), ...(nearbyLines(OUT)?.definitions ?? [])]) expect(clean(s), s).toBe(true);
  });

  it("the scale: rings only, the readout names the building, the card's caption", () => {
    const m = nearbyScale(OUT, 576, { variant: "desktop" });
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.own).toBe(0);
    expect(m.others).toBe(14);
    expect(m.marks.every((mk) => mk.kind === "other")).toBe(true);
    expect(nearbyRangeLegend(OUT, m)).toMatchObject({ own: null, range: "the range, AED 990 to 1,770" });
    const one = m.marks.find((mk) => mk.items.length === 1);
    if (one) expect(nearbyRangeReadout(OUT, one)).toMatch(/^Test [\w ]+, \d+ \w+ 20\d\d: [\d,]+ sq ft at AED [\d,]+ per sq ft\. Adjusted: AED [\d,]+ per sq ft\.$/);
    expect(nearbyRangeSummary(OUT, m)).toContain("14 adjusted registered sales in other buildings are marked.");
    expect(cardNearbyCaption({ per: 1 })).toBe("Each ring is one registered sale in another building, adjusted.");
    expect(cardNearbyCaption({ per: 3 })).toBe("Each ring is up to 3 registered sales in other buildings, adjusted.");
    expect(nearbyScale(FIXTURE_CHECK_NONE)).toBeNull();
  });

  it("/c mirrors it, with the Save button and no way to change the building", () => {
    renderWithProviders(<SharePageView check={OUT} current={OUT.analysis} />);
    const page = document.querySelector("[data-slot=share-page]") as HTMLElement;
    expect(plain(page.querySelector("[data-slot=verdict-headline]")?.textContent)).toBe("Above the range of nearby sales");
    expect(page.querySelector("[data-slot=nearby-own]")).not.toBeNull();
    expect(page.querySelector("[data-slot=range-scale][data-source=nearby]")).not.toBeNull();
    expect(page.querySelector("[data-slot=nearby-weak]")).not.toBeNull();
    expect(page.querySelector("[data-slot=nearby-list]")).not.toBeNull();
    expect(page.querySelector("[data-slot=wrong-building]")).toBeNull();
    expect(page.textContent).not.toMatch(/couldn't match/);
    expect(within(page).getByRole("heading", { level: 2, name: "The 14 registered sales used" })).toBeInTheDocument();
  });
});

describe("a chosen building with too few sales (kind in)", () => {
  it("says how many sales the building has, names the community and the rest of the area, and adjusts for building age", () => {
    const onEdit = vi.fn();
    setMedia({ "(min-width: 1024px)": true });
    renderWithProviders(<Slots check={IN} desktop onEdit={onEdit} />);
    const chart = screen.getByTestId("chart");
    const below = screen.getByTestId("below");
    const l = nearbyLines(IN);
    expect(nearbyPlace(FIXTURE_NEARBY_IN)).toBe("Test Science Park and the rest of Test Barsha South");
    expect(l?.own).toMatch(new RegExp(`^${IN.building?.name} has ${IN.analysis.count} registered sales? of [\\w-]+ [\\w-]+ in the 12 months to .*\\. A comparison needs 5\\.$`));
    expect(plain(chart.querySelector("[data-slot=nearby-from]")?.textContent)).toBe("The range here comes from other buildings in Test Science Park and the rest of Test Barsha South, not from this one.");
    // No tally and no "Too few sales" heading: the headline is the outcome.
    expect(chart.querySelector("[data-slot=tally]")).toBeNull();
    expect(verdictHeadText(IN)).toBe("Within the range of nearby sales");
    expect(plain(below.querySelector("[data-slot=nearby-range]")?.textContent)).toMatch(/for its date, to [\d,]+ sq ft for its size, and for the age of its building\./);
    const evidence = below.querySelector("[data-slot=evidence-line][data-tier=nearby]") as HTMLElement;
    expect(plain(evidence.querySelector("p")?.textContent)).toBe(`DLD building: ${IN.building?.name}. Not a valuation.`);
    fireEvent.click(within(evidence).getByRole("button", { name: "Wrong building?" }));
    expect(onEdit).toHaveBeenCalledWith("building");
    expect(l?.definitions.join(" ")).toMatch(/Buildings outside Test Science Park count less than buildings in it\./);
    expect(l?.definitions.join(" ")).toMatch(/Each sale is moved from the age of its building to the age of this one/);
    // The age column shows when that adjustment is made.
    const table = screen.getByTestId("rest").querySelector("[data-slot=nearby-table]") as HTMLElement;
    expect([...table.querySelectorAll("thead th")].map((th) => plain(th.textContent))).toContain("For building age");
    expect(plain(table.querySelector("tbody tr")?.textContent)).toContain("up 3.1%");
    // The building's own few sales stay listed under the sales used.
    if (IN.sales.length > 0) expect(screen.getByTestId("rest").querySelector("[data-slot=sales-list]")).not.toBeNull();
    expect(shareText(IN)).toMatch(/This building has too few registered sales of its own to compare\./);
    expect(ogDescription(IN)).toMatch(/^Too few registered sales in this building to compare\./);
    setMedia({ "(min-width: 1024px)": false });
  });

  it("Saved: the outcome against the range, and today's same-building line stays", () => {
    const item = { ...FIXTURE_SAVED[0], acs: null, nearby: { verdict: "above" as const, rangeLowPsf: 990, rangeHighPsf: 1770 } };
    expect(thenLine(item)).toMatch(/^Saved .*: above the range of nearby sales\.$/);
    expect(nowLine({ ...item, nearby: null })).toBe(nowLine(item));
  });
});
