// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createColumnHelper } from "@tanstack/react-table";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkMock } from "../shell/test-utils";

const adminApi = vi.hoisted(() => ({
  requests: { resolve: vi.fn() },
  buildings: { list: vi.fn() },
  sales: { list: vi.fn(), remove: vi.fn() },
}));
vi.mock("@/lib/api/admin-client", () => ({ adminApi }));
vi.mock("next/link", () => linkMock);
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/sales", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { AdminDataTable, adminTableFeatures, type AdminColumn } from "@/components/admin/data-table";
import { VerdictIcon } from "@/components/admin/overview-view";
import { RequestsView } from "@/components/admin/requests-view";
import { SalesTable } from "@/components/admin/sales-table";
import { SalesView } from "@/components/admin/sales-view";
import type { AdminRequestRow, AdminSale } from "@/lib/validation/admin";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin verdict icons (D§2.7)", () => {
  it("in line is Equal in the verdict colour; too few and not covered get distinct neutral icons", () => {
    const { container, rerender } = render(<VerdictIcon band="inline" />);
    const icon = () => container.querySelector("svg") as SVGElement;
    expect(icon().getAttribute("data-icon")).toBe("equal");
    expect(icon().getAttribute("class")).toContain("text-verdict-inline");
    rerender(<VerdictIcon band="thin" />);
    expect(icon().getAttribute("data-icon")).toBe("minus");
    rerender(<VerdictIcon band="none" />);
    expect(icon().getAttribute("data-icon")).toBe("building");
  });
});

describe("AdminDataTable paging", () => {
  type Row = { id: number };
  const col = createColumnHelper<typeof adminTableFeatures, Row>();
  const columns: AdminColumn<Row>[] = [col.accessor("id", { header: "Id", meta: { label: "Id" }, sortFn: "basic" })];
  const data = Array.from({ length: 45 }, (_, i) => ({ id: i + 1 }));

  it("shows 20 rows, then 20 more, with a count, instead of an endless stack", async () => {
    render(<AdminDataTable columns={columns} data={data} caption="Rows" pageSize={20} getRowId={(r) => String(r.id)} />);
    expect(screen.getAllByRole("row")).toHaveLength(1 + 20);
    expect(screen.getByText("Showing 20 of 45")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    expect(screen.getAllByRole("row")).toHaveLength(1 + 40);
    await userEvent.click(screen.getByRole("button", { name: "Show 5 more" }));
    expect(screen.getAllByRole("row")).toHaveLength(1 + 45);
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
  });

  it("without pageSize shows every row", () => {
    render(<AdminDataTable columns={columns} data={data} caption="Rows" />);
    expect(screen.getAllByRole("row")).toHaveLength(46);
  });
});

describe("Sales data tabs on phones (D§3.8)", () => {
  it("offers the four sections as a Select below 768px and hides the wrapping tab row there", () => {
    render(
      <SalesView
        initialSales={[]}
        initialBuildings={{ buildings: [], total: 0, page: 1, pageSize: 50, q: null }}
        initialOptions={[]}
        initialTab="sales"
      />,
    );
    expect(screen.getByRole("combobox", { name: "Sales data section" })).toBeInTheDocument();
    const list = screen.getByRole("tablist");
    expect(list.className).toContain("hidden");
    expect(list.className).toContain("md:flex");
    expect(list.className).not.toContain("flex-wrap");
  });
});

describe("Sales table: ready and off-plan (REAL_DATA.md sections 7 and 12)", () => {
  it("shows each sale's completion, sortable, next to the bedrooms", async () => {
    const sale = (id: number, completion: AdminSale["completion"]): AdminSale => ({
      id,
      buildingId: 1,
      buildingName: "Test Tower A",
      buildingArea: "Test Area A",
      saleDate: `2026-10-0${id}`,
      bedrooms: 2,
      sizeSqft: 1100,
      priceAed: 2_000_000,
      psf: 2_000_000 / 1100,
      source: "open_data",
      completion,
      externalRef: `dld:TEST-${id}`,
      createdAt: "2026-11-01T00:00:00.000Z",
    });
    render(<SalesTable initialSales={[sale(1, "ready"), sale(2, "off_plan")]} buildings={[{ id: 1, name: "Test Tower A", area: "Test Area" }]} />);
    expect(screen.getByRole("button", { name: "Sort by Completion" })).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).queryByText(/^(Ready|Off-plan)$/)?.textContent)).toEqual(["Off-plan", "Ready"]);
  });

  it("filters by building with a searchable combobox (name and area), shows the area per row and marks admin sales", async () => {
    const base: AdminSale = {
      id: 1,
      buildingId: 1,
      buildingName: "Test Tower A",
      buildingArea: "Test Area A",
      saleDate: "2026-10-01",
      bedrooms: 2,
      sizeSqft: 1100,
      priceAed: 2_000_000,
      psf: 2_000_000 / 1100,
      source: "open_data",
      completion: "ready",
      externalRef: "dld:1-11-2026-000000123456",
      createdAt: "2026-11-01T00:00:00.000Z",
    };
    const sales: AdminSale[] = [
      base,
      { ...base, id: 2, buildingId: 2, buildingArea: "Test Area B", saleDate: "2026-10-02", source: "admin", externalRef: null },
    ];
    // Two buildings with the same DLD name in different areas, among many.
    const buildings = [
      { id: 1, name: "Test Tower A", area: "Test Area A" },
      { id: 2, name: "Test Tower A", area: "Test Area B" },
      ...Array.from({ length: 300 }, (_, i) => ({ id: 10 + i, name: `Test Tower ${i}`, area: "Test Area C" })),
    ];
    adminApi.sales.list.mockResolvedValue({ ok: true, data: { sales: [sales[1]] } });
    render(<SalesTable initialSales={sales} buildings={buildings} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Test Area A")).toBeInTheDocument();
    expect(within(table).getByText("Test Area B")).toBeInTheDocument();
    // DLD rows show their reference only; the admin's sale says who added it.
    expect(within(table).queryByText("DLD open data")).toBeNull();
    expect(within(table).getByText("Added by admin")).toBeInTheDocument();
    expect(within(table).getByTitle("dld:1-11-2026-000000123456").className).toContain("truncate");

    const filter = screen.getByRole("combobox", { name: "Building" });
    expect(filter).toHaveTextContent("All buildings");
    await userEvent.click(filter);
    const search = await screen.findByPlaceholderText("Search buildings");
    // At most 100 options are rendered, each with its area.
    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(100);
    await userEvent.type(search, "Test Area B");
    await userEvent.click(screen.getByRole("option", { name: /Test Tower A\s*Test Area B/ }));
    expect(adminApi.sales.list).toHaveBeenCalledWith({ buildingId: 2, bedrooms: undefined });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Building" })).toHaveTextContent("Test Tower A, Test Area B"));
    await userEvent.click(screen.getByRole("button", { name: "All buildings" }));
    expect(adminApi.sales.list).toHaveBeenLastCalledWith({ buildingId: undefined, bedrooms: undefined });
  });
});

describe("Building requests: Mark as covered", () => {
  const BUILDINGS = [
    { id: 1, name: "Mockup Crest Tower", area: "Dubai Marina" },
    { id: 2, name: "Bay View Residence", area: "Business Bay" },
  ];
  const row = (resolved: AdminRequestRow["resolvedBuilding"]): AdminRequestRow => ({
    textNorm: "bay view residence",
    text: "Bay View Residence",
    area: "Business Bay",
    requests: 1,
    people: 1,
    firstAskedAt: "2026-11-10T08:00:00.000Z",
    lastAskedAt: "2026-11-10T08:00:00.000Z",
    resolvedBuilding: resolved,
  });

  it("a linked row shows the building with its area, 'Change building' and 'Unlink'", async () => {
    adminApi.requests.resolve.mockResolvedValue({ ok: true, data: { textNorm: "bay view residence", updated: 1, resolvedBuilding: null } });
    render(<RequestsView requests={[row({ id: 1, name: "Mockup Crest Tower" })]} buildings={BUILDINGS} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Covered: Mockup Crest Tower, Dubai Marina")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Change building" })).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "Mark as covered" })).toBeNull();
    await userEvent.click(within(table).getByRole("button", { name: "Unlink" }));
    expect(adminApi.requests.resolve).toHaveBeenCalledWith("bay view residence", null);
    await waitFor(() => expect(within(table).getByRole("button", { name: "Mark as covered" })).toBeInTheDocument());
    expect(within(table).queryByText(/^Covered:/)).toBeNull();
  });
});
