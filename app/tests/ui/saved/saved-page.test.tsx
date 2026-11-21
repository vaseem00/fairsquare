// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkMock, renderWithProviders } from "../shell/test-utils";
import { ok, type ApiMock } from "../shell/api-mock";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }));
vi.mock("@/lib/api/client", async () => ({ api: (await import("../shell/api-mock")).makeApiMock() }));
vi.mock("next/link", () => linkMock);
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/saved" }));

import { UNDO_MS } from "@/components/saved/saved-list";
import { nowLine, thenLine } from "@/components/saved/saved-item";
import { SavedView } from "@/components/saved/saved-view";
import { api } from "@/lib/api/client";
import { FIXTURE_ME, FIXTURE_SAVED } from "../../fixtures/api-fixtures";
import { EMPTY_ME, type MeView } from "@/lib/types";

const apiMock = api as unknown as ApiMock;

function setup(me: MeView = FIXTURE_ME, items = FIXTURE_SAVED) {
  apiMock.me.get.mockResolvedValue(ok(me));
  apiMock.saved.list.mockResolvedValue(ok({ items }));
  return renderWithProviders(<SavedView />, { me });
}

async function openOverflow(building: string) {
  await userEvent.click(await screen.findByRole("button", { name: `More actions for ${building}` }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Saved page", () => {
  it("renders listings, then-vs-now lines and the new-sales badge", async () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Saved" })).toHaveAttribute("tabindex", "-1");
    const marina = (await screen.findByRole("heading", { level: 3, name: "Mockup Crest Tower" })).closest("article") as HTMLElement;
    expect(marina).toHaveTextContent("1 new sale");
    expect(marina).toHaveTextContent("2-bed, AED 2,450,000");
    expect(marina).toHaveTextContent("Saved 3 Nov 2026: +15.2% vs 10 sales.");
    expect(marina).toHaveTextContent(nowLine(FIXTURE_SAVED[0]) as string);
    expect(thenLine(FIXTURE_SAVED[0])).toBe("Saved 3 Nov 2026: +15.2% vs 10 sales.");
    const jvc = screen.getByRole("heading", { level: 3, name: "Fake Vista Residences" }).closest("article") as HTMLElement;
    expect(jvc).not.toHaveTextContent("new sale");
  });

  it("'Open' marks the listing seen before navigating to /c/<code>", async () => {
    const order: string[] = [];
    apiMock.saved.markSeen.mockImplementation(async (code: string) => {
      order.push(`seen:${code}`);
      return ok(null);
    });
    router.push.mockImplementation((href: string) => order.push(`push:${href}`));
    setup();
    const marina = (await screen.findByRole("heading", { level: 3, name: "Mockup Crest Tower" })).closest("article") as HTMLElement;
    // Each Open button is named for its listing (not a page of identical "Open" buttons).
    await userEvent.click(within(marina).getByRole("button", { name: "Open Mockup Crest Tower" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/c/K7Q2MX"));
    expect(order).toEqual(["seen:K7Q2MX", "push:/c/K7Q2MX"]);
  });

  it("Remove collapses into an Undo row with focus; Undo calls add and restores the same savedAt", async () => {
    const original = FIXTURE_SAVED[1];
    apiMock.saved.add.mockResolvedValue(ok({ item: original }));
    setup();
    await openOverflow("Fake Vista Residences");

    await waitFor(() => expect(apiMock.saved.remove).toHaveBeenCalledWith("P4VR8N"));
    const undo = await screen.findByRole("button", { name: "Undo" });
    expect(screen.getByText("Removed Fake Vista Residences.")).toBeInTheDocument();
    await waitFor(() => expect(undo).toHaveFocus());
    expect(screen.queryByRole("heading", { level: 3, name: "Fake Vista Residences" })).toBeNull();
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent("Removed Fake Vista Residences."));

    await userEvent.click(undo);
    expect(apiMock.saved.add).toHaveBeenCalledWith("P4VR8N");
    const restored = (await screen.findByRole("heading", { level: 3, name: "Fake Vista Residences" })).closest("article") as HTMLElement;
    expect(restored).toHaveTextContent(`Saved ${"28 Oct 2026"}:`);
    expect(apiMock.saved.add.mock.calls).toHaveLength(1);
    expect(original.savedAt).toBe("2026-10-28T16:40:00.000Z");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("the Undo row waits while focus or the pointer is on it, then goes 10 s after it is left", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup();
    await screen.findByRole("heading", { level: 3, name: "Mockup Crest Tower" });

    // Remove the first item: Undo takes focus, and the row stays as long as focus is on it.
    await user.click(screen.getByRole("button", { name: "More actions for Mockup Crest Tower" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
    const undo = await screen.findByRole("button", { name: "Undo" });
    await waitFor(() => expect(undo).toHaveFocus());
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS * 3);
    });
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();

    // The pointer over the row pauses it too.
    const row = undo.closest("[data-slot=saved-removed]") as HTMLElement;
    fireEvent.mouseEnter(row);
    act(() => undo.blur());
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS * 2);
    });
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();

    // Once left, it goes after 10 s, and focus (on <body>) moves to the next item.
    fireEvent.mouseLeave(row);
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS + 50);
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
    const jvc = screen.getByRole("heading", { level: 3, name: "Fake Vista Residences" }).closest("article") as HTMLElement;
    await waitFor(() => expect(within(jvc).getByRole("button", { name: "Open Fake Vista Residences" })).toHaveFocus());

    // Remove the last item, leave the row: focus goes to the Listings h2.
    await user.click(screen.getByRole("button", { name: "More actions for Fake Vista Residences" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
    const undo2 = await screen.findByRole("button", { name: "Undo" });
    await waitFor(() => expect(undo2).toHaveFocus());
    act(() => undo2.blur());
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS + 50);
    });
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Listings" })).toHaveFocus());
    expect(screen.getByText("Nothing saved yet")).toBeInTheDocument();
    expect(apiMock.saved.add).not.toHaveBeenCalled();
  });

  it("a failed Remove is shown on the item, not only in a toast", async () => {
    apiMock.saved.remove.mockResolvedValueOnce({
      ok: false,
      status: 429,
      error: { code: "rate_limited", message: "Too many requests from this browser. Wait a minute and try again.", requestId: "x" },
    } as never);
    setup();
    await openOverflow("Fake Vista Residences");
    const article = (await screen.findByRole("heading", { level: 3, name: "Fake Vista Residences" })).closest("article") as HTMLElement;
    expect(within(article).getByRole("alert")).toHaveTextContent("Too many requests from this browser.");
  });

  it("renders requests and the adviser request from FIXTURE_ME", async () => {
    setup();
    const requests = await screen.findByRole("region", { name: "Buildings you asked for" });
    expect(within(requests).getByRole("heading", { name: "Nowhere Point Tower" })).toBeInTheDocument();
    expect(requests).toHaveTextContent("Requested 17 Nov 2026. 3 other people asked.");
    expect(requests).toHaveTextContent("Not covered yet");

    const adviser = screen.getByRole("region", { name: "Adviser request" });
    expect(adviser).toHaveTextContent("Sent to Test Mortgage Partner on 17 Nov 2026.");
    expect(within(adviser).getByRole("button", { name: "Withdraw this request" })).toBeInTheDocument();
  });

  it("shows 'Now covered. Compare again.' for a covered request and hides empty sections", async () => {
    const me: MeView = {
      ...FIXTURE_ME,
      leads: [],
      requests: [{ ...FIXTURE_ME.requests[0], covered: true, coveredBuilding: { id: 9, name: "Nowhere Point Tower" } }],
    };
    setup(me);
    expect(await screen.findByRole("link", { name: "Now covered. Compare again." })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("region", { name: "Adviser request" })).toBeNull();
  });

  it("shows the Empty state with no listings and hides requests when there are none", async () => {
    setup(EMPTY_ME, []);
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
    expect(screen.getByText("Save a comparison to see new sales in that building here.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Compare a listing" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("region", { name: "Buildings you asked for" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Your data" })).toBeNull();
  });

  it("copies the recovery link", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    apiMock.me.recoveryLink.mockResolvedValue(ok({ url: "http://localhost:3000/r/abc.def" }));
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Copy recovery link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost:3000/r/abc.def"));
    expect(apiMock.track).toHaveBeenCalledWith("recovery_link_copied");
  });

  it("shows the link and the clipboard message when copying is blocked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
      configurable: true,
    });
    apiMock.me.recoveryLink.mockResolvedValue(ok({ url: "http://localhost:3000/r/abc.def" }));
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Copy recovery link" }));
    expect(await screen.findByDisplayValue("http://localhost:3000/r/abc.def")).toHaveAttribute("readonly");
    expect(screen.getByText("Copy didn't work here. Press and hold the link to copy it.")).toBeInTheDocument();
  });

  it("Delete all my data: confirm, DELETE /api/me, empty state and focus on the h1", async () => {
    setup();
    const yourData = await screen.findByRole("region", { name: "Your data" });
    expect(yourData).toHaveTextContent("Comparisons4");
    await userEvent.click(within(yourData).getByRole("button", { name: "Delete all my data" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete everything Fairsquare stores for this browser?");
    expect(dialog).toHaveTextContent("If you sent your details to Test Mortgage Partner, they will be told to delete them.");

    apiMock.me.get.mockResolvedValue(ok(EMPTY_ME));
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete everything" }));
    await waitFor(() => expect(apiMock.me.remove).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Saved" })).toHaveFocus());
    await waitFor(() => expect(screen.queryByRole("region", { name: "Your data" })).toBeNull());
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent("Your data is deleted."));
  });

  it("a failed Delete all stays visible in the dialog next to the action, not only in a toast", async () => {
    apiMock.me.remove.mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: { code: "internal", message: "You're offline. Connect and try again, or type the details.", requestId: "" },
    } as never);
    setup();
    const yourData = await screen.findByRole("region", { name: "Your data" });
    await userEvent.click(within(yourData).getByRole("button", { name: "Delete all my data" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete everything" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("You're offline.");
  });

  it("a recovery link opened over another list asks first; Keep leaves this browser's list", async () => {
    apiMock.saved.list.mockResolvedValue(ok({ items: [] }));
    renderWithProviders(<SavedView recoveryToken="abc.def" />, { me: EMPTY_ME });
    const box = screen.getByRole("region", { name: /This link opens a different saved list/ });
    expect(within(box).getByRole("button", { name: "Replace with the linked list" })).toBeInTheDocument();
    await userEvent.click(within(box).getByRole("button", { name: "Keep this browser's list" }));
    expect(screen.queryByRole("region", { name: /This link opens a different saved list/ })).toBeNull();
    expect(apiMock.me.recover).not.toHaveBeenCalled();
  });

  it("shows the recovery failure notice for ?recovery=failed", async () => {
    apiMock.saved.list.mockResolvedValue(ok({ items: [] }));
    renderWithProviders(<SavedView recoveryFailed />, { me: EMPTY_ME });
    expect(screen.getByRole("alert")).toHaveTextContent("That recovery link didn't work.");
  });
});
