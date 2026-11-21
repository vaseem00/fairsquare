// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkMock, renderWithProviders } from "../shell/test-utils";
import { fail, ok, type ApiMock } from "../shell/api-mock";

vi.mock("@/lib/api/client", async () => ({ api: (await import("../shell/api-mock")).makeApiMock() }));
vi.mock("next/link", () => linkMock);

import { coverageHref, effectiveQuery, pageCount, showingText, statusText, typeLine } from "@/components/coverage/coverage-list";
import { CoverageView } from "@/components/coverage/coverage-view";
import { api } from "@/lib/api/client";
import { COPY } from "@/lib/copy";
import type { CoverageBuilding, CoverageResponse } from "@/lib/types";
import { FIXTURE_CONFIG, FIXTURE_COVERAGE } from "../../fixtures/api-fixtures";
import { EMPTY_ME } from "@/lib/types";

const apiMock = api as unknown as ApiMock;
const BUILDINGS = FIXTURE_COVERAGE.buildings;

/** A synthetic page `page` of `total` buildings, 50 per page ("Test Tower 1", "Test Tower 2", ...). */
function bigPage(page: number, total = 120): CoverageResponse {
  const first = (page - 1) * 50;
  const n = Math.max(0, Math.min(50, total - first));
  const buildings: CoverageBuilding[] = Array.from({ length: n }, (_, i) => ({
    ...BUILDINGS[0],
    id: 1000 + first + i,
    name: `Test Tower ${first + i + 1}`,
  }));
  return { ...FIXTURE_COVERAGE, buildings, total, page, pageSize: 50, q: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/coverage");
  apiMock.me.get.mockResolvedValue(ok(EMPTY_ME));
});

describe("Coverage page (REAL_DATA.md section 11)", () => {
  it("lists every building with area (and DLD area), ready and off-plan counts, latest sale, types and neutral badges", () => {
    renderWithProviders(<CoverageView initial={FIXTURE_COVERAGE} />);
    expect(screen.getByRole("heading", { level: 1, name: "Buildings Fairsquare covers" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/demo|fictional|sample/i);
    expect(screen.getByText("Counts are registered sales from 17 Nov 2025 to 17 Nov 2026, most sales first.")).toBeInTheDocument();

    const items = document.querySelector("[data-slot=coverage-items]") as HTMLElement;
    const marina = within(items).getByRole("heading", { name: "Mockup Crest Tower" }).parentElement as HTMLElement;
    expect(marina).toHaveTextContent("Dubai Marina (DLD area: Marsa Dubai). Latest sale");
    expect(marina).toHaveTextContent("11 ready and 0 off-plan sales");
    // Ready and off-plan sales are never pooled, and the status names the basis it is about.
    expect(marina).toHaveTextContent("2-bed: 11 ready, 0 off-plan");
    expect(marina).toHaveTextContent("Enough ready sales");
    expect(marina).not.toHaveTextContent("Ready to compare");
    const thin = within(items).getByRole("heading", { name: "Dummyside Heights 2" }).parentElement as HTMLElement;
    // Same shown and DLD area name: shown once.
    expect(thin).toHaveTextContent(/^Dummyside Heights 2Al Jaddaf\. Latest sale/);
    expect(thin).toHaveTextContent("3-bed: 2 ready, 0 off-plan");
    expect(thin).toHaveTextContent("Too few sales");

    // Status badges are neutral: no verdict colours.
    for (const badge of document.querySelectorAll("[data-slot=badge]")) {
      expect(badge.className).not.toMatch(/verdict/);
    }

    const table = document.querySelector("[data-slot=coverage-table] table") as HTMLElement;
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Building", "Area", "Ready sales", "Off-plan sales", "Latest sale", "Apartment types"]);
    expect(within(table).getAllByRole("row")).toHaveLength(BUILDINGS.length + 1);
    expect(screen.getByText(`Showing 1 to ${BUILDINGS.length} of ${BUILDINGS.length} buildings`)).toBeInTheDocument();
    // One page: no paging links.
    expect(screen.queryByRole("link", { name: /Next page/ })).toBeNull();
  });

  it("searches on the server from 2 letters, announces the count and keeps the URL in step", async () => {
    const found = { ...FIXTURE_COVERAGE, buildings: BUILDINGS.filter((b) => b.name.startsWith("Fake Vista")), total: 2, q: "fake vista" };
    apiMock.buildings.mockResolvedValue(ok(found));
    renderWithProviders(<CoverageView initial={FIXTURE_COVERAGE} />);
    const box = screen.getByRole("searchbox", { name: "Search buildings" });
    expect(box).toHaveAccessibleDescription("A building or area name, at least 2 letters.");
    await userEvent.type(box, "f");
    // One letter: no search.
    await new Promise((r) => setTimeout(r, 250));
    expect(apiMock.buildings).not.toHaveBeenCalled();
    await userEvent.type(box, "ake vista");
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent("2 buildings match"));
    expect(apiMock.buildings).toHaveBeenLastCalledWith({ q: "fake vista", page: 1 });
    const items = document.querySelector("[data-slot=coverage-items]") as HTMLElement;
    expect(within(items).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Fake Vista Residences", "Fake Vista Residences 2"]);
    expect(window.location.search).toBe("?q=fake+vista");
  });

  it("pages by 50 with real links that load in place, and a new page starts at its top", async () => {
    apiMock.buildings.mockImplementation((async (p: { page?: number }) => ok(bigPage(p.page ?? 1))) as never);
    const scrolled: Array<{ el: Element; opts: unknown }> = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, opts?: unknown) {
      scrolled.push({ el: this, opts });
    } as typeof Element.prototype.scrollIntoView;
    try {
      renderWithProviders(<CoverageView initial={bigPage(1)} />);
      // Where the list is shows above it, before the first building.
      const status = () => document.querySelector("[data-slot=coverage-showing]") as HTMLElement;
      expect(status()).toHaveTextContent("Showing 1 to 50 of 120 buildings");
      const firstItem = document.querySelector("[data-slot=coverage-items]") as HTMLElement;
      expect(status().compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const nav = screen.getByRole("navigation", { name: "Pages" });
      const next = within(nav).getByRole("link", { name: "Next page" });
      expect(next).toHaveAttribute("href", "/coverage?page=2");
      // No link back from page 1.
      expect(within(nav).queryByRole("link", { name: "Previous page" })).toBeNull();

      await userEvent.click(next);
      await waitFor(() => expect(status()).toHaveTextContent("Showing 51 to 100 of 120 buildings"));
      expect(apiMock.buildings).toHaveBeenCalledWith({ q: null, page: 2 });
      // Focus and the scroll go to the top of the new page, not the end of the list.
      expect(status()).toHaveFocus();
      const last = scrolled.at(-1);
      expect(last?.el === status()).toBe(true);
      expect(last?.opts).toMatchObject({ block: "start" });
      expect(window.location.search).toBe("?page=2");
    } finally {
      Element.prototype.scrollIntoView = original;
    }
    const nav = screen.getByRole("navigation", { name: "Pages" });
    const status = () => document.querySelector("[data-slot=coverage-showing]") as HTMLElement;
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent("Showing 51 to 100 of 120 buildings"));

    await userEvent.click(within(nav).getByRole("link", { name: "Next page" }));
    await waitFor(() => expect(status()).toHaveTextContent("Showing 101 to 120 of 120 buildings"));
    expect(within(nav).queryByRole("link", { name: "Next page" })).toBeNull();
    expect(within(nav).getByRole("link", { name: "Previous page" })).toHaveAttribute("href", "/coverage?page=2");
  });

  it("says the data is being loaded when none is (REAL_DATA.md section 7)", () => {
    renderWithProviders(<CoverageView initial={{ ...FIXTURE_COVERAGE, buildings: [], total: 0, window: null, dataThrough: null }} />);
    expect(document.querySelector("[data-slot=coverage-loading]")).toHaveTextContent("Sales data is being loaded. Try again in a few minutes.");
    expect(document.querySelector("[data-slot=coverage-window]")).toBeNull();
  });

  it("shows a retry when a search fails", async () => {
    apiMock.buildings.mockResolvedValueOnce(fail(500, "internal", "Something went wrong on our side. Try again."));
    renderWithProviders(<CoverageView initial={FIXTURE_COVERAGE} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search buildings" }), "zz");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the buildings just now. Try again.");
    apiMock.buildings.mockResolvedValueOnce(ok({ ...FIXTURE_COVERAGE, buildings: [], total: 0, q: "zz" }));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText('No covered building matches "zz".')).toBeInTheDocument();
  });

  it("offers to request a building that does not match, in one tap", async () => {
    apiMock.buildings.mockResolvedValue(ok({ ...FIXTURE_COVERAGE, buildings: [], total: 0, q: "Nowhere" }));
    apiMock.requests.create.mockResolvedValue(ok({ id: 7, othersAsked: 0, created: true }));
    renderWithProviders(<CoverageView initial={FIXTURE_COVERAGE} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search buildings" }), "Nowhere");
    expect(await screen.findByText('No covered building matches "Nowhere".')).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: 'Request "Nowhere"' }));
    await waitFor(() => expect(apiMock.requests.create).toHaveBeenCalledWith({ text: "Nowhere" }));
    expect(await screen.findByText("Requested. It shows under Saved.", { selector: "span" })).toBeInTheDocument();
  });

  it("request form: visible label, inline error, then success clears the field and refreshes me", async () => {
    apiMock.requests.create.mockResolvedValue(ok({ id: 8, othersAsked: 2, created: true }));
    renderWithProviders(<CoverageView initial={FIXTURE_COVERAGE} />, { config: FIXTURE_CONFIG });
    await waitFor(() => expect(apiMock.me.get).toHaveBeenCalledTimes(1));
    const form = screen.getByRole("region", { name: COPY["coverage.requestH2"] });
    const input = within(form).getByRole("textbox", { name: "Building name and area" });
    expect(input).toHaveAttribute("enterkeyhint", "send");

    await userEvent.click(within(form).getByRole("button", { name: "Request this building" }));
    expect(within(form).getByText("Type a building name.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveFocus();
    expect(apiMock.requests.create).not.toHaveBeenCalled();

    await userEvent.type(input, "Nowhere Point Tower, Creek Harbour{Enter}");
    await waitFor(() =>
      expect(apiMock.requests.create).toHaveBeenCalledWith({ text: "Nowhere Point Tower, Creek Harbour" }),
    );
    await waitFor(() => expect(input).toHaveValue(""));
    expect(within(form).getByText("Requested. It shows under Saved.")).toBeInTheDocument();
    expect(within(form).queryByText("Type a building name.")).toBeNull();
    await waitFor(() => expect(apiMock.me.get).toHaveBeenCalledTimes(2));
  });

  it("shows the API's message under the field when the request fails", async () => {
    apiMock.requests.create.mockResolvedValue(
      fail(429, "rate_limited", "Too many requests from this browser. Wait a minute and try again."),
    );
    renderWithProviders(<CoverageView initial={FIXTURE_COVERAGE} />);
    const form = screen.getByRole("region", { name: COPY["coverage.requestH2"] });
    await userEvent.type(within(form).getByRole("textbox"), "Nowhere Point Tower{Enter}");
    expect(await within(form).findByText("Too many requests from this browser. Wait a minute and try again.")).toBeInTheDocument();
  });

  it("helpers: the effective query, page links, page count and the showing line", () => {
    expect(effectiveQuery(" a ")).toBe("");
    expect(effectiveQuery(" ab ")).toBe("ab");
    expect(coverageHref("", 1)).toBe("/coverage");
    expect(coverageHref("marsa dubai", 3)).toBe("/coverage?q=marsa+dubai&page=3");
    expect(pageCount({ total: 0, pageSize: 50 })).toBe(1);
    expect(pageCount({ total: 101, pageSize: 50 })).toBe(3);
    expect(showingText(bigPage(3))).toBe("Showing 101 to 120 of 120 buildings");
    expect(showingText(bigPage(4))).toBeNull();
    expect(showingText(bigPage(1, 1))).toBe("Showing 1 to 1 of 1 building");
    expect(typeLine({ bedrooms: 0, readySales: 1, offPlanSales: 0 })).toBe("Studio: 1 ready, 0 off-plan");
    expect(typeLine({ bedrooms: 2, readySales: 0, offPlanSales: 7 })).toBe("2-bed: 0 ready, 7 off-plan");
    expect(typeLine({ bedrooms: 2, readySales: 1234, offPlanSales: 3 })).toBe("2-bed: 1,234 ready, 3 off-plan");
    expect(statusText({ readyComparable: true, offPlanComparable: true })).toBe("Enough ready and off-plan sales");
    expect(statusText({ readyComparable: true, offPlanComparable: false })).toBe("Enough ready sales");
    expect(statusText({ readyComparable: false, offPlanComparable: true })).toBe("Enough off-plan sales");
    expect(statusText({ readyComparable: false, offPlanComparable: false })).toBe("Too few sales");
  });

  it("a type with only off-plan sales says so, never 'Ready to compare'", () => {
    const type = { bedrooms: 2, readySales: 0, offPlanSales: 7, medianPsf: null, latestSaleDate: "2026-11-01", readyComparable: false, offPlanComparable: true };
    const b: CoverageBuilding = { ...BUILDINGS[0], name: "Test Tower F", readySales: 0, offPlanSales: 7, types: [type] };
    renderWithProviders(<CoverageView initial={{ ...FIXTURE_COVERAGE, buildings: [b], total: 1 }} />);
    const items = document.querySelector("[data-slot=coverage-items]") as HTMLElement;
    expect(items).toHaveTextContent("2-bed: 0 ready, 7 off-plan");
    expect(items).toHaveTextContent("Enough off-plan sales");
    expect(screen.getAllByText("Showing 1 to 1 of 1 building")[0]).toBeInTheDocument();
  });

  it("announces one match in the singular", async () => {
    const one = { ...FIXTURE_COVERAGE, buildings: BUILDINGS.slice(0, 1), total: 1, q: "mockup crest tower" };
    apiMock.buildings.mockResolvedValue(ok(one));
    renderWithProviders(<CoverageView initial={FIXTURE_COVERAGE} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search buildings" }), "mockup crest tower");
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent("1 building matches"));
  });
});
