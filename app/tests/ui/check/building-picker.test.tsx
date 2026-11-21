// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkMock, renderWithProviders } from "../shell/test-utils";
import { fail, ok, type ApiMock } from "../shell/api-mock";

vi.mock("@/lib/api/client", async () => ({ api: (await import("../shell/api-mock")).makeApiMock() }));
vi.mock("next/link", () => linkMock);

import { BuildingPicker, type BuildingPickerProps } from "@/components/check/building-picker";
import { __resetCoveredBuildingsForTests } from "@/components/check/building-search";
import { api } from "@/lib/api/client";
import { COPY } from "@/lib/copy";
import type { CandidateView } from "@/lib/types";
import { FIXTURE_COVERAGE } from "../../fixtures/api-fixtures";

const apiMock = api as unknown as ApiMock;

const cand = (buildingId: number, name: string, area: string, salesForBedrooms: number | null = 11): CandidateView => ({
  buildingId,
  name,
  area,
  strength: "strong",
  salesForBedrooms,
});

function picker(over: Partial<BuildingPickerProps> = {}) {
  const props: BuildingPickerProps = {
    options: [cand(1, "Test Gate 1", "Test Area A"), cand(2, "Test Gate 2", "Test Area A", 4)],
    matchedCount: 2,
    towerCheck: false,
    areaCheck: false,
    bestId: 1,
    basis: "ready",
    bedrooms: 2,
    buildingText: "Test Gate 1",
    value: "b:1",
    onChange: () => undefined,
    onSearchPick: () => undefined,
    matching: false,
    error: null,
    ...over,
  };
  return renderWithProviders(<BuildingPicker {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetCoveredBuildingsForTests();
});

describe("<BuildingPicker> (review fixes)", () => {
  it("names the basis on every option and says 'Fairsquare needs 5' below the minimum (MIN_SALES 5)", () => {
    picker({ options: [cand(1, "Test Gate 1", "Test Area A", 11), cand(2, "Test Gate 2", "Test Area A", 4), cand(3, "Test Gate 3", "Test Area A", 0)], matchedCount: 3 });
    expect(screen.getByText("11 ready two-bed sales in 12 months")).toBeInTheDocument();
    expect(screen.getByText("Only 4 ready two-bed sales in 12 months: Fairsquare needs 5 to compare")).toBeInTheDocument();
    expect(screen.getByText("No ready two-bed sales in 12 months: Fairsquare needs 5 to compare")).toBeInTheDocument();
  });

  it("an off-plan listing's options count off-plan sales and say so", () => {
    picker({ basis: "off_plan", options: [cand(1, "Test Tower F", "Test Area F", 7)], matchedCount: 1 });
    expect(screen.getByText("7 off-plan two-bed sales in 12 months")).toBeInTheDocument();
  });

  it("'Best match' marks only the pre-selected building; a tie (no pre-selection) marks none", () => {
    const { unmount } = picker();
    const one = document.querySelector('[data-option="1"]') as HTMLElement;
    expect(within(one).getByText(COPY["pick.best"])).toBeInTheDocument();
    expect(screen.getAllByText(COPY["pick.best"])).toHaveLength(1);
    unmount();
    picker({ bestId: null });
    expect(screen.queryByText(COPY["pick.best"])).toBeNull();
  });

  it("one name in two areas asks for the area, not the tower number", () => {
    picker({
      options: [cand(1, "Test Residence", "Test Area A"), cand(2, "Test Residence", "Test Area B")],
      bestId: null,
      areaCheck: true,
    });
    expect(screen.getByText(COPY["pick.sameName"])).toBeInTheDocument();
    expect(screen.queryByText(COPY["pick.lookalike"])).toBeNull();
    expect(screen.getByText("Test Area A")).toBeInTheDocument();
    expect(screen.getByText("Test Area B")).toBeInTheDocument();
  });
});

describe("Search covered buildings (review fixes)", () => {
  it("a failed search says so with Try again (never 'no match'), and the match count is announced", async () => {
    apiMock.buildings.mockResolvedValueOnce(ok(FIXTURE_COVERAGE));
    picker();
    await userEvent.click(screen.getByRole("button", { name: COPY["pick.search"] }));
    const dialog = await screen.findByRole("dialog");
    apiMock.buildings.mockResolvedValueOnce(fail(500, "internal", "Something went wrong on our side. Try again."));
    await userEvent.type(within(dialog).getByPlaceholderText(COPY["pick.searchPlaceholder"]), "vista");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(COPY["coverage.loadFailed"]);
    expect(within(dialog).queryByText(COPY["pick.noMatch"])).toBeNull();

    const one = { ...FIXTURE_COVERAGE, buildings: FIXTURE_COVERAGE.buildings.filter((b) => b.name === "Fake Vista Residences"), total: 1, q: "vista" };
    apiMock.buildings.mockResolvedValueOnce(ok(one));
    await userEvent.click(within(dialog).getByRole("button", { name: COPY["alert.tryAgain"] }));
    expect(await within(dialog).findByRole("option", { name: /Fake Vista Residences/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent("1 matching building"));
  });
});
