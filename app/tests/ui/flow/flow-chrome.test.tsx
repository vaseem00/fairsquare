// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../shell/test-utils";
import { ActionBar } from "@/components/flow/action-bar";

describe("ActionBar", () => {
  it("adds data-action-bar on <html> while mounted and removes it on unmount", () => {
    const html = document.documentElement;
    expect(html.hasAttribute("data-action-bar")).toBe(false);
    const { unmount } = render(
      <ActionBar>
        <button type="button">Share card</button>
      </ActionBar>,
    );
    expect(html.hasAttribute("data-action-bar")).toBe(true);
    unmount();
    expect(html.hasAttribute("data-action-bar")).toBe(false);
  });

  it("keeps the attribute until the last of two bars unmounts", () => {
    const html = document.documentElement;
    const a = render(<ActionBar>a</ActionBar>);
    const b = render(<ActionBar>b</ActionBar>);
    a.unmount();
    expect(html.hasAttribute("data-action-bar")).toBe(true);
    b.unmount();
    expect(html.hasAttribute("data-action-bar")).toBe(false);
  });

  it("is a fixed, opaque bar with a top border below 1024px and inline from 1024px", () => {
    render(<ActionBar>x</ActionBar>);
    const bar = document.querySelector("[data-slot=action-bar]") as HTMLElement;
    for (const c of ["fixed", "bottom-0", "z-30", "border-t", "bg-background", "lg:static", "lg:border-0"]) {
      expect(bar.className).toContain(c);
    }
    expect(bar.className).toContain("min-h-[calc(72px+env(safe-area-inset-bottom))]");
  });

  it("scroll padding follows the bar: globals.css sets --action-bar-h on html[data-action-bar] below 1024px", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");
    expect(css).toMatch(/@media \(max-width: 1023px\)\s*{\s*html\[data-action-bar\]\s*{\s*--action-bar-h: 72px;/);
    expect(css).toContain(
      "scroll-padding-bottom: calc(var(--action-bar-h) + env(safe-area-inset-bottom) + 8px)",
    );
    expect(css).toContain("scroll-padding-top: calc(var(--header-h) + 8px)");
  });
});
