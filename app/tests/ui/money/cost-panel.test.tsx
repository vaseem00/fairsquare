// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, setMedia } from "../shell/test-utils";
import type { ApiMock } from "../shell/api-mock";

vi.mock("@/lib/api/client", async () => ({ api: (await import("../shell/api-mock")).makeApiMock() }));

import { CostPanel } from "@/components/money/cost-panel";
import { CostRow } from "@/components/money/cost-row";
import { __resetCostChoicesForTests, defaultChoice } from "@/components/money/cost-store";
import { OUTPUT_DEBOUNCE_MS, parseRate } from "@/components/money/estimator";
import { api } from "@/lib/api/client";
import { FIXTURE_CHECK_MARINA, FIXTURE_CHECK_NONE, FIXTURE_CONFIG, buildFixtureCheck } from "../../fixtures/api-fixtures";
import { costRow } from "@/lib/copy";
import { estimateMortgage, minDownPct } from "@/lib/domain/mortgage";
import { formatAed, formatInt } from "@/lib/format";
import type { CheckView } from "@/lib/types";

const apiMock = api as unknown as ApiMock;

function Harness({ check }: { check: CheckView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CostRow check={check} onOpen={() => setOpen(true)} />
      <CostPanel check={check} open={open} onOpenChange={setOpen} />
    </>
  );
}

const MARINA = estimateMortgage({ priceAed: 2_450_000, downPct: 20, ratePct: 4.25, years: 25 });

beforeEach(() => {
  __resetCostChoicesForTests();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("CostRow", () => {
  it("shows the Marina default: About AED 10,618 a month with 20% down, plus Adjust", () => {
    renderWithProviders(<CostRow check={FIXTURE_CHECK_MARINA} onOpen={() => undefined} />);
    const row = screen.getByRole("button", { name: /About AED 10,618 a month with 20% down/ });
    expect(row).toHaveTextContent("Adjust");
    expect(row).toHaveTextContent(costRow(MARINA.monthlyAed, 20));
    // One rule above only: the sales accordion below draws its own, so two hairlines never stack.
    expect(row).toHaveClass("border-t");
    expect(row).not.toHaveClass("border-y");
  });

  it("works from the price alone for a not-covered comparison", () => {
    renderWithProviders(<CostRow check={FIXTURE_CHECK_NONE} onOpen={() => undefined} />);
    const e = estimateMortgage({ priceAed: FIXTURE_CHECK_NONE.priceAed, downPct: 20, ratePct: 4.25, years: 25 });
    expect(screen.getByRole("button", { name: new RegExp(`About AED ${formatInt(e.monthlyAed)} a month`) })).toBeInTheDocument();
  });
});

// base-ui hides the slider thumb until it can measure layout, which jsdom cannot: query with hidden: true.
describe("CostPanel (Marina fixture at the defaults)", () => {
  it("matches the domain functions: monthly, loan, upfront and the itemised breakdown", async () => {
    renderWithProviders(<Harness check={FIXTURE_CHECK_MARINA} />);
    await userEvent.click(screen.getByRole("button", { name: /About AED 10,618/ }));

    expect(await screen.findByRole("heading", { name: "Monthly cost estimate" })).toBeInTheDocument();
    expect(screen.getByText("For an asking price of AED 2,450,000")).toBeInTheDocument();

    const output = document.querySelector("output") as HTMLOutputElement;
    expect(output).toHaveAttribute("aria-live", "polite");
    expect(output).toHaveTextContent("About AED 10,618 a month");
    expect(output).toHaveTextContent("Monthly payment about AED 10,618");
    expect(formatInt(MARINA.monthlyAed)).toBe("10,618");

    expect(screen.getByText(formatAed(MARINA.loanAed))).toBeInTheDocument();
    expect(formatAed(MARINA.loanAed)).toBe("AED 1,960,000");
    expect(screen.getByText(formatAed(MARINA.upfrontAed))).toBeInTheDocument();
    expect(formatAed(MARINA.upfrontAed)).toBe("AED 644,350");

    await userEvent.click(screen.getByRole("button", { name: "Show the upfront costs" }));
    for (const [label, value] of [
      ["Down payment", MARINA.upfront.down],
      ["DLD transfer fee (4%)", MARINA.upfront.dldFee],
      ["Mortgage registration (0.25%)", MARINA.upfront.mortgageRegistration],
      ["Agency fee (2% plus VAT)", MARINA.upfront.agencyFee + MARINA.upfront.agencyVat],
    ] as const) {
      const dt = await screen.findByText(label, { selector: "dt" });
      expect(dt.nextElementSibling).toHaveTextContent(formatAed(value));
    }
    expect(screen.getByText("AED 51,450")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Estimate only, not an offer of credit. Expats usually need at least 20% down on a first home up to AED 5M, and 30% above that.",
      ),
    ).toBeInTheDocument();
  });

  it("records cost_opened once when it opens", async () => {
    renderWithProviders(<Harness check={FIXTURE_CHECK_MARINA} />);
    expect(apiMock.track).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /About AED 10,618/ }));
    await screen.findByRole("heading", { name: "Monthly cost estimate" });
    expect(apiMock.track).toHaveBeenCalledTimes(1);
    expect(apiMock.track).toHaveBeenCalledWith("cost_opened", "K7Q2MX");
  });

  it("down payment slider: minimum from minDownPct, aria-valuetext per cost.downSr, and −/+ buttons", async () => {
    renderWithProviders(<Harness check={FIXTURE_CHECK_MARINA} />);
    await userEvent.click(screen.getByRole("button", { name: /About AED 10,618/ }));
    const slider = await screen.findByRole("slider", { hidden: true });
    expect(slider).toHaveAttribute("aria-valuetext", "20 percent, AED 490,000");
    expect(slider).toHaveAttribute("min", String(minDownPct(2_450_000)));
    expect(slider).toHaveAttribute("max", "50");
    expect(slider).toHaveAttribute("step", "5");
    expect(screen.getByText("20% (AED 490,000)")).toBeInTheDocument();

    const less = screen.getByRole("button", { name: "Less down payment" });
    const more = screen.getByRole("button", { name: "More down payment" });
    // At the limit the button reports itself unavailable but stays focusable (no native disabled).
    expect(less).toHaveAttribute("aria-disabled", "true");
    expect(less).not.toHaveAttribute("disabled");
    await userEvent.click(more);
    expect(screen.getByText("25% (AED 612,500)")).toBeInTheDocument();
    expect(screen.getByRole("slider", { hidden: true })).toHaveAttribute("aria-valuetext", "25 percent, AED 612,500");
    expect(less).not.toHaveAttribute("aria-disabled", "true");
    // Pressing − back to the minimum keeps focus on the button.
    less.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("20% (AED 490,000)")).toBeInTheDocument();
    expect(less).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(less);
  });

  it("starts at 30% down above AED 5M", async () => {
    const big = buildFixtureCheck({
      code: "B1GPR1",
      buildingName: "Mockup Crest Tower",
      buildingText: "Mockup Crest",
      areaText: "Dubai Marina",
      bedrooms: 2,
      sizeSqft: 3000,
      priceAed: 6_000_000,
    });
    expect(defaultChoice(6_000_000, FIXTURE_CONFIG.mortgage).downPct).toBe(30);
    renderWithProviders(<Harness check={big} />);
    await userEvent.click(screen.getByRole("button", { name: /a month with 30% down/ }));
    const slider = await screen.findByRole("slider", { hidden: true });
    expect(slider).toHaveAttribute("min", "30");
    expect(slider).toHaveAttribute("aria-valuetext", "30 percent, AED 1,800,000");
  });

  it("debounces the output by 400ms and updates the row when the panel closes", async () => {
    renderWithProviders(<Harness check={FIXTURE_CHECK_MARINA} />);
    await userEvent.click(screen.getByRole("button", { name: /About AED 10,618/ }));
    await screen.findByRole("slider", { hidden: true });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "More down payment" }));
    const after = estimateMortgage({ priceAed: 2_450_000, downPct: 25, ratePct: 4.25, years: 25 });
    const output = document.querySelector("output") as HTMLOutputElement;
    expect(output).toHaveTextContent("About AED 10,618 a month");
    act(() => {
      vi.advanceTimersByTime(OUTPUT_DEBOUNCE_MS - 50);
    });
    expect(output).toHaveTextContent("About AED 10,618 a month");
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(output).toHaveTextContent(`About AED ${formatInt(after.monthlyAed)} a month`);
    vi.useRealTimers();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: new RegExp(`About AED ${formatInt(after.monthlyAed)} a month with 25% down`) })).toBeInTheDocument(),
    );
  });

  it("validates the rate (1 to 12) with an inline error after blur", async () => {
    renderWithProviders(<Harness check={FIXTURE_CHECK_MARINA} />);
    await userEvent.click(screen.getByRole("button", { name: /About AED 10,618/ }));
    const rate = await screen.findByRole("textbox", { name: "Interest rate (%)" });
    expect(rate).toHaveValue("4.25");
    expect(rate).toHaveAttribute("inputmode", "decimal");
    await userEvent.clear(rate);
    await userEvent.type(rate, "15");
    await userEvent.tab();
    expect(screen.getByText("Enter a rate between 1% and 12%.")).toBeInTheDocument();
    expect(rate).toHaveAttribute("aria-invalid", "true");
    await userEvent.clear(rate);
    await userEvent.type(rate, "5");
    expect(screen.queryByText("Enter a rate between 1% and 12%.")).toBeNull();
  });

  it("offers the three terms with 25 years selected", async () => {
    renderWithProviders(<Harness check={FIXTURE_CHECK_MARINA} />);
    await userEvent.click(screen.getByRole("button", { name: /About AED 10,618/ }));
    const term = await screen.findByRole("combobox", { name: "Term" });
    expect(term).toHaveTextContent("25 years");
  });

  it("uses a right Sheet from 1024px", async () => {
    setMedia({ "(min-width: 1024px)": true });
    renderWithProviders(<Harness check={FIXTURE_CHECK_MARINA} />);
    await userEvent.click(screen.getByRole("button", { name: /About AED 10,618/ }));
    await screen.findByRole("heading", { name: "Monthly cost estimate" });
    expect(document.querySelector("[data-slot=sheet-content]")).not.toBeNull();
    expect(document.querySelector("[data-slot=drawer-popup]")).toBeNull();
  });

  it("uses a bottom Drawer below 1024px", async () => {
    renderWithProviders(<Harness check={FIXTURE_CHECK_MARINA} />);
    await userEvent.click(screen.getByRole("button", { name: /About AED 10,618/ }));
    await screen.findByRole("heading", { name: "Monthly cost estimate" });
    expect(document.querySelector("[data-slot=drawer-popup]")).not.toBeNull();
  });
});

describe("parseRate", () => {
  it("accepts dot or comma decimals and rejects junk", () => {
    expect(parseRate("4.25")).toBe(4.25);
    expect(parseRate("4,5")).toBe(4.5);
    expect(parseRate(" 6% ")).toBe(6);
    expect(Number.isNaN(parseRate("abc"))).toBe(true);
    expect(Number.isNaN(parseRate(""))).toBe(true);
  });
});
