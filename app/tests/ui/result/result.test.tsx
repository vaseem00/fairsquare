// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { linkMock, renderWithProviders } from "../shell/test-utils";

vi.mock("@/lib/api/client", async () => ({ api: (await import("../shell/api-mock")).makeApiMock() }));
vi.mock("next/link", () => linkMock);

import { Provenance } from "@/components/result/provenance";
import { SalesList } from "@/components/result/sales-list";
import { TallyDots, todayLine, VerdictHeadline } from "@/components/result/verdict-summary";
import { FIXTURE_CHECK_JVC, FIXTURE_CHECK_MARINA, FIXTURE_CHECK_NONE, FIXTURE_CHECK_THIN } from "../../fixtures/api-fixtures";
import { COPY } from "@/lib/copy";
import type { CheckView } from "@/lib/types";

describe("the verdict's words", () => {
  it("the headline: only the figure words take the verdict colour; the direction is in the words", () => {
    renderWithProviders(<VerdictHeadline check={FIXTURE_CHECK_MARINA} />);
    const h2 = screen.getByRole("heading", { level: 2, name: "14.0% above registered sales" });
    expect(h2).toHaveAttribute("tabindex", "-1");
    expect(within(h2).getByText("14.0% above")).toHaveClass("text-verdict-above");
    expect(screen.queryByText("Above recent sales")).toBeNull();
    expect(document.querySelector("svg")).toBeNull();
  });

  it("in line keeps the figure words in the in-line hue (ink); too few and not covered are plain ink", () => {
    const { unmount } = renderWithProviders(<VerdictHeadline check={FIXTURE_CHECK_JVC} as="h1" />);
    expect(within(screen.getByRole("heading", { level: 1, name: "In line with registered sales" })).getByText("In line")).toHaveClass(
      "text-verdict-inline",
    );
    unmount();
    renderWithProviders(
      <>
        <VerdictHeadline check={FIXTURE_CHECK_THIN} />
        <VerdictHeadline check={FIXTURE_CHECK_NONE} />
      </>,
    );
    expect(screen.getByRole("heading", { name: COPY["thin.h2"] })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: COPY["band.none"] })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=verdict-figure]")).toBeNull();
  });

  it("the tally: 5 dots with progress semantics and the visible text", () => {
    renderWithProviders(<TallyDots count={2} min={5} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "5");
    expect(bar).toHaveAttribute("aria-valuetext", "2 of the 5 sales needed");
    expect(bar.children).toHaveLength(5);
    expect(bar.querySelectorAll(".bg-foreground")).toHaveLength(2);
  });

  it("todayLine: only when today's count or median moved (/c)", () => {
    const a = FIXTURE_CHECK_MARINA.analysis;
    expect(todayLine(FIXTURE_CHECK_MARINA, a)).toBeNull();
    expect(todayLine(FIXTURE_CHECK_MARINA, undefined)).toBeNull();
    expect(todayLine(FIXTURE_CHECK_MARINA, { ...a, count: 12, medianPsf: 1702.1, diff: 0.121 })).toBe("Today: +12.1% vs 12 sales.");
    expect(todayLine(FIXTURE_CHECK_MARINA, { ...a, band: "thin", diff: null, count: 2 })).toBe("Today: 2 sales, too few to compare.");
    expect(todayLine(FIXTURE_CHECK_NONE, FIXTURE_CHECK_NONE.analysis)).toBeNull();
  });
});

describe("<Provenance>", () => {
  it("one paragraph: the attribution with its links, how far the data runs, the independence line, fees excluded, not a valuation", () => {
    renderWithProviders(<Provenance check={FIXTURE_CHECK_MARINA} />);
    const line = document.querySelector("[data-slot=provenance] p") as HTMLElement;
    expect(line.textContent).toBe(
      "Source: Dubai Land Department sales transactions, published as open data on Data.Dubai and used under the Dubai Open Data Licence. Data to 17 Nov 2026; the latest weeks may be incomplete. Fairsquare is independent. It is not affiliated with or endorsed by the Dubai Land Department or the Government of Dubai. This compares an asking price with registered sale prices, fees excluded on both. It is not a valuation or a forecast.",
    );
    // The dataset and licence names link to the loaded manifest's URLs (REAL_DATA.md section 9).
    expect(within(line).getByRole("link", { name: COPY["data.dataset"] })).toHaveAttribute("href", "https://example.test/dataset");
    expect(within(line).getByRole("link", { name: COPY["data.licence"] })).toHaveAttribute("href", "https://example.test/licence");
  });

  it("a not-covered comparison is still credited and keeps the independence line", () => {
    renderWithProviders(<Provenance check={FIXTURE_CHECK_NONE} />);
    const p = document.querySelector("[data-slot=provenance]") as HTMLElement;
    expect(p).toHaveTextContent("Source: Dubai Land Department sales transactions");
    expect(p).toHaveTextContent(COPY["data.independent"]);
    expect(p).toHaveTextContent("It is not a valuation or a forecast.");
  });
});

describe("the sales behind a comparison (review fixes)", () => {
  it("a list that stores the newest of more sales counts every sale in its title and says it shows the newest", () => {
    const newest = [...FIXTURE_CHECK_MARINA.sales].sort((a, b) => b.saleDate.localeCompare(a.saleDate)).slice(0, 8);
    renderWithProviders(<SalesList check={{ ...FIXTURE_CHECK_MARINA, sales: newest }} />);
    expect(screen.getByRole("heading", { name: "11 registered sales" })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=sales-shown]")).toHaveTextContent("Showing the newest 8 of 11 sales.");
  });

  it("a sale the admin added is marked, and the provenance says so; with only such sales the DLD is not credited", () => {
    const some: CheckView = { ...FIXTURE_CHECK_MARINA, sales: [{ ...FIXTURE_CHECK_MARINA.sales[0], source: "admin" }, ...FIXTURE_CHECK_MARINA.sales.slice(1)] };
    const { unmount } = renderWithProviders(
      <>
        <Provenance check={some} />
        <SalesList check={some} all />
      </>,
    );
    expect(screen.getAllByText(COPY["result.addedByUs"], { exact: false }).length).toBeGreaterThan(0);
    expect(document.querySelector("[data-slot=added-sales]")).toHaveTextContent("1 of these sales was added by Fairsquare, not taken from the DLD open data.");
    expect(document.querySelector("[data-slot=provenance]")).toHaveTextContent("Source: Dubai Land Department sales transactions");
    unmount();

    const all: CheckView = { ...FIXTURE_CHECK_MARINA, sales: FIXTURE_CHECK_MARINA.sales.map((s) => ({ ...s, source: "import" as const })) };
    renderWithProviders(<Provenance check={all} />);
    expect(document.querySelector("[data-slot=added-sales]")).toHaveTextContent("These sales were added by Fairsquare, not taken from the DLD open data.");
    expect(document.querySelector("[data-slot=provenance]")).not.toHaveTextContent("Dubai Land Department sales transactions");
  });
});
