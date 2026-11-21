"use client";

/**
 * The beam's motion (docs/REDESIGN.md sections 5 and 7.3): one angle motion value made of a base
 * angle, a sway amplitude and a sine of time.
 * - The base springs to its stage's angle: the screenshot landing dips the left pan (BEAM_DIP), the
 *   drag-over tips it (BEAM_TIP), the verdict settles it (BEAM_SETTLE); questions and failures ease it
 *   level in 240ms.
 * - The amplitude falls with each stage (reading 1.6°, found 1.0°, finding 0.8°, weighing 0.6°) on
 *   SWAY_AMP, and is 0 everywhere else.
 * - The time source is a requestAnimationFrame loop that runs only while the beam sways (and until
 *   the amplitude has died away): the home page at rest runs no loop.
 * Imperative motion ignores MotionConfig, so the caller mounts `useStillBeam` under reduced motion:
 * no loop, no springs, the beam level (or tipped at once on a drag-over).
 */
import { animate, useMotionValue, useTransform, type AnimationPlaybackControls, type MotionValue } from "motion/react";
import { useEffect, useRef } from "react";
import type { SceneStage } from "@/lib/flow/scene-stage";
import { BEAM_DIP, BEAM_SETTLE, BEAM_TIP, DRAG_TIP_DEG, EASE_OUT, SWAY_AMP, SWAY_PERIOD } from "@/lib/motion";

/** Sway amplitude by stage, in degrees (0 when not listed). */
export const SWAY_AMPLITUDE: Partial<Record<SceneStage, number>> = {
  placing: 1.6,
  reading: 1.6,
  found: 1.0,
  finding: 0.8,
  weighing: 0.6,
};
/** The base angle while working: the screenshot rests the left pan slightly low. */
export const WORKING_BASE = -0.6;
/** The initial velocity (degrees per second) that makes the landing dip to about −3°. */
const DIP_VELOCITY = -34;

export type BeamMove = "tip" | "dip" | "sway" | "level" | "settle";

export interface BeamTarget {
  base: number;
  amp: number;
  move: BeamMove;
}

/** The beam's target for a stage: its base angle, its sway and how it gets there. */
export function beamTarget(stage: SceneStage, verdictAngle: number | null, dragging: boolean): BeamTarget {
  if (stage === "rest") return { base: dragging ? DRAG_TIP_DEG : 0, amp: 0, move: "tip" };
  if (stage === "settling") return { base: verdictAngle ?? 0, amp: 0, move: "settle" };
  if (stage === "asking" || stage === "failed" || stage === "partial") return { base: 0, amp: 0, move: "level" };
  return { base: WORKING_BASE, amp: SWAY_AMPLITUDE[stage] ?? 0, move: stage === "placing" ? "dip" : "sway" };
}

export function useSwayingBeam(target: BeamTarget): MotionValue<number> {
  const base = useMotionValue(0);
  const amp = useMotionValue(0);
  const time = useMotionValue(0);
  const angle = useTransform(() => base.get() + amp.get() * Math.sin((time.get() / SWAY_PERIOD) * 2 * Math.PI));

  // The base: a spring (or a 240ms ease to level) toward the stage's angle. Arriving at the working
  // angle from anywhere else is the landing: it starts with a downward velocity, so the pan dips.
  const moveRef = useRef(target.move);
  useEffect(() => {
    moveRef.current = target.move;
  });
  const lastBase = useRef(0);
  useEffect(() => {
    const from = lastBase.current;
    lastBase.current = target.base;
    const move = moveRef.current;
    let c: AnimationPlaybackControls;
    if (target.base === WORKING_BASE && from !== WORKING_BASE) {
      c = animate(base, WORKING_BASE, { type: "spring", ...BEAM_DIP, velocity: DIP_VELOCITY });
    } else if (move === "level") {
      c = animate(base, target.base, { duration: 0.24, ease: [...EASE_OUT] });
    } else {
      c = animate(base, target.base, { type: "spring", ...(move === "tip" ? BEAM_TIP : BEAM_SETTLE) });
    }
    return () => c.stop();
  }, [target.base, base]);

  // The amplitude: no overshoot, about 250ms.
  useEffect(() => {
    const c = animate(amp, target.amp, { type: "spring", ...SWAY_AMP });
    return () => c.stop();
  }, [target.amp, amp]);

  // The time source, only while swaying (and until the amplitude has died away).
  const swaying = target.amp > 0;
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
    let raf = 0;
    const start = performance.now() - time.get();
    const tick = (now: number) => {
      time.set(now - start);
      if (!swaying && Math.abs(amp.get()) < 0.01) return;
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [swaying, amp, time]);

  return angle;
}

/** Reduced motion: no time source and no springs; level, or tipped at once while a file is dragged over. */
export function useStillBeam(angleDeg: number): MotionValue<number> {
  const angle = useMotionValue(angleDeg);
  useEffect(() => {
    angle.jump(angleDeg);
  }, [angle, angleDeg]);
  return angle;
}
