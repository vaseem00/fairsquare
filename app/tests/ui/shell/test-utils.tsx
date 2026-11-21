/**
 * Shared jsdom setup for WP8's UI tests: browser APIs jsdom lacks, a plain-anchor next/link,
 * and a render helper with the app's providers (ConfigProvider, MeProvider, LiveRegion).
 * Each test file still declares `// @vitest-environment jsdom` and mocks `@/lib/api/client`.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach } from "vitest";
import { __resetAnnouncementsForTests, LiveRegion } from "@/components/a11y/live-region";
import { ConfigProvider } from "@/components/shell/config-provider";
import { MeProvider } from "@/components/shell/me-provider";
import { FIXTURE_CONFIG } from "../../fixtures/api-fixtures";
import type { MeView, PublicConfig } from "@/lib/types";

/** `window.matchMedia` stub; `setMedia({ "(min-width: 1024px)": true })` switches queries on. */
const media = new Map<string, boolean>();
export function setMedia(values: Record<string, boolean>): void {
  media.clear();
  for (const [k, v] of Object.entries(values)) media.set(k, v);
}

export function installBrowserStubs(): void {
  if (typeof window === "undefined") return;
  window.matchMedia = ((query: string) => ({
    matches: media.get(query) ?? false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!("getAnimations" in Element.prototype)) {
    (Element.prototype as unknown as { getAnimations: () => Animation[] }).getAnimations = () => [];
  }
  if (!window.PointerEvent) {
    (window as unknown as { PointerEvent: unknown }).PointerEvent = class extends MouseEvent {};
  }
}

installBrowserStubs();

afterEach(() => {
  cleanup();
  __resetAnnouncementsForTests();
  setMedia({});
  document.documentElement.removeAttribute("data-action-bar");
});

/** next/link as a plain anchor (no app router in jsdom). Use with `vi.mock("next/link", () => linkMock)`. */
export const linkMock = {
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as object)}>
      {children}
    </a>
  ),
};

export function Providers({
  children,
  config = FIXTURE_CONFIG,
  me = null,
}: {
  children: ReactNode;
  config?: PublicConfig;
  me?: MeView | null;
}) {
  return (
    <ConfigProvider value={config}>
      <MeProvider initial={me}>
        {children}
        <LiveRegion />
      </MeProvider>
    </ConfigProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  opts: { config?: PublicConfig; me?: MeView | null } & Omit<RenderOptions, "wrapper"> = {},
) {
  const { config, me, ...rest } = opts;
  return render(ui, {
    wrapper: ({ children }) => (
      <Providers config={config} me={me}>
        {children}
      </Providers>
    ),
    ...rest,
  });
}
