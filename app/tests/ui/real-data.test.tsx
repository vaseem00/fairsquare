// @vitest-environment jsdom
/**
 * The real-data UI (REAL_DATA.md sections 7 to 12): the "From the data" panel, the stale-data note,
 * the size and outlier notes, the admin "Data source" panel, the admin completion choice and building
 * filter, and the wording without a configured adviser partner. Synthetic data only.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkMock, renderWithProviders } from "./shell/test-utils";
import { ok, type ApiMock } from "./shell/api-mock";

const adminApi = vi.hoisted(() => ({
  sales: { preview: vi.fn(), create: vi.fn() },
  buildings: { create: vi.fn(), addAlias: vi.fn(), list: vi.fn(), options: vi.fn() },
}));
vi.mock("@/lib/api/client", async () => ({ api: (await import("./shell/api-mock")).makeApiMock() }));
vi.mock("@/lib/api/admin-client", () => ({ adminApi }));
vi.mock("next/link", () => linkMock);
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: vi.fn(async () => {}) }));

import PrivacyPage from "@/app/privacy/page";
import { BUILDINGS_PAGE, BuildingsPanel, buildingsQuery } from "@/components/admin/buildings-panel";
import { COMBOBOX_MAX, matchBuildings } from "@/components/admin/building-combobox";
import { DataSourcePanel } from "@/components/admin/data-source-panel";
import { RegisterSaleForm } from "@/components/admin/register-sale-form";
import { NotCoveredBelow } from "@/components/check/not-covered-result";
import { ResultNotices } from "@/components/check/result-view";
import { StaleNote } from "@/components/data/data-notice";
import { FromTheDataPanel } from "@/components/home/from-the-data";
import { EvidenceLine } from "@/components/result/evidence-line";
import { Provenance } from "@/components/result/provenance";
import { SizeNote } from "@/components/result/verdict-summary";
import { YourData } from "@/components/saved/your-data";
import { api } from "@/lib/api/client";
import { COPY } from "@/lib/copy";
import { __resetEnvForTests } from "@/lib/env";
import type { CheckView, DataStatusView, FromTheData, PublicConfig } from "@/lib/types";
import type { AdminBuilding, DataSourcePanel as DataSourcePanelData } from "@/lib/validation/admin";
import {
  FIXTURE_CHECK_MARINA,
  FIXTURE_CHECK_NONE,
  FIXTURE_CHECK_OFFPLAN,
  FIXTURE_CHECK_THIN,
  FIXTURE_CONFIG,
  FIXTURE_CONFIG_NO_LEADS,
  FIXTURE_DATA_STATUS,
} from "../fixtures/api-fixtures";

const apiMock = api as unknown as ApiMock;
const env = process.env as Record<string, string | undefined>;

const STALE_CONFIG: PublicConfig = {
  ...FIXTURE_CONFIG,
  data: { ...FIXTURE_DATA_STATUS, dataThrough: "2026-09-30", stale: true },
};
const STALE_TEXT = "Fairsquare's sales data currently runs to 30 Sep 2026. Sales registered after that aren't included yet.";

/** "From the data" for a synthetic building. */
const PANEL: FromTheData = {
  building: { id: 7, name: "Test Tower A", area: "Dubai Marina", areaDld: "Marsa Dubai" },
  bedrooms: 2,
  completion: "ready",
  count: 11,
  medianPsf: 1674.4,
  outliersDropped: 0,
  firstSaleDate: "2025-12-03",
  lastSaleDate: "2026-10-08",
  window: { start: "2025-11-17", end: "2026-11-17" },
};
const NOT_LOADED: DataStatusView = { loaded: false, dataFrom: null, dataThrough: null, stale: false, source: null };

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  __resetEnvForTests();
});

describe("From the data (REAL_DATA.md section 10)", () => {
  it("names the building with the most ready 2-bed sales, its areas, the median, the count and dates, and links to coverage", () => {
    render(<FromTheDataPanel data={PANEL} status={FIXTURE_DATA_STATUS} />);
    const panel = screen.getByRole("region", { name: "From the data" });
    // One sentence (REDESIGN.md section 8.3), no label-value list.
    expect(panel.querySelector("[data-slot=from-the-data-sentence]")).toHaveTextContent(
      "Test Tower A had the most registered sales of ready 2-bed apartments in the 12 months to 17 Nov 2026: 11, at a median of AED 1,674 per sq ft.",
    );
    expect(within(panel).getByText("Test Tower A")).toBeInTheDocument();
    expect(within(panel).getByText("Dubai Marina (DLD area: Marsa Dubai)")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Dubai Marina (DLD area: Marsa Dubai). Registered sales from 3 Dec 2025 to 8 Oct 2026.");
    expect(panel.querySelector("dl")).toBeNull();
    expect(within(panel).getByRole("link", { name: "See all buildings Fairsquare covers" })).toHaveAttribute("href", "/coverage");
    expect(within(panel).getByText("Sales data runs to 17 Nov 2026.")).toBeInTheDocument();
    // Never a listing or an asking price, and no fictional example.
    expect(panel).not.toHaveTextContent(/asking|listing|example|demo|sample/i);
    expect(panel.querySelector("img, svg")).toBeNull();
    expect(panel).not.toHaveTextContent("unusual");
  });

  it("says how many unusual sales were left out", () => {
    render(<FromTheDataPanel data={{ ...PANEL, outliersDropped: 2 }} status={FIXTURE_DATA_STATUS} />);
    expect(screen.getByText("2 unusual sales left out")).toBeInTheDocument();
  });

  it("before the first load: only the loading line (REAL_DATA.md section 7)", () => {
    render(<FromTheDataPanel data={null} status={NOT_LOADED} />);
    const panel = screen.getByRole("region", { name: "From the data" });
    expect(panel).toHaveTextContent("From the dataSales data is being loaded. Try again in a few minutes.");
    expect(within(panel).queryByRole("link")).toBeNull();
  });

  it("loaded but no ready 2-bed sale in the window: the coverage link and the data date only", () => {
    render(<FromTheDataPanel data={null} status={FIXTURE_DATA_STATUS} />);
    const panel = screen.getByRole("region", { name: "From the data" });
    expect(panel.querySelector("[data-slot=from-the-data-sentence]")).toBeNull();
    expect(within(panel).getByRole("link", { name: "See all buildings Fairsquare covers" })).toBeInTheDocument();
    expect(within(panel).getByText("Sales data runs to 17 Nov 2026.")).toBeInTheDocument();
  });
});

describe("stale data (REAL_DATA.md section 7)", () => {
  it("StaleNote shows only when the data ends more than 45 days ago", () => {
    const { unmount } = renderWithProviders(<StaleNote />, { config: STALE_CONFIG });
    expect(screen.getByRole("note")).toHaveTextContent(STALE_TEXT);
    unmount();
    renderWithProviders(<StaleNote />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("every result carries it at the top, with the off-plan notice when the basis is off-plan", () => {
    const { unmount } = renderWithProviders(<ResultNotices check={FIXTURE_CHECK_OFFPLAN} />, { config: STALE_CONFIG });
    expect(screen.getAllByRole("note").map((n) => n.textContent)).toEqual([STALE_TEXT, COPY["offplan.notice"]]);
    unmount();
    renderWithProviders(
      <div data-testid="notices-cell">
        <ResultNotices check={FIXTURE_CHECK_MARINA} />
      </div>,
    );
    expect(screen.queryAllByRole("note")).toHaveLength(0);
    // Nothing at all: the notices cell stays empty, so the verdict starts where the caption was.
    expect(screen.getByTestId("notices-cell")).toBeEmptyDOMElement();
  });
});

describe("no sales data loaded yet (REAL_DATA.md section 7)", () => {
  it("the not-covered result says the data is being loaded instead of counting buildings", async () => {
    renderWithProviders(<NotCoveredBelow check={FIXTURE_CHECK_NONE} onPickBuilding={() => undefined} />, {
      config: { ...FIXTURE_CONFIG, data: NOT_LOADED },
    });
    expect(document.querySelector("[data-slot=verdict-sentence]")).toHaveTextContent(COPY["data.loading"]);
    expect(document.body).not.toHaveTextContent(/Fairsquare covers \d+ buildings/);
    // Nothing to count: the coverage list is not even asked for.
    await new Promise((r) => setTimeout(r, 20));
    expect(apiMock.buildings).not.toHaveBeenCalled();
  });
});

describe("size and outlier notes (REAL_DATA.md section 7)", () => {
  const sized = (sizeSqft: number): CheckView => ({ ...FIXTURE_CHECK_MARINA, sizeSqft, analysis: { ...FIXTURE_CHECK_MARINA.analysis, medianSizeSqft: 1000 } });

  it("a listing more than 20% away from the typical sale gets the size note; within 20% does not", () => {
    const { unmount } = renderWithProviders(<SizeNote check={sized(1240)} />);
    expect(screen.getByRole("note")).toHaveTextContent(
      "This listing is 24% larger than the typical sale here. DLD sizes may be measured differently, for example with or without balconies.",
    );
    unmount();
    renderWithProviders(<SizeNote check={sized(1150)} />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("no size note without a verdict (too few sales: nothing was compared)", () => {
    renderWithProviders(
      <SizeNote check={{ ...FIXTURE_CHECK_THIN, sizeSqft: 3000, analysis: { ...FIXTURE_CHECK_THIN.analysis, medianSizeSqft: 1800 } }} />,
    );
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("the evidence line says how many unusual sales were set aside; the provenance keeps the attribution", () => {
    const check = { ...FIXTURE_CHECK_MARINA, analysis: { ...FIXTURE_CHECK_MARINA.analysis, outliersDropped: 1 } };
    renderWithProviders(
      <>
        <EvidenceLine check={check} />
        <Provenance check={check} />
      </>,
    );
    expect(document.querySelector("[data-slot=evidence-line]")).toHaveTextContent("1 unusual sale set aside.");
    expect(document.querySelector("[data-slot=provenance]")).toHaveTextContent("Source: Dubai Land Department sales transactions");
  });
});

describe("admin Data source panel (REAL_DATA.md section 12)", () => {
  const PANEL_DATA: DataSourcePanelData = {
    loaded: true,
    pending: false,
    dataFrom: "2023-10-16",
    dataThrough: "2026-10-15",
    stale: false,
    loadedAt: "2026-11-17T06:05:00.000Z",
    manifest: {
      datasetTitle: "Test Transactions",
      datasetUrl: "https://example.test/dataset",
      publisher: "Test Publisher",
      licence: "Test Licence",
      licenceUrl: "https://example.test/licence",
      downloadedOn: "2026-11-16",
      rows: 1234,
      read: 5678,
      buildings: 42,
      snapshotSha256: "abcdef0123456789".padEnd(64, "0"),
      excluded: [
        { reason: "not_sales", count: 4000 },
        { reason: "procedure_excluded", count: 0 },
        { reason: "portfolio_deal", count: 3 },
      ],
    },
    live: { openDataSales: 1234, dldBuildings: 42 },
  };

  it("shows the dataset (linked), licence (linked), dates, rows, buildings, last load and the exclusions behind a toggle", async () => {
    render(<DataSourcePanel data={PANEL_DATA} />);
    const panel = screen.getByRole("region", { name: "Data source" });
    expect(within(panel).getByRole("link", { name: "Test Transactions" })).toHaveAttribute("href", "https://example.test/dataset");
    expect(within(panel).getByRole("link", { name: "Test Licence" })).toHaveAttribute("href", "https://example.test/licence");
    const text = panel.textContent ?? "";
    for (const s of [
      "Downloaded on16 Nov 2026",
      "Data range16 Oct 2023 to 15 Oct 2026",
      "Sales in the snapshot1,234",
      "Rows read5,678",
      "Buildings42",
      "Last loaded17 Nov 2026, 10:05",
      "In the database1,234 open-data sales in 42 buildings",
      "Snapshotabcdef012345",
    ]) {
      expect(text).toContain(s);
    }
    expect(within(panel).queryByRole("status")).toBeNull();
    await userEvent.click(within(panel).getByRole("button", { name: "Rows left out, by reason" }));
    const table = await within(panel).findByRole("table", { name: "Rows left out, by reason" });
    // Reasons with no rows are left out.
    expect(within(table).getAllByRole("row").slice(1).map((r) => r.textContent)).toEqual([
      "Not in the Sales group4,000",
      "Block of unlike units at one price (3 or more)3",
    ]);
  });

  it("nothing loaded, a snapshot waiting to load, and details that could not be read", () => {
    const { rerender } = render(
      <DataSourcePanel data={{ ...PANEL_DATA, loaded: false, manifest: null, dataFrom: null, dataThrough: null, loadedAt: null, live: { openDataSales: 0, dldBuildings: 0 } }} />,
    );
    expect(screen.getByText(COPY["adminUi.ds.none"])).toBeInTheDocument();
    rerender(<DataSourcePanel data={{ ...PANEL_DATA, pending: true }} />);
    expect(screen.getByRole("status")).toHaveTextContent(COPY["adminUi.ds.pending"]);
    rerender(<DataSourcePanel data={null} />);
    expect(screen.getByText(COPY["adminUi.ds.loadFailed"])).toBeInTheDocument();
  });

  it("tells the owner when the public pages show the stale-data note; the snapshot hash is 14px", async () => {
    render(<DataSourcePanel data={{ ...PANEL_DATA, stale: true, dataThrough: "2026-09-30" }} />);
    const panel = screen.getByRole("region", { name: "Data source" });
    expect(within(panel).getByRole("status")).toHaveTextContent(
      "The public pages show the stale-data note: the loaded sales end on 30 Sep 2026. Download a newer Transactions file and build a new snapshot (see the README).",
    );
    expect(within(panel).getByTitle(PANEL_DATA.manifest!.snapshotSha256).className).toContain("text-sm");
    // The reasons stay a two-column table at every width (no stacked label / value pairs).
    await userEvent.click(within(panel).getByRole("button", { name: "Rows left out, by reason" }));
    const table = await within(panel).findByRole("table", { name: "Rows left out, by reason" });
    expect(table.className).not.toContain("max-md:block");
    expect(table.querySelector("td")?.className).not.toContain("max-md:grid");
  });
});

describe("admin sales and buildings at real scale", () => {
  it("Register a sale: a ready / off-plan choice (ready first), and no demo checkbox", async () => {
    render(<RegisterSaleForm buildings={[{ id: 1, name: "Test Tower A", area: "Dubai Marina" }]} />);
    const group = screen.getByRole("radiogroup", { name: "Completion" });
    const ready = within(group).getByRole("radio", { name: "Ready" });
    const offPlan = within(group).getByRole("radio", { name: "Off-plan" });
    expect(ready).toHaveAttribute("aria-checked", "true");
    await userEvent.click(offPlan);
    expect(offPlan).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(document.body).not.toHaveTextContent(/demo/i);
  });

  const many: AdminBuilding[] = Array.from({ length: 120 }, (_, i) => ({
    id: i + 1,
    name: `Test Tower ${i + 1}`,
    area: i % 2 ? "Dubai Marina" : "Business Bay",
    areaDld: i % 2 ? "Marsa Dubai" : "Business Bay",
    project: null,
    masterProject: null,
    fromOpenData: true,
    aliases: [],
    salesCount: i,
  }));

  /** A fake GET /api/admin/buildings over `many`: name/area contains, by name, 50 a page. */
  function serve(q: { q?: string | null; page?: number } = {}) {
    const needle = (q.q ?? "").toLowerCase();
    const hits = many.filter((b) => !needle || `${b.name} ${b.area} ${b.areaDld}`.toLowerCase().includes(needle));
    const page = q.page ?? 1;
    return ok({ buildings: hits.slice((page - 1) * BUILDINGS_PAGE, page * BUILDINGS_PAGE), total: hits.length, page, pageSize: BUILDINGS_PAGE, q: needle || null });
  }

  it("Buildings: searched and paged on the server, 50 rows at a time, with the DLD area name", async () => {
    adminApi.buildings.list.mockImplementation(async (q: { q?: string | null; page?: number }) => serve(q));
    const added: AdminBuilding[] = [];
    const first = serve();
    render(<BuildingsPanel initial={first.data} onAdded={(b) => added.push(b)} />);
    // The server-rendered first page: no request yet.
    expect(adminApi.buildings.list).not.toHaveBeenCalled();
    expect(screen.getAllByRole("row")).toHaveLength(1 + BUILDINGS_PAGE);
    expect(screen.getByText("Showing 50 of 120")).toBeInTheDocument();
    expect(screen.getAllByText("Dubai Marina (DLD area: Marsa Dubai)").length).toBeGreaterThan(0);
    // No sort buttons: the server orders by name and a page alone must not be re-sorted.
    expect(screen.queryByRole("button", { name: /sort by/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show 50 more" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(1 + 100));
    expect(adminApi.buildings.list).toHaveBeenLastCalledWith({ q: null, page: 2 });
    expect(screen.getByText("Showing 100 of 120")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 20 more" })).toBeInTheDocument();

    // One letter is not a search; two or more go to the server after a short pause.
    const box = screen.getByRole("searchbox", { name: COPY["adminUi.filterBuildings"] });
    await userEvent.type(box, "t");
    expect(buildingsQuery("t")).toBe("");
    await userEvent.type(box, "ower 11");
    // Test Tower 11 and Test Tower 110 to 119.
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(1 + 11));
    expect(adminApi.buildings.list).toHaveBeenLastCalledWith({ q: "tower 11", page: 1 });
    expect(screen.getByText("Showing 11 of 11")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show \d+ more$/ })).toBeNull();

    // A failed load says so and keeps the rows.
    adminApi.buildings.list.mockResolvedValueOnce({ ok: false, status: 500, error: { code: "internal", message: "x", requestId: "" } });
    await userEvent.clear(box);
    await userEvent.type(box, "marsa");
    expect(await screen.findByRole("alert")).toHaveTextContent(COPY["coverage.loadFailed"]);
    expect(added).toEqual([]);
  });

  it("the building picker renders at most 100 matches", () => {
    const options = many.concat(many.map((b) => ({ ...b, id: b.id + 1000 })));
    expect(matchBuildings(options, "").shown).toHaveLength(COMBOBOX_MAX);
    expect(matchBuildings(options, "").more).toBe(true);
    expect(matchBuildings(options, " tower 7 business ").shown.map((b) => b.name)).toEqual(["Test Tower 7", "Test Tower 7"]);
    expect(matchBuildings(options, " tower 7 business ").more).toBe(false);
  });
});

describe("no adviser partner configured (REAL_DATA.md section 8)", () => {
  it("Your data: the delete confirmation leaves the adviser out", async () => {
    apiMock.me.get.mockResolvedValue(ok({ savedCount: 0, savedWithNewSales: 0, checksCount: 1, requests: [], leads: [] }));
    renderWithProviders(<YourData counts={{ checks: 1, saved: 0, requests: 0, leads: 0 }} onDeleted={() => undefined} />, {
      config: FIXTURE_CONFIG_NO_LEADS,
    });
    await userEvent.click(screen.getByRole("button", { name: "Delete all my data" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(COPY["confirm.delete.bodyNoPartner"]);
    expect(dialog).not.toHaveTextContent(/adviser|sent your details to/i);
  });

  it("Privacy: no name-and-mobile row and no partner sentences", async () => {
    delete env.PARTNER_NAME;
    __resetEnvForTests();
    try {
      render(await PrivacyPage());
      expect(document.body).toHaveTextContent(COPY["privacy.whoNoPartner"]);
      expect(document.body).toHaveTextContent(COPY["privacy.choicesNoPartner"]);
      expect(document.body).toHaveTextContent(COPY["privacy.howLongNoPartner"]);
      expect(document.body).not.toHaveTextContent(/send them to|adviser request|withdraw/i);
      // Four rows in the phone list (the table has the same four).
      expect(document.querySelectorAll("ul > li")).toHaveLength(4);
    } finally {
      env.PARTNER_NAME = "Test Mortgage Partner";
    }
  });

  it("Privacy with a partner names it", async () => {
    __resetEnvForTests();
    render(await PrivacyPage());
    expect(document.body).toHaveTextContent("Test Mortgage Partner gets your name, mobile and the listing only after you tick the box");
    expect(document.querySelectorAll("ul > li")).toHaveLength(5);
  });
});
