// @vitest-environment jsdom
/**
 * The second tier on a result (DESIGN.md section 6.16; REAL_DATA.md section 15): the range
 * scale, the section under "Too few sales to compare yet", the refusals (the result is then exactly
 * what it was), the /c mirror, the announcement and the share words. The fixtures are synthetic.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ok, type ApiMock } from "../shell/api-mock";
import { linkMock, renderWithProviders, setMedia } from "../shell/test-utils";

vi.mock("@/lib/api/client", async () => ({ api: (await import("../shell/api-mock")).makeApiMock() }));
vi.mock("next/link", () => linkMock);
vi.mock("@/lib/stamp/card-canvas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stamp/card-canvas")>()),
  renderCard: vi.fn(async () => new File(["png"], "card.png", { type: "image/png" })),
}));

import { ogLines } from "@/app/c/[code]/opengraph-image";
import { resultSlots, useCardGetter, useResultUi } from "@/components/check/result-view";
import { RangeScale, SIMILAR_LIST_ROWS, SimilarSection } from "@/components/result/similar-section";
import { SharePageView } from "@/components/share/share-page";
import { cardAlt, ogAlt, ogDescription, ogTitle, shareText, verdictAnnouncement } from "@/lib/copy";
import { nearestMark, RANGE_REACH, similarScale } from "@/lib/result/similar-scale";
import { rangeLegend, rangeReadout, rangeSummary, similarDefinitions } from "@/lib/result/words";
import type { CheckView, SimilarView } from "@/lib/types";
import { SimilarViewSchema } from "@/lib/validation/api";
import { api } from "@/lib/api/client";
import { FIXTURE_CHECK_MARINA, FIXTURE_CHECK_NONE, FIXTURE_CHECK_THIN, FIXTURE_COVERAGE } from "../../fixtures/api-fixtures";
import { FIXTURE_SIMILAR, FIXTURE_SIMILAR_OWN, FIXTURE_SIMILAR_OWN_ONLY, FIXTURE_SIMILAR_PROJECT, FIXTURE_SIMILAR_REFUSED } from "../../fixtures/similar-view";

const plain = (s: string | null | undefined) => (s ?? "").replace(/ /g, " ").replace(/⁠/g, "").replace(/\s+/g, " ").trim();
const thin = (similar: SimilarView | null, over: Partial<CheckView> = {}): CheckView => ({ ...FIXTURE_CHECK_THIN, ...over, similar });
const SHOWN = thin(FIXTURE_SIMILAR);
const OWN = thin(FIXTURE_SIMILAR_OWN);
const REFUSED = thin(FIXTURE_SIMILAR_REFUSED);

/** The legal word rules (copy-similar.test.ts): no sentence the page builds may break them. */
const BANNED =
  /estimat|forecast|predict|\bworth\b|\bvalues?\b|\bvalued\b|fair price|overpriced|underpriced|\bdeals?\b|checked|verified|approved|certified|average|outlier|trimmed|percentile|\bmodels?\b|·|→/i;
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

describe("similarScale (the range scale's model)", () => {
  it("null unless a range shows", () => {
    expect(similarScale(FIXTURE_CHECK_THIN)).toBeNull();
    expect(similarScale(REFUSED)).toBeNull();
    expect(similarScale(FIXTURE_CHECK_MARINA)).toBeNull();
    // Nothing but the 12 months' own sales, or nothing from the building: never drawn, whatever the entry says.
    expect(similarScale(thin(FIXTURE_SIMILAR_OWN_ONLY))).toBeNull();
    expect(similarScale(thin({ ...FIXTURE_SIMILAR, evidence: { ownSales: 0, olderSales: 0, otherBedroomSales: 0 } }))).toBeNull();
  });

  it("the zone is the stored range, the pin the asking price, a ring per similar building and a dot per own sale", () => {
    const m = similarScale(SHOWN, 358, { variant: "phone" })!;
    expect([m.low, m.high, Math.round(m.ask), m.verdict]).toEqual([1720, 1980, 1890, "within"]);
    expect(m.zone.x0).toBeLessThan(m.pin.x);
    expect(m.pin.x).toBeLessThan(m.zone.x1);
    expect(m.marks.filter((k) => k.kind === "other")).toHaveLength(9);
    expect(m.marks.filter((k) => k.kind === "own")).toHaveLength(SHOWN.sales.length);
    expect([m.per, m.others, m.offScale, m.own]).toEqual([1, 9, 0, 2]);
    expect(m.othersSpan).toEqual({ lo: 1688, hi: 2150 });
    // Every mark inside the plot, above the axis; the keyboard order runs left to right.
    for (const k of m.marks) {
      expect(k.cx).toBeGreaterThanOrEqual(16 - 4);
      expect(k.cx).toBeLessThanOrEqual(358 - 16 + 4);
      expect(k.cy).toBeLessThan(m.axisY);
    }
    const xs = m.order.map((i) => m.marks[i].cx);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(nearestMark(m, m.marks[m.order[0]].cx)).toBe(m.order[0]);
    // The two end labels do not touch, and no tick label sits on them.
    expect(m.ends.joined).toBeNull();
    for (const t of m.ticks.filter((x) => x.visible)) {
      for (const e of [m.ends.low, m.ends.high]) expect(t.left + t.width <= e.left || t.left >= e.left + e.width).toBe(true);
    }
  });

  it("many similar buildings: one ring stands for several, the lane never grows, and far ones are counted, not drawn", () => {
    const many = Array.from({ length: 180 }, (_, i) => ({ name: `Tower ${i + 1}`, sales: 3 + (i % 9), medianPsf: 1700 + (i % 30) * 10 }));
    const far = [{ name: "Far Low", sales: 4, medianPsf: 900 }, { name: "Far High", sales: 4, medianPsf: Math.round(1980 * RANGE_REACH) + 50 }];
    const c = thin({ ...FIXTURE_SIMILAR, comparableBuildings: 182, comparables: [...many, ...far] });
    const m = similarScale(c, 358, { variant: "phone" })!;
    expect(m.per).toBeGreaterThan(1);
    expect([m.others, m.offScale]).toEqual([180, 2]);
    expect(m.marks.filter((k) => k.kind === "other").reduce((n, k) => n + k.items.length, 0)).toBe(180);
    expect(Math.min(...m.marks.map((k) => k.cy))).toBeGreaterThanOrEqual(26 - 4);
    // "Up to": a column of n buildings draws ceil(n / per) rings, so a ring can stand for fewer than `per`.
    expect(rangeLegend(c, m)).toMatchObject({ other: `up to ${m.per} other buildings`, off: "2 more are off this scale.", capped: null });
    for (const k of m.marks.filter((x) => x.kind === "other")) expect(k.items.length).toBeLessThanOrEqual(m.per);
    const group = m.marks.find((k) => k.kind === "other" && k.items.length > 1)!;
    expect(rangeReadout(c, group)).toMatch(/^\d+ other buildings near AED [\d,]+ per sq ft\.$/);
    // More buildings than are stored: the legend and the summary say how many are on the scale.
    const capped = thin({ ...FIXTURE_SIMILAR, comparableBuildings: 312, comparables: [...many, ...far] });
    const mc = similarScale(capped, 358, { variant: "phone" })!;
    expect(mc.capped).toEqual({ shown: 182, of: 312 });
    expect(rangeLegend(capped, mc).capped).toBe("Only the 182 with the most sales, of 312, are on this scale.");
    expect(rangeSummary(capped, mc)).toContain("2 more are off this scale. Only the 182 with the most sales, of 312, are on this scale.");
    expect(m.capped).toBeNull();
  });

  it("a narrow range on a wide axis joins its two end labels; an asking price far right puts its label on the left", () => {
    const c = thin({ ...FIXTURE_SIMILAR, rangeLowPsf: 1880, rangeHighPsf: 1900, verdict: "above" }, { priceAed: 6_000_000, analysis: { ...FIXTURE_CHECK_THIN.analysis, askingPsf: 3150 } });
    const m = similarScale(c, 358, { variant: "phone" })!;
    expect(m.ends.joined).not.toBeNull();
    expect(m.askLabel.side).toBe("left");
    expect(m.pin.x).toBeGreaterThan(m.zone.x1);
  });

  it("the words: the summary, the legend, the readouts and the definitions", () => {
    const m = similarScale(SHOWN, 358, { variant: "phone" })!;
    expect(rangeSummary(SHOWN, m)).toBe(
      `A scale in AED per sq ft from ${m.domain[0].toLocaleString("en-US")} to ${m.domain[1].toLocaleString("en-US")}. The shaded range runs from AED 1,720 to AED 1,980. The asking price, AED 1,890, is within it. 9 other buildings are marked with rings at the median of their registered sales, from AED 1,688 to AED 2,150. 2 registered sales in this building are marked with filled dots.`,
    );
    expect(rangeLegend(SHOWN, m)).toEqual({ unit: "AED per sq ft.", other: "another building, at its median", own: "a sale in this building", range: "the range, AED 1,720 to 1,980", off: null, capped: null });
    const ring = m.marks.find((k) => k.kind === "other" && SHOWN.similar!.comparables[k.items[0]].name === "Creek Vista Heights")!;
    expect(rangeReadout(SHOWN, ring)).toBe("Creek Vista Heights: 22 registered sales, median AED 1,850 per sq ft.");
    expect(rangeReadout(SHOWN, m.marks.find((k) => k.kind === "own")!)).toMatch(/^This building, \d+ \w+ \d{4}: [\d,]+ sq ft, AED [\d,]+, AED [\d,]+ per sq ft\.$/);
    expect(similarDefinitions(SHOWN)).toEqual([
      "Narrow range: its ends are within about 10% of its middle.",
      "Broad range: its ends are up to about 20% from its middle. Fairsquare shows nothing wider.",
      "In tests on buildings with many registered sales, a range built this way held the building's own median in about 8 of 10 cases, and in about 7 of 10 against the six months that followed.",
      "The range takes no account of size, floor, view or condition.",
    ]);
    for (const s of [rangeSummary(SHOWN, m), ...Object.values(rangeLegend(SHOWN, m)), ...similarDefinitions(SHOWN)]) if (s) expect(clean(s), s).toBe(true);
  });

  it("an entry stored before the list existed still parses and draws its range with no rings", () => {
    const { comparables: _gone, ...old } = FIXTURE_SIMILAR;
    void _gone;
    const parsed = SimilarViewSchema.parse(old);
    expect(parsed.comparables).toEqual([]);
    const m = similarScale(thin(parsed))!;
    expect(m.others).toBe(0);
    expect(m.marks.every((k) => k.kind === "own")).toBe(true);
  });
});

describe("<SimilarSection> under a too-few result", () => {
  it("nothing at all without a shown range: no entry, a refusal, a verdict", () => {
    for (const c of [FIXTURE_CHECK_THIN, thin(null), REFUSED, FIXTURE_CHECK_MARINA]) {
      const { container, unmount } = renderWithProviders(<SimilarSection check={c} />);
      expect(container.querySelector("[data-slot=similar-section]")).toBeNull();
      unmount();
    }
  });

  it("a refusal leaves the too-few result exactly as it is without the second tier", () => {
    const a = renderWithProviders(<Slots check={FIXTURE_CHECK_THIN} />);
    const before = a.getByTestId("below").innerHTML + a.getByTestId("chart").innerHTML;
    a.unmount();
    const b = renderWithProviders(<Slots check={REFUSED} />);
    expect(b.getByTestId("below").innerHTML + b.getByTestId("chart").innerHTML).toBe(before);
  });

  it("the section: an h3 under the unchanged explanation, the scale, the sentences, the evidence line and the caution", () => {
    renderWithProviders(<Slots check={SHOWN} />);
    const below = screen.getByTestId("below");
    // The first tier is untouched: the tally, its sentence and its evidence line come first.
    expect(screen.getByTestId("chart").querySelector("[data-slot=tally]")).not.toBeNull();
    const sentence = below.querySelector("[data-slot=verdict-sentence]") as HTMLElement;
    const section = below.querySelector("[data-slot=similar-section]") as HTMLElement;
    expect(sentence.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(below.querySelector("[data-slot=evidence-line]")?.compareDocumentPosition(section)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(section).getByRole("heading", { level: 3, name: "A range from more registered sales" })).toBeInTheDocument();
    expect(section).toHaveAttribute("aria-labelledby", within(section).getByRole("heading", { level: 3 }).id);

    expect(plain(section.querySelector("[data-slot=similar-range]")?.textContent)).toBe(
      "This building has too few registered sales of its own to compare, so Fairsquare looked at more registered sales. They point to a median between AED 1,720 and AED 1,980 per sq ft for ready 3-beds in Dummyside Heights 2, in the 12 months to 16 Nov 2026.",
    );
    expect(plain(section.querySelector("[data-slot=similar-verdict]")?.textContent)).toBe("This asking price, AED 1,890 per sq ft, is within that range.");
    expect(plain(section.querySelector("[data-slot=similar-evidence]")?.textContent)).toBe(
      "Narrow range. The range is built from 2 registered sales in this building in those 12 months, 7 earlier sales of the same type here, back to 17 Nov 2023, 1 sale of other bedroom types here and 96 registered sales of ready 3-beds in 9 other buildings in Al Jaddaf. Their medians run from AED 1,688 to AED 2,150 per sq ft. Other buildings are not matched on size or price level, and are weaker evidence than sales in this one. Not a valuation.",
    );
    // Weaker than a verdict: no stamp, no percentage, no verdict colour, no second headline.
    expect(section.querySelector("[data-slot=scale-stamp], [data-slot=scale-stamp-art], [data-slot=verdict-headline]")).toBeNull();
    expect(section.textContent).not.toMatch(/%\s*(above|below)|ASKING/);
    expect(clean(plain(section.textContent)), plain(section.textContent)).toBe(true);
  });

  it("the scale: a named group with a text summary; rings for other buildings, filled dots for this one; the drawing is aria-hidden", () => {
    renderWithProviders(<RangeScale check={SHOWN} />);
    const chart = screen.getByRole("group", { name: "Where this asking price sits against the range" });
    const summary = document.getElementById(chart.getAttribute("aria-describedby") as string);
    expect(plain(summary?.textContent)).toContain("The shaded range runs from AED 1,720 to AED 1,980. The asking price, AED 1,890, is within it.");
    expect(chart).toHaveAttribute("tabindex", "0");
    expect(chart).toHaveAttribute("data-verdict", "within");
    expect(chart.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(chart.querySelectorAll("[data-slot=range-mark][data-kind=other]")).toHaveLength(9);
    expect(chart.querySelectorAll("[data-slot=range-mark][data-kind=own]")).toHaveLength(SHOWN.sales.length);
    // Shape, not colour alone: a ring has no ink fill, a sale of this building is filled.
    expect(chart.querySelector("[data-kind=other]")).toHaveAttribute("fill", "var(--background)");
    expect(chart.querySelector("[data-kind=own]")).toHaveAttribute("fill", "var(--chart-3)");
    expect(plain(chart.querySelector("[data-slot=range-asking]")?.textContent)).toBe("Asking 1,890");
    expect(plain(chart.querySelector("[data-slot=range-low]")?.textContent)).toBe("1,720");
    expect(plain(chart.querySelector("[data-slot=range-high]")?.textContent)).toBe("1,980");
    const legend = document.querySelector("[data-slot=range-legend]") as HTMLElement;
    expect(plain(legend.textContent)).toBe("AED per sq ft.another building, at its mediana sale in this buildingthe range, AED 1,720 to 1,980");
  });

  it("keyboard: Right and Left step through the marks in price order, End jumps, Esc restores the legend; the readout is announced", () => {
    renderWithProviders(<RangeScale check={SHOWN} />);
    const chart = screen.getByRole("group", { name: "Where this asking price sits against the range" });
    const live = document.querySelector("[data-slot=range-live]") as HTMLElement;
    expect(live).toHaveAttribute("aria-live", "polite");
    const model = similarScale(SHOWN, 358, { variant: "phone" })!;
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(chart.querySelector("[data-slot=range-ring]")).not.toBeNull();
    expect(plain(live.textContent)).toBe(plain(rangeReadout(SHOWN, model.marks[model.order[0]])));
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(plain(live.textContent)).toBe(plain(rangeReadout(SHOWN, model.marks[model.order[1]])));
    expect(plain(document.querySelector("[data-slot=range-readout]")?.textContent)).toBe(plain(live.textContent));
    fireEvent.keyDown(chart, { key: "End" });
    expect(plain(live.textContent)).toBe("Culture Village Tower B: 5 registered sales, median AED 2,150 per sq ft.");
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(plain(live.textContent)).toBe("Palace Gate Residences: 9 registered sales, median AED 2,010 per sq ft.");
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(chart.querySelector("[data-slot=range-ring]")).toBeNull();
    expect(live).toBeEmptyDOMElement();
    expect(document.querySelector("[data-slot=range-legend-1]")).toHaveTextContent("AED per sq ft.");
  });

  it("a scale with no marks is not a tab stop", () => {
    renderWithProviders(<RangeScale check={thin({ ...FIXTURE_SIMILAR_OWN, evidence: { ownSales: 0, olderSales: 5, otherBedroomSales: 0 } }, { sales: [] })} />);
    expect(screen.getByRole("group", { name: "Where this asking price sits against the range" })).not.toHaveAttribute("tabindex");
  });

  it("the list: closed until asked for, then a table of name, sales and median; never behind an ask", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SimilarSection check={SHOWN} settle={false} />);
    const toggle = screen.getByRole("button", { name: "See the 9 other buildings" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Hide the list");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Building", "Sales", "Median"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(SIMILAR_LIST_ROWS);
    expect(rows[0]).toHaveTextContent("Creek Vista Heights");
    expect(within(rows[0]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["22", "1,850"]);
    expect(plain(document.querySelector("[data-slot=similar-list-note]")?.textContent)).toBe("Registered sales of ready 3-beds, 16 Nov 2025 to 16 Nov 2026. Medians in AED per sq ft. Most sales first.");
    await user.click(screen.getByRole("button", { name: "Show all 9" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(10);
    expect(screen.queryByRole("button", { name: "Show all 9" })).toBeNull();
    // Focus moves to the first new row, which shows it: an outline, not a faint fill alone.
    const focused = document.querySelector(`[data-row="${SIMILAR_LIST_ROWS}"]`) as HTMLElement;
    expect(focused.className).toMatch(/focus-visible:outline-2/);
    expect(focused.className).toMatch(/focus-visible:outline-foreground/);
    // No form, no field and no sign-up in front of the list.
    expect(document.querySelector("[data-slot=similar-list] input, [data-slot=similar-list] form")).toBeNull();
    await user.click(toggle);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("a stored list shorter than the count says so; one other building reads in the singular", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<SimilarSection check={thin({ ...FIXTURE_SIMILAR, comparableBuildings: 240 })} settle={false} />);
    expect(plain(document.querySelector("[data-slot=range-capped]")?.textContent)).toBe("Only the 9 with the most sales, of 240, are on this scale.");
    await user.click(screen.getByRole("button", { name: "See the 240 other buildings" }));
    expect(plain(document.querySelector("[data-slot=similar-list-note]")?.textContent)).toContain("The 9 with the most sales, of 240.");
    unmount();
    renderWithProviders(<SimilarSection check={thin({ ...FIXTURE_SIMILAR, level: "project", place: null, comparableBuildings: 1, comparableSales: 22, comparables: FIXTURE_SIMILAR.comparables.slice(0, 1) })} settle={false} />);
    expect(screen.getByRole("button", { name: "See the other building" })).toBeInTheDocument();
    // One other building: "of the same project", and no span of medians to state.
    expect(plain(document.querySelector("[data-slot=similar-evidence]")?.textContent)).toContain("22 registered sales of ready 3-beds in 1 other building of the same project. Other buildings are not matched");
  });

  it("the tier opens the definitions: a popover from 1024px, a sheet on phones", async () => {
    const user = userEvent.setup();
    setMedia({ "(min-width: 1024px)": true });
    const d = renderWithProviders(<SimilarSection check={SHOWN} settle={false} />);
    await user.click(screen.getByRole("button", { name: "Narrow range" }));
    expect(await screen.findByText("Broad range: its ends are up to about 20% from its middle. Fairsquare shows nothing wider.")).toBeInTheDocument();
    // The popover is a named dialog, as the phone sheet is.
    expect(document.querySelector("[data-slot=popover-content]")).toHaveAttribute("aria-label", "Narrow range");
    expect(screen.getByText(/held the building's own median in about 8 of 10 cases/)).toBeInTheDocument();
    expect(screen.getByText("The range takes no account of size, floor, view or condition.")).toBeInTheDocument();
    d.unmount();
    setMedia({ "(min-width: 1024px)": false });
    renderWithProviders(<SimilarSection check={thin({ ...FIXTURE_SIMILAR, tier: "broad" })} settle={false} />);
    const trigger = screen.getByRole("button", { name: "Broad range" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(trigger);
    expect(await screen.findByRole("dialog", { name: "Broad range" })).toBeInTheDocument();
  });

  it("no other building in the range: the same heading, its own caution, no rings, no list, and never the words 'other buildings'", () => {
    renderWithProviders(<SimilarSection check={OWN} settle={false} />);
    const section = document.querySelector("[data-slot=similar-section]") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 3, name: "A range from more registered sales" })).toBeInTheDocument();
    expect(section).not.toHaveAttribute("data-others");
    expect(section.querySelectorAll("[data-kind=other]")).toHaveLength(0);
    expect(section.querySelector("[data-slot=similar-list]")).toBeNull();
    expect(plain(section.querySelector("[data-slot=similar-evidence]")?.textContent)).toBe(
      "Broad range. The range is built from 2 registered sales in this building in those 12 months and 3 earlier sales of the same type here, back to 17 Nov 2023. A few sales are weaker evidence than 5 or more in 12 months. Not a valuation.",
    );
    expect(plain(section.textContent)).not.toMatch(/(similar|other) building/i);
  });

  it("nothing but the 12 months' own sales: no section, and the result is exactly the too-few result (the first tier calls those sales too few)", () => {
    const a = renderWithProviders(<Slots check={FIXTURE_CHECK_THIN} />);
    const before = a.getByTestId("below").innerHTML + a.getByTestId("chart").innerHTML;
    a.unmount();
    const b = renderWithProviders(<Slots check={thin(FIXTURE_SIMILAR_OWN_ONLY)} />);
    expect(b.getByTestId("below").innerHTML + b.getByTestId("chart").innerHTML).toBe(before);
    expect(document.querySelector("[data-slot=similar-section], [data-slot=range-scale]")).toBeNull();
    for (const f of [shareText, ogDescription, ogAlt, cardAlt, verdictAnnouncement] as const) expect(f(thin(FIXTURE_SIMILAR_OWN_ONLY))).toBe(f(FIXTURE_CHECK_THIN));
    expect(ogLines(thin(FIXTURE_SIMILAR_OWN_ONLY)).range).toBeNull();
  });

  it("above and below are said in words and marked on the scale, never by colour alone", () => {
    const above = thin({ ...FIXTURE_SIMILAR, verdict: "above", rangeLowPsf: 1500, rangeHighPsf: 1700 });
    renderWithProviders(<SimilarSection check={above} settle={false} />);
    expect(document.querySelector("[data-slot=similar-verdict]")).toHaveTextContent("is above that range.");
    expect(document.querySelector("[data-slot=range-scale]")).toHaveAttribute("data-verdict", "above");
    expect(document.querySelector("[data-slot=similar-verdict]")?.className).not.toMatch(/verdict-/);
  });

  it("a not-covered comparison never carries a range with the shipped rule; the section still mirrors one if it is stored", () => {
    const refused: CheckView = { ...FIXTURE_CHECK_NONE, similar: { ...FIXTURE_SIMILAR_REFUSED, scenario: "area", reason: "no_building_evidence", level: "area", place: "Dubai Creek Harbour" } };
    (api as unknown as ApiMock).buildings.mockResolvedValue(ok(FIXTURE_COVERAGE) as never);
    const a = renderWithProviders(<Slots check={FIXTURE_CHECK_NONE} />);
    const before = a.getByTestId("below").innerHTML;
    a.unmount();
    const b = renderWithProviders(<Slots check={refused} />);
    expect(b.getByTestId("below").innerHTML).toBe(before);
    expect(b.getByRole("button", { name: "Request it and track" })).toBeInTheDocument();
  });

  it("the project route (REAL_DATA.md section 15.8): the section under the unchanged not-covered result, naming the project", () => {
    const project: CheckView = { ...FIXTURE_CHECK_NONE, completion: "off_plan", analysis: { ...FIXTURE_CHECK_NONE.analysis, completionBasis: "off_plan" }, similar: FIXTURE_SIMILAR_PROJECT };
    (api as unknown as ApiMock).buildings.mockResolvedValue(ok(FIXTURE_COVERAGE) as never);
    const r = renderWithProviders(<Slots check={project} />);
    const below = r.getByTestId("below");
    expect(within(below).getByRole("button", { name: "Request it and track" })).toBeInTheDocument();
    const section = below.querySelector("[data-slot=similar-section]") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 3, name: "A range from other buildings in the Dummyside Lagoon project" })).toBeInTheDocument();
    const text = plain(section.textContent);
    expect(text).toContain("This building has no registered sales in the data, so Fairsquare looked at registered sales in other buildings in the Dummyside Lagoon project.");
    expect(text).toContain("The building itself has no registered sales in the data.");
    expect(text).toMatch(/Not a valuation\./);
    expect(text).not.toMatch(/similar/i);
    expect(clean(text)).toBe(true);
    expect(section.querySelectorAll("[data-slot=range-mark][data-kind=other]")).toHaveLength(4);
    expect(section.querySelectorAll("[data-slot=range-mark][data-kind=own]")).toHaveLength(0);
    r.unmount();
    // A project entry from constants before the route, or without its project, shows nothing.
    const old = renderWithProviders(<Slots check={{ ...project, similar: { ...FIXTURE_SIMILAR_PROJECT, modelVersion: 3 } }} />);
    expect(old.getByTestId("below").querySelector("[data-slot=similar-section]")).toBeNull();
    old.unmount();
    const nameless = renderWithProviders(<Slots check={{ ...project, similar: { ...FIXTURE_SIMILAR_PROJECT, project: null } }} />);
    expect(nameless.getByTestId("below").querySelector("[data-slot=similar-section]")).toBeNull();
    nameless.unmount();
    // /c mirrors it with an h2, and the stored entry parses.
    renderWithProviders(<SharePageView check={project} current={project.analysis} />);
    expect(screen.getByRole("heading", { level: 2, name: "A range from other buildings in the Dummyside Lagoon project" })).toBeInTheDocument();
    expect(SimilarViewSchema.parse(JSON.parse(JSON.stringify(FIXTURE_SIMILAR_PROJECT)))).toEqual(FIXTURE_SIMILAR_PROJECT);
    // An entry stored before the field existed reads as no project.
    const { project: _drop, ...older } = FIXTURE_SIMILAR;
    void _drop;
    expect(SimilarViewSchema.parse(older).project).toBeNull();
  });
});

describe("the /c page mirrors the second tier", () => {
  it("the section under the too-few summary with an h2 (the page's h1 is the unchanged verdict); nothing for a refusal", () => {
    const shown = renderWithProviders(<SharePageView check={SHOWN} current={SHOWN.analysis} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Too few sales to compare yet");
    const section = document.querySelector("[data-slot=similar-section]") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2, name: "A range from more registered sales" })).toBeInTheDocument();
    expect(section.querySelector("[data-slot=range-scale]")).not.toBeNull();
    expect(document.querySelector("[data-slot=wrong-building]")).toBeNull();
    // Headings in order: h1, then h2s only.
    expect([...document.querySelectorAll("h1, h2, h3")].map((h) => h.tagName)).not.toContain("H3");
    shown.unmount();
    renderWithProviders(<SharePageView check={REFUSED} current={REFUSED.analysis} />);
    expect(document.querySelector("[data-slot=similar-section]")).toBeNull();
  });
});

describe("the words that leave the page", () => {
  it("the announcement at the settle reads the too-few sentence, then the second tier's", () => {
    expect(verdictAnnouncement(REFUSED)).toBe(verdictAnnouncement(FIXTURE_CHECK_THIN));
    expect(verdictAnnouncement(SHOWN)).toBe(
      `${verdictAnnouncement(FIXTURE_CHECK_THIN)} This building has too few registered sales of its own to compare, so Fairsquare looked at more registered sales. They point to a median between AED 1,720 and AED 1,980 per sq ft for ready 3-beds in Dummyside Heights 2, in the 12 months to 16 Nov 2026. This asking price, AED 1,890 per sq ft, is within that range.`,
    );
  });

  it("the WhatsApp text: the too-few sentence first, then the range as weaker evidence, then the source", () => {
    const base = shareText(FIXTURE_CHECK_THIN);
    expect(shareText(REFUSED)).toBe(base);
    const text = shareText(SHOWN);
    expect(text.startsWith(base.slice(0, base.indexOf(" Source:")))).toBe(true);
    expect(text).toContain(
      "too few to compare. More registered sales, in this tower and in other buildings in Al Jaddaf, point to a median between AED 1,720 and AED 1,980 per sq ft; the asking price, AED 1,890 per sq ft, is within that range. Weaker evidence than 5 or more sales in the tower. Source: DLD open data via Data.Dubai. Not a valuation.",
    );
    expect(shareText(OWN)).toContain("More registered sales, in this tower over three years, point to a median between AED 1,600 and AED 2,240 per sq ft");
    expect(text).not.toMatch(/%/);
    expect(clean(text.replace(SHOWN.url, "")), text).toBe(true);
  });

  it("the link preview: the title stays too few; the description, the alt text and the image line carry the range", () => {
    expect(ogTitle(SHOWN)).toBe(ogTitle(FIXTURE_CHECK_THIN));
    expect(ogTitle(SHOWN)).toMatch(/^Too few sales to compare/);
    expect(ogDescription(REFUSED)).toBe(ogDescription(FIXTURE_CHECK_THIN));
    expect(ogDescription(SHOWN)).toBe(
      "Too few sales in this building to compare. More registered sales point to a median between AED 1,720 and AED 1,980 per sq ft. Weaker evidence. Not a valuation.",
    );
    expect(ogAlt(SHOWN)).toBe(`${ogAlt(FIXTURE_CHECK_THIN)} A range from more registered sales runs from AED 1,720 to AED 1,980 per sq ft; the asking price is within it.`);
    expect(cardAlt(SHOWN)).toBe(`${cardAlt(FIXTURE_CHECK_THIN)} A range from more registered sales runs from AED 1,720 to AED 1,980 per sq ft; the asking price is within it.`);
    const l = ogLines(SHOWN);
    expect(l.range).toBe("A range from more registered sales: AED 1,720 to 1,980 per sq ft");
    expect(l.head).toMatchObject({ figure: null, line1: "Too few sales", line2: "to compare yet" });
    expect(l.figures).toBe(ogLines(FIXTURE_CHECK_THIN).figures);
    expect(ogLines(FIXTURE_CHECK_THIN).range).toBeNull();
    expect(ogLines(REFUSED).range).toBeNull();
    expect(ogLines(FIXTURE_CHECK_MARINA).range).toBeNull();
    for (const s of [ogDescription(SHOWN), ogAlt(SHOWN), l.range as string]) expect(clean(s), s).toBe(true);
  });
});
