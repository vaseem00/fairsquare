// @vitest-environment jsdom
/**
 * The result section (RESULT_SPEC section 12.3, component tests) with the owner's listing, FYZ79D:
 * Aykon City Tower C, ready 2-bed, 812 sq ft, AED 1,450,000, against 43 real registered sales.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ok, type ApiMock } from "../shell/api-mock";
import { linkMock, renderWithProviders, setMedia } from "../shell/test-utils";

vi.mock("@/lib/api/client", async () => ({ api: (await import("../shell/api-mock")).makeApiMock() }));
vi.mock("next/link", () => linkMock);
vi.mock("@/lib/stamp/card-canvas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stamp/card-canvas")>()),
  renderCard: vi.fn(async () => new File(["png"], "card.png", { type: "image/png" })),
}));

import { resultSlots, useCardGetter, useResultUi } from "@/components/check/result-view";
import { changeOf, EditSheet } from "@/components/result/edit-sheet";
import { EvidenceLine } from "@/components/result/evidence-line";
import { __resetLandedForTests } from "@/components/stamp/use-land-once";
import { FactLine } from "@/components/result/fact-line";
import { MarketScale } from "@/components/result/market-scale";
import { SalesList } from "@/components/result/sales-list";
import { FlowLayout } from "@/components/scene/flow-layout";
import { api } from "@/lib/api/client";
import { COPY } from "@/lib/copy";
import { analyseWith } from "@/lib/domain/analyse";
import { factOfCheck, factText } from "@/lib/result/words";
import type { CheckView } from "@/lib/types";
import { CheckViewSchema } from "@/lib/validation/api";
import { FIXTURE_CHECK_NONE, FIXTURE_CHECK_THIN, FIXTURE_COVERAGE } from "../../fixtures/api-fixtures";

const AYKON: CheckView = CheckViewSchema.parse(
  (JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", "aykon-check.json"), "utf8")) as { check: unknown }).check,
);

/** The owner's listing at another asking price (the spec's illustrative above and below states). */
function asking(priceAed: number): CheckView {
  const { analysis } = analyseWith(priceAed, AYKON.sizeSqft, AYKON.sales, AYKON.rules);
  return { ...AYKON, priceAed, analysis: { ...AYKON.analysis, ...analysis } };
}

const plain = (s: string | null | undefined) => (s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

function Slots({ check, desktop = false, onPick = () => undefined }: { check: CheckView; desktop?: boolean; onPick?: () => void }) {
  const ui = useResultUi();
  const getCard = useCardGetter(check);
  const s = resultSlots({
    check,
    image: null,
    match: null,
    desktop,
    getCard,
    ui,
    onAnother: () => undefined,
    onPickBuilding: onPick,
    onCompareReady: () => undefined,
  });
  return (
    <>
      <div data-testid="fact">{s.fact}</div>
      <div data-testid="chart">{s.chart}</div>
      <div data-testid="below">{s.below}</div>
      <div data-testid="stage">{s.stage}</div>
      <div data-testid="rest">{s.rest}</div>
    </>
  );
}

describe("<MarketScale> (section 4)", () => {
  it("a named group described by its summary; 43 dots, 11 filled; the stamp and the drawing are aria-hidden", () => {
    renderWithProviders(<MarketScale check={AYKON} variant="phone" />);
    const chart = screen.getByRole("group", { name: "Where this asking price sits among 43 registered sales" });
    const summary = document.getElementById(chart.getAttribute("aria-describedby") as string);
    expect(plain(summary?.textContent)).toBe(
      "Each dot is a registered sale of a ready 2-bed in Aykon City (2) -Tower C, 16 Nov 2025 to 16 Nov 2026. Lowest AED 1,470, highest AED 2,899 per sq ft. Median AED 1,761. This asking price, AED 1,786, is higher than 25 of them. The 11 sales since 18 Aug are filled; their median is AED 1,602.",
    );
    expect(chart).toHaveAttribute("tabindex", "0");
    expect(chart.querySelectorAll("[data-slot=scale-dot]")).toHaveLength(43);
    expect(chart.querySelectorAll("[data-slot=scale-dot][data-recent]")).toHaveLength(11);
    const stamp = chart.querySelector("[data-slot=scale-stamp]") as HTMLElement;
    expect(stamp).toHaveAttribute("aria-hidden", "true");
    expect(stamp).toHaveTextContent("ASKING");
    expect(stamp).toHaveTextContent("1,786");
    expect(chart.querySelector("svg[data-slot=scale-svg]")).toHaveAttribute("aria-hidden", "true");
    // 25 sales below the asking price sit left of the pin: exactly the "higher than 25" count.
    const pinX = Number(chart.querySelector("[data-slot=scale-pin] line")?.getAttribute("x1"));
    const left = [...chart.querySelectorAll("[data-slot=scale-dot]")].filter((d) => Number(d.getAttribute("cx")) < pinX);
    expect(pinX).toBeCloseTo(94.6, 1);
    expect(left).toHaveLength(25);
  });

  it("labels on x(): Median 1,761, 2,500 and 3,000 on phones (1,500 and 2,000 hide behind the median)", () => {
    renderWithProviders(<MarketScale check={AYKON} variant="phone" />);
    expect(plain(document.querySelector("[data-slot=scale-median-label]")?.textContent)).toBe("Median1,761");
    expect([...document.querySelectorAll("[data-slot=scale-tick-label]")].map((e) => e.textContent)).toEqual(["2,500", "3,000"]);
    expect(document.querySelector("[data-slot=market-scale]")).toHaveStyle({ height: "149px" });
  });

  it("the legend: unit, since 18 Aug, earlier, and the band with its ends", () => {
    renderWithProviders(<MarketScale check={AYKON} variant="phone" />);
    expect(plain(document.querySelector("[data-slot=scale-legend-1]")?.textContent)).toBe("AED per sq ft.since 18 Augearlier");
    expect(plain(document.querySelector("[data-slot=scale-legend-2]")?.textContent)).toBe("within 5% of the median, AED 1,673 to 1,849");
  });

  it("tap or drag reads a sale; arrow keys, Home and End step in price order; Esc restores the legend", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MarketScale check={AYKON} variant="phone" />);
    const chart = screen.getByRole("group", { name: /^Where this asking price sits/ });
    const live = document.querySelector("[data-slot=scale-live]") as HTMLElement;
    expect(live).toHaveAttribute("aria-live", "polite");
    chart.focus();
    await user.keyboard("{Home}");
    expect(plain(live.textContent)).toBe("3 Nov 2026: 817 sq ft, AED 1,200,000, AED 1,470 per sq ft.");
    expect(plain(document.querySelector("[data-slot=scale-readout]")?.textContent)).toBe(plain(live.textContent));
    expect(chart.querySelector("[data-slot=scale-ring]")).not.toBeNull();
    await user.keyboard("{End}");
    expect(plain(live.textContent)).toMatch(/^9 Apr 2026: .* AED 2,899 per sq ft\.$/);
    await user.keyboard("{ArrowLeft}");
    expect(plain(live.textContent)).not.toMatch(/2,899/);
    await user.keyboard("{Escape}");
    expect(live.textContent).toBe("");
    expect(document.querySelector("[data-slot=scale-readout]")).toBeNull();
    expect(chart.querySelector("[data-slot=scale-ring]")).toBeNull();
    // A pointer anywhere picks the nearest sale by x (no precise hit needed); a tap outside restores.
    act(() => {
      fireEvent.pointerDown(chart, { clientX: 31, pointerId: 1, pointerType: "touch" });
    });
    expect(plain(live.textContent)).toMatch(/AED 1,470 per sq ft\.$/);
    act(() => {
      fireEvent.pointerDown(document.body, { pointerId: 2, pointerType: "touch" });
    });
    expect(live.textContent).toBe("");
  });

  it("desktop: 9px dots, the 116 x 65 stamp and every tick label but 2,000", () => {
    renderWithProviders(<MarketScale check={AYKON} variant="desktop" />);
    const dot = document.querySelector("[data-slot=scale-dot][data-recent]") as SVGCircleElement;
    expect(dot.getAttribute("r")).toBe("4.5");
    expect(document.querySelector("[data-slot=scale-stamp]")).toHaveStyle({ width: "116px", height: "65px" });
    expect([...document.querySelectorAll("[data-slot=scale-tick-label]")].map((e) => e.textContent)).toEqual(["1,500", "2,500", "3,000"]);
  });

  it("draws nothing for too few sales or not covered", () => {
    const { container } = renderWithProviders(
      <>
        <MarketScale check={FIXTURE_CHECK_THIN} />
        <MarketScale check={FIXTURE_CHECK_NONE} />
      </>,
    );
    expect(container.querySelector("[data-slot=market-scale]")).toBeNull();
  });
});

describe("<FactLine> (section 2.4)", () => {
  it("two lines, the listing's own text; no labels and no blanks", () => {
    renderWithProviders(<FactLine values={factOfCheck(AYKON)} onEdit={() => undefined} />);
    const line = document.querySelector("[data-slot=fact-line]") as HTMLElement;
    expect(line.tagName).toBe("P");
    expect(plain(document.querySelector("[data-slot=fact-line1]")?.textContent)).toBe("Aykon City Tower C, Business Bay.");
    expect(plain(document.querySelector("[data-slot=fact-line2]")?.textContent)).toBe("Ready 2-bed, 812 sq ft, AED 1,450,000.");
    expect(screen.getByRole("button", { name: COPY["fact.editSr"] })).toHaveTextContent(COPY["fact.edit"]);
    // "AED" and "sq ft" stay with their numbers.
    expect(line.textContent).toContain("812 sq ft");
    expect(line.textContent).toContain("AED 1,450,000");
  });

  it("leaves out what is not known, says 'about' for a size button, and drops the basis when unknown", () => {
    const v = factOfCheck(AYKON);
    expect(factText({ ...v, sizeSqft: null })).toBe("Aykon City Tower C, Business Bay. Ready 2-bed, AED 1,450,000.");
    expect(factText({ ...v, sizeSqft: 815, sizeAbout: true })).toBe("Aykon City Tower C, Business Bay. Ready 2-bed, about 815 sq ft, AED 1,450,000.");
    expect(factText({ ...v, completion: "unknown" })).toBe("Aykon City Tower C, Business Bay. 2-bed, 812 sq ft, AED 1,450,000.");
    expect(factText({ ...v, completion: "off_plan", bedrooms: 0 })).toBe("Aykon City Tower C, Business Bay. Off-plan studio, 812 sq ft, AED 1,450,000.");
    expect(factText({ ...v, completion: null, bedrooms: 0 })).toBe("Aykon City Tower C, Business Bay. Studio, 812 sq ft, AED 1,450,000.");
    expect(factText({ ...v, area: null, bedrooms: null })).toBe("Aykon City Tower C. Ready, 812 sq ft, AED 1,450,000.");
    expect(factText({ ...v, building: null })).toBe("Ready 2-bed, 812 sq ft, AED 1,450,000.");
    const { container } = renderWithProviders(<FactLine values={{ ...v, building: null, bedrooms: null, sizeSqft: null, priceAed: null, completion: null }} />);
    expect(container.querySelector("[data-slot=fact-line]")).toBeNull();
  });
});

describe("<EvidenceLine> (section 3.1)", () => {
  it("Strong for the owner's listing: the count, window, latest sale, set-aside count, DLD building, Not a valuation, Wrong building?", async () => {
    const onWrong = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<EvidenceLine check={AYKON} onWrongBuilding={onWrong} />);
    const line = document.querySelector("[data-slot=evidence-line]") as HTMLElement;
    expect(line).toHaveAttribute("data-tier", "strong");
    expect(plain(line.textContent)).toBe(
      "Strong evidence. 43 registered sales of ready 2-beds in Aykon City (2) -Tower C, 16 Nov 2025 to 16 Nov 2026, the latest on 16 Nov. None set aside. Not a valuation. Wrong building?",
    );
    await user.click(screen.getByRole("button", { name: COPY["evidence.wrongBuilding"] }));
    expect(onWrong).toHaveBeenCalledTimes(1);
    // Phones: the definitions open in a bottom sheet.
    await user.click(screen.getByRole("button", { name: "Strong evidence" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(COPY["evidence.defStrong"])).toBeInTheDocument();
    expect(plain(within(sheet).getByText(/^Here:/).textContent)).toBe(
      "Here: 43 sales, 11 in the last 90 days, middle half AED 1,599 to 1,854 per sq ft (14.5% of the median).",
    );
    expect(within(sheet).getByText(COPY["evidence.defCounts"])).toBeInTheDocument();
  });

  it("tiers: from the count, one down for fewer than 3 recent sales, one more for a wide middle half, never below Limited", () => {
    const tier = (c: CheckView) => {
      const { container, unmount } = renderWithProviders(<EvidenceLine check={c} />);
      const t = container.querySelector("[data-slot=evidence-line]")?.getAttribute("data-tier");
      unmount();
      return t;
    };
    expect(tier({ ...AYKON, analysis: { ...AYKON.analysis, count: 15 } })).toBe("moderate");
    expect(tier({ ...AYKON, analysis: { ...AYKON.analysis, count: 7 } })).toBe("limited");
    // No sale in the last 90 days: Strong drops to Moderate.
    const old = AYKON.sales.filter((s) => s.saleDate < "2026-08-18");
    expect(tier({ ...AYKON, sales: old })).toBe("moderate");
    // Also a middle half far wider than 20% of the median: one more down.
    const wide = old.map((s, i) => ({ ...s, psf: i % 2 ? s.psf * 1.6 : s.psf * 0.6 }));
    expect(tier({ ...AYKON, sales: wide })).toBe("limited");
    expect(tier({ ...AYKON, sales: wide, analysis: { ...AYKON.analysis, count: 7 } })).toBe("limited");
    // Too few: no tier and no evidence line (the thin line says the DLD building instead).
    expect(tier(FIXTURE_CHECK_THIN)).toBeUndefined();
  });

  it("counts unusual sales set aside", () => {
    renderWithProviders(<EvidenceLine check={{ ...AYKON, analysis: { ...AYKON.analysis, outliersDropped: 2 } }} />);
    expect(document.querySelector("[data-slot=evidence-line]")).toHaveTextContent("2 unusual sales set aside.");
  });
});

describe("<SalesList> (section 5)", () => {
  it("phones: 5 rows newest first with the same-size sentence and tags; Show all 43 expands in place; never gated", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalesList check={AYKON} />);
    expect(screen.getByRole("heading", { level: 3, name: "43 registered sales" })).toBeInTheDocument();
    expect(plain(document.querySelector("[data-slot=same-size-sentence]")?.textContent)).toBe(
      "The 3 newest sales of the same size (within 3% of 812 sq ft) registered at AED 1,200,000 to AED 1,260,045.",
    );
    const rows = () => [...document.querySelectorAll("[data-slot=sales-rows] li")];
    expect(rows()).toHaveLength(5);
    expect(plain(rows()[0].textContent)).toBe("16 Nov 2026AED 1,500,000943 sq ftAED 1,591 per sq ft");
    expect(plain(rows()[1].textContent)).toBe("3 Nov 2026AED 1,200,000817 sq ft, same sizeAED 1,470 per sq ft");
    expect(within(rows()[0] as HTMLElement).getByRole("img", { name: "since 18 Aug" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all 43 sales" }));
    expect(rows()).toHaveLength(43);
    expect(screen.queryByRole("button", { name: "Show all 43 sales" })).toBeNull();
    expect(within(rows()[42] as HTMLElement).getByRole("img", { name: "earlier" })).toBeInTheDocument();
  });

  it("the sort pair reorders in place (aria-pressed)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SalesList check={AYKON} />);
    const group = screen.getByRole("group", { name: COPY["list.sortLabel"] });
    const newest = within(group).getByRole("button", { name: COPY["list.newest"] });
    const byPsf = within(group).getByRole("button", { name: COPY["list.byPsf"] });
    expect(newest).toHaveAttribute("aria-pressed", "true");
    await user.click(byPsf);
    expect(byPsf).toHaveAttribute("aria-pressed", "true");
    expect(newest).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector("[data-slot=sales-rows] li")).toHaveTextContent(/AED.1,470 per.sq.ft$/);
  });

  it("set-aside sales are listed and tagged; desktop is a table of 12 rows, then Show all", () => {
    const aside = { saleDate: "2026-10-01" as const, sizeSqft: 820, priceAed: 400_000, psf: 400_000 / 820 };
    const check: CheckView = { ...AYKON, setAsideSales: [aside], analysis: { ...AYKON.analysis, outliersDropped: 1 } };
    const { unmount } = renderWithProviders(<SalesList check={check} />);
    expect(screen.getByRole("heading", { name: "44 registered sales" })).toBeInTheDocument();
    unmount();
    setMedia({ "(min-width: 1024px)": true });
    renderWithProviders(<SalesList check={check} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => plain(h.textContent))).toEqual(["Registered", "Size (sq ft)", "Price (AED)", "AED per sq ft", "Note"]);
    expect(within(table).getAllByRole("row")).toHaveLength(13);
    expect(within(table).getByText("Set aside")).toBeInTheDocument();
    expect(within(table).getAllByText("Same size").length).toBeGreaterThan(0);
  });
});

describe("result states (section 6)", () => {
  it("in line (the owner's listing): fact, scale, gap sentence, recent line, evidence; level 2 open; no stamped sheet", () => {
    renderWithProviders(<Slots check={AYKON} />);
    expect(screen.getByTestId("chart").querySelector("[data-slot=market-scale]")).not.toBeNull();
    expect(plain(document.querySelector("[data-slot=gap-sentence]")?.textContent)).toBe(
      "The asking price is AED 25 per sq ft above the median (1.4%), and higher than 25 of the 43 sales.",
    );
    expect(plain(document.querySelector("[data-slot=recent-line]")?.textContent)).toBe(
      "Recent sales are lower. The 11 since 18 Aug have a median of AED 1,602 per sq ft. This asking price is higher than 9 of them.",
    );
    expect(document.querySelector("[data-slot=listing-check], [data-slot=premium-link], [data-slot=stamped-sheet]")).toBeNull();
    // Before you make an offer: closed on phones in line; the premium line when 3 or more sales sit 15% over.
    const toggle = screen.getByRole("button", { name: COPY["offer.h"] });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("[data-slot=offer-panel]")).toHaveTextContent("8 of the 43 sales were at AED 2,091 per sq ft or more.");
    // Every result keeps the attribution, the independence line and Not a valuation.
    const provenance = document.querySelector("[data-slot=provenance]") as HTMLElement;
    expect(provenance).toHaveTextContent("Source: Dubai Land Department sales transactions");
    expect(provenance).toHaveTextContent(COPY["data.independent"]);
    expect(provenance).toHaveTextContent("Data to 16 Nov 2026; the latest weeks may be incomplete.");
    expect(document.querySelector("[data-slot=evidence-line]")).toHaveTextContent("Not a valuation.");
  });

  it("in line with no drift: no recent line", () => {
    // The 12-month median moved onto the recent one: no drift over 5%.
    renderWithProviders(<Slots check={{ ...AYKON, analysis: { ...AYKON.analysis, medianPsf: 1610 } }} />);
    expect(document.querySelector("[data-slot=recent-line]")).toBeNull();
  });

  it("above (AED 1,650,000): no % in the sentence, Ask what explains the premium, the offer notes open", () => {
    renderWithProviders(<Slots check={asking(1_650_000)} />);
    expect(plain(document.querySelector("[data-slot=gap-sentence]")?.textContent)).toBe(
      "The asking price is AED 271 per sq ft above the median, and higher than 35 of the 43 sales.",
    );
    expect(screen.getByRole("button", { name: COPY["result.premiumLink"] })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY["offer.h"] })).toHaveAttribute("aria-expanded", "true");
  });

  it("above every sale (AED 2,400,000): higher than all 43, with the highest sale", () => {
    renderWithProviders(<Slots check={asking(2_400_000)} />);
    expect(plain(document.querySelector("[data-slot=gap-sentence]")?.textContent)).toBe(
      "The asking price is AED 1,195 per sq ft above the median, and higher than all 43 sales. The highest was AED 2,899 per sq ft, on 9 Apr 2026.",
    );
  });

  it("below (AED 1,300,000): the listing check with How to check; the recent line in counts", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Slots check={asking(1_300_000)} />);
    expect(plain(document.querySelector("[data-slot=gap-sentence]")?.textContent)).toBe(
      "The asking price is AED 160 per sq ft below the median, and lower than 32 of the 43 sales.",
    );
    expect(document.querySelector("[data-slot=listing-check]")).toHaveTextContent(COPY["result.listingCheck"]);
    expect(plain(document.querySelector("[data-slot=recent-line]")?.textContent)).toMatch(/This asking price is lower than 6 of them\.$/);
    await user.click(screen.getByRole("button", { name: COPY["result.howToCheck"] }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getAllByRole("listitem")).toHaveLength(3);
  });

  it("too few: no scale and no stamp; the tally, the sentence, the DLD building, Save first and the open list", () => {
    renderWithProviders(<Slots check={FIXTURE_CHECK_THIN} />);
    expect(document.querySelector("[data-slot=market-scale], [data-slot=scale-stamp], [data-slot=stamp]")).toBeNull();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "2 of the 5 sales needed");
    expect(document.querySelector("[data-slot=verdict-sentence]")).toHaveTextContent(COPY["thin.notHighLow"]);
    expect(plain(document.querySelector("[data-slot=evidence-line]")?.textContent)).toBe(
      "DLD building: Dummyside Heights 2. Not a valuation. Wrong building?",
    );
    const bar = document.querySelector("[data-slot=action-bar]") as HTMLElement;
    expect(within(bar).getAllByRole("button")[0]).toHaveTextContent(COPY["save.cta"]);
    expect(screen.getByRole("heading", { name: "2 registered sales" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("not covered: no scale and no evidence line", async () => {
    (api as unknown as ApiMock).buildings.mockResolvedValue(ok(FIXTURE_COVERAGE) as never);
    renderWithProviders(<Slots check={FIXTURE_CHECK_NONE} />);
    expect(await screen.findByText(/^We couldn.t match “Nowhere Point Tower” to a building in Dubai Land Department sales data\./)).toBeInTheDocument();
    expect(document.querySelector("[data-slot=market-scale], [data-slot=evidence-line], [data-slot=sales-list]")).toBeNull();
    expect(document.querySelector("[data-slot=provenance]")).toHaveTextContent(COPY["data.independent"]);
  });

  it("desktop: the card preview and the actions sit in the stage cell, not in a sticky bar", async () => {
    setMedia({ "(min-width: 1024px)": true });
    URL.createObjectURL = vi.fn(() => "blob:card");
    URL.revokeObjectURL = vi.fn();
    renderWithProviders(<Slots check={AYKON} desktop />);
    const stage = screen.getByTestId("stage");
    expect(await within(stage).findByRole("button", { name: COPY["share.openCard"] })).toBeInTheDocument();
    expect(within(stage).getByRole("link", { name: COPY["share.whatsapp"] })).toBeInTheDocument();
    expect(within(stage).getByRole("button", { name: COPY["share.more"] })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=action-bar]")).toBeNull();
    // Open from 1024px.
    expect(screen.getByRole("button", { name: COPY["offer.h"] })).toHaveAttribute("aria-expanded", "true");
  });

  it("the reading and tab order is the sentences, then the card preview: the stage cell follows below in the DOM (RESULT_SPEC 3.1)", () => {
    renderWithProviders(
      <FlowLayout mode="result" head={<h2>h</h2>} fact={<p>f</p>} chart={<p>c</p>} below={<p>b</p>} stage={<p>s</p>} rest={<p>r</p>} stagePhone="hide" />,
    );
    const order = [...document.querySelectorAll("[data-slot=flow-layout] > [data-slot]")].map((e) => e.getAttribute("data-slot"));
    expect(order).toEqual(["flow-notices", "flow-head", "flow-fact", "flow-chart", "flow-below", "flow-stage", "flow-rest"]);
    // Phones still show the stage (the balance) between the fact line and the chart; desktop places it explicitly.
    const cls = (slot: string) => document.querySelector(`[data-slot=${slot}]`)?.className ?? "";
    expect(cls("flow-stage")).toContain("max-lg:order-1");
    expect(cls("flow-chart")).toContain("max-lg:order-2");
    expect(cls("flow-below")).toContain("max-lg:order-3");
    expect(cls("flow-rest")).toContain("max-lg:order-4");
    expect(cls("flow-stage")).toContain("lg:col-start-7");
  });

  it("the off-plan helper: the building's ready count, and a 44px target on its inline text button", () => {
    const thinOffPlan: CheckView = {
      ...FIXTURE_CHECK_THIN,
      completion: "off_plan",
      analysis: { ...FIXTURE_CHECK_THIN.analysis, completionBasis: "off_plan" },
    };
    const match = {
      candidates: [
        {
          buildingId: thinOffPlan.building?.id as number,
          name: "Dummyside Heights 2",
          area: "Al Jaddaf",
          strength: "strong" as const,
          salesForBedrooms: 2,
          basisSales: { ready: 7, offPlan: 2 },
        },
      ],
      preselectId: thinOffPlan.building?.id as number,
      towerCheck: false,
      areaCheck: false,
    };
    function Probe() {
      const ui = useResultUi();
      const s = resultSlots({
        check: thinOffPlan,
        image: null,
        match,
        desktop: false,
        getCard: () => Promise.resolve(null),
        ui,
        onAnother: () => undefined,
        onPickBuilding: () => undefined,
        onCompareReady: () => undefined,
      });
      return <>{s.below}</>;
    }
    renderWithProviders(<Probe />);
    expect(plain(document.querySelector("[data-slot=offplan-mismatch]")?.textContent)).toBe(
      "This building has 7 ready 3-bed sales. Is the listing ready? Compare with ready sales",
    );
    const button = screen.getByRole("button", { name: COPY["offplan.compareReady"] });
    expect(button.className).toContain("after:-inset-y-3");
    expect(button.className).toContain("relative");
  });

  it("Edit and Wrong building? open the Change a detail sheet: at its rows, or at the building question", async () => {
    const opened: string[] = [];
    function Probe() {
      const ui = useResultUi();
      const s = resultSlots({
        check: AYKON,
        image: null,
        match: null,
        desktop: false,
        getCard: () => Promise.resolve(null),
        ui: { ...ui, openEdit: (entry) => opened.push(entry) },
        onAnother: () => undefined,
        onPickBuilding: () => undefined,
        onCompareReady: () => undefined,
      });
      return (
        <>
          {s.fact}
          {s.below}
        </>
      );
    }
    const user = userEvent.setup();
    renderWithProviders(<Probe />);
    await user.click(screen.getByRole("button", { name: COPY["fact.editSr"] }));
    await user.click(screen.getByRole("button", { name: COPY["evidence.wrongBuilding"] }));
    expect(opened).toEqual(["rows", "building"]);
  });
});

describe("<EditSheet> Change a detail (section 7)", () => {
  function renderSheet(props: Partial<Parameters<typeof EditSheet>[0]> = {}) {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    const onTypeAll = vi.fn();
    renderWithProviders(
      <EditSheet
        open
        entry="rows"
        onOpenChange={onOpenChange}
        check={AYKON}
        image={null}
        match={null}
        onChange={onChange}
        onTypeAll={onTypeAll}
        onViewImage={() => undefined}
        {...props}
      />,
    );
    return { onChange, onOpenChange, onTypeAll };
  }

  it("the five rows say what this result compared; the title takes focus; Type all the details opens the form", async () => {
    const user = userEvent.setup();
    const { onTypeAll } = renderSheet();
    const title = await screen.findByRole("heading", { name: COPY["edit.h"] });
    await vi.waitFor(() => expect(title).toHaveFocus());
    const rows = [...document.querySelectorAll("[data-slot=edit-rows] li button")].map((b) =>
      plain([...b.querySelectorAll("span")].map((s) => s.textContent).join(" ")),
    );
    expect(rows).toEqual([
      "Building Aykon City (2) -Tower C",
      "Bedrooms 2",
      "Size 812 sq ft",
      "Asking price AED 1,450,000",
      "Ready or off-plan Ready",
    ]);
    // No screenshot: no screenshot row.
    expect(document.querySelector("[data-slot=edit-screenshot]")).toBeNull();
    await user.click(screen.getByRole("button", { name: COPY["edit.typeAll"] }));
    expect(onTypeAll).toHaveBeenCalledTimes(1);
  });

  it("Asking price: one question with Back; Continue hands over the new value; the same value just closes", async () => {
    const user = userEvent.setup();
    const { onChange, onOpenChange } = renderSheet();
    await user.click(await screen.findByRole("button", { name: /^Asking price/ }));
    expect(screen.getByRole("heading", { name: COPY["ask.priceH"] })).toBeInTheDocument();
    const price = screen.getByLabelText(COPY["field.price"]);
    await vi.waitFor(() => expect(price).toHaveFocus());
    expect(price).toHaveValue("1,450,000");
    await user.clear(price);
    await user.type(price, "1650000");
    await user.click(screen.getByRole("button", { name: COPY["ask.continue"] }));
    expect(onChange).toHaveBeenCalledWith({ field: "priceAed", value: 1_650_000 });
    // Back returns to the rows.
    await user.click(screen.getByRole("button", { name: COPY["step.back"] }));
    expect(screen.getByRole("heading", { name: COPY["edit.h"] })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Asking price/ }));
    await user.click(screen.getByRole("button", { name: COPY["ask.continue"] }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("Size: the usual sizes from this result's own registered sales; a tap compares with 'about'", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSheet();
    await user.click(await screen.findByRole("button", { name: /^Size/ }));
    const group = screen.getByRole("group", { name: "Usual 2-bed sizes in Aykon City (2) -Tower C" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["About 815 sq ft, 31 sales", "About 895 sq ft, 6 sales", "About 945 sq ft, 6 sales"]);
    await user.click(buttons[0]);
    expect(onChange).toHaveBeenCalledWith({ field: "sizeSqft", value: 815, source: "cluster" });
  });

  it("Bedrooms and Ready or off-plan: a tap hands over the change", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSheet();
    await user.click(await screen.findByRole("button", { name: /^Bedrooms/ }));
    await user.click(screen.getByRole("button", { name: "3 bed" }));
    expect(onChange).toHaveBeenLastCalledWith({ field: "bedrooms", value: 3 });
    await user.click(screen.getByRole("button", { name: COPY["step.back"] }));
    await user.click(screen.getByRole("button", { name: /^Ready or off-plan/ }));
    await user.click(screen.getByRole("button", { name: "Off-plan" }));
    expect(onChange).toHaveBeenLastCalledWith({ field: "completion", value: "off_plan" });
  });

  it("Wrong building? opens straight at the building question: None of these and Search, no Back", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSheet({ entry: "building" });
    expect(await screen.findByRole("heading", { name: COPY["ask.buildingH"] })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: COPY["step.back"] })).toBeNull();
    expect(screen.getByRole("button", { name: COPY["pick.search"] })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^None of these/ }));
    expect(onChange).toHaveBeenCalledWith({ field: "building", value: null });
  });

  it("changeOf: an unchanged value is no change", () => {
    expect(changeOf(AYKON, { priceAed: 1_450_000 })).toBeNull();
    expect(changeOf(AYKON, { sizeSqft: 812, sizeSource: "typed" })).toBeNull();
    expect(changeOf(AYKON, { sizeSqft: 812, sizeSource: "cluster" })).toEqual({ field: "sizeSqft", value: 812, source: "cluster" });
    expect(changeOf(AYKON, { bedrooms: 2 })).toBeNull();
    expect(changeOf(AYKON, { completion: "ready" })).toBeNull();
  });
});

describe("the /c scale lands once per session (section 6.10)", () => {
  it("the first view carries the CSS landing; a second view in the same session shows the stamp at rest", () => {
    __resetLandedForTests();
    const { unmount } = renderWithProviders(<MarketScale check={AYKON} landing="session" />);
    const first = document.querySelector("[data-slot=scale-stamp]") as HTMLElement;
    expect(first.className).toContain("motion-safe:animate-in");
    unmount();
    renderWithProviders(<MarketScale check={AYKON} landing="session" />);
    expect((document.querySelector("[data-slot=scale-stamp]") as HTMLElement).className).not.toContain("animate-in");
  });
});
