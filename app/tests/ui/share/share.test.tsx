// @vitest-environment jsdom
/**
 * Sharing (RESULT_SPEC section 8.2): Send on WhatsApp first; "More ways to share" holds the card image,
 * Send the card image (Web Share with the file, left out where the browser can't), Download card, Copy
 * link and Copy text.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkMock, renderWithProviders, setMedia } from "../shell/test-utils";
import type { ApiMock } from "../shell/api-mock";

vi.mock("@/lib/api/client", async () => ({ api: (await import("../shell/api-mock")).makeApiMock() }));
vi.mock("next/link", () => linkMock);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", async (orig) => ({ ...(await orig<typeof import("sonner")>()), toast: toastMock }));

import { MoreShareSheet } from "@/components/share/more-share";
import { ShareButton, WhatsAppButton } from "@/components/share/share-actions";
import { whatsappUrl } from "@/components/share/share";
import { api } from "@/lib/api/client";
import { FIXTURE_CHECK_MARINA, FIXTURE_CHECK_NONE, FIXTURE_CHECK_THIN } from "../../fixtures/api-fixtures";
import { cardAlt, COPY, shareText } from "@/lib/copy";

const apiMock = api as unknown as ApiMock;
const nav = navigator as Navigator & { canShare?: unknown; share?: unknown; clipboard?: unknown };
const card = new File([new Uint8Array([1, 2, 3])], "fairsquare-mockup-crest-K7Q2MX.png", { type: "image/png" });

function setShare(canShare: ((d: ShareData) => boolean) | undefined, share: ((d: ShareData) => Promise<void>) | undefined) {
  Object.defineProperty(nav, "canShare", { value: canShare, configurable: true, writable: true });
  Object.defineProperty(nav, "share", { value: share, configurable: true, writable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  setMedia({});
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:card");
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});
afterEach(() => {
  setShare(undefined, undefined);
});

describe("<WhatsAppButton>", () => {
  it("opens wa.me with the section 8.2 text (it ends with the /c link) and tracks share_whatsapp", async () => {
    renderWithProviders(<WhatsAppButton check={FIXTURE_CHECK_MARINA} />);
    const wa = screen.getByRole("link", { name: COPY["share.whatsapp"] });
    expect(wa).toHaveAttribute("href", whatsappUrl(shareText(FIXTURE_CHECK_MARINA)));
    expect(wa.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(wa.getAttribute("href")!.split("text=")[1])).toMatch(/Not a valuation\. http:\/\/localhost:3000\/c\/K7Q2MX$/);
    expect(wa).toHaveAttribute("target", "_blank");
    wa.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(wa);
    expect(apiMock.track).toHaveBeenCalledWith("share_whatsapp", "K7Q2MX");
  });
});

describe("<ShareButton> and More ways to share", () => {
  it("Share opens the drawer on phones: the card image (named by its alt), Download card, Copy link, Copy text", async () => {
    renderWithProviders(<ShareButton check={FIXTURE_CHECK_THIN} file={card} />);
    await userEvent.click(screen.getByRole("button", { name: COPY["share.cta"] }));
    expect(await screen.findByText(COPY["share.more"])).toBeInTheDocument();
    expect(document.querySelector("[data-slot=drawer-popup]")).not.toBeNull();
    expect(screen.getByRole("img", { name: cardAlt(FIXTURE_CHECK_THIN) as string })).toHaveAttribute("src", "blob:card");
    expect(screen.getByRole("button", { name: COPY["share.download"] })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY["share.copy"] })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY["share.copyText"] })).toBeInTheDocument();
    // Without Web Share for files there is no "Send the card image".
    expect(screen.queryByRole("button", { name: COPY["share.image"] })).toBeNull();
  });

  it("Send the card image calls navigator.share with the file, the text and the link, and tracks share_native", async () => {
    const share = vi.fn(async () => {});
    const canShare = vi.fn((d: ShareData) => Boolean(d.files?.length));
    setShare(canShare, share);
    renderWithProviders(<MoreShareSheet open onOpenChange={() => undefined} check={FIXTURE_CHECK_MARINA} file={card} />);
    await userEvent.click(await screen.findByRole("button", { name: COPY["share.image"] }));
    expect(canShare).toHaveBeenCalledWith({ files: [card] });
    expect(share).toHaveBeenCalledWith({ files: [card], text: shareText(FIXTURE_CHECK_MARINA), url: FIXTURE_CHECK_MARINA.url });
    await waitFor(() => expect(apiMock.track).toHaveBeenCalledWith("share_native", "K7Q2MX"));
  });

  it("a cancelled share sheet (AbortError) shows nothing; another failure shows the error toast", async () => {
    const abort = Object.assign(new Error("cancel"), { name: "AbortError" });
    setShare(() => true, vi.fn(async () => Promise.reject(abort)));
    const { unmount } = renderWithProviders(<MoreShareSheet open onOpenChange={() => undefined} check={FIXTURE_CHECK_MARINA} file={card} />);
    await userEvent.click(await screen.findByRole("button", { name: COPY["share.image"] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(apiMock.track).not.toHaveBeenCalled();
    unmount();
    setShare(() => true, vi.fn(async () => Promise.reject(new Error("NotAllowedError"))));
    renderWithProviders(<MoreShareSheet open onOpenChange={() => undefined} check={FIXTURE_CHECK_MARINA} file={card} />);
    await userEvent.click(await screen.findByRole("button", { name: COPY["share.image"] }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(COPY["error.shareFailed"]));
  });

  it("desktop Dialog: Download card, Copy link and Copy text, each confirmed (and tracked where there is an event)", async () => {
    setMedia({ "(min-width: 1024px)": true });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(nav, "clipboard", { value: { writeText }, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderWithProviders(<MoreShareSheet open onOpenChange={() => undefined} check={FIXTURE_CHECK_MARINA} file={card} />);
    expect(await screen.findByRole("dialog", { name: COPY["share.more"] })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: COPY["share.copy"] }));
    expect(writeText).toHaveBeenCalledWith("http://localhost:3000/c/K7Q2MX");
    await waitFor(() => expect(apiMock.track).toHaveBeenCalledWith("link_copied", "K7Q2MX"));
    expect(toastMock.success).toHaveBeenCalledWith(COPY["share.copied"]);

    await userEvent.click(screen.getByRole("button", { name: COPY["share.copyText"] }));
    expect(writeText).toHaveBeenLastCalledWith(shareText(FIXTURE_CHECK_MARINA));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(COPY["share.textCopied"]));

    await userEvent.click(screen.getByRole("button", { name: COPY["share.download"] }));
    expect(click).toHaveBeenCalled();
    expect(apiMock.track).toHaveBeenCalledWith("card_downloaded", "K7Q2MX");
    expect(toastMock.success).toHaveBeenCalledWith(COPY["share.downloaded"]);
    click.mockRestore();
  });

  it("a blocked clipboard shows the press-and-hold note with the link itself", async () => {
    Object.defineProperty(nav, "clipboard", { value: { writeText: vi.fn(async () => Promise.reject(new Error("blocked"))) }, configurable: true });
    renderWithProviders(<MoreShareSheet open onOpenChange={() => undefined} check={FIXTURE_CHECK_MARINA} file={card} />);
    await userEvent.click(await screen.findByRole("button", { name: COPY["share.copy"] }));
    await waitFor(() => expect(document.querySelector("[data-slot=share-copy-failed]")).not.toBeNull());
    const note = document.querySelector("[data-slot=share-copy-failed]") as HTMLElement;
    expect(note).toHaveAttribute("role", "status");
    expect(note).toHaveTextContent(COPY["error.clipboard"]);
    expect(note).toHaveTextContent("http://localhost:3000/c/K7Q2MX");
    expect(apiMock.track).not.toHaveBeenCalledWith("link_copied", "K7Q2MX");
  });

  it("while the card renders its box stays empty and Download waits; not covered has no card at all", async () => {
    const { unmount } = renderWithProviders(<MoreShareSheet open onOpenChange={() => undefined} check={FIXTURE_CHECK_MARINA} file={null} />);
    expect(await screen.findByRole("button", { name: COPY["share.download"] })).toBeDisabled();
    expect(document.querySelector("[data-slot=more-share-card] img")).toBeNull();
    unmount();
    renderWithProviders(<MoreShareSheet open onOpenChange={() => undefined} check={FIXTURE_CHECK_NONE} file={null} />);
    expect(await screen.findByRole("button", { name: COPY["share.copy"] })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=more-share-card]")).toBeNull();
    expect(screen.queryByRole("button", { name: COPY["share.download"] })).toBeNull();
  });

  it("a not-covered comparison has no Share button", () => {
    const { container } = renderWithProviders(<ShareButton check={FIXTURE_CHECK_NONE} file={null} />);
    expect(container.querySelector("[data-slot=share-card]")).toBeNull();
  });
});
