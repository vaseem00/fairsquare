// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../shell/test-utils";

const nav = vi.hoisted(() => ({ pathname: "/saved" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { RouteFocus } from "@/components/a11y/route-focus";

function Page({ h1 }: { h1: string | null }) {
  return (
    <>
      <header>
        <button type="button">Menu</button>
      </header>
      <main id="main" tabIndex={-1}>
        {h1 ? <h1 tabIndex={-1}>{h1}</h1> : <p>Loading</p>}
        <button type="button">Open</button>
      </main>
      <RouteFocus />
    </>
  );
}

async function frames(n = 3) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
  }
}

beforeEach(() => {
  nav.pathname = "/saved";
});

describe("RouteFocus (D§7.2: client route change → page h1)", () => {
  it("does nothing on the first render", async () => {
    render(<Page h1="Saved" />);
    await frames();
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to the new page's h1 after a client navigation, instead of leaving it on <body>", async () => {
    const view = render(<Page h1="Saved" />);
    nav.pathname = "/c/K7Q2MX";
    view.rerender(<Page h1="Mockup Crest Tower, 2-bed" />);
    await frames();
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.activeElement?.textContent).toBe("Mockup Crest Tower, 2-bed");
  });

  it("waits for an h1 that streams in after the URL changed", async () => {
    const view = render(<Page h1="Saved" />);
    nav.pathname = "/coverage";
    view.rerender(<Page h1={null} />);
    await frames(2);
    expect(document.activeElement).toBe(document.body);
    view.rerender(<Page h1="Coverage" />);
    await frames();
    expect(document.activeElement?.textContent).toBe("Coverage");
  });

  it("leaves focus the new page placed itself", async () => {
    const view = render(<Page h1="Saved" />);
    nav.pathname = "/";
    view.rerender(<Page h1="Home" />);
    const open = view.getAllByRole("button", { name: "Open" })[0];
    open.focus();
    await frames();
    expect(document.activeElement).toBe(open);
  });
});
