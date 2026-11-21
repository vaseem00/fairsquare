"use client";

/**
 * The settle (RESULT_SPEC section 2.7): at most 900ms from the moment the comparison is in hand.
 * At t = 0 the whole result is in the DOM (focus, the announcement and the URL do not wait); what
 * moves is only opacity and a few pixels:
 *
 *   0–380   the beam springs to the verdict angle (use-balance), dots are reconciled
 *   340–480 the caption fades out, the verdict heading fades in (y 6 to 0); the status line and the balance fade out
 *   440–600 phones: the stage collapses (448 to 0) and the market scale takes its place; desktop: the card preview crossfades in
 *   560–760 the axis draws out from the median, the zone and the fulcrum fade in
 *   600–800 the dots drop 12px and fade in, columns left to right
 *   640–900 the ASKING stamp lands on its pin (the Stamp spring), the 1.5px impact at about 740
 *   640–880 Edit fades in on the fact line; the phone bar slides up
 *   700–900 the legend, the sentences, the evidence line and level 2 fade in
 *
 * `useSettle(key)` runs once per result key and is over after SETTLE_MAX, or at once on the first tap,
 * key, wheel or touch (`listenOnce`): every piece then jumps to its final frame (the fades are motion
 * values that are stopped and set, not animations left to finish on their schedule). Under reduced
 * motion, and for a result reached by Back or Forward, it never runs: the final frame renders at once.
 * `SettleIn` is the fade every piece uses; `useSettleRunning()` reads the state.
 *
 * The re-settle (RESULT_SPEC section 7, after a Change a detail edit) runs the same schedule with no
 * balance and no stage: `SettleProvider shift` moves every piece RESETTLE_SHIFT earlier, the axis keeps
 * its place, and only what remounts with the new comparison (the verdict, the scale's dots and stamp,
 * the sentences) plays.
 */
import { animate, motion, useMotionValue } from "motion/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EASE_IN, EASE_OUT, SETTLE_MAX } from "@/lib/motion";
import { INTERRUPT_EVENTS, listenOnce } from "@/lib/use-interrupt";

/** When each piece starts, in seconds from t = 0. */
export const SETTLE_AT = {
  captionOut: 0.34,
  verdictIn: 0.36,
  balanceOut: 0.34,
  /** Desktop: the card preview (or the screenshot) crossfades in where the balance was. */
  sheetIn: 0.44,
  /** Phones: the stage collapses after the balance has faded, and the market scale takes its place. */
  collapse: 0.44,
  /** The scale's axis draws out from the median; the zone, the fulcrum and the labels fade in. */
  axis: 0.56,
  /** The dots drop, columns left to right. */
  dots: 0.6,
  /** The ASKING stamp lands on its pin. */
  stamp: 0.64,
  edit: 0.64,
  rest: 0.7,
} as const;

/** The re-settle skips the balance's part of the schedule: every piece starts this much earlier (seconds). */
export const RESETTLE_SHIFT = 0.3;

const SettleContext = createContext({ running: false, shift: 0 });

/** True while the settle of `key` runs (null: no settle). */
export function useSettle(key: string | null): boolean {
  const [done, setDone] = useState<string | null>(null);
  const running = key !== null && done !== key;
  useEffect(() => {
    if (!running || key === null) return;
    const finish = () => setDone(key);
    const timer = window.setTimeout(finish, SETTLE_MAX + 60);
    const off = listenOnce(INTERRUPT_EVENTS, finish);
    return () => {
      window.clearTimeout(timer);
      off();
    };
  }, [running, key]);
  return running;
}

export function SettleProvider({ running, shift = 0, children }: { running: boolean; shift?: number; children: ReactNode }) {
  const value = useMemo(() => ({ running, shift }), [running, shift]);
  return <SettleContext.Provider value={value}>{children}</SettleContext.Provider>;
}

export function useSettleRunning(): boolean {
  return useContext(SettleContext).running;
}

/** How much earlier every piece starts: RESETTLE_SHIFT during a re-settle, else 0. */
export function useSettleShift(): number {
  return useContext(SettleContext).shift;
}

/** A schedule time (SETTLE_AT) moved by the re-settle's shift, never below 0. */
export function useSettleAt(): (at: number) => number {
  const shift = useSettleShift();
  return (at: number) => Math.max(0, at - shift);
}

/**
 * True while the settle runs for a piece that mounted with it: its CSS animations play. A piece that
 * was already on screen stays as it is, and the moment the settle ends (or an interrupt ends it) this
 * turns false, so the caller drops its animations and shows the final frame.
 */
export function useSettleEntering(): boolean {
  const running = useSettleRunning();
  const [mountedRunning] = useState(running);
  return running && mountedRunning;
}

/** An inline CSS animation for a settle piece (`at` in seconds), or nothing when it does not play. */
export function settleAnimation(play: boolean, name: string, at: number, durationMs: number, ease = "var(--ease-out)"): { animation: string } | undefined {
  return play ? { animation: `${name} ${durationMs}ms ${ease} ${Math.round(at * 1000)}ms both` } : undefined;
}

/**
 * Fades its content in at `at` seconds while the settle runs (opacity only by default; `y` adds a
 * small rise). Otherwise, and the moment an interrupt ends the settle, it shows the final frame: the
 * running animation is stopped and the values jump to 1 and 0. The element itself never remounts, so
 * focus inside it (the verdict heading takes focus at t = 0) is kept.
 */
export function SettleIn({
  at,
  duration = 0.2,
  y = 0,
  className,
  children,
  slot,
  as = "div",
}: {
  at: number;
  duration?: number;
  y?: number;
  className?: string;
  children: ReactNode;
  slot?: string;
  /** "span" inside a paragraph. */
  as?: "div" | "span";
}) {
  const running = useSettleRunning();
  const delay = Math.max(0, at - useSettleShift());
  // Only a piece that mounts with the settle fades in; one already on screen stays as it is.
  const fadesIn = useRef(running);
  const opacity = useMotionValue(running ? 0 : 1);
  const rise = useMotionValue(running ? y : 0);
  useEffect(() => {
    if (!running || !fadesIn.current) {
      fadesIn.current = false;
      opacity.jump(1);
      rise.jump(0);
      return;
    }
    const ease = [...EASE_OUT] as [number, number, number, number];
    const controls = [
      animate(opacity, 1, { delay, duration, ease }),
      ...(y ? [animate(rise, 0, { delay, duration, ease })] : []),
    ];
    return () => {
      for (const c of controls) c.stop();
    };
  }, [running, delay, duration, y, opacity, rise]);
  const Tag = as === "span" ? motion.span : motion.div;
  return (
    <Tag className={className} data-slot={slot} style={{ opacity, y: rise }}>
      {children}
    </Tag>
  );
}

/** The scene's last caption, fading out over the verdict while the settle runs (aria-hidden). */
export function SettleOut({ at, duration = 0.12, className, children }: { at: number; duration?: number; className?: string; children: ReactNode }) {
  const running = useSettleRunning();
  const delay = Math.max(0, at - useSettleShift());
  if (!running) return null;
  return (
    <motion.div
      aria-hidden="true"
      className={className}
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ delay, duration, ease: [...EASE_IN] }}
    >
      {children}
    </motion.div>
  );
}
