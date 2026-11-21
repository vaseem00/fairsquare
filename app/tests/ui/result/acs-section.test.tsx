// @vitest-environment jsdom
/**
 * Adjusted registered sales on a result (DESIGN.md section 6.17; REAL_DATA.md section 16): the range
 * that leads a result with 5 or more sales, the section under "Too few sales", the list of the sales
 * used, the fallbacks (the result is then exactly what it was), the /c mirror, the stamp, the card's
 * words, the link preview, the share text and the Saved line. The fixtures are synthetic.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { ACS_LIST_ROWS, AcsSalesList, AcsSection } from "@/components/result/acs-section";
import { RangeScale } from "@/components/result/similar-section";
import { VerdictHeadline } from "@/components/result/verdict-summary";
import { SavedItem, nowLine, thenLine } from "@/components/saved/saved-item";
import { SharePageView } from "@/components/share/share-page";
import { acsLead, acsLines, acsShown, acsSizeNote, cardAlt, howBody, ogAlt, ogDescription, ogTitle, shareText, stampProps, verdictAnnouncement, verdictHeadOf, verdictHeadText } from "@/lib/copy";
import { acsScale } from "@/lib/result/acs-scale";
import { RANGE_REACH } from "@/lib/result/similar-scale";
import { acsAdjText, acsRangeLegend, acsRangeReadout, acsRangeSummary, acsSharePct, acsSeveral, cardAcsCaption } from "@/lib/result/words";
import { layoutStamp, STAMP_WIDTH } from "@/lib/stamp/geometry";
import type { AcsView, CheckView } from "@/lib/types";
import { AcsViewSchema } from "@/lib/validation/api";
import { FIXTURE_ACS_FEW, FIXTURE_ACS_LEAD, FIXTURE_ACS_REFUSED } from "../../fixtures/acs-view";
import { FIXTURE_CHECK_MARINA, FIXTURE_CHECK_NONE, FIXTURE_CHECK_THIN, FIXTURE_SAVED } from "../../fixtures/api-fixtures";
import { FIXTURE_SIMILAR } from "../../fixtures/similar-view";

const plain = (s: string | null | undefined) => (s ?? "").replace(/\u00A0/g, " ").replace(/\u2060/g, "").replace(/\s+/g, " ").trim();
const lead = (acs: AcsView | null, over: Partial<CheckView> = {}): CheckView => ({ ...FIXTURE_CHECK_MARINA, ...over, acs });
const few = (acs: AcsView | null, over: Partial<CheckView> = {}): CheckView => ({ ...FIXTURE_CHECK_THIN, ...over, acs });
const LEAD = lead(FIXTURE_ACS_LEAD);
const FEW = few(FIXTURE_ACS_FEW);

/** The legal word rules (copy-acs.test.ts): no sentence the page builds may break them. */
const BANNED =
  /estimat|forecast|predict|\bworth\b|\bvalues?\b|\bvalued\b|fair price|overpriced|underpriced|\bdeals?\b|checked|verified|approved|certified|average|outlier|trimmed|percentile|\bmodels?\b|similar|·|→/i;
const clean = (s: string) => !BANNED.test(s) && !/valuation/i.test(s.replace(/Not a valuation/g, "")) && !/\bfair\w*/i.test(s.replace(/Fairsquare/g, ""));

function Slots({ check, desktop = false }: { check: CheckView; desktop?: boolean }) {
  const ui = useResultUi();
  const getCard = useCardGetter(check);
  const s = resultSlots({ check, image: null, match: null, desktop, getCard, ui, onAnother: () => undefined, onPickBuilding: () => undefined, onCompareReady: () => undefined });
  return (
    <>
      <div data-testid="chart">{s.chart}</div>
      <div data-testid="below">{s.below}</div>
      <div data-testid="rest">{s.rest}</div>
    </>
  );
}
/** Markup with React's generated ids taken out (they count up from one render to the next). */
const noIds = (html: string) => html.replace(/_r_[0-9a-z]+_/g, "_r_");
const slotsHtml = (r: ReturnType<typeof renderWithProviders>) => noIds(["chart", "below", "rest"].map((id) => r.getByTestId(id).innerHTML).join("|"));

describe("who leads: acsShown and acsLead", () => {
  it("a shown range leads a result with a verdict of its own, and shows under too few; never on not covered", () => {
    expect(acsLead(LEAD)?.verdict).toBe("within");
    expect(acsShown(FEW)?.verdict).toBe("above");
    expect(acsLead(FEW)).toBeNull();
    expect(acsShown({ ...FIXTURE_CHECK_NONE, acs: FIXTURE_ACS_FEW })).toBeNull();
    expect(acsShown({ ...LEAD, building: null })).toBeNull();
  });

  it("nothing for no entry, a refusal, an unsafe entry or another version: the result then reads as stored", () => {
    for (const acs of [null, undefined, FIXTURE_ACS_REFUSED, { ...FIXTURE_ACS_LEAD, comparables: [] }, { ...FIXTURE_ACS_LEAD, rangeLowPsf: null }, { ...FIXTURE_ACS_LEAD, evidence: { ...FIXTURE_ACS_LEAD.evidence, ownSales: 0 } }] as (AcsView | null | undefined)[]) {
      const c = { ...FIXTURE_CHECK_MARINA, acs } as CheckView;
      expect(acsShown(c)).toBeNull();
      for (const f of [shareText, ogTitle, ogDescription, ogAlt, cardAlt, verdictAnnouncement, verdictHeadText, howBody] as const) expect(f(c)).toBe(f(FIXTURE_CHECK_MARINA));
      expect(stampProps(c)).toEqual(stampProps(FIXTURE_CHECK_MARINA));
      expect(ogLines(c)).toEqual(ogLines(FIXTURE_CHECK_MARINA));
    }
    // A version this build cannot read never reaches a page: the schema refuses it.
    expect(AcsViewSchema.safeParse({ ...FIXTURE_ACS_LEAD, v: 2 }).success).toBe(false);
  });
});

describe("a leading range (5 or more sales)", () => {
  it("the headline is the outcome against the range, in the outcome's hue, with no percentage", () => {
    expect(verdictHeadOf(LEAD)).toEqual({ figure: "Within the range", rest: "of adjusted sales", tone: "inline" });
    expect(verdictHeadText(LEAD)).toBe("Within the range of adjusted sales");
    expect(verdictHeadOf(lead({ ...FIXTURE_ACS_LEAD, verdict: "above" }))).toMatchObject({ figure: "Above the range", tone: "above" });
    expect(verdictHeadOf(lead({ ...FIXTURE_ACS_LEAD, verdict: "below" }))).toMatchObject({ figure: "Below the range", tone: "below" });
    renderWithProviders(<VerdictHeadline check={LEAD} />);
    const h = screen.getByRole("heading", { level: 2, name: "Within the range of adjusted sales" });
    expect(h.querySelector("[data-slot=verdict-figure]")).toHaveTextContent("Within the range");
    expect(h.querySelector("[data-slot=verdict-figure]")?.className).toMatch(/text-verdict-inline/);
    expect(h.textContent).not.toMatch(/%/);
  });

  it("the result: the range scale, what was adjusted, the outcome, the median beside it, the evidence line, the sales used", () => {
    renderWithProviders(<Slots check={LEAD} />);
    const chart = screen.getByTestId("chart");
    const below = screen.getByTestId("below");
    const rest = screen.getByTestId("rest");
    // The scale of adjusted sales, not the market scale with its 5% zone and ASKING stamp.
    expect(chart.querySelector("[data-slot=range-scale][data-source=acs]")).not.toBeNull();
    expect(chart.querySelector("[data-slot=market-scale], [data-slot=scale-stamp]")).toBeNull();
    expect(plain(below.querySelector("[data-slot=acs-range]")?.textContent)).toBe(
      "Fairsquare took 12 registered sales in Mockup Crest Tower and adjusted each one to this listing: to 10 Nov 2026 for its date and to 1,284 sq ft for its size. Adjusted this way, they point to a range of AED 1,550 to AED 1,970 per sq ft.",
    );
    expect(plain(below.querySelector("[data-slot=acs-verdict]")?.textContent)).toBe("This asking price, AED 1,908 per sq ft, is within that range.");
    // The fixed-band sentence and the recent-sales line are not there; the median is, as one plain line.
    expect(below.querySelector("[data-slot=gap-sentence], [data-slot=recent-line]")).toBeNull();
    expect(plain(below.querySelector("[data-slot=acs-median]")?.textContent)).toBe(`With no adjustment, the median of the 11 sales of the last 12 months is AED ${Math.round(LEAD.analysis.medianPsf as number).toLocaleString("en-US")} per sq ft.`);
    const evidence = plain(below.querySelector("[data-slot=evidence-line]")?.textContent);
    expect(evidence).toBe(
      "The range is built from 12 sales of 2-beds in this building, registered from 10 Jun 2025 to 10 Nov 2026. In tests, about 8 of 10 later sale prices were inside a range made this way. DLD building: Mockup Crest Tower. The adjustments are for date, size and, for a sale of another bedroom type, bedrooms. Floor, view and condition are not in DLD sales data. Not a valuation.How the sales were adjustedWrong building?",
    );
    // Within: no premium link and no listing check; the list of the sales used replaces the 12-month list.
    expect(below.querySelector("[data-slot=premium-link], [data-slot=listing-check]")).toBeNull();
    expect(within(rest).getByRole("heading", { level: 3, name: "The 12 registered sales used" })).toBeInTheDocument();
    expect(rest.querySelector("[data-slot=sales-list]")).toBeNull();
    expect(rest.querySelector("[data-slot=offer-notes]")).not.toBeNull();
    for (const el of [below, rest.querySelector("[data-slot=acs-list]") as HTMLElement]) expect(clean(plain(el.textContent)), plain(el.textContent)).toBe(true);
  });

  it("above shows 'Ask what explains the premium'; below shows the listing check", () => {
    const a = renderWithProviders(<Slots check={lead({ ...FIXTURE_ACS_LEAD, verdict: "above", rangeLowPsf: 1500, rangeHighPsf: 1800 })} />);
    expect(a.getByTestId("below").querySelector("[data-slot=premium-link]")).not.toBeNull();
    expect(a.getByTestId("below").querySelector("[data-slot=acs-verdict]")).toHaveTextContent("is above that range.");
    a.unmount();
    const b = renderWithProviders(<Slots check={lead({ ...FIXTURE_ACS_LEAD, verdict: "below", rangeLowPsf: 2000, rangeHighPsf: 2300 })} />);
    expect(b.getByTestId("below").querySelector("[data-slot=listing-check]")).not.toBeNull();
    expect(b.getByTestId("below").querySelector("[data-slot=premium-link]")).toBeNull();
  });

  it("the fallback to the same-building median: a refusal, no entry and the switch leave the result exactly as it was", () => {
    const a = renderWithProviders(<Slots check={FIXTURE_CHECK_MARINA} />);
    const before = slotsHtml(a);
    expect(a.getByTestId("chart").querySelector("[data-slot=market-scale]")).not.toBeNull();
    a.unmount();
    // ACS_TIER=off and a comparison stored before this existed both arrive as no entry (`storedAcs`).
    for (const acs of [FIXTURE_ACS_REFUSED, null, undefined]) {
      const b = renderWithProviders(<Slots check={{ ...FIXTURE_CHECK_MARINA, acs } as CheckView} />);
      expect(slotsHtml(b)).toBe(before);
      expect(document.querySelector("[data-slot=acs-list], [data-slot=acs-range], [data-source=acs]")).toBeNull();
      b.unmount();
    }
  });

  it("the asking price past every adjusted sale is said in figures, whatever the outcome; 'within' also says why the range reaches further", () => {
    // LEAD: asking AED 1,908, the highest adjusted sale AED 1,879, the range to AED 1,970: "within".
    const l = acsLines(LEAD)!;
    expect(l.beyond).toBe("It is higher than all 12 adjusted sales; the highest is AED 1,879 per sq ft.");
    expect(l.beyondWhy).toBe("The range reaches further than the adjusted sales themselves because, in tests, later sale prices spread further than the sales before them.");
    expect(l.announce.endsWith(l.beyond as string)).toBe(true);
    renderWithProviders(<Slots check={LEAD} />);
    const p = screen.getByTestId("below").querySelector("[data-slot=acs-beyond]") as HTMLElement;
    expect(plain(p.textContent)).toBe(`${l.beyond} ${l.beyondWhy}`);
    expect((screen.getByTestId("below").querySelector("[data-slot=acs-verdict]") as HTMLElement).compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Above the range: the fact, without the "why" (the outcome already says it).
    const above = acsLines(lead({ ...FIXTURE_ACS_LEAD, verdict: "above", rangeLowPsf: 1500, rangeHighPsf: 1800 }))!;
    expect(above.beyond).toMatch(/^It is higher than all 12 adjusted sales/);
    expect(above.beyondWhy).toBeNull();
    // Under every adjusted sale.
    const low = acsLines(lead(FIXTURE_ACS_LEAD, { analysis: { ...LEAD.analysis, askingPsf: 1650.4 } }))!;
    expect(low.beyond).toBe("It is lower than all 12 adjusted sales; the lowest is AED 1,703 per sq ft.");
    // Among the sales, or level with the highest as printed: nothing. A cut list (not every row known): nothing.
    expect(acsLines(lead(FIXTURE_ACS_LEAD, { analysis: { ...LEAD.analysis, askingPsf: 1800 } }))!.beyond).toBeNull();
    expect(acsLines(lead(FIXTURE_ACS_LEAD, { analysis: { ...LEAD.analysis, askingPsf: 1879.4 } }))!.beyond).toBeNull();
    expect(acsLines(lead({ ...FIXTURE_ACS_LEAD, comparablesTotal: 260 }))!.beyond).toBeNull();
  });

  it("sales of other bedroom types counting for more than the building's own of this type: a note says so", () => {
    expect(acsLines(LEAD)!.otherBeds).toBeNull();
    const c = lead({ ...FIXTURE_ACS_LEAD, evidence: { ...FIXTURE_ACS_LEAD.evidence, lead: 2 } });
    expect(acsLines(c)!.otherBeds).toBe("Sales of other bedroom types in this building count for more of this range than its sales of 2-beds. Each of them was also adjusted for bedrooms.");
    renderWithProviders(<Slots check={c} />);
    const note = screen.getByTestId("below").querySelector("[data-slot=acs-other-beds]") as HTMLElement;
    expect(note).toHaveAttribute("role", "note");
    expect(plain(note.textContent)).toMatch(/^Sales of other bedroom types in this building count for more of this range than its sales of 2-beds\./);
  });

  it("the size note: only when the listing is more than 20% from the building's usual size, and it says the adjustment is less exact", () => {
    expect(acsSizeNote(LEAD)).toBeNull();
    const far = lead({ ...FIXTURE_ACS_LEAD, typicalSizeSqft: 1000 });
    expect(acsSizeNote(far)).toBe("This listing is 28% larger than the usual 2-bed sold in this building, 1,000 sq ft. Each sale was adjusted for size; that adjustment is less exact this far from the usual size.");
    expect(acsSizeNote(lead({ ...FIXTURE_ACS_LEAD, typicalSizeSqft: 1700 }))).toMatch(/^This listing is 24% smaller than the usual 2-bed sold in this building, 1,700 sq ft\./);
    expect(acsSizeNote(lead({ ...FIXTURE_ACS_LEAD, typicalSizeSqft: null }))).toBeNull();
    renderWithProviders(<Slots check={far} />);
    const notes = screen.getByTestId("below").querySelectorAll("[data-slot=size-note]");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveAttribute("role", "note");
    expect(plain(notes[0].textContent)).toMatch(/^This listing is 28% larger than the usual 2-bed sold in this building/);
  });

  it("the definitions: how date and size are adjusted, how much a sale counts, the test as run, the limits", async () => {
    const user = userEvent.setup();
    setMedia({ "(min-width: 1024px)": true });
    const d = renderWithProviders(<Slots check={LEAD} desktop />);
    await user.click(screen.getByRole("button", { name: "How the sales were adjusted" }));
    expect(await screen.findByText(/^Date: each sale is moved to 10\sNov\s2026 with the movement of registered sale prices in its area since its month\.$/)).toBeInTheDocument();
    expect(screen.getByText(/^Size: each sale is moved to 1,284\ssq\sft with the relation between size and AED\sper\ssq\sft\. For a sale of the same bedroom type in this building, that relation comes from this building's sales together with Dubai's registered sales of that type\./)).toBeInTheDocument();
    expect(screen.getByText(/About 8 of 10 of those later sale prices were inside the range\.$/)).toBeInTheDocument();
    expect(document.querySelector("[data-slot=popover-content]")).toHaveAttribute("aria-label", "How the sales were adjusted");
    d.unmount();
    setMedia({ "(min-width: 1024px)": false });
    renderWithProviders(<Slots check={LEAD} />);
    const trigger = screen.getByRole("button", { name: "How the sales were adjusted" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(trigger);
    expect(await screen.findByRole("dialog", { name: "How the sales were adjusted" })).toBeInTheDocument();
    expect(acsLines(LEAD)?.definitions).toHaveLength(5);
    for (const s of acsLines(LEAD)?.definitions ?? []) expect(clean(s), s).toBe(true);
  });
});

describe("the scale of adjusted registered sales", () => {
  it("the zone is the stored range, the pin the asking price, a filled dot per sale of the type, a ring per other row", () => {
    const m = acsScale(LEAD, 358, { variant: "phone" })!;
    expect([m.low, m.high, Math.round(m.ask), m.verdict]).toEqual([1550, 1970, 1908, "within"]);
    expect(m.zone.x0).toBeLessThan(m.pin.x);
    expect(m.pin.x).toBeLessThan(m.zone.x1);
    expect(m.marks.reduce((n, k) => n + k.items.length, 0)).toBe(12);
    expect(m.marks.every((k) => k.kind === "own")).toBe(true);
    for (const k of m.marks) expect(k.cy).toBeLessThan(m.axisY);
    const f = acsScale(FEW, 358, { variant: "phone" })!;
    expect(f.marks.filter((k) => k.kind === "own").reduce((n, k) => n + k.items.length, 0)).toBe(6);
    expect(f.marks.filter((k) => k.kind === "other").reduce((n, k) => n + k.items.length, 0)).toBe(5);
    expect(f.pin.x).toBeGreaterThan(f.zone.x1);
    expect(acsScale(FIXTURE_CHECK_MARINA)).toBeNull();
    expect(acsScale(lead(FIXTURE_ACS_REFUSED))).toBeNull();
  });

  it("many rows: one mark stands for several, the lane never grows; far rows are counted, not drawn; a cut list says so", () => {
    const base = FIXTURE_ACS_LEAD.comparables[0];
    const many = Array.from({ length: 150 }, (_, i) => ({ ...base, adjustedPsf: 1650 + (i % 20) * 12, weightShare: 1 / 152 }));
    const far = [{ ...base, adjustedPsf: 600 }, { ...base, adjustedPsf: Math.round(1970 * RANGE_REACH) + 40 }];
    const c = lead({ ...FIXTURE_ACS_LEAD, comparables: [...many, ...far], comparablesTotal: 320, evidence: { ...FIXTURE_ACS_LEAD.evidence, sales: 320, ownSales: 320 } });
    const m = acsScale(c, 358, { variant: "phone" })!;
    expect(m.per).toBeGreaterThan(1);
    expect(m.offScale).toBe(2);
    expect(m.capped).toEqual({ shown: 152, of: 320 });
    expect(Math.min(...m.marks.map((k) => k.cy))).toBeGreaterThanOrEqual(26 - 4);
    expect(m.marks.reduce((n, k) => n + k.items.length, 0)).toBe(150);
    expect(acsRangeLegend(c, m)).toMatchObject({ own: `up to ${m.per} registered sales, adjusted`, other: null, off: "2 more are off this scale.", capped: "The 152 rows that count most, of 320." });
    const group = m.marks.find((k) => k.items.length > 1)!;
    expect(acsRangeReadout(c, group)).toMatch(/^\d+ adjusted sales near AED [\d,]+ per sq ft\.$/);
    expect(cardAcsCaption(m)).toBe(`Each dot is up to ${m.per} registered sales, adjusted to this listing.`);
  });

  it("the words: the summary, the legend and the readouts name what each mark is", () => {
    const m = acsScale(FEW, 358, { variant: "phone" })!;
    expect(acsRangeSummary(FEW, m)).toBe("The range runs from AED 1,370 to AED 1,610 per sq ft. The asking price, AED 1,890 per sq ft, is above it. 11 adjusted registered sales are marked.");
    expect(acsRangeLegend(FEW, m)).toEqual({ unit: "AED per sq ft.", own: "a registered sale, adjusted", other: "another bedroom type or building, adjusted", range: "the range, AED 1,370 to 1,610", off: null, capped: null });
    const own = m.marks.find((k) => k.kind === "own" && k.items[0] === 0)!;
    expect(acsRangeReadout(FEW, own)).toBe("14 Oct 2026: 1,625 sq ft at AED 1,476 per sq ft. Adjusted for date and size: AED 1,526 per sq ft.");
    const beds = m.marks.find((k) => k.kind === "other" && FIXTURE_ACS_FEW.comparables[k.items[0]].ring === 2 && k.items.length === 1);
    if (beds) expect(acsRangeReadout(FEW, beds)).toMatch(/^2-bed in this building\. \d+ \w+ \d{4}: [\d,]+ sq ft at AED [\d,]+ per sq ft\. Adjusted for date, size and bedrooms: AED [\d,]+ per sq ft\.$/);
    const project = m.marks.find((k) => k.kind === "other" && FIXTURE_ACS_FEW.comparables[k.items[0]].ring === 3 && k.items.length === 1);
    if (project) expect(acsRangeReadout(FEW, project)).toMatch(/^Test Tower G, same project\. /);
    expect(cardAcsCaption(m)).toBe("Each dot is one registered sale, adjusted to this listing.");
    expect(cardAcsCaption(m, acsSeveral(FIXTURE_ACS_FEW))).toBe("Each dot is one or more registered sales, adjusted.");
    expect(acsSeveral(FIXTURE_ACS_LEAD)).toBe(false);
    for (const s of [acsRangeSummary(FEW, m), ...Object.values(acsRangeLegend(FEW, m))]) if (s) expect(clean(s), s).toBe(true);
    expect([acsAdjText(0.0443), acsAdjText(-0.052), acsAdjText(0.0004), acsAdjText(0)]).toEqual(["up 4.4%", "down 5.2%", "no change", "no change"]);
    expect([acsSharePct(0.132), acsSharePct(0.004), acsSharePct(1)]).toEqual(["13", "0.4", "100"]);
  });

  it("on the page: a named group with a text summary, the keyboard reaches every mark, the drawing is aria-hidden", () => {
    renderWithProviders(<RangeScale check={FEW} source="acs" />);
    const chart = screen.getByRole("group", { name: "Where this asking price sits against the range of adjusted sales" });
    const summary = document.getElementById(chart.getAttribute("aria-describedby") as string);
    expect(plain(summary?.textContent)).toContain("The asking price, AED 1,890 per sq ft, is above it.");
    expect(chart).toHaveAttribute("tabindex", "0");
    expect(chart).toHaveAttribute("data-verdict", "above");
    expect(chart.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(chart.querySelector("[data-kind=own]")).toHaveAttribute("fill", "var(--chart-3)");
    expect(chart.querySelector("[data-kind=other]")).toHaveAttribute("fill", "var(--background)");
    expect(plain(chart.querySelector("[data-slot=range-low]")?.textContent)).toBe("1,370");
    expect(plain(chart.querySelector("[data-slot=range-high]")?.textContent)).toBe("1,610");
    const legend = document.querySelector("[data-slot=range-legend]") as HTMLElement;
    expect(plain(legend.textContent)).toBe("AED per sq ft.a registered sale, adjustedanother bedroom type or building, adjustedthe range, AED 1,370 to 1,610");
    const live = document.querySelector("[data-slot=range-live]") as HTMLElement;
    fireEvent.keyDown(chart, { key: "End" });
    expect(plain(live.textContent)).toMatch(/Adjusted for date(, size and bedrooms| and size): AED [\d,]+ per sq ft\.$/);
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(live).toBeEmptyDOMElement();
  });
});

describe("the sales used", () => {
  it("phones: grouped by where a sale comes from; each row gives the registered figure, each change and the adjusted figure", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AcsSalesList check={FEW} />);
    const list = document.querySelector("[data-slot=acs-list]") as HTMLElement;
    expect(within(list).getByRole("heading", { level: 3, name: "The 17 registered sales used" })).toBeInTheDocument();
    expect(within(list).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["This building, 3-beds", "This building, other bedroom types", "Other buildings of the project"]);
    expect(plain(list.querySelector("[data-slot=acs-list-note]")?.textContent)).toBe("Each row is a registered sale and what Fairsquare changed to compare it with this listing. The rows that count most are first.");
    const rows = [...list.querySelectorAll("li")];
    // The first group shows its first rows; the others three each; then "Show all".
    expect(rows).toHaveLength(ACS_LIST_ROWS.phone.first + 2 + 3);
    expect(plain(rows[0].textContent)).toBe("14 Oct 2026Adjusted: AED 1,5261,625 sq ft at AED 1,476 per sq ftFor date: up 1.2%. For size: up 2.1%. Counts for 21%.");
    // Two sales registered with the same date, size and price are one row, and it says so.
    expect(plain(rows[2].textContent)).toContain("2 sales registered with the same date, size and price.");
    const otherBeds = [...list.querySelectorAll("[data-ring='2'] li")];
    expect(plain(otherBeds[0].textContent)).toBe("25 Aug 2026Adjusted: AED 1,5031,141 sq ft at AED 1,613 per sq ftFor date: up 1.8%. For size: down 5.2%. For bedrooms: down 3.4%. Counts for 6%.2-bed in this building");
    const project = [...list.querySelectorAll("[data-ring='3'] li")];
    expect(plain(project[0].textContent)).toMatch(/Test Tower G, same project$/);
    expect(plain(project[1].textContent)).toMatch(/Test Tower G, same project\. 6 apartments registered at one price per sq ft\. The size is their median\.$/);
    await user.click(within(list).getByRole("button", { name: "Show all 11 rows" }));
    expect(list.querySelectorAll("li")).toHaveLength(11);
    expect(within(list).queryByRole("button", { name: /^Show all/ })).toBeNull();
    // Focus moves to the first new row on the next frame.
    await vi.waitFor(() => expect(document.activeElement).toBe(list.querySelector(`[data-row="${ACS_LIST_ROWS.phone.first}"]`)));
    // Never behind an ask.
    expect(list.querySelector("input, form")).toBeNull();
    expect(clean(plain(list.textContent)), plain(list.textContent)).toBe(true);
  });

  it("from 1024px: one table, a row group per origin, a bedrooms column only when another bedroom type is used", () => {
    setMedia({ "(min-width: 1024px)": true });
    const a = renderWithProviders(<AcsSalesList check={FEW} headingLevel={2} />);
    expect(screen.getByRole("heading", { level: 2, name: "The 17 registered sales used" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Registered", "Size", "AED per sq ft", "For date", "For size", "For bedrooms", "Adjusted", "Counts for"]);
    expect(table.querySelectorAll("tbody")).toHaveLength(3);
    const first = table.querySelector("tbody tr[data-row='0']") as HTMLElement;
    expect([...first.querySelectorAll("th, td")].map((c) => plain(c.textContent))).toEqual(["14 Oct 2026", "1,625", "1,476", "up 1.2%", "up 2.1%", "", "1,526", "21%"]);
    a.unmount();
    renderWithProviders(<AcsSalesList check={LEAD} />);
    expect(within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Registered", "Size", "AED per sq ft", "For date", "For size", "Adjusted", "Counts for"]);
    expect(screen.getByRole("table").querySelectorAll("tbody tr[data-row]")).toHaveLength(ACS_LIST_ROWS.desktop.first);
    setMedia({ "(min-width: 1024px)": false });
  });

  it("a list cut at 200 rows says how many there are", () => {
    renderWithProviders(<AcsSalesList check={lead({ ...FIXTURE_ACS_LEAD, comparablesTotal: 260, evidence: { ...FIXTURE_ACS_LEAD.evidence, sales: 260, ownSales: 260 } })} />);
    expect(plain(document.querySelector("[data-slot=acs-list-note]")?.textContent)).toMatch(/The 12 rows that count most, of 260\.$/);
    expect(screen.getByRole("heading", { level: 3, name: "The 260 registered sales used" })).toBeInTheDocument();
  });
});

describe("<AcsSection> under a too-few result", () => {
  it("nothing without a shown range, and nothing when the range leads", () => {
    for (const c of [FIXTURE_CHECK_THIN, few(null), few(FIXTURE_ACS_REFUSED), LEAD]) {
      const { container, unmount } = renderWithProviders(<AcsSection check={c} />);
      expect(container.querySelector("[data-slot=acs-section]")).toBeNull();
      unmount();
    }
  });

  it("a refusal leaves the too-few result exactly as it is, with the second tier when it shows (the fallback to tier 2)", () => {
    const a = renderWithProviders(<Slots check={FIXTURE_CHECK_THIN} />);
    const before = slotsHtml(a);
    a.unmount();
    const b = renderWithProviders(<Slots check={few(FIXTURE_ACS_REFUSED)} />);
    expect(slotsHtml(b)).toBe(before);
    b.unmount();
    const withTier2: CheckView = { ...FIXTURE_CHECK_THIN, similar: FIXTURE_SIMILAR };
    const c = renderWithProviders(<Slots check={withTier2} />);
    const tier2 = slotsHtml(c);
    expect(c.getByTestId("below").querySelector("[data-slot=similar-section]")).not.toBeNull();
    c.unmount();
    const d = renderWithProviders(<Slots check={{ ...withTier2, acs: FIXTURE_ACS_REFUSED }} />);
    expect(slotsHtml(d)).toBe(tier2);
  });

  it("from 1024px the section's list is still the stacked rows (the narrow column has no room for the table), and the project is named", async () => {
    const user = userEvent.setup();
    setMedia({ "(min-width: 1024px)": true });
    renderWithProviders(<AcsSection check={FEW} settle={false} />);
    const section = document.querySelector("[data-slot=acs-section]") as HTMLElement;
    await user.click(within(section).getByRole("button", { name: "See the 17 registered sales used" }));
    expect(section.querySelector("table")).toBeNull();
    expect(section.querySelectorAll("li")).toHaveLength(ACS_LIST_ROWS.phone.first + 2 + 3);
    // Only this building's sales: the other sentence.
    const own = few({ ...FIXTURE_ACS_FEW, evidence: { ...FIXTURE_ACS_FEW.evidence, projectSales: 0 } });
    expect(acsLines(own)!.fewLead).toBe("A median needs 5 sales in 12 months, so there is none here. The range below comes from this building's registered sales of three years, each adjusted to this listing.");
    expect(shareText(own)).toContain("Registered sales in this building, each adjusted to this listing, point to");
    setMedia({ "(min-width: 1024px)": false });
  });

  it("the section: under the unchanged headline and tally, in the second tier's place, with the list closed until asked for", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Slots check={{ ...FEW, similar: FIXTURE_SIMILAR }} />);
    const below = screen.getByTestId("below");
    expect(screen.getByTestId("chart").querySelector("[data-slot=tally]")).not.toBeNull();
    expect(verdictHeadText(FEW)).toBe("Too few sales to compare yet");
    // One range on the page: this one, never both.
    expect(below.querySelector("[data-slot=similar-section]")).toBeNull();
    const section = below.querySelector("[data-slot=acs-section]") as HTMLElement;
    expect((below.querySelector("[data-slot=verdict-sentence]") as HTMLElement).compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(section).getByRole("heading", { level: 3, name: "Registered sales, adjusted to this listing" })).toBeInTheDocument();
    expect(plain(section.querySelector("[data-slot=acs-few]")?.textContent)).toBe("A median needs 5 sales in 12 months, so there is none here. The range below comes from three years of registered sales in this building and in other buildings of its project, each adjusted to this listing.");
    expect(plain(section.querySelector("[data-slot=acs-range]")?.textContent)).toBe(
      "Fairsquare took 17 registered sales in Dummyside Heights 2 and in other buildings of its project, and adjusted each one to this listing: to 10 Nov 2026 for its date and to 1,905 sq ft for its size. Adjusted this way, they point to a range of AED 1,370 to AED 1,610 per sq ft.",
    );
    expect(plain(section.querySelector("[data-slot=acs-verdict]")?.textContent)).toBe("This asking price, AED 1,890 per sq ft, is above that range.");
    expect(plain(section.querySelector("[data-slot=acs-evidence]")?.textContent)).toBe(
      "The range is built from 7 sales of 3-beds in this building, 2 sales of other bedroom types in this building and 8 sales in other buildings of the project, registered from 5 Mar 2024 to 14 Oct 2026. In tests, about 8 of 10 later sale prices were inside a range made this way. The adjustments are for date, size and, for a sale of another bedroom type, bedrooms. Floor, view and condition are not in DLD sales data. Not a valuation.How the sales were adjusted",
    );
    // No headline of its own, no stamp, no percentage above or below, no verdict colour; no median line (there is no median).
    expect(section.querySelector("[data-slot=verdict-headline], [data-slot=scale-stamp], [data-slot=acs-median]")).toBeNull();
    expect(section.querySelector("[data-slot=acs-verdict]")?.className).not.toMatch(/verdict-/);
    const toggle = within(section).getByRole("button", { name: "See the 17 registered sales used" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(section.querySelector("li")).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAccessibleName("Hide the list");
    expect(section.querySelectorAll("li").length).toBeGreaterThan(0);
    // The asking price is past every adjusted sale: said under the outcome.
    expect(plain(section.querySelector("[data-slot=acs-beyond]")?.textContent)).toBe("It is higher than all 17 adjusted sales; the highest is AED 1,526 per sq ft.");
    // The building's own 12-month sales stay listed below, as on every too-few result.
    expect(screen.getByTestId("rest").querySelector("[data-slot=sales-list]")).not.toBeNull();
    expect(clean(plain(section.textContent)), plain(section.textContent)).toBe(true);
  });
});

describe("/c mirrors the stored result", () => {
  it("a leading range: the h1, the scale, the sentences and the sales used; no 'Today' figure against the median", () => {
    renderWithProviders(<SharePageView check={LEAD} current={{ ...LEAD.analysis, count: LEAD.analysis.count + 2 }} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Within the range of adjusted sales");
    expect(document.querySelector("[data-slot=range-scale][data-source=acs]")).not.toBeNull();
    expect(document.querySelector("[data-slot=market-scale], [data-slot=today], [data-slot=sales-list]")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "The 12 registered sales used" })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=wrong-building]")).toBeNull();
    expect(document.querySelector("[data-slot=evidence-line]")).toHaveTextContent("Not a valuation.");
  });

  it("too few with a range: the section one heading level up; a comparison stored before this existed renders as it did", () => {
    const a = renderWithProviders(<SharePageView check={FEW} current={FEW.analysis} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Too few sales to compare yet");
    expect(within(document.querySelector("[data-slot=acs-section]") as HTMLElement).getByRole("heading", { level: 2, name: "Registered sales, adjusted to this listing" })).toBeInTheDocument();
    a.unmount();
    // The ASKING stamp lands once per code and session: the first view spends it, so the next two can be compared.
    renderWithProviders(<SharePageView check={FIXTURE_CHECK_MARINA} current={FIXTURE_CHECK_MARINA.analysis} />).unmount();
    const old = renderWithProviders(<SharePageView check={FIXTURE_CHECK_MARINA} current={FIXTURE_CHECK_MARINA.analysis} />);
    const before = noIds(old.container.innerHTML);
    old.unmount();
    const { acs: _none, ...stored } = { ...FIXTURE_CHECK_MARINA, acs: undefined };
    void _none;
    const again = renderWithProviders(<SharePageView check={stored as CheckView} current={FIXTURE_CHECK_MARINA.analysis} />);
    expect(noIds(again.container.innerHTML)).toBe(before);
    expect(document.querySelector("[data-slot=market-scale]")).not.toBeNull();
  });
});

describe("sharing a leading range", () => {
  it("the stamp: WITHIN, the range, the count of adjusted sales and the date they are adjusted to; it fits the stamp", () => {
    const s = stampProps(LEAD);
    expect(s).toMatchObject({ header: "WITHIN", figure: "1,550 TO 1,970", lines: { c: "AED PER SQ FT FROM 12 REGISTERED SALES", d: ["2-BED", "ADJUSTED TO 10 NOV 2026"] }, date: "2026-11-10" });
    expect(JSON.stringify(s)).not.toMatch(/%|MEDIAN/);
    expect(stampProps(lead({ ...FIXTURE_ACS_LEAD, verdict: "above" })).header).toBe("ABOVE");
    expect(stampProps(lead({ ...FIXTURE_ACS_LEAD, verdict: "below" })).header).toBe("BELOW");
    // Too few with a range keeps the TOO FEW stamp.
    expect(stampProps(FEW)).toEqual(stampProps(FIXTURE_CHECK_THIN));
    const layout = layoutStamp(s, STAMP_WIDTH.card);
    for (const row of layout.rows) expect(row.width, row.id).toBeLessThanOrEqual(STAMP_WIDTH.card * 0.8);
    const wide = layoutStamp(stampProps(lead({ ...FIXTURE_ACS_LEAD, rangeLowPsf: 10550, rangeHighPsf: 12970 })), STAMP_WIDTH.card);
    expect(wide.rows.find((r) => r.id === "b")!.width).toBeLessThanOrEqual(STAMP_WIDTH.card * 0.8);
  });

  it("the WhatsApp text, the link preview and the alt texts state the range and the outcome, never a percentage or one figure", () => {
    expect(shareText(LEAD)).toBe(
      `Mockup Crest, ready 2-bed, 1,284 sq ft, asking AED 2,450,000 (AED 1,908 per sq ft). Registered sales in this building, each adjusted to this listing, point to AED 1,550 to AED 1,970 per sq ft. The asking price, AED 1,908 per sq ft, is within that range. Not a valuation. Source: DLD open data via Data.Dubai. Not a valuation. ${LEAD.url}`,
    );
    expect(ogTitle(LEAD)).toBe("Mockup Crest 2-bed: within the range of adjusted sales");
    expect(ogDescription(LEAD)).toBe("12 registered sales, each adjusted to this listing, point to AED 1,550 to AED 1,970 per sq ft. The asking price is within that range. Not a valuation.");
    expect(ogAlt(LEAD)).toBe("A range from registered sales adjusted to this listing runs from AED 1,550 to AED 1,970 per sq ft; the asking price is within it.");
    expect(cardAlt(LEAD)).toBe(
      "Fairsquare comparison card. Mockup Crest, ready 2-bed, 1,284 sq ft, asking AED 2,450,000. Within the range of adjusted sales. Asking AED 1,908 per sq ft; 12 registered sales, each adjusted to this listing, point to AED 1,550 to AED 1,970 per sq ft. Not a valuation.",
    );
    expect(verdictAnnouncement(LEAD)).toBe("Within the range of adjusted sales. Mockup Crest, ready 2-bed, AED 1,908 per sq ft. 12 registered sales, each adjusted to this listing, point to AED 1,550 to AED 1,970 per sq ft.");
    expect(howBody(LEAD)).toMatch(/^Fairsquare adjusts each registered sale to the data date and to the listing's size/);
    const og = ogLines(LEAD);
    expect(og.head).toMatchObject({ figure: "Within the range", line1: "", line2: "of adjusted sales" });
    expect(og.figures).toBe("Asking AED 1,908 per sq ft, 12 registered sales adjusted");
    expect(og.range).toBe("Registered sales, adjusted to this listing: AED 1,550 to 1,970 per sq ft");
    expect(og.recent).toBeNull();
    for (const s of [shareText(LEAD), ogTitle(LEAD), ogDescription(LEAD), ogAlt(LEAD), cardAlt(LEAD) ?? "", verdictAnnouncement(LEAD), JSON.stringify(stampProps(LEAD))]) {
      expect(clean(s), s).toBe(true);
      expect(s).not.toMatch(/\d%/);
    }
  });

  it("too few with a range: the too-few words first, then the range; the second tier's words are not used", () => {
    const both: CheckView = { ...FEW, similar: FIXTURE_SIMILAR };
    expect(shareText(both)).toContain("too few to compare. Registered sales in this building and in other buildings of its project, each adjusted to this listing, point to AED 1,370 to AED 1,610 per sq ft. The asking price, AED 1,890 per sq ft, is above that range. Not a valuation.");
    expect(shareText(both)).not.toMatch(/Weaker evidence|median between/);
    expect(ogTitle(both)).toBe(ogTitle(FIXTURE_CHECK_THIN));
    expect(ogDescription(both)).toBe("17 registered sales, each adjusted to this listing, point to AED 1,370 to AED 1,610 per sq ft. The asking price is above that range. Not a valuation.");
    expect(ogAlt(both)).toMatch(/needed to compare\. A range from registered sales adjusted to this listing runs from AED 1,370 to AED 1,610 per sq ft; the asking price is above it\.$/);
    expect(cardAlt(both)).toMatch(/A range from registered sales adjusted to this listing runs from AED 1,370 to AED 1,610 per sq ft; the asking price is above it\.$/);
    expect(verdictAnnouncement(both)).toMatch(/^Only 2 registered sales .* Fairsquare took 17 registered sales in Dummyside Heights 2 and in other buildings of its project/);
    expect(ogLines(both).range).toBe("Registered sales, adjusted to this listing: AED 1,370 to 1,610 per sq ft");
    expect(ogLines(both).head.figure).toBeNull();
  });
});

describe("Saved", () => {
  const item = { ...FIXTURE_SAVED[0], acs: { verdict: "within" as const, rangeLowPsf: 1550, rangeHighPsf: 1970 } };

  it("a saved comparison whose range leads states the outcome against the range, with no 'Today' figure", () => {
    expect(thenLine(item)).toMatch(/^Saved \d+ \w+ \d{4}: within the range of adjusted sales\.$/);
    expect(nowLine(item)).toBeNull();
    renderWithProviders(<SavedItem item={item} onOpen={() => undefined} onRemove={() => undefined} />);
    const line = document.querySelector("[data-slot=saved-acs]") as HTMLElement;
    expect(plain(line.textContent)).toMatch(/: within the range of adjusted sales\.$/);
    expect(line.querySelector("span")).toHaveTextContent("within");
    expect(line.querySelector("span")?.className).toMatch(/text-verdict-inline/);
  });

  it("without one the lines are what they were", () => {
    expect(thenLine({ ...FIXTURE_SAVED[0], acs: null })).toBe(thenLine(FIXTURE_SAVED[0]));
    expect(nowLine({ ...FIXTURE_SAVED[0], acs: null })).toBe(nowLine(FIXTURE_SAVED[0]));
  });
});
