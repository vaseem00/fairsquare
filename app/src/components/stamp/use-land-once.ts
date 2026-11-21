"use client";

/**
 * "The stamp lands once on the first view of a /c page" (DESIGN.md sections 2.6 and 3.5), once per
 * code per browser session (`sessionStorage`).
 *
 * - "ssr": server render and hydration. The markup carries the CSS landing (the D§2.6 CSS
 *   fallback curve), which plays on first paint without waiting for JavaScript.
 * - "land": this mount is the first view in the session: keep (or start) the CSS landing.
 * - "final": seen before in this session: render the final state.
 *
 * The decision is taken once per mount and never flips, so a landing already playing is never
 * cut short by a re-render.
 */
import { useRef, useSyncExternalStore } from "react";

export type LandPhase = "ssr" | "land" | "final";

const KEY = "mz:landed:";
const noopSubscribe = () => () => undefined;

function decide(code: string): Exclude<LandPhase, "ssr"> {
  try {
    const key = KEY + code;
    if (window.sessionStorage.getItem(key)) return "final";
    window.sessionStorage.setItem(key, "1");
    return "land";
  } catch {
    // Storage blocked (private mode, WhatsApp's in-app browser settings): land every time.
    return "land";
  }
}

export function useLandOnce(code: string, enabled: boolean): LandPhase {
  const decision = useRef<{ code: string; phase: Exclude<LandPhase, "ssr"> } | null>(null);
  return useSyncExternalStore(
    noopSubscribe,
    () => {
      if (!enabled) return "final";
      if (!decision.current || decision.current.code !== code) decision.current = { code, phase: decide(code) };
      return decision.current.phase;
    },
    () => (enabled ? "ssr" : "final"),
  );
}

/** Tests: forget what this session has seen. */
export function __resetLandedForTests(): void {
  try {
    for (const k of Object.keys(window.sessionStorage)) if (k.startsWith(KEY)) window.sessionStorage.removeItem(k);
  } catch {
    // ignore
  }
}
