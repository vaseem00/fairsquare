"use client";

/**
 * Route-change focus (DESIGN.md sections 7.1 and 7.2, row 1: "Client route change → page h1").
 * Next's layout router deliberately leaves focus alone on navigation, so a link or button that
 * unmounts with the old page drops focus to <body>. After every client pathname change (not the first
 * render) this moves focus to the new page's `main h1` (tabIndex -1), falling back to `#main`, without
 * scrolling. The h1 may stream in after the URL changes, so it is looked for over a short window.
 * Focus already placed inside the new page by that page (for example the compare flow's own step
 * focus) is left alone.
 */
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** How long to wait for the new page's h1 to stream in. */
const WAIT_MS = 2000;

function focusTarget(): HTMLElement | null {
  const main = document.getElementById("main");
  if (!main) return null;
  return main.querySelector<HTMLElement>("h1") ?? null;
}

/** True when something other than <body> inside <main> already holds focus. */
function focusInsideMain(): boolean {
  const active = document.activeElement;
  const main = document.getElementById("main");
  return Boolean(active && main && active !== main && main.contains(active));
}

export function moveFocusToPage(h1: HTMLElement | null, main: HTMLElement | null): HTMLElement | null {
  const target = h1 ?? main;
  if (!target) return null;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  return target;
}

export function RouteFocus() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = pathname;
    if (before === null || before === pathname) return;

    let frame = 0;
    const started = performance.now();
    const tick = () => {
      if (focusInsideMain()) return;
      const h1 = focusTarget();
      if (h1) {
        moveFocusToPage(h1, null);
        return;
      }
      if (performance.now() - started > WAIT_MS) {
        moveFocusToPage(null, document.getElementById("main"));
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}
