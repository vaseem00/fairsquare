// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "../shell/test-utils";
import { LiveRegion, useAnnounce } from "@/components/a11y/live-region";
import { SkipLink } from "@/components/a11y/skip-link";

function Announcer({ message, politeness }: { message: string; politeness?: "polite" | "assertive" }) {
  const announce = useAnnounce();
  return (
    <button type="button" onClick={() => announce(message, politeness)}>
      announce
    </button>
  );
}

describe("LiveRegion and useAnnounce", () => {
  it("renders one polite status region and one assertive region, both visually hidden", () => {
    render(<LiveRegion />);
    const polite = screen.getByTestId("live-polite");
    const assertive = screen.getByTestId("live-assertive");
    expect(polite).toHaveAttribute("role", "status");
    expect(polite).toHaveAttribute("aria-live", "polite");
    expect(polite).toHaveAttribute("aria-atomic", "true");
    expect(assertive).toHaveAttribute("aria-live", "assertive");
    expect(polite).toHaveClass("sr-only");
    expect(assertive).toHaveClass("sr-only");
  });

  it("delivers a polite announcement to the polite region", async () => {
    render(
      <>
        <LiveRegion />
        <Announcer message="Saved. New sales in Mockup Crest Tower will show under Saved." />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "announce" }));
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Saved. New sales in Mockup Crest Tower will show under Saved.",
      ),
    );
    expect(screen.getByTestId("live-assertive")).toHaveTextContent("");
  });

  it("delivers an assertive announcement to the assertive region", async () => {
    render(
      <>
        <LiveRegion />
        <Announcer message="Fix 2 things to compare the price" politeness="assertive" />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "announce" }));
    await waitFor(() => expect(screen.getByTestId("live-assertive")).toHaveTextContent("Fix 2 things to compare the price"));
  });

  it("re-announces the same message (cleared first, then set)", async () => {
    render(
      <>
        <LiveRegion />
        <Announcer message="3 matching buildings" />
      </>,
    );
    const button = screen.getByRole("button", { name: "announce" });
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent("3 matching buildings"));
    await act(async () => {
      button.click();
    });
    expect(screen.getByTestId("live-polite")).toHaveTextContent("");
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent("3 matching buildings"));
  });
});

describe("SkipLink", () => {
  it("targets #main with the deck label", () => {
    render(<SkipLink />);
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  });
});
