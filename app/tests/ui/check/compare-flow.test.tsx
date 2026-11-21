// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MotionConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, type ApiMock } from "../shell/api-mock";
import { linkMock, renderWithProviders, setMedia } from "../shell/test-utils";

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("@/lib/api/client", async () => ({ api: (await import("../shell/api-mock")).makeApiMock() }));
vi.mock("next/link", () => linkMock);
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/" }));
vi.mock("@/lib/image/downscale", () => ({
  downscaleForUpload: vi.fn(async (f: Blob) => ({ blob: f, width: 720, height: 1440 })),
}));
vi.mock("@/lib/stamp/card-canvas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stamp/card-canvas")>()),
  renderCard: vi.fn(async () => new File(["png"], "card.png", { type: "image/png" })),
  whenIdle: <T,>(fn: () => Promise<T>) => fn(),
}));

import { __resetCoveredBuildingsForTests } from "@/components/check/building-search";
import { CompareFlow } from "@/components/check/compare-flow";
import { __resetRequestedForTests } from "@/components/check/not-covered-result";
import { __resetSavedCodesForTests } from "@/components/saved/save-button";
import { REF_STORAGE_KEY } from "@/hooks/use-check-flow";
import { api } from "@/lib/api/client";
import {
  FIXTURE_CHECK_JVC,
  FIXTURE_CHECK_MARINA,
  FIXTURE_CHECK_NONE,
  FIXTURE_CHECK_THIN,
  FIXTURE_CONFIG_CLAUDE_OFF,
  FIXTURE_COVERAGE,
  FIXTURE_EXTRACT_OK,
  fixtureMatch,
} from "../../fixtures/api-fixtures";
import { COPY } from "@/lib/copy";
import type { ExtractResponse, MatchResponse, PublicConfig } from "@/lib/types";
import type { ReactNode } from "react";

const mock = api as unknown as ApiMock;

/** Mockup Crest Tower alone, strong and untied: the confident path (no question). */
const CLEAN_MATCH: MatchResponse = {
  candidates: [{ buildingId: 1, name: "Mockup Crest Tower", area: "Dubai Marina", strength: "strong", salesForBedrooms: 11 }],
  preselectId: 1,
  towerCheck: false,
  areaCheck: false,
};
const CLEAN: ExtractResponse = { ...FIXTURE_EXTRACT_OK, match: CLEAN_MATCH };
/** The fixture read: Mockup Crest pre-selected, but Mockup Crest Tower 2 looks alike (towerCheck). */
const TOWER = FIXTURE_EXTRACT_OK;
const NOWHERE: ExtractResponse = {
  ...FIXTURE_EXTRACT_OK,
  fields: { buildingText: "Nowhere Point Tower", areaText: "Dubai Creek Harbour", bedrooms: 2, sizeSqft: 1150, priceAed: 2_300_000 },
  match: { candidates: [], preselectId: null, towerCheck: false, areaCheck: false },
};
const THIN_READ: ExtractResponse = {
  ...FIXTURE_EXTRACT_OK,
  fields: { buildingText: "Dummyside Hts 2", areaText: "Al Jaddaf", bedrooms: 3, sizeSqft: 1905, priceAed: 3_600_000 },
  match: {
    candidates: [{ buildingId: 5, name: "Dummyside Heights 2", area: "Al Jaddaf", strength: "strong", salesForBedrooms: 2 }],
    preselectId: 5,
    towerCheck: false,
    areaCheck: false,
  },
};

const MARINA_HEAD = "14.0% above registered sales";

let blobN = 0;

// motion's useInView needs IntersectionObserver, which jsdom lacks.
if (!("IntersectionObserver" in window)) {
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}

function renderFlow(opts: { config?: PublicConfig; initialRef?: string | null; fromTheData?: ReactNode; reduce?: boolean } = {}) {
  const ui = <CompareFlow initialRef={opts.initialRef ?? null} fromTheData={opts.fromTheData} />;
  return renderWithProviders(opts.reduce ? <MotionConfig reducedMotion="always">{ui}</MotionConfig> : ui, { config: opts.config });
}

function fileInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!el) throw new Error("no file input");
  return el;
}

const screenshot = () => new File(["img"], "listing.png", { type: "image/png" });

async function chooseFile(file: File = screenshot()) {
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files: [file] } });
  });
}

async function seriousViolations(root: HTMLElement) {
  const res = await axe.run(root, { resultTypes: ["violations"], rules: { region: { enabled: false } } });
  return res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

const verdict = (name: string | RegExp = MARINA_HEAD) => screen.findByRole("heading", { level: 2, name }, { timeout: 3000 });
const noForm = () => expect(document.querySelector("[data-slot=details-form]")).toBeNull();

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
  URL.createObjectURL = vi.fn(() => `blob:test-${++blobN}`);
  URL.revokeObjectURL = vi.fn();
  for (const f of [nav.replace, nav.push]) f.mockReset();
  mock.extract.mockReset();
  mock.createCheck.mockReset();
  mock.requests.create.mockReset();
  mock.track.mockReset();
  mock.match.mockReset();
  mock.match.mockImplementation((async (q: string, area?: string | null, beds?: number | null) =>
    ok(fixtureMatch(q, area ?? null, beds ?? null))) as never);
  mock.buildings.mockReset();
  mock.buildings.mockImplementation((async () => ok(FIXTURE_COVERAGE)) as never);
  __resetCoveredBuildingsForTests();
  __resetRequestedForTests();
  __resetSavedCodesForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("home: the hero is the tool", () => {
  it("opens on the tool with the server's From the data panel, makes no API call, moves no focus and scrolls nothing", async () => {
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");
    renderFlow({ fromTheData: <section data-testid="from-the-data-slot">From the data</section> });
    expect(screen.getByRole("heading", { level: 1, name: COPY["home.h1"] })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY["home.choose"] }).tagName).toBe("BUTTON");
    expect(fileInput()).toHaveAttribute("accept", "image/*");
    expect(fileInput()).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: COPY["home.paste"] }).className).not.toContain("bg-primary");
    expect(screen.getByRole("button", { name: COPY["home.type"] }).className).not.toContain("bg-primary");
    expect(screen.getByText(COPY["home.privacy"], { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId("from-the-data-slot")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/demo|sample|fictional|made-up/i);
    expect(document.querySelector("kbd")).toBeNull();
    // The balance is decoration, at rest, and hidden on phones (the stage cell is `hidden` below 1024px).
    const stage = document.querySelector("[data-slot=stage]") as HTMLElement;
    expect(stage).toHaveAttribute("data-mode", "rest");
    expect(stage.querySelector("svg[data-balance]")).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector("[data-slot=flow-stage]")?.className).toContain("hidden");
    await act(async () => undefined);
    for (const f of [mock.extract, mock.match, mock.buildings, mock.createCheck, mock.track]) expect(f).not.toHaveBeenCalled();
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
    scrollSpy.mockRestore();
  });

  it("fine pointers get the drop hint; a screenshot dragged anywhere tips the balance and a drop reads it", async () => {
    setMedia({ "(pointer: fine)": true });
    mock.extract.mockImplementation((() => new Promise(() => undefined)) as never);
    renderFlow();
    const hint = document.querySelector("[data-slot=drop-hint]") as HTMLElement;
    expect(hint).toHaveTextContent(COPY["home.dropScale"]);
    expect(hint).toHaveTextContent(/or paste it with (Ctrl|Cmd) V/);
    const dataTransfer = { files: [screenshot()], items: [], dropEffect: "none" };
    fireEvent.dragEnter(screen.getByRole("heading", { level: 1 }), { dataTransfer });
    const stage = document.querySelector("[data-slot=stage]") as HTMLElement;
    expect(stage).toHaveAttribute("data-dragging", "true");
    expect(stage.querySelector("[data-slot=balance-pan] path[data-dashed]")).not.toBeNull();
    expect(screen.getByText(COPY["home.dropActive"])).toBeInTheDocument();
    await act(async () => {
      fireEvent.drop(document.body, { dataTransfer });
    });
    expect(await screen.findByRole("heading", { level: 2, name: COPY["read.reading"] })).toHaveFocus();
    expect(mock.extract).toHaveBeenCalledTimes(1);
  });

  it("a text selection dragged inside the page is not a screenshot; a pasted image is", async () => {
    mock.extract.mockImplementation((() => new Promise(() => undefined)) as never);
    renderFlow();
    fireEvent.dragEnter(document.body, { dataTransfer: { types: ["text/plain"], files: [], items: [] } });
    expect(document.querySelector("[data-slot=upload-card]")).not.toHaveAttribute("data-dragging");
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    paste.clipboardData = { files: [screenshot()], items: [] };
    await act(async () => {
      document.dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(true);
    expect(mock.extract).toHaveBeenCalledTimes(1);
  });

  it("has no serious or critical axe violations", async () => {
    const { container } = renderFlow();
    await act(async () => undefined);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe("the scene: a read goes straight to the result when Fairsquare is sure", () => {
  it("reads on file choice, shows the scene (no form, no table, no skeleton) and lands on the market scale", async () => {
    let resolve!: (v: unknown) => void;
    mock.extract.mockImplementation((() => new Promise((r) => (resolve = r))) as never);
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    renderFlow();
    await chooseFile();
    // The caption answers the tap and takes focus; the URL moves to ?step=compare.
    expect(screen.getByRole("heading", { level: 2, name: COPY["read.reading"] })).toHaveFocus();
    expect(window.location.search).toBe("?step=compare");
    expect(document.querySelector("[data-slot=flow-layout][aria-busy=true]")).not.toBeNull();
    expect(screen.getByRole("button", { name: COPY["read.stop"] })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=stage]")).toHaveAttribute("data-mode", "scene");
    expect(document.querySelector("[data-slot=reading-skeleton], [data-slot=compare-button], [data-slot=step-header]")).toBeNull();
    expect(screen.getByTestId("live-polite")).toBeInTheDocument();
    const [input, signal] = mock.extract.mock.calls[0] as unknown as [{ image?: Blob }, AbortSignal];
    expect(input.image).toBeInstanceOf(Blob);
    expect(signal).toBeInstanceOf(AbortSignal);

    await act(async () => resolve(ok(CLEAN)));
    // What was read sets into the fact line under the caption (no labels, no blanks); the status line
    // names the DLD building; the comparison fires at once.
    await waitFor(() => expect(document.querySelector("[data-slot=fact-line1]")).toHaveTextContent("Mockup Crest, Dubai Marina."));
    expect(document.querySelector("[data-slot=scene-status]")).toHaveTextContent("In DLD records as Mockup Crest Tower, Dubai Marina.");
    noForm();
    expect(document.querySelector("[data-slot=read-blank], [data-slot=read-line]")).toBeNull();
    expect(mock.createCheck).toHaveBeenCalledTimes(1);
    expect(mock.createCheck.mock.calls[0][0]).toMatchObject({
      source: "claude",
      buildingId: 1,
      propertyType: "apartment",
      completion: "ready",
      editedFields: [],
      sizeSource: "read",
    });
    expect(mock.match).not.toHaveBeenCalled();

    // The verdict headline takes focus; the fact line stays in its slot, now with Edit.
    expect(await verdict()).toHaveFocus();
    noForm();
    expect(window.location.search).toBe("?step=result&code=K7Q2MX");
    const line = document.querySelector("[data-slot=fact-line]") as HTMLElement;
    expect(line.closest("[data-slot=flow-fact]")).not.toBeNull();
    // The listing's own text, as read; the DLD name is in the evidence line.
    expect(line).toHaveTextContent("Mockup Crest, Dubai Marina. Ready 2-bed, 1,284 sq ft, AED 2,450,000. Edit");
    expect(within(line).getByRole("button", { name: COPY["fact.editSr"] })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=evidence-line]")).toHaveTextContent(/registered sales of ready 2-beds in Mockup Crest Tower,/);
    // The market scale replaces the stamped sheet: no sheet, no "See the whole card", no trim.
    expect(screen.getByRole("group", { name: "Where this asking price sits among 11 registered sales" })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=stamped-sheet], [data-slot=stage-sheet] [data-sheet-kind], [data-slot=listing-plate]")).toBeNull();
    expect(screen.queryByText("See the whole card")).toBeNull();
    expect(screen.queryByText("Trim the bottom")).toBeNull();
    // Mockup Crest asks more than every one of its 11 sales: the sentence names the highest.
    expect(document.querySelector("[data-slot=gap-sentence]")).toHaveTextContent(
      "The asking price is AED 234 per sq ft above the median, and higher than all 11 sales. The highest was AED 1,763 per sq ft, on 2 Sep 2026.",
    );
    // Evidence next to the claim: the attribution, the independence line, the sales list (never gated).
    const provenance = document.querySelector("[data-slot=provenance]") as HTMLElement;
    expect(provenance).toHaveTextContent("Source: Dubai Land Department sales transactions");
    expect(provenance).toHaveTextContent(COPY["data.independent"]);
    expect(provenance).toHaveTextContent("It is not a valuation or a forecast.");
    expect(screen.getByRole("heading", { level: 3, name: "11 registered sales" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-slot=sales-rows] li")).toHaveLength(5);
    // The phone bar: Send on WhatsApp first, Save and track second.
    const bar = document.querySelector("[data-slot=action-bar]") as HTMLElement;
    expect(within(bar).getByRole("link", { name: COPY["share.whatsapp"] })).toHaveAttribute("href", expect.stringMatching(/^https:\/\/wa\.me\/\?text=/));
    expect(within(bar).getByRole("button", { name: COPY["save.cta"] })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY["share.more"] })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=cost-row]")).not.toBeNull();
    // RESULT_SPEC 2.7: the headline, the listing, its price per sq ft and the exact % against the median.
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(/^14\.0% above registered sales\. Mockup Crest, ready 2-bed, AED 1,908 per sq ft, 14\.0% above the median of 11 registered sales\./),
    );
  });

  it("a comparison answered within 300ms of a clean read passes quietly: no weighing caption, no sales status line (RESULT_SPEC 2.3)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    mock.extract.mockResolvedValue(ok(CLEAN) as never);
    // The comparison answers 20ms after it is asked, well inside the 400ms read hold.
    mock.createCheck.mockImplementation((() => new Promise((r) => setTimeout(() => r(ok({ check: FIXTURE_CHECK_MARINA })), 20))) as never);
    renderFlow();
    const seen = { weighing: false, sales: false, heads: new Set<string>() };
    const watch = new MutationObserver(() => {
      const head = document.querySelector("[data-slot=flow-head]")?.textContent ?? "";
      seen.heads.add(head);
      if (head.includes(COPY["scene.weighing"])) seen.weighing = true;
      if (/registered sales of ready 2-beds in the 12 months/.test(document.querySelector("[data-slot=scene-status]")?.textContent ?? "")) seen.sales = true;
    });
    watch.observe(document.body, { subtree: true, childList: true, characterData: true });
    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [screenshot()] } });
      await vi.advanceTimersByTimeAsync(0);
    });
    for (let i = 0; i < 16; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    watch.disconnect();
    expect(screen.getByRole("heading", { level: 2, name: MARINA_HEAD })).toBeInTheDocument();
    expect(mock.createCheck).toHaveBeenCalledTimes(1);
    expect(seen.weighing).toBe(false);
    expect(seen.sales).toBe(false);
  });

  it("an off-plan read is honoured: compared with off-plan sales, with the notice above the verdict", async () => {
    mock.extract.mockResolvedValue(ok({ ...CLEAN, completion: "off_plan" }) as never);
    mock.createCheck.mockResolvedValue(ok({ check: { ...FIXTURE_CHECK_MARINA, analysis: { ...FIXTURE_CHECK_MARINA.analysis, completionBasis: "off_plan" } } }) as never);
    renderFlow();
    await chooseFile();
    await verdict();
    expect(mock.createCheck.mock.calls[0][0]).toMatchObject({ completion: "off_plan" });
    expect(screen.getByText(COPY["offplan.notice"])).toBeInTheDocument();
  });

  it("too few sales: the tally, Save first, and the 2 OF 5 stamp", async () => {
    mock.extract.mockResolvedValue(ok(THIN_READ) as never);
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_THIN }) as never);
    renderFlow();
    await chooseFile();
    expect(await verdict(COPY["thin.h2"])).toHaveFocus();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "2 of the 5 sales needed");
    const bar = document.querySelector("[data-slot=action-bar]") as HTMLElement;
    expect(within(bar).getAllByRole("button")[0]).toHaveTextContent(COPY["save.cta"]);
  });
});

describe("one question at a time, only when Fairsquare must ask", () => {
  it("a look-alike tower asks 'Which building is this?'; a row tap compares at once", async () => {
    mock.extract.mockResolvedValue(ok(TOWER) as never);
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    const heading = await screen.findByRole("heading", { level: 2, name: COPY["ask.buildingH"] });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/The listing says “Mockup Crest”\./)).toHaveTextContent(COPY["pick.lookalike"]);
    noForm();
    expect(mock.createCheck).not.toHaveBeenCalled();
    // Rows are buttons named by their full text; the pre-selected one comes first, with no tag.
    const rows = within(document.querySelector("[data-slot=building-rows]") as HTMLElement).getAllByRole("button");
    expect(rows[0]).toHaveAccessibleName("Mockup Crest Tower, Dubai Marina, 11 ready two-bed sales in 12 months");
    expect(rows[1]).toHaveAccessibleName(/^Mockup Crest Tower 2, Dubai Marina, Only 4 ready two-bed sales/);
    expect(screen.queryByText(COPY["pick.best"])).toBeNull();
    expect(screen.getByRole("button", { name: /None of these/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY["pick.search"] })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY["ask.typeAll"] })).toBeInTheDocument();
    // The phone thumbnail opens the screenshot larger.
    expect(screen.getByRole("button", { name: COPY["read.view"] })).toBeInTheDocument();
    await user.click(rows[0]);
    expect(await verdict()).toHaveFocus();
    expect(mock.createCheck.mock.calls[0][0]).toMatchObject({ buildingId: 1 });
  });

  it("a missing price asks one question, then compares", async () => {
    mock.extract.mockResolvedValue(ok({ ...CLEAN, fields: { ...CLEAN.fields, priceAed: null } }) as never);
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await screen.findByRole("heading", { level: 2, name: COPY["ask.priceH"] });
    expect(screen.getByText(COPY["ask.notIn"])).toBeInTheDocument();
    const price = screen.getByLabelText(COPY["field.price"]);
    // No buttons, so the input takes focus and the keypad opens at once (RESULT_SPEC 2.5).
    expect(price).toHaveFocus();
    expect(price).toHaveAttribute("inputmode", "numeric");
    // Not a price: the field says so and nothing is sent.
    await user.type(price, "12");
    await user.click(screen.getByRole("button", { name: COPY["ask.continue"] }));
    expect(screen.getByText(COPY["err.price"])).toBeInTheDocument();
    expect(price).toHaveAttribute("aria-invalid", "true");
    await user.clear(price);
    await user.type(price, "2450000{Enter}");
    await verdict();
    expect(mock.createCheck.mock.calls[0][0]).toMatchObject({ fields: { priceAed: 2_450_000 }, editedFields: [] });
  });

  it("missing bedrooms: eight buttons, a tap continues", async () => {
    mock.extract.mockResolvedValue(ok({ ...CLEAN, fields: { ...CLEAN.fields, bedrooms: null } }) as never);
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await screen.findByRole("heading", { level: 2, name: COPY["ask.bedsH"] });
    const group = screen.getByRole("group", { name: COPY["field.bedrooms"] });
    expect(within(group).getAllByRole("button")).toHaveLength(8);
    await user.click(within(group).getByRole("button", { name: "2 bed" }));
    await verdict();
    expect(mock.createCheck.mock.calls[0][0]).toMatchObject({ fields: { bedrooms: 2 } });
  });

  it("a missing size: the usual DLD sizes as buttons; one tap compares with sizeSource 'cluster' (RESULT_SPEC 2.5)", async () => {
    const sizes = [
      { sqft: 815, sales: 31 },
      { sqft: 895, sales: 6 },
      { sqft: 945, sales: 6 },
    ];
    const match: MatchResponse = { ...CLEAN_MATCH, candidates: [{ ...CLEAN_MATCH.candidates[0], sizes }] };
    mock.extract.mockResolvedValue(ok({ ...CLEAN, fields: { ...CLEAN.fields, sizeSqft: null }, match }) as never);
    mock.createCheck.mockResolvedValue(ok({ check: { ...FIXTURE_CHECK_MARINA, sizeSqft: 815, sizeSource: "cluster" } }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    // Buttons, so the heading takes focus (the keypad stays closed).
    expect(await screen.findByRole("heading", { level: 2, name: COPY["ask.sizeH"] })).toHaveFocus();
    // The fact line shows what is known and leaves the size out; no blank.
    expect(document.querySelector("[data-slot=fact-line]")).toHaveTextContent("Mockup Crest, Dubai Marina. Ready 2-bed, AED 2,450,000.");
    const group = screen.getByRole("group", { name: "Usual 2-bed sizes in Mockup Crest Tower" });
    expect(within(group).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "About 815 sq ft, 31 sales",
      "About 895 sq ft, 6 sales",
      "About 945 sq ft, 6 sales",
    ]);
    expect(screen.getByLabelText(COPY["ask.sizeOr"])).toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "About 815 sq ft, 31 sales" }));
    await verdict();
    expect(mock.createCheck).toHaveBeenCalledTimes(1);
    expect(mock.createCheck.mock.calls[0][0]).toMatchObject({ fields: { sizeSqft: 815 }, sizeSource: "cluster", editedFields: [] });
    // The result's fact line says "about".
    expect(document.querySelector("[data-slot=fact-line]")).toHaveTextContent("Ready 2-bed, about 815 sq ft, AED 2,450,000.");
  });

  it("'Is it ready or off-plan?' only when the read did not say and the building has both kinds of sales", async () => {
    const match: MatchResponse = { ...CLEAN_MATCH, candidates: [{ ...CLEAN_MATCH.candidates[0], basisSales: { ready: 11, offPlan: 6 } }] };
    mock.extract.mockResolvedValue(ok({ ...CLEAN, completion: "unknown", match }) as never);
    mock.createCheck.mockResolvedValue(ok({ check: { ...FIXTURE_CHECK_MARINA, analysis: { ...FIXTURE_CHECK_MARINA.analysis, completionBasis: "off_plan" } } }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    expect(await screen.findByRole("heading", { level: 2, name: COPY["ask.completionH"] })).toHaveFocus();
    expect(mock.createCheck).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Off-plan" }));
    await verdict();
    expect(mock.createCheck.mock.calls[0][0]).toMatchObject({ completion: "off_plan" });
  });

  it("a price per sq ft out of range asks for both; the correction is sent as edited", async () => {
    mock.extract.mockResolvedValue(ok({ ...CLEAN, fields: { ...CLEAN.fields, priceAed: 245_000_000 } }) as never);
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await screen.findByRole("heading", { level: 2, name: COPY["ask.psfH"] });
    expect(screen.getByLabelText(COPY["field.size"])).toHaveValue("1,284");
    const price = screen.getByLabelText(COPY["field.price"]);
    expect(price).toHaveValue("245,000,000");
    await user.clear(price);
    await user.type(price, "2450000");
    await user.click(screen.getByRole("button", { name: COPY["ask.continue"] }));
    await verdict();
    expect(mock.match).not.toHaveBeenCalled();
    expect(mock.createCheck.mock.calls[0][0]).toMatchObject({ editedFields: ["priceAed"], fields: { priceAed: 2_450_000 } });
  });

  it("too little read: the partial state offers the form, filled with what was read; it never opens by itself", async () => {
    mock.extract.mockResolvedValue(
      ok({ ...CLEAN, fields: { buildingText: null, areaText: null, bedrooms: null, sizeSqft: null, priceAed: 2_450_000 }, match: { ...CLEAN_MATCH, candidates: [], preselectId: null } }) as never,
    );
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    expect(await screen.findByRole("heading", { level: 2, name: COPY["scene.partialH"] })).toHaveFocus();
    noForm();
    expect(document.querySelector("[data-slot=balance-labels]")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: COPY["home.type"] }));
    expect(await screen.findByRole("heading", { level: 2, name: COPY["details.h2"] })).toHaveFocus();
    expect(screen.getByText(COPY["scene.partialBody"])).toBeInTheDocument();
    expect(screen.getByLabelText(COPY["field.price"])).toHaveValue("2,450,000");
    expect(window.location.search).toBe("?step=details");
  });

  it("a rental asks; 'It's for sale, continue' goes on (here to the building question)", async () => {
    mock.extract.mockResolvedValue(ok({ ...TOWER, outcome: "rental" }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    expect(await screen.findByRole("heading", { level: 2, name: COPY["ask.rentalH"] })).toHaveFocus();
    expect(screen.getByText(COPY["ask.rentalBody"])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY["alert.tryAnother"] })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: COPY["alert.rentalContinue"] }));
    expect(await screen.findByRole("heading", { level: 2, name: COPY["ask.buildingH"] })).toHaveFocus();
  });

  it("not a listing: Try another screenshot or Type the details; a villa: Type the details anyway opens the form with the values", async () => {
    mock.extract.mockResolvedValueOnce(ok({ ...TOWER, outcome: "not_listing" }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await screen.findByRole("heading", { level: 2, name: COPY["ask.notListingH"] });
    expect(screen.getByRole("button", { name: COPY["alert.tryAnother"] }).className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: COPY["home.type"] })).toBeInTheDocument();

    mock.extract.mockResolvedValueOnce(ok({ ...TOWER, outcome: "not_apartment", propertyType: "villa" }) as never);
    await chooseFile();
    await screen.findByRole("heading", { level: 2, name: COPY["ask.villaH"] });
    await user.click(screen.getByRole("button", { name: COPY["alert.anyway"] }));
    expect(await screen.findByLabelText(COPY["field.building"])).toHaveValue("Mockup Crest");
  });

  it("'Type all the details instead' opens the form with everything known", async () => {
    mock.extract.mockResolvedValue(ok(TOWER) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await screen.findByRole("heading", { level: 2, name: COPY["ask.buildingH"] });
    await user.click(screen.getByRole("button", { name: COPY["ask.typeAll"] }));
    expect(await screen.findByRole("heading", { level: 2, name: COPY["details.h2"] })).toHaveFocus();
    expect(screen.getByLabelText(COPY["field.size"])).toHaveValue("1,284");
    expect(screen.getByRole("radio", { name: "Mockup Crest Tower" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("Stop, failures and timers in the scene", () => {
  it("Stop aborts the request and returns home with the screenshot kept; focus on Try again", async () => {
    let signal: AbortSignal | undefined;
    mock.extract.mockImplementation(((_: unknown, s: AbortSignal) => {
      signal = s;
      return new Promise((_r, reject) => s.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await user.click(await screen.findByRole("button", { name: COPY["read.stop"] }));
    expect(signal?.aborted).toBe(true);
    const kept = document.querySelector("[data-slot=kept-screenshot]") as HTMLElement;
    expect(within(kept).getByRole("button", { name: COPY["alert.tryAgain"] })).toHaveFocus();
    expect(screen.getByText(COPY["read.stopped"])).toBeInTheDocument();
    expect(screen.getByRole("img", { name: COPY["read.thumb"] })).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(""));

    // Try again reads the same screenshot.
    mock.extract.mockResolvedValue(ok(TOWER) as never);
    await user.click(within(kept).getByRole("button", { name: COPY["alert.tryAgain"] }));
    await screen.findByRole("heading", { level: 2, name: COPY["ask.buildingH"] });
  });

  it("Remove after Stop: focus goes to Add a screenshot", async () => {
    mock.extract.mockImplementation(((_: unknown, s: AbortSignal) =>
      new Promise((_r, reject) => s.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await user.click(await screen.findByRole("button", { name: COPY["read.stop"] }));
    await user.click(screen.getByRole("button", { name: COPY["read.remove"] }));
    expect(screen.getByRole("button", { name: COPY["home.choose"] })).toHaveFocus();
  });

  it("a refused read: the short cause takes focus; Type the details opens the empty form", async () => {
    mock.extract.mockResolvedValue(fail(422, "extract_refused", COPY["error.refused"]) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    expect(await screen.findByRole("heading", { level: 2, name: COPY["fail.refused"] })).toHaveFocus();
    expect(document.querySelector("svg[data-balance]")).toHaveAttribute("data-dimmed", "true");
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent(COPY["error.refused"]));
    await user.click(screen.getByRole("button", { name: COPY["home.type"] }));
    expect(await screen.findByRole("heading", { level: 2, name: COPY["details.h2Typed"] })).toHaveFocus();
    expect(screen.getByLabelText(COPY["field.building"])).toHaveValue("");
    expect(document.querySelector("[aria-invalid=true]")).toBeNull();
  });

  it("offline: 'You're offline.' with Try again", async () => {
    mock.extract.mockResolvedValue({ ok: false, status: 0, error: { code: "internal", message: COPY["error.offline"], requestId: "" } } as never);
    renderFlow();
    await chooseFile();
    expect(await screen.findByRole("heading", { level: 2, name: COPY["fail.offline"] })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY["alert.tryAgain"] })).toBeInTheDocument();
  });

  it("shows 'still reading' at 8 s and gives up at 28 s with the timeout failure", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    let signal: AbortSignal | undefined;
    mock.extract.mockImplementation(((_: unknown, s: AbortSignal) => {
      signal = s;
      return new Promise((_r, reject) => s.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }) as never);
    renderFlow();
    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [screenshot()] } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("heading", { level: 2, name: COPY["read.reading"] })).toBeInTheDocument();
    expect(screen.queryByText(COPY["read.slowFallback"])).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(screen.getByText(COPY["read.slowFallback"])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY["read.typeInstead"] })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole("heading", { level: 2, name: COPY["fail.timeout"] })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY["alert.tryAgain"] })).toBeInTheDocument();
  });

  it("extract_busy: Try again is enabled after a visible 30 s countdown, announced once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    mock.extract.mockResolvedValue({
      ok: false,
      status: 503,
      error: { code: "extract_busy", message: COPY["rate.busy"], retryAfterSec: 30, requestId: "x" },
    } as never);
    renderFlow();
    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [screenshot()] } });
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByRole("heading", { level: 2, name: COPY["fail.busy"] })).toBeInTheDocument();
    const waitBtn = screen.getByRole("button", { name: "Try again in 30 s" });
    expect(waitBtn).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(waitBtn);
    expect(mock.extract).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(screen.getByRole("button", { name: "Try again in 24 s" })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(24_500);
    });
    const again = screen.getByRole("button", { name: COPY["alert.tryAgain"] });
    expect(again).not.toHaveAttribute("aria-disabled");
    // The live region sets its text a moment after clearing it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByTestId("live-polite")).toHaveTextContent(COPY["alert.tryAgain"]);
    mock.extract.mockImplementation((() => new Promise(() => undefined)) as never);
    await act(async () => {
      fireEvent.click(again);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock.extract).toHaveBeenCalledTimes(2);
  });

  it("a failed comparison: 'Couldn't compare just now.' with Try again (re-posts) and Edit details", async () => {
    mock.extract.mockResolvedValue(ok(CLEAN) as never);
    mock.createCheck.mockResolvedValue(fail(500, "internal", "x") as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    expect(await screen.findByRole("heading", { level: 2, name: COPY["fail.compare"] })).toHaveFocus();
    expect(screen.getByRole("button", { name: COPY["result.editDetails"] })).toBeInTheDocument();
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    await user.click(screen.getByRole("button", { name: COPY["alert.tryAgain"] }));
    await verdict();
    expect(mock.createCheck).toHaveBeenCalledTimes(2);
    expect(mock.createCheck.mock.calls[1][0]).toEqual(mock.createCheck.mock.calls[0][0]);
  });
});

describe("typing, Edit and the not-covered result", () => {
  it("Type the details: the form; two or more errors focus the summary; Compare price goes through the scene", async () => {
    mock.createCheck.mockResolvedValue(ok({ check: { ...FIXTURE_CHECK_MARINA, source: "manual" } }) as never);
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: COPY["home.type"] }));
    expect(screen.getByRole("heading", { level: 2, name: COPY["details.h2Typed"] })).toHaveFocus();
    expect(window.location.search).toBe("?step=details");
    await user.click(screen.getByRole("button", { name: COPY["details.cta"] }));
    const summary = await screen.findByText("Fix 4 things to compare the price");
    const box = summary.closest("[data-slot=error-summary]") as HTMLElement;
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveAttribute("role", "alert");
    expect(mock.createCheck).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(COPY["field.building"]), "Mockup Crest");
    await user.click(screen.getByRole("combobox", { name: COPY["field.bedrooms"] }));
    await user.click(await screen.findByRole("option", { name: "2 bed" }));
    await user.type(screen.getByLabelText(COPY["field.size"]), "1284");
    await user.type(screen.getByLabelText(COPY["field.price"]), "2450000");
    const radio = await screen.findByRole("radio", { name: "Mockup Crest Tower" });
    await waitFor(() => expect(radio).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByText(COPY["pick.best"])).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: COPY["details.cta"] }));
    expect(await verdict()).toHaveFocus();
    expect(mock.createCheck.mock.calls[0][0]).toMatchObject({ source: "manual", buildingId: 1 });
    expect(mock.createCheck.mock.calls[0][0]).not.toHaveProperty("completion");
    expect(mock.createCheck.mock.calls[0][0]).toMatchObject({ sizeSource: "typed" });
    // Typed: the fact line states the typed values; no plate, no sheet, the market scale instead.
    expect(document.querySelector("[data-slot=fact-line]")).toHaveTextContent("Mockup Crest, Dubai Marina. Ready 2-bed, 1,284 sq ft, AED 2,450,000. Edit");
    expect(document.querySelector("[data-sheet-kind]")).toBeNull();
    expect(document.querySelector("[data-slot=market-scale]")).not.toBeNull();
  });

  it("Edit, Asking price, Continue: the result re-settles in place with a new code; Back shows the first code (RESULT_SPEC section 7)", async () => {
    mock.extract.mockResolvedValue(ok(CLEAN) as never);
    mock.createCheck.mockResolvedValueOnce(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await verdict();
    expect(window.location.search).toBe("?step=result&code=K7Q2MX");
    const editButton = screen.getByRole("button", { name: COPY["fact.editSr"] });
    await user.click(editButton);
    // The Change a detail sheet, not the form.
    expect(await screen.findByRole("heading", { name: COPY["edit.h"] })).toBeInTheDocument();
    noForm();
    await user.click(screen.getByRole("button", { name: /^Asking price/ }));
    const price = screen.getByLabelText(COPY["field.price"]);
    await user.clear(price);
    await user.type(price, "1000000");
    let answer!: (v: unknown) => void;
    mock.createCheck.mockImplementationOnce((() => new Promise((r) => (answer = r))) as never);
    await user.click(screen.getByRole("button", { name: COPY["ask.continue"] }));
    // At once: the sheet closes, the result stays (no scene, no balance), the new price is in the fact
    // line, the scale dims, and the URL is ?step=compare.
    await waitFor(() => expect(screen.queryByRole("heading", { name: COPY["edit.h"] })).toBeNull());
    expect(document.querySelector("[data-slot=compare-flow]")).toHaveAttribute("data-view", "result");
    expect(document.querySelector("[data-slot=fact-line]")).toHaveTextContent("AED 1,000,000.");
    expect(document.querySelector("[data-slot=result-chart]")).toHaveAttribute("data-pending", "true");
    expect(window.location.search).toBe("?step=compare");
    expect(mock.createCheck.mock.calls[1][0]).toMatchObject({ fields: { priceAed: 1_000_000 }, buildingId: 1, editedFields: ["priceAed"], sizeSource: "read" });
    // After 300ms the heading turns to the weighing caption.
    expect(await screen.findByText(COPY["scene.weighing"], {}, { timeout: 2000 })).toBeInTheDocument();
    await act(async () => answer(ok({ check: FIXTURE_CHECK_JVC })));
    // The new verdict takes focus; a new code; no form, no scene in between.
    expect(await verdict("In line with registered sales")).toHaveFocus();
    expect(window.location.search).toBe("?step=result&code=P4VR8N");
    noForm();
    // Back returns to the first result and its code.
    act(() => window.history.back());
    expect(await verdict()).toBeInTheDocument();
    expect(window.location.search).toBe("?step=result&code=K7Q2MX");
    expect(mock.createCheck).toHaveBeenCalledTimes(2);
  });

  it("Wrong building? opens the building question; None of these re-settles in place as not covered", async () => {
    mock.extract.mockResolvedValue(ok(CLEAN) as never);
    mock.createCheck.mockResolvedValueOnce(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    mock.buildings.mockResolvedValue(ok(FIXTURE_COVERAGE) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await verdict();
    await user.click(screen.getByRole("button", { name: COPY["evidence.wrongBuilding"] }));
    expect(await screen.findByRole("heading", { name: COPY["ask.buildingH"] })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Mockup Crest Tower, Dubai Marina/ })).toBeInTheDocument();
    mock.createCheck.mockResolvedValueOnce(ok({ check: FIXTURE_CHECK_NONE }) as never);
    await user.click(screen.getByRole("button", { name: /^None of these/ }));
    expect(await verdict(COPY["band.none"])).toHaveFocus();
    expect(mock.createCheck.mock.calls[1][0]).toMatchObject({ buildingId: null, fields: { priceAed: 2_450_000 } });
    noForm();
  });

  it("Edit, Type all the details: the form with every value; Compare price returns through the scene; Back shows the first result", async () => {
    mock.extract.mockResolvedValue(ok(CLEAN) as never);
    mock.createCheck.mockResolvedValueOnce(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await verdict();
    await user.click(screen.getByRole("button", { name: COPY["fact.editSr"] }));
    await user.click(await screen.findByRole("button", { name: COPY["edit.typeAll"] }));
    expect(await screen.findByRole("heading", { level: 2, name: COPY["details.h2"] })).toHaveFocus();
    expect(window.location.search).toBe("?step=details");
    expect(screen.getByRole("button", { name: COPY["details.back"] })).toBeInTheDocument();
    expect(screen.getByLabelText(COPY["field.building"])).toHaveValue("Mockup Crest");
    expect(screen.getByLabelText(COPY["field.size"])).toHaveValue("1,284");
    const price = screen.getByLabelText(COPY["field.price"]);
    await user.clear(price);
    await user.type(price, "1000000");
    expect(screen.getByText(COPY["details.source.changed"])).toBeInTheDocument();

    mock.createCheck.mockResolvedValueOnce(ok({ check: FIXTURE_CHECK_JVC }) as never);
    await user.click(screen.getByRole("button", { name: COPY["details.cta"] }));
    expect(await verdict("In line with registered sales")).toHaveFocus();
    expect(mock.createCheck.mock.calls[1][0]).toMatchObject({ editedFields: ["priceAed"], fields: { priceAed: 1_000_000 } });
    expect(window.location.search).toBe("?step=result&code=P4VR8N");

    act(() => window.history.back());
    expect(await verdict()).toHaveFocus();
    expect(window.location.search).toBe("?step=result&code=K7Q2MX");
    act(() => window.history.back());
    await waitFor(() => expect(document.querySelector("[data-slot=compare-flow]")).toHaveAttribute("data-step", "home"));
    act(() => window.history.forward());
    expect(await verdict()).toBeInTheDocument();
  });

  it("the form's 'Back to the result' returns to the result with no new request", async () => {
    mock.extract.mockResolvedValue(ok(CLEAN) as never);
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await verdict();
    await user.click(screen.getByRole("button", { name: COPY["fact.editSr"] }));
    await user.click(await screen.findByRole("button", { name: COPY["edit.typeAll"] }));
    await user.click(await screen.findByRole("button", { name: COPY["details.back"] }));
    expect(await verdict()).toHaveFocus();
    expect(mock.createCheck).toHaveBeenCalledTimes(1);
  });

  it("not covered: 'Not covered yet', the buildings count, Request it and track; Search covered buildings re-settles in place", async () => {
    mock.extract.mockResolvedValue(ok(NOWHERE) as never);
    mock.createCheck.mockResolvedValueOnce(ok({ check: FIXTURE_CHECK_NONE }) as never);
    mock.requests.create.mockResolvedValue(ok({ id: 7, othersAsked: 3, created: true }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    // Nothing similar at all: no question, straight to "not covered".
    expect(await verdict(COPY["band.none"])).toHaveFocus();
    expect(mock.createCheck.mock.calls[0][0]).toMatchObject({ buildingId: null });
    expect(
      await screen.findByText(
        "We couldn’t match “Nowhere Point Tower” to a building in Dubai Land Department sales data. DLD may list it under the project or developer name. Fairsquare covers 6 buildings. Request this one and track it under Saved.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: COPY["save.cta"] })).toBeNull();
    expect(document.querySelector("[data-slot=stamp]")).toBeNull();
    expect(document.querySelector("[data-slot=cost-row]")).not.toBeNull();
    expect(document.querySelector("[data-slot=provenance]")).toHaveTextContent(COPY["data.independent"]);
    // Phones: no stage for a result without a stamp (it collapses while the settle runs, then hides).
    await waitFor(() => expect(document.querySelector("[data-slot=flow-stage]")?.className).toContain("hidden"));

    await user.click(screen.getByRole("button", { name: COPY["none.cta"] }));
    expect(await screen.findByText("Requested. It shows under Saved. 3 other people asked for it too.")).toBeInTheDocument();
    expect(mock.requests.create).toHaveBeenCalledWith({ text: "Nowhere Point Tower", area: "Dubai Creek Harbour", code: "H8PT5W" });
    const done = screen.getByRole("button", { name: COPY["none.ctaDone"] });
    expect(done).toHaveAttribute("aria-disabled", "true");

    mock.createCheck.mockResolvedValueOnce(ok({ check: FIXTURE_CHECK_JVC }) as never);
    await user.click(screen.getByRole("button", { name: COPY["pick.search"] }));
    await screen.findAllByRole("option");
    const option = screen.getAllByRole("option").find((o) => o.textContent?.startsWith("Fake Vista Residences") && !o.textContent.includes("Residences 2"));
    await user.click(option as HTMLElement);
    expect(await verdict("In line with registered sales")).toHaveFocus();
    expect(mock.createCheck.mock.calls[1][0]).toMatchObject({ buildingId: 3, fields: { buildingText: "Nowhere Point Tower" } });
    expect(window.location.search).toBe("?step=result&code=P4VR8N");
    noForm();
  });
});

describe("Claude off", () => {
  it("Type the details is primary; pasted text is parsed locally and the scene asks only for the building", async () => {
    mock.createCheck.mockResolvedValue(ok({ check: { ...FIXTURE_CHECK_MARINA, source: "text" } }) as never);
    const user = userEvent.setup();
    renderFlow({ config: FIXTURE_CONFIG_CLAUDE_OFF });
    expect(screen.queryByRole("button", { name: COPY["home.choose"] })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByText(COPY["claudeOff.notice"])).toBeInTheDocument();
    expect(screen.queryByText(COPY["home.privacy"], { exact: false })).toBeNull();
    expect(screen.getByRole("button", { name: COPY["home.type"] }).className).toContain("bg-primary");

    await user.click(screen.getByRole("button", { name: COPY["home.paste"] }));
    await user.type(screen.getByLabelText(COPY["home.pasteLabel"]), "2BR, 1284 sqft, AED 2.45M, call Sara");
    await user.click(screen.getByRole("button", { name: COPY["home.pasteRead"] }));
    await screen.findByRole("heading", { level: 2, name: COPY["ask.buildingNameH"] });
    // No buttons: the name field takes focus (RESULT_SPEC 2.5).
    expect(screen.getByLabelText(COPY["field.building"])).toHaveFocus();
    expect(screen.getByText(COPY["ask.notInText"])).toBeInTheDocument();
    // The fact line states what was parsed and leaves the building out (never a blank).
    expect(document.querySelector("[data-slot=fact-line]")).toHaveTextContent(/^2-bed, 1,284 sq ft, AED 2,450,000\.$/);
    noForm();
    await user.type(screen.getByLabelText(COPY["field.building"]), "Mockup Crest Tower{Enter}");
    await waitFor(() => expect(mock.match).toHaveBeenCalledWith("Mockup Crest Tower", null, 2, "ready", expect.any(AbortSignal)));
    // Two towers look alike: one more question, then the comparison.
    await screen.findByRole("heading", { level: 2, name: COPY["ask.buildingH"] });
    await user.click(screen.getByRole("button", { name: /^Mockup Crest Tower, Dubai Marina/ }));
    await verdict();
    expect(mock.createCheck.mock.calls[0][0]).toMatchObject({ source: "text", buildingId: 1 });
    expect(mock.extract).not.toHaveBeenCalled();
  });

  it("an extract_unavailable answer: 'Screenshot reading is off right now.' with Type the details only", async () => {
    mock.extract.mockResolvedValue(fail(503, "extract_unavailable", COPY["claudeOff.notice"]) as never);
    renderFlow();
    await chooseFile();
    expect(await screen.findByRole("heading", { level: 2, name: COPY["fail.off"] })).toBeInTheDocument();
    expect(screen.getByText(COPY["fail.offHint"])).toBeInTheDocument();
    const actions = document.querySelector("[data-slot=failure-actions]") as HTMLElement;
    expect(within(actions).getAllByRole("button").map((b) => b.textContent)).toEqual([COPY["home.type"]]);
    act(() => window.history.back());
    await waitFor(() => expect(document.querySelector("[data-slot=compare-flow]")).toHaveAttribute("data-step", "home"));
    expect(screen.queryByRole("button", { name: COPY["home.choose"] })).toBeNull();
  });
});

describe("URL, ref and reloads", () => {
  it("Back from a result goes home; Forward shows it again", async () => {
    mock.extract.mockResolvedValue(ok(CLEAN) as never);
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    renderFlow();
    await chooseFile();
    await verdict();
    act(() => window.history.back());
    await waitFor(() => expect(document.querySelector("[data-slot=compare-flow]")).toHaveAttribute("data-step", "home"));
    expect(screen.getByRole("heading", { level: 1, name: COPY["home.h1"] })).toHaveFocus();
    act(() => window.history.forward());
    expect(await verdict()).toHaveFocus();
  });

  it("'Compare another listing' starts again empty", async () => {
    mock.extract.mockResolvedValue(ok(CLEAN) as never);
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await verdict();
    await user.click(screen.getByRole("button", { name: COPY["result.another"] }));
    expect(screen.getByRole("heading", { level: 1, name: COPY["home.h1"] })).toHaveFocus();
    expect(screen.getByRole("button", { name: COPY["home.choose"] })).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("reloading a result URL goes to /c/<code>; reloading ?step=compare or ?step=details shows home", () => {
    window.history.replaceState(null, "", "/?step=result&code=K7Q2MX");
    const first = renderFlow();
    expect(nav.replace).toHaveBeenCalledWith("/c/K7Q2MX");
    first.unmount();
    for (const step of ["compare", "details"]) {
      window.history.replaceState(null, "", `/?step=${step}`);
      const r = renderFlow();
      expect(window.location.search).toBe("");
      expect(screen.getByRole("button", { name: COPY["home.choose"] })).toBeInTheDocument();
      r.unmount();
    }
  });

  it("?ref=CODE is kept in sessionStorage and sent with the comparison", async () => {
    mock.extract.mockResolvedValue(ok(CLEAN) as never);
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    renderFlow({ initialRef: "K7Q2MX" });
    await act(async () => undefined);
    expect(window.sessionStorage.getItem(REF_STORAGE_KEY)).toBe("K7Q2MX");
    await chooseFile();
    await verdict();
    expect(mock.createCheck.mock.calls[0][0]).toMatchObject({ ref: "K7Q2MX" });
  });
});

describe("reduced motion (docs/REDESIGN.md section 5.5)", () => {
  it("the balance is still, the reading caption explains the wait in words, and the result renders final at once", async () => {
    setMedia({ "(prefers-reduced-motion: reduce)": true });
    let resolve!: (v: unknown) => void;
    mock.extract.mockImplementation((() => new Promise((r) => (resolve = r))) as never);
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    renderFlow({ reduce: true });
    await chooseFile();
    expect(screen.getByRole("heading", { level: 2, name: COPY["read.reading"] })).toHaveFocus();
    expect(screen.getByText(COPY["scene.reducedHint"])).toBeInTheDocument();
    // The still balance: level, nothing drops (no motion elements on the pans), the same stage and focus.
    expect(document.querySelector("[data-slot=stage]")).toHaveAttribute("data-stage", "reading");
    await act(async () => resolve(ok(CLEAN)));
    // The fact line appears whole: no set-in figures, no underline.
    expect(document.querySelector("[data-slot=fact-line]")).toHaveTextContent(/^Mockup Crest, Dubai Marina\. Ready 2-bed, 1,284 sq ft, AED 2,450,000\./);
    expect(document.querySelectorAll("[data-slot=fact-figure], .read-ink")).toHaveLength(0);
    // No read hold and no settle: the verdict and the scale's final frame in one go.
    expect(await screen.findByRole("heading", { level: 2, name: MARINA_HEAD })).toHaveFocus();
    expect(document.querySelector("[data-slot=scale-stamp]")).not.toBeNull();
    expect(document.querySelector("[data-slot=market-scale] [style*=animation]")).toBeNull();
    expect(document.querySelector("[data-slot=action-bar]")?.className).not.toContain("mz-bar-up");
    expect(document.querySelector("[data-slot=fact-line] [data-slot=fact-edit]")).toBeInTheDocument();
  });
});

describe("keyboard and accessibility", () => {
  it("completes a comparison by keyboard alone (paste, Read text, a question, the verdict)", async () => {
    mock.extract.mockResolvedValue(ok({ ...TOWER, fields: { ...TOWER.fields } }) as never);
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    const user = userEvent.setup();
    renderFlow();
    const paste = screen.getByRole("button", { name: COPY["home.paste"] });
    for (let i = 0; i < 30 && document.activeElement !== paste; i++) await user.tab();
    expect(paste).toHaveFocus();
    await user.keyboard("{Enter}");
    const text = screen.getByLabelText(COPY["home.pasteLabel"]);
    for (let i = 0; i < 10 && document.activeElement !== text; i++) await user.tab();
    await user.keyboard("2BR Mockup Crest, 1284 sqft, AED 2.45M");
    const read = screen.getByRole("button", { name: COPY["home.pasteRead"] });
    for (let i = 0; i < 10 && document.activeElement !== read; i++) await user.tab();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { level: 2, name: COPY["ask.buildingH"] })).toHaveFocus();
    expect(mock.extract.mock.calls[0][0]).toEqual({ text: "2BR Mockup Crest, 1284 sqft, AED 2.45M" });
    await user.tab();
    const first = within(document.querySelector("[data-slot=building-rows]") as HTMLElement).getAllByRole("button")[0];
    for (let i = 0; i < 10 && document.activeElement !== first; i++) await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await verdict()).toHaveFocus();
  });

  it("no serious or critical axe violations in the scene, a question and each result", async () => {
    let resolve!: (v: unknown) => void;
    mock.extract.mockImplementationOnce((() => new Promise((r) => (resolve = r))) as never);
    mock.createCheck.mockResolvedValueOnce(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    const user = userEvent.setup();
    const { container } = renderFlow();
    await chooseFile();
    expect(await seriousViolations(container)).toEqual([]);
    await act(async () => resolve(ok(TOWER)));
    await screen.findByRole("heading", { level: 2, name: COPY["ask.buildingH"] });
    expect(await seriousViolations(container)).toEqual([]);
    await user.click(within(document.querySelector("[data-slot=building-rows]") as HTMLElement).getAllByRole("button")[0]);
    await verdict();
    expect(await seriousViolations(container)).toEqual([]);

    await user.click(screen.getByRole("button", { name: COPY["result.another"] }));
    mock.extract.mockResolvedValueOnce(ok(THIN_READ) as never);
    mock.createCheck.mockResolvedValueOnce(ok({ check: FIXTURE_CHECK_THIN }) as never);
    await chooseFile();
    await verdict(COPY["thin.h2"]);
    expect(await seriousViolations(container)).toEqual([]);

    await user.click(screen.getByRole("button", { name: COPY["result.another"] }));
    mock.extract.mockResolvedValueOnce(ok(NOWHERE) as never);
    mock.createCheck.mockResolvedValueOnce(ok({ check: FIXTURE_CHECK_NONE }) as never);
    await chooseFile();
    await screen.findByText(/Fairsquare covers 6 buildings/);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe("review fixes: ways out, Back and Continue, Esc", () => {
  it("Back from a question keeps what was read: Continue asks again, with no second read", async () => {
    mock.extract.mockResolvedValue(ok(TOWER) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await screen.findByRole("heading", { level: 2, name: COPY["ask.buildingH"] });
    act(() => window.history.back());
    await waitFor(() => expect(document.querySelector("[data-slot=compare-flow]")).toHaveAttribute("data-step", "home"));
    const kept = document.querySelector("[data-slot=kept-screenshot]") as HTMLElement;
    expect(within(kept).getByText(COPY["scene.kept"])).toBeInTheDocument();
    expect(screen.queryByText(COPY["read.stopped"])).toBeNull();
    const cont = within(kept).getByRole("button", { name: COPY["ask.continue"] });
    await waitFor(() => expect(cont).toHaveFocus());
    await user.click(cont);
    expect(await screen.findByRole("heading", { level: 2, name: COPY["ask.buildingH"] })).toHaveFocus();
    expect(mock.extract).toHaveBeenCalledTimes(1);
  });

  it("Back from a result leaves no screenshot behind: Type the details starts with none", async () => {
    mock.extract.mockResolvedValue(ok(CLEAN) as never);
    mock.createCheck.mockResolvedValue(ok({ check: FIXTURE_CHECK_MARINA }) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    await verdict();
    act(() => window.history.back());
    await waitFor(() => expect(document.querySelector("[data-slot=compare-flow]")).toHaveAttribute("data-step", "home"));
    expect(document.querySelector("[data-slot=kept-screenshot]")).toBeNull();
    await user.click(screen.getByRole("button", { name: COPY["home.type"] }));
    await screen.findByRole("heading", { level: 2, name: COPY["details.h2Typed"] });
    expect(screen.queryByRole("img", { name: COPY["read.thumb"] })).toBeNull();
    expect(document.querySelector("[data-sheet-kind], [data-slot=stage-sheet]")).toBeNull();
  });

  it("Esc stops reading while focus is in the scene", async () => {
    mock.extract.mockImplementation(((_: unknown, s: AbortSignal) =>
      new Promise((_r, reject) => s.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as never);
    const user = userEvent.setup();
    renderFlow();
    await chooseFile();
    expect(screen.getByRole("heading", { level: 2, name: COPY["read.reading"] })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(await screen.findByText(COPY["read.stopped"])).toBeInTheDocument();
  });

  it("Stop on pasted text keeps it in the open box with Try again", async () => {
    mock.extract.mockImplementation(((_: unknown, s: AbortSignal) =>
      new Promise((_r, reject) => s.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as never);
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole("button", { name: COPY["home.paste"] }));
    await user.type(screen.getByLabelText(COPY["home.pasteLabel"]), "2BR Mockup Crest, 1284 sqft");
    await user.click(screen.getByRole("button", { name: COPY["home.pasteRead"] }));
    await user.click(await screen.findByRole("button", { name: COPY["read.stop"] }));
    expect(screen.getByLabelText(COPY["home.pasteLabel"])).toHaveValue("2BR Mockup Crest, 1284 sqft");
    expect(screen.getByText(COPY["read.stoppedText"])).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: COPY["alert.tryAgain"] })).toHaveFocus());
  });

  it("a comparison with no answer: 'Still comparing.' with a way out at 4 s, and 'Couldn't compare just now.' at 20 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    mock.extract.mockResolvedValue(ok(CLEAN) as never);
    let signal: AbortSignal | undefined;
    mock.createCheck.mockImplementation(((_: unknown, s: AbortSignal) => {
      signal = s;
      return new Promise((_r, reject) => s.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }) as never);
    renderFlow();
    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [screenshot()] } });
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(screen.getByText(COPY["scene.slowCompare"])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY["read.typeInstead"] })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_100);
    });
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole("heading", { level: 2, name: COPY["fail.compare"] })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY["alert.tryAgain"] })).toBeInTheDocument();
  });
});