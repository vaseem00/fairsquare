/**
 * Shared motion values and the reduced-motion aware scroll helper (docs/REDESIGN.md section 5).
 * Client-safe. Nothing scrolls without a user action; callers only call this after one.
 * Motion means work: the balance moves while Fairsquare works and settles on the real answer, the stamp
 * lands because a comparison exists, controls answer presses. Nothing else moves.
 */

/** Durations in ms, mirroring the CSS tokens in globals.css. */
export const DURATION = { press: 80, fast: 140, base: 200, set: 220, sheet: 280, sheetExit: 180 } as const;

/** Cubic-bezier control points for motion/react (`ease: EASE_OUT`). */
export const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;
export const EASE_IN = [0.4, 0, 1, 1] as const;
/** CSS fallback curve for the beam's sway. */
export const EASE_SWAY = [0.37, 0, 0.63, 1] as const;

/** The stamp landing spring; used for the stamp only. */
export const STAMP_SPRING = { type: "spring", stiffness: 700, damping: 32, mass: 0.8 } as const;

/** The beam springs to the verdict angle (about 5% overshoot). */
export const BEAM_SETTLE = { stiffness: 260, damping: 20, mass: 1 } as const;
/** The left pan dips when the screenshot lands on it. */
export const BEAM_DIP = { stiffness: 220, damping: 16, mass: 1 } as const;
/** Desktop drag-over: the beam tips toward the left pan. */
export const BEAM_TIP = { stiffness: 300, damping: 22, mass: 1 } as const;
/** Sway amplitude changes (about 250ms, no overshoot). */
export const SWAY_AMP = { stiffness: 170, damping: 26 } as const;
/** One full sine cycle of the sway, in ms. */
export const SWAY_PERIOD = 2400;
/** A middle caption shows only if its request is still pending after this long (ms). */
export const SHOW_AFTER = 300;
/** Shortest time from read/done to the settle, so the read figures are seen (ms). */
export const READ_HOLD = 400;
/** From the settle start to the stamp at rest (ms). */
export const SETTLE_MAX = 900;
/** The beam angle while an image is dragged over the window (degrees; the left pan goes down). */
export const DRAG_TIP_DEG = -2.5;

/** True when the person asked the OS for reduced motion (false on the server). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Scrolls an element into view, honouring reduced motion: `behavior: "auto"` when the person
 * prefers reduced motion, otherwise the requested behaviour (default "smooth"). A null element
 * or an environment without scrollIntoView (jsdom) is a no-op.
 */
export function scrollIntoViewSafe(el: Element | null, opts?: ScrollIntoViewOptions): void {
  if (!el || typeof (el as HTMLElement).scrollIntoView !== "function") return;
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : (opts?.behavior ?? "smooth");
  el.scrollIntoView({ block: "nearest", ...opts, behavior });
}
