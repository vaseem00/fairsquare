// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkMock, renderWithProviders } from "./test-utils";
import { ok, type ApiMock } from "./api-mock";

vi.mock("@/lib/api/client", async () => ({ api: (await import("./api-mock")).makeApiMock() }));
vi.mock("next/link", () => linkMock);
vi.mock("next/navigation", () => ({ usePathname: () => "/coverage", useRouter: () => ({ push: vi.fn() }) }));

import { Footer } from "@/components/shell/footer";
import { Header, HeaderBar } from "@/components/shell/header";
import { isAdminPath, savedLinkName } from "@/components/shell/nav-items";
import { api } from "@/lib/api/client";
import { FIXTURE_ME } from "../../fixtures/api-fixtures";
import { attributionText, COPY } from "@/lib/copy";
import { EMPTY_ME, type MeView } from "@/lib/types";

const apiMock = api as unknown as ApiMock;
const ME_TWO: MeView = { ...FIXTURE_ME, savedWithNewSales: 2 };

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------- a small layout stub for the 360px check (jsdom has no layout engine) ----------

const PX_PER_STEP = 4;
const VIEWPORT = 360;
const GUTTER = 16 * 2;

function classes(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/** Hidden below 1024px (base `hidden` without a mobile override), or sr-only. */
function hiddenOnPhone(el: Element): boolean {
  const c = classes(el);
  // VIEWPORT < 375, so `max-[374px]:sr-only` hides too.
  return c.includes("sr-only") || c.includes("max-[374px]:sr-only") || (c.includes("hidden") && !c.some((x) => /^(?:max-|sm:|md:)/.test(x) && !x.endsWith("hidden")));
}

function fontPx(el: Element | null): number {
  for (let e = el; e; e = e.parentElement) {
    const c = classes(e);
    if (c.includes("text-[1.25rem]")) return 20;
    if (c.includes("text-sm") || c.includes("text-caption")) return 14;
    if (c.includes("text-body") || c.includes("text-base")) return 16;
  }
  return 16;
}

function step(c: string[], re: RegExp): number {
  for (const x of c) {
    const m = re.exec(x);
    if (m) return Number(m[1]) * PX_PER_STEP;
  }
  return 0;
}

/** Estimated width at 360px: text at 0.56em per character, sizes and paddings from the classes. */
function widthAt360(el: Element): number {
  if (hiddenOnPhone(el)) return 0;
  const c = classes(el);
  const fixed = step(c, /^size-(\d+(?:\.\d+)?)$/);
  if (fixed) return fixed;
  // VIEWPORT < 375, so `max-[374px]:px-N` wins over `px-N`.
  const px = step(c, /^max-\[374px\]:px-(\d+(?:\.\d+)?)$/) || step(c, /^px-(\d+(?:\.\d+)?)$/);
  const gap = step(c, /^gap-(\d+(?:\.\d+)?)$/);
  const minW = step(c, /^min-w-(\d+(?:\.\d+)?)$/);
  let content = 0;
  let parts = 0;
  for (const node of Array.from(el.childNodes)) {
    let w = 0;
    if (node.nodeType === Node.TEXT_NODE) w = (node.textContent ?? "").trim().length * fontPx(el) * 0.56;
    else if (node instanceof Element) w = widthAt360(node);
    if (w > 0) {
      content += w;
      parts += 1;
    }
  }
  const neg = step(c, /^-m[lr]-(\d+(?:\.\d+)?)$/);
  return Math.max(minW, content + gap * Math.max(0, parts - 1) + px * 2) - neg;
}

describe("Header", () => {
  it("fits on one row at 360px with mark, wordmark, Saved with a count, and Menu", async () => {
    apiMock.me.get.mockResolvedValue(ok(ME_TWO));
    renderWithProviders(<HeaderBar pathname="/" />, { me: ME_TWO });
    const row = document.querySelector("header > div") as HTMLElement;
    expect(classes(row)).toContain("flex-nowrap");
    expect(classes(row)).toContain("h-(--header-h)");
    await waitFor(() => expect(screen.getByTestId("header-saved-mobile")).toHaveTextContent("2"));
    const total = widthAt360(row); // children, gaps and paddings of the visible phone items
    expect(total).toBeGreaterThan(180); // sanity: the stub measured the visible items (no demo badge any more)
    expect(total).toBeLessThanOrEqual(VIEWPORT - GUTTER);
    // The Menu trigger is a 44px target.
    expect(screen.getByRole("button", { name: "Menu" }).className).toContain("size-11");
  });

  it("still fits at 360px with a two-digit count (12 listings with new sales)", async () => {
    const ME_TWELVE: MeView = { ...FIXTURE_ME, savedWithNewSales: 12 };
    apiMock.me.get.mockResolvedValue(ok(ME_TWELVE));
    renderWithProviders(<HeaderBar pathname="/" />, { me: ME_TWELVE });
    const link = screen.getByTestId("header-saved-mobile");
    await waitFor(() => expect(link).toHaveTextContent("12"));
    expect(link).toHaveAccessibleName("Saved, 12 listings have new sales");
    const row = document.querySelector("header > div") as HTMLElement;
    expect(widthAt360(row)).toBeLessThanOrEqual(VIEWPORT - GUTTER);
  });

  it("admin pages get no public header or footer (their own shell, D§3.8)", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/login")).toBe(true);
    expect(isAdminPath("/admin/sales")).toBe(true);
    expect(isAdminPath("/administrator")).toBe(false);
    expect(isAdminPath("/")).toBe(false);
    expect(isAdminPath(null)).toBe(false);
  });

  it("names the Saved link with the count of listings that have new sales", async () => {
    apiMock.me.get.mockResolvedValue(ok(ME_TWO));
    renderWithProviders(<HeaderBar pathname="/" />, { me: ME_TWO });
    const link = screen.getByTestId("header-saved-mobile");
    expect(link).toHaveAccessibleName("Saved, 2 listings have new sales");
    expect(link).toHaveAttribute("href", "/saved");
    expect(savedLinkName(0)).toBe("Saved");
  });

  it("shows no count and the plain name when nothing is new", async () => {
    apiMock.me.get.mockResolvedValue(ok(EMPTY_ME));
    renderWithProviders(<HeaderBar pathname="/" />, { me: EMPTY_ME });
    const link = screen.getByTestId("header-saved-mobile");
    expect(link).toHaveAccessibleName("Saved");
    expect(link.querySelector("[aria-hidden=true].num")).toBeNull();
  });

  it("has the brand link, no demo badge (REAL_DATA.md section 8), desktop links with aria-current, and no admin", () => {
    apiMock.me.get.mockResolvedValue(ok(EMPTY_ME));
    renderWithProviders(<Header />);
    expect(screen.getByRole("link", { name: "Fairsquare home" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: /Demo/ })).toBeNull();
    expect(document.body).not.toHaveTextContent(/demo/i);
    const coverage = screen.getByRole("link", { name: "Coverage" });
    expect(coverage).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Compare" })).not.toHaveAttribute("aria-current");
    expect(document.querySelector('a[href^="/admin"]')).toBeNull();
    expect(screen.queryByRole("navigation", { name: /tab/i })).toBeNull();
  });

  it("opens the menu Sheet with the five links and the theme choice", async () => {
    apiMock.me.get.mockResolvedValue(ok(EMPTY_ME));
    renderWithProviders(<HeaderBar pathname="/saved" />);
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    const sheet = await screen.findByRole("dialog", { name: "Menu" });
    const links = within(sheet).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Compare a listing", "/"],
      ["Saved", "/saved"],
      ["Coverage", "/coverage"],
      ["How Fairsquare compares", "/how-it-works"],
      ["Privacy", "/privacy"],
    ]);
    expect(within(sheet).getByRole("link", { name: "Saved" })).toHaveAttribute("aria-current", "page");
    const theme = within(sheet).getByRole("group", { name: "Theme" });
    expect(within(theme).getAllByRole("button").map((b) => b.textContent)).toEqual(["Light", "Dark", "System"]);
  });
});

describe("Footer", () => {
  it("has the links, the attribution and independence lines, not-a-valuation and the AI sentence", () => {
    renderWithProviders(<Footer />);
    const footer = screen.getByRole("contentinfo");
    // The site links, then the dataset and licence named in the attribution (REAL_DATA.md section 9).
    expect(within(footer).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/how-it-works",
      "/coverage",
      "/privacy",
      "https://example.test/dataset",
      "https://example.test/licence",
    ]);
    expect(within(footer).getByRole("link", { name: COPY["data.dataset"] })).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: COPY["data.licence"] })).toBeInTheDocument();
    expect(footer).toHaveTextContent(attributionText());
    // No logos: the only images are the Fairsquare mark (REAL_DATA.md section 9).
    expect(footer.querySelectorAll("img")).toHaveLength(0);
    expect(footer).toHaveTextContent(COPY["data.independent"]);
    expect(footer).not.toHaveTextContent(/demo|fictional/i);
    expect(footer).toHaveTextContent("It is not a valuation and not financial advice.");
    expect(footer).toHaveTextContent("Fairsquare uses Claude, Anthropic's AI, to read screenshots.");
  });

});
