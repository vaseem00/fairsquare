// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkMock, renderWithProviders } from "../shell/test-utils";
import { fail, ok, type ApiMock } from "../shell/api-mock";

vi.mock("@/lib/api/client", async () => ({ api: (await import("../shell/api-mock")).makeApiMock() }));
vi.mock("next/link", () => linkMock);

import { __resetSavedCodesForTests, SaveButton } from "@/components/saved/save-button";
import { api } from "@/lib/api/client";
import {
  FIXTURE_CHECK_MARINA,
  FIXTURE_CHECK_NONE,
  FIXTURE_CHECK_THIN,
  FIXTURE_ME,
  FIXTURE_SAVED,
} from "../../fixtures/api-fixtures";
import { EMPTY_ME } from "@/lib/types";

const apiMock = api as unknown as ApiMock;

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.me.get.mockResolvedValue(ok(EMPTY_ME));
  apiMock.saved.list.mockResolvedValue(ok({ items: [] }));
  __resetSavedCodesForTests();
});

describe("SaveButton", () => {
  it("saves, becomes a Tracking link to /saved, announces and refreshes me; never removes", async () => {
    apiMock.saved.add.mockResolvedValue(ok({ item: FIXTURE_SAVED[0] }));
    renderWithProviders(<SaveButton check={FIXTURE_CHECK_MARINA} />);
    await waitFor(() => expect(apiMock.me.get).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: "Save and track" }));
    expect(apiMock.saved.add).toHaveBeenCalledWith("K7Q2MX");

    const link = await screen.findByRole("link", { name: "Tracking" });
    expect(link).toHaveAttribute("href", "/saved");
    await waitFor(() => expect(link).toHaveFocus());
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Saved. New sales in Mockup Crest Tower will show under Saved.",
      ),
    );
    await waitFor(() => expect(apiMock.me.get).toHaveBeenCalledTimes(2));

    // Tapping "Tracking" again is navigation only.
    await userEvent.click(link);
    expect(apiMock.saved.remove).not.toHaveBeenCalled();
    expect(apiMock.saved.add).toHaveBeenCalledTimes(1);
  });

  it("is not rendered for not-covered comparisons", () => {
    const { container, rerender } = renderWithProviders(<SaveButton check={FIXTURE_CHECK_NONE} />);
    expect(container.querySelector("[data-slot=save-button]")).toBeNull();
    rerender(<SaveButton check={FIXTURE_CHECK_THIN} />);
    expect(screen.getByRole("button", { name: "Save and track" })).toBeInTheDocument();
  });

  it("shows Tracking when the comparison is already saved", async () => {
    apiMock.me.get.mockResolvedValue(ok(FIXTURE_ME));
    apiMock.saved.list.mockResolvedValue(ok({ items: FIXTURE_SAVED }));
    renderWithProviders(<SaveButton check={FIXTURE_CHECK_MARINA} />, { me: FIXTURE_ME });
    expect(await screen.findByRole("link", { name: "Tracking" })).toBeInTheDocument();
    expect(apiMock.saved.remove).not.toHaveBeenCalled();
  });

  it("keeps the Save button when saving fails", async () => {
    apiMock.saved.add.mockResolvedValue(fail(429, "rate_limited", "Too many requests from this browser. Wait a minute and try again."));
    renderWithProviders(<SaveButton check={FIXTURE_CHECK_MARINA} />);
    await userEvent.click(screen.getByRole("button", { name: "Save and track" }));
    await waitFor(() => expect(apiMock.saved.add).toHaveBeenCalled());
    const button = screen.getByRole("button", { name: "Save and track" });
    expect(button).toBeInTheDocument();
    expect(apiMock.saved.remove).not.toHaveBeenCalled();
    // The failure stays next to the button (not only in a 4-second toast) and describes it.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Too many requests from this browser. Wait a minute and try again.");
    expect(button).toHaveAccessibleDescription("Too many requests from this browser. Wait a minute and try again.");
  });
});
