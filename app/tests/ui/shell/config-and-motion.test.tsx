// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { linkMock, renderWithProviders, setMedia } from "./test-utils";

vi.mock("@/lib/api/client", async () => ({ api: (await import("./api-mock")).makeApiMock() }));
vi.mock("next/link", () => linkMock);

import { usePublicConfig } from "@/components/shell/config-provider";
import { FIXTURE_CONFIG_NO_LEADS } from "../../fixtures/api-fixtures";
import { scrollIntoViewSafe } from "@/lib/motion";

describe("usePublicConfig", () => {
  it("throws outside a ConfigProvider", () => {
    const Probe = () => <span>{usePublicConfig().appUrl}</span>;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/ConfigProvider/);
    spy.mockRestore();
  });

  it("hands the config to client components (the demo switch is gone, REAL_DATA.md section 8)", () => {
    const Probe = () => {
      const c = usePublicConfig();
      return <span>{`${c.leadsEnabled}|${c.data.loaded}|${"isDemo" in c}`}</span>;
    };
    renderWithProviders(<Probe />, { config: FIXTURE_CONFIG_NO_LEADS });
    expect(screen.getByText("false|true|false")).toBeInTheDocument();
  });
});

describe("scrollIntoViewSafe", () => {
  it("scrolls smoothly by default and instantly under reduced motion; ignores null", () => {
    const el = document.createElement("div");
    const spy = vi.fn();
    el.scrollIntoView = spy;
    scrollIntoViewSafe(el);
    expect(spy).toHaveBeenLastCalledWith({ block: "nearest", behavior: "smooth" });
    setMedia({ "(prefers-reduced-motion: reduce)": true });
    scrollIntoViewSafe(el, { behavior: "smooth", block: "start" });
    expect(spy).toHaveBeenLastCalledWith({ block: "start", behavior: "auto" });
    expect(() => scrollIntoViewSafe(null)).not.toThrow();
  });
});
