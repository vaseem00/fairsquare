// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkMock, renderWithProviders } from "./shell/test-utils";

vi.mock("@/lib/api/client", async () => ({ api: (await import("./shell/api-mock")).makeApiMock() }));
vi.mock("next/link", () => linkMock);
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: vi.fn(async () => {}) }));
const meta = vi.hoisted(() => ({
  getAppMeta: vi.fn(async () => null as string | null),
  getAppMetas: vi.fn(async () => new Map<string, { value: string; updatedAt: Date }>()),
}));
vi.mock("@/lib/db/meta", () => meta);
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
// Whether adjusted registered sales can run today (`acsStatus`): the switch is the page's own test; the model's state is this mock.
const acs = vi.hoisted(() => ({ acsStatus: vi.fn(async (): Promise<{ active: boolean; reason?: string }> => ({ active: true })) }));
vi.mock("@/lib/services/acs", () => acs);
// The same for nearby registered sales (`nearbyStatus`).
const nearby = vi.hoisted(() => ({ nearbyStatus: vi.fn(async (): Promise<{ active: boolean; reason?: string }> => ({ active: true })) }));
vi.mock("@/lib/services/nearby", () => nearby);

import HowItWorksPage from "@/app/how-it-works/page";
import { attributionText, COPY, tList } from "@/lib/copy";
import { __resetEnvForTests } from "@/lib/env";

const env = process.env as Record<string, string | undefined>;

/** A synthetic manifest as app_meta.data_source holds it (never real data). */
const SOURCE = {
  version: 1,
  source: "data.dubai",
  publisher: "Test Publisher",
  datasetTitle: "Test Transactions",
  datasetUrl: "https://example.test/dataset",
  licence: "Test Licence",
  licenceUrl: "https://example.test/licence",
  downloadedOn: "2026-11-17",
  sourceFiles: [],
  dataFrom: "2023-11-18",
  dataThrough: "2026-11-17",
  buildings: 3,
  snapshotSha256: "0".repeat(64),
};

/** app_meta of a loaded snapshot (synthetic dates). */
function loaded(dataFrom = "2025-11-18", dataThrough = "2026-11-17") {
  const at = new Date("2026-11-17T08:00:00Z");
  return new Map([
    ["data_from", { value: dataFrom, updatedAt: at }],
    ["data_through", { value: dataThrough, updatedAt: at }],
    ["data_source", { value: JSON.stringify(SOURCE), updatedAt: at }],
  ]);
}

/** The attribution sentence, whose dataset and licence names are links. */
function attribution(root: HTMLElement): HTMLElement {
  const el = root.querySelector<HTMLElement>("[data-slot=attribution]");
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

beforeEach(() => {
  meta.getAppMeta.mockReset();
  meta.getAppMeta.mockResolvedValue(null);
  meta.getAppMetas.mockReset();
  meta.getAppMetas.mockResolvedValue(loaded());
});
afterEach(() => {
  delete env.MIN_SALES;
  delete env.WINDOW_DAYS;
  delete env.BAND_PCT;
  __resetEnvForTests();
});

async function renderPage() {
  __resetEnvForTests();
  const ui = await HowItWorksPage();
  return renderWithProviders(ui);
}

function headingLevels(root: HTMLElement): number[] {
  return [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
}

async function seriousViolations(root: HTMLElement) {
  const res = await axe.run(root, { resultTypes: ["violations"], rules: { region: { enabled: false } } });
  return res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

describe("/how-it-works", () => {
  it("one h1, headings in order, every section, #data with the data line", async () => {
    const { container } = await renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: COPY["how.h1"] })).toBeInTheDocument();
    const levels = headingLevels(container);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    for (const key of ["how.whatH2", "how.rulesH2", "how.outH2", "how.dataH2", "how.readH2", "how.valuationH2"] as const) {
      expect(screen.getByRole("heading", { level: 2, name: COPY[key] })).toBeInTheDocument();
    }
    // The fictional example is gone (REAL_DATA.md section 8).
    expect(document.getElementById("example")).toBeNull();
    expect(container).not.toHaveTextContent(/demo|sample|fictional|made-up|An example/i);
    const data = container.querySelector("#data")!;
    expect(data).not.toBeNull();
    // REAL_DATA.md section 9: the attribution with the dataset and licence linked, independence, the loaded range.
    const source = attribution(data as HTMLElement);
    expect(source.textContent).toBe(attributionText());
    expect(within(source).getByRole("link", { name: COPY["data.dataset"] })).toHaveAttribute("href", SOURCE.datasetUrl);
    expect(within(source).getByRole("link", { name: COPY["data.licence"] })).toHaveAttribute("href", SOURCE.licenceUrl);
    expect(within(data as HTMLElement).getByText(COPY["data.independent"])).toBeInTheDocument();
    expect(
      within(data as HTMLElement).getByText("The sales Fairsquare uses run from 18 Nov 2025 to 17 Nov 2026. Fairsquare last loaded them on 17 Nov 2026."),
    ).toBeInTheDocument();
    expect(meta.getAppMeta).toHaveBeenCalledWith(expect.anything(), "data_imported_at");
    expect(screen.getByRole("link", { name: COPY["nav.compareLong"] })).toHaveAttribute("href", "/");
    // The table of contents links to every section.
    const toc = screen.getByRole("navigation", { name: COPY["how.tocLabel"] });
    expect(within(toc).getAllByRole("link")).toHaveLength(9);
    // The second tier has its own section: what it reads, when it declines, what the tests found.
    expect(within(toc).getByRole("link", { name: COPY["how.similarH"] })).toHaveAttribute("href", "#too-few");
    const tooFew = document.getElementById("too-few") as HTMLElement;
    expect(tooFew).toHaveTextContent("A building that is not in DLD sales data gets a range of this kind only in the one case below.");
    // The project route (REAL_DATA.md section 15.8): the one exception, its limits and its own tested share.
    expect(tooFew).toHaveTextContent("A building that is not in DLD sales data gets no range of this kind, with one exception.");
    expect(tooFew).toHaveTextContent("An area or a community alone never gives a range of this kind, and a ready building never gets one this way.");
    expect(tooFew).toHaveTextContent("held the median of their first six months of sales in about 7 of 10 cases");
    expect(tooFew).toHaveTextContent("held the building's own median in about 8 of 10 cases");
    expect(tooFew).toHaveTextContent("in about 7 of 10, because prices move");
    expect(tooFew).toHaveTextContent("about 6 to 8 of 10");
    expect(tooFew).toHaveTextContent("weaker evidence than a same-building comparison");
    expect(within(toc).getByRole("link", { name: COPY["how.dataH2"] })).toHaveAttribute("href", "#data");
    // The first answer (REAL_DATA.md section 16): how sales are adjusted, when it declines, what the tests found.
    expect(within(toc).getByRole("link", { name: COPY["how.acsH"] })).toHaveAttribute("href", "#adjusted");
    const adjusted = document.getElementById("adjusted") as HTMLElement;
    expect(within(adjusted).getByRole("heading", { level: 2, name: "How registered sales are adjusted to a listing" })).toBeInTheDocument();
    expect(adjusted).toHaveTextContent("It moves each sale to the data date with the movement of registered sale prices in its area, and to the listing's size");
    expect(adjusted).toHaveTextContent("only when the range is narrow enough to say something. In every other case it compares as described above");
    expect(adjusted).toHaveTextContent("About 8 of 10 of those later sale prices were inside the range. After prices fall, more of the later sales are under the range than over it.");
    expect(adjusted).toHaveTextContent("Floor, view and condition are not in DLD sales data, so two apartments of one size in one building get the same range. Not a valuation.");
    // It comes after the sections it refers to ("as described above").
    expect((document.getElementById("too-few") as HTMLElement).compareDocumentPosition(adjusted) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("ACS_TIER=off: the page does not describe adjusted registered sales, and is otherwise what it was", async () => {
    env.ACS_TIER = "off";
    try {
      await renderPage();
      expect(document.getElementById("adjusted")).toBeNull();
      const toc = screen.getByRole("navigation", { name: COPY["how.tocLabel"] });
      expect(within(toc).getAllByRole("link")).toHaveLength(8);
      expect(within(toc).queryByRole("link", { name: COPY["how.acsH"] })).toBeNull();
      expect(document.getElementById("too-few")).not.toBeNull();
    } finally {
      delete env.ACS_TIER;
    }
  });

  it("no usable model, or data or a fit that has aged out: the page does not describe an answer nobody gets", async () => {
    for (const reason of ["no_model", "fit_too_old", "data_too_old"]) {
      acs.acsStatus.mockResolvedValueOnce({ active: false, reason });
      const { unmount } = await renderPage();
      expect(document.getElementById("adjusted"), reason).toBeNull();
      expect(within(screen.getByRole("navigation", { name: COPY["how.tocLabel"] })).getAllByRole("link")).toHaveLength(8);
      unmount();
    }
    // A failed read does not take the page down: the switch alone decides.
    acs.acsStatus.mockRejectedValueOnce(new Error("db"));
    await renderPage();
    expect(document.getElementById("adjusted")).not.toBeNull();
  });

  it("the last resort has its own section after the others: what it reads, when it declines, the test and how weak it is", async () => {
    await renderPage();
    const toc = screen.getByRole("navigation", { name: COPY["how.tocLabel"] });
    expect(within(toc).getByRole("link", { name: COPY["how.nearbyH"] })).toHaveAttribute("href", "#nearby");
    const section = document.getElementById("nearby") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2, name: "When the building itself gives nothing to compare" })).toBeInTheDocument();
    expect(section).toHaveTextContent("Fairsquare compares with registered sales nearby. It takes sales of the same bedroom type in other buildings of the same community over two years.");
    expect(section).toHaveTextContent("The page says that the range comes from other buildings and names where they are. The building's own sales are never part of it.");
    expect(section).toHaveTextContent("only with sales in at least three other buildings");
    // The tested share comes from the constants, never from the copy.
    expect(section.querySelector("[data-slot=nearby-tested]")).toHaveTextContent("About 7 of 10 of those later sale prices were inside the range.");
    expect(section.querySelector("[data-slot=nearby-weak]")).toHaveTextContent("This is the weakest comparison Fairsquare makes. The sales are in other buildings.");
    expect(section.querySelector("[data-slot=nearby-weak]")).toHaveTextContent("only about half of the later sale prices were inside the range at the latest test date. Not a valuation.");
    // After the sections it refers to ("none of the comparisons above").
    expect((document.getElementById("adjusted") as HTMLElement).compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.compareDocumentPosition(document.getElementById("leaves-out") as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("NEARBY_TIER=off, or constants or data that have aged out: the page does not describe the last resort", async () => {
    env.NEARBY_TIER = "off";
    try {
      const { unmount } = await renderPage();
      expect(document.getElementById("nearby")).toBeNull();
      expect(within(screen.getByRole("navigation", { name: COPY["how.tocLabel"] })).queryByRole("link", { name: COPY["how.nearbyH"] })).toBeNull();
      expect(document.getElementById("adjusted")).not.toBeNull();
      unmount();
    } finally {
      delete env.NEARBY_TIER;
    }
    for (const reason of ["no_model", "fit_too_old", "data_too_old", "constants_withdrawn"]) {
      nearby.nearbyStatus.mockResolvedValueOnce({ active: false, reason });
      const { unmount } = await renderPage();
      expect(document.getElementById("nearby"), reason).toBeNull();
      unmount();
    }
    nearby.nearbyStatus.mockRejectedValueOnce(new Error("db"));
    await renderPage();
    expect(document.getElementById("nearby")).not.toBeNull();
  });

  it("the rules dl shows 5 sales, 12 months and 5% from config.rules", async () => {
    const { container } = await renderPage();
    const dl = container.querySelector("dl[data-slot=rules]")!;
    const terms = [...dl.querySelectorAll("dt")].map((n) => n.textContent);
    const details = [...dl.querySelectorAll("dd")].map((n) => n.textContent);
    expect(terms).toEqual([
      "Same building",
      "Same apartment type",
      "Last 12 months",
      "At least 5 sales",
      "Median price per sq ft",
      "Within 5% is in line",
    ]);
    // Each detail explains its term rather than repeating it (REAL_DATA.md section 7 rules).
    expect(details).toEqual([
      "Only sales in the same tower, not the whole area, and off-plan listings only with off-plan sales.",
      "Same number of bedrooms; a studio counts as 0.",
      "Sales registered in the 12 months up to the latest sale in the data.",
      "With fewer, Fairsquare shows no verdict.",
      "Sales under half or over twice the median per sq ft are left out, so one unusual sale can't move the result much.",
      "More than 5% either way is above or below.",
    ]);
    terms.forEach((term, i) => expect(details[i]?.toLowerCase().startsWith(term?.toLowerCase() ?? "")).toBe(false));
  });

  it("follows other rules from the environment", async () => {
    env.MIN_SALES = "4";
    env.WINDOW_DAYS = "182";
    env.BAND_PCT = "7.5";
    const { container } = await renderPage();
    const text = container.querySelector("dl[data-slot=rules]")!.textContent;
    expect(text).toContain("At least 4 sales");
    expect(text).toContain("Last 6 months");
    expect(text).toContain("Within 7.5% is in line");
    expect(text).toContain("More than 7.5% either way is above or below.");
  });

  it("names the loaded range and the last load date", async () => {
    meta.getAppMeta.mockResolvedValue("2026-11-02T09:30:00.000Z");
    const { container } = await renderPage();
    expect(meta.getAppMeta).toHaveBeenCalledWith(expect.anything(), "data_imported_at");
    expect(within(container.querySelector("#data") as HTMLElement).getByText(
      "The sales Fairsquare uses run from 18 Nov 2025 to 17 Nov 2026. Fairsquare last loaded them on 2 Nov 2026.",
    )).toBeInTheDocument();
  });

  it("says the data is being loaded before the first load (REAL_DATA.md section 7)", async () => {
    meta.getAppMetas.mockResolvedValue(new Map());
    const { container } = await renderPage();
    const data = within(container.querySelector("#data") as HTMLElement);
    expect(data.getByText(COPY["data.loading"])).toBeInTheDocument();
    expect(data.getByText(COPY["data.independent"])).toBeInTheDocument();
    expect(meta.getAppMeta).not.toHaveBeenCalled();
  });

  it("#data says what is included and left out, ready vs off-plan, DIFC, sizes and the refresh", async () => {
    const { container } = await renderPage();
    const data = within(container.querySelector("#data") as HTMLElement);
    const list = (container.querySelector("[data-slot=data-included]") as HTMLElement).querySelectorAll("li");
    expect([...list].map((li) => li.textContent)).toEqual(tList("how.dataIncluded"));
    expect(list[0].textContent).toMatch(/^Included: sales registered with the Dubai Land Department of apartments/);
    for (const key of ["how.dataBasis", "how.dataDifc", "how.dataSizes", "how.dataRefresh"] as const) {
      expect(data.getByText(COPY[key])).toBeInTheDocument();
    }
    expect(COPY["how.dataDifc"]).toMatch(/DIFC/);
    // No logos anywhere (REAL_DATA.md section 9).
    expect(container.querySelector("#data img, #data svg")).toBeNull();
  });

  it("before the first load the dataset and licence names are plain text", async () => {
    meta.getAppMetas.mockResolvedValue(new Map());
    const { container } = await renderPage();
    const source = attribution(container.querySelector("#data") as HTMLElement);
    expect(source.textContent).toBe(attributionText());
    expect(within(source).queryAllByRole("link")).toHaveLength(0);
  });

  it("has no serious or critical axe violations, light and dark", async () => {
    const { container } = await renderPage();
    expect(await seriousViolations(container)).toEqual([]);
    document.documentElement.classList.add("dark");
    expect(await seriousViolations(container)).toEqual([]);
    document.documentElement.classList.remove("dark");
  });
});
