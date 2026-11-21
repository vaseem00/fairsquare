"use client";

/**
 * Interruptible motion (docs/REDESIGN.md section 5.4): any tap, key, wheel or touch during a landing
 * or the settle jumps to the final frame. Nothing waits for `animationend`.
 * - `scroll` is not listened to: every scroll a person starts begins with one of these events (a
 *   wheel, a touch, a key, or a pointerdown on the scrollbar), while the flow's own scroll of the
 *   result into view would otherwise skip the stamp landing it is meant to show.
 * - `listenOnce(events, fire)`: capture + passive + once listeners on window; `fire` runs on the first
 *   of them. Returns a cleanup that removes every listener.
 * - `useInterrupt(active, onInterrupt)`: the same as a hook, while `active`.
 */
import { useEffect, useRef } from "react";

export const INTERRUPT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
export type InterruptEvent = (typeof INTERRUPT_EVENTS)[number];

export function listenOnce(events: readonly InterruptEvent[], fire: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  let fired = false;
  const handler = () => {
    if (fired) return;
    fired = true;
    off();
    fire();
  };
  const off = () => {
    for (const e of events) window.removeEventListener(e, handler, { capture: true });
  };
  for (const e of events) window.addEventListener(e, handler, { passive: true, capture: true, once: true });
  return off;
}

export function useInterrupt(active: boolean, onInterrupt: () => void, events: readonly InterruptEvent[] = INTERRUPT_EVENTS): void {
  const cb = useRef(onInterrupt);
  useEffect(() => {
    cb.current = onInterrupt;
  });
  const key = events.join(",");
  useEffect(() => {
    if (!active) return;
    return listenOnce(key.split(",") as InterruptEvent[], () => cb.current());
  }, [active, key]);
}
