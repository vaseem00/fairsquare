"use client";

/**
 * Persistent screen-reader announcements (DESIGN.md sections 3.0 and 7.2). The root layout mounts
 * <LiveRegion /> once; any client component calls `useAnnounce()(message)`.
 * A message is cleared first and set a moment later, so repeating the same words is still read.
 */
import { useCallback, useSyncExternalStore } from "react";

export type Politeness = "polite" | "assertive";

interface Messages {
  polite: string;
  assertive: string;
}

const EMPTY: Messages = { polite: "", assertive: "" };
let messages: Messages = EMPTY;
const listeners = new Set<() => void>();
const timers: Record<Politeness, ReturnType<typeof setTimeout> | null> = { polite: null, assertive: null };

/** Delay between clearing and setting, so assistive tech notices a repeated message. */
const SET_DELAY_MS = 60;

function emit(): void {
  for (const l of listeners) l();
}

function set(politeness: Politeness, value: string): void {
  messages = { ...messages, [politeness]: value };
  emit();
}

/** Announce outside React (for example from an event handler in a non-component module). */
export function announce(message: string, politeness: Politeness = "polite"): void {
  const pending = timers[politeness];
  if (pending) clearTimeout(pending);
  set(politeness, "");
  timers[politeness] = setTimeout(() => {
    timers[politeness] = null;
    set(politeness, message);
  }, SET_DELAY_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => messages;
const getServerSnapshot = () => EMPTY;

/** Returns `announce(message, politeness = "polite")`. */
export function useAnnounce(): (message: string, politeness?: Politeness) => void {
  return useCallback((message: string, politeness: Politeness = "polite") => announce(message, politeness), []);
}

/** One polite status region and one assertive region, both visually hidden. */
export function LiveRegion() {
  const m = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="live-polite">
        {m.polite}
      </div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only" data-testid="live-assertive">
        {m.assertive}
      </div>
    </>
  );
}

/** Tests: reset the store between cases. */
export function __resetAnnouncementsForTests(): void {
  for (const p of ["polite", "assertive"] as const) {
    const t = timers[p];
    if (t) clearTimeout(t);
    timers[p] = null;
  }
  messages = EMPTY;
  emit();
}
