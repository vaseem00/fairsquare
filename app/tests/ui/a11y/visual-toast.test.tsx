// @vitest-environment jsdom
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import "../shell/test-utils";

const sonner = vi.hoisted(() => ({ toast: { success: vi.fn() } }));
vi.mock("sonner", () => sonner);

import { visualToast } from "@/components/a11y/visual-toast";

describe("visualToast (one announcement per message, D§7.1)", () => {
  it("shows the message but hides it from the toaster's live region, so announce() speaks it once", () => {
    visualToast("Your data is deleted.");
    expect(sonner.toast.success).toHaveBeenCalledTimes(1);
    const content = sonner.toast.success.mock.calls[0][0] as ReactElement;
    const { container } = render(content);
    const span = container.querySelector("[data-slot=visual-toast]") as HTMLElement;
    expect(span).toHaveTextContent("Your data is deleted.");
    expect(span).toHaveAttribute("aria-hidden", "true");
  });
});
