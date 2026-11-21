"use client";

/**
 * The processing scene's words (docs/REDESIGN.md sections 7.3 and 7.6). The balance draws in the stage
 * cell (flow-stage.tsx); these fill the head and below slots.
 * - `SceneCaption`: one serif caption per real stage ("Reading the listing", "Finding the building",
 *   "Weighing it against registered sales in {building}"), an h2 that takes focus when the scene
 *   starts, with Stop as a text button on its right while reading. A new caption crossfades (200ms).
 *   Under reduced motion one more sentence explains the wait in words.
 * - `ReadSlowNote`: "Still reading" at 8s with "Type the details instead", in the fact slot (RESULT_SPEC
 *   section 2.3: the fact line takes that slot once the read is in).
 * - `SceneWaiting`: the status line under the balance (the DLD building as DLD names it, then the sales
 *   being weighed), and "Still comparing." at 4s with its way out.
 * - `SceneFailure` / `FailureActions`: the cause as a short serif heading (focus moves to it), an
 *   optional detail line, then the ways forward: primary, outline, text. `extract_busy` counts down
 *   "Try again in 24 s" (aria-disabled until then, announced once when it is ready).
 * Captions and failures are announced by the flow (the layout's polite live region), not here.
 */
import { AnimatePresence, motion, useIsPresent, useReducedMotionConfig } from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { useAnnounce } from "@/components/a11y/live-region";
import { noBreakBeds } from "@/components/result/no-break";
import { usePublicConfig } from "@/components/shell/config-provider";
import { Button } from "@/components/ui/button";
import type { ReadAction, ReadFailure } from "@/hooks/use-check-flow";
import { COPY, readSlowText, t } from "@/lib/copy";
import { keepFiguresTogether } from "@/lib/format";
import { EASE_IN, EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

function CaptionText({ text, reduce }: { text: string; reduce: boolean }) {
  const present = useIsPresent();
  return (
    <motion.span
      className="col-start-1 row-start-1 block"
      aria-hidden={present ? undefined : true}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transition: { duration: 0.2, ease: [...EASE_IN] } }}
      transition={{ duration: 0.2, ease: [...EASE_OUT] }}
    >
      {text}
    </motion.span>
  );
}

export function SceneCaption({
  caption,
  headingRef,
  onStop,
  hint,
}: {
  caption: string;
  headingRef: Ref<HTMLHeadingElement>;
  /** Stop, while reading. */
  onStop?: () => void;
  /** The reduced-motion sentence under the caption. */
  hint?: string | null;
}) {
  const reduce = useReducedMotionConfig() === true;
  return (
    <div data-slot="scene-head">
      <div className="flex items-start justify-between gap-4">
        {/* Captions crossfade in one grid cell (200ms); the outgoing one is hidden from screen readers. */}
        <h2 ref={headingRef} tabIndex={-1} data-scene-caption="" className="type-display-md grid min-w-0 text-foreground outline-none">
          <AnimatePresence initial={false}>
            <CaptionText key={caption} text={caption} reduce={reduce} />
          </AnimatePresence>
        </h2>
        {onStop ? (
          <Button type="button" variant="link" onClick={onStop} className="shrink-0" data-slot="scene-stop">
            {COPY["read.stop"]}
          </Button>
        ) : null}
      </div>
      {hint ? <p className="mt-2 type-lead text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A line that fades in (200ms) when it appears. */
function Arrives({ children, className, "data-slot": slot }: { children: ReactNode; className?: string; "data-slot"?: string }) {
  const reduce = useReducedMotionConfig() === true;
  return (
    <motion.div className={className} data-slot={slot} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      {children}
    </motion.div>
  );
}

/** A slow line in pencil and its way forward: "Type the details instead". */
function SlowLine({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <Arrives className="flex flex-col items-start gap-1">
      <p className="type-lead text-muted-foreground" data-slot="scene-slow">
        {text}
      </p>
      <Button type="button" variant="link" onClick={onAction} data-slot="scene-slow-action">
        {action}
      </Button>
    </Arrives>
  );
}

/**
 * "Still reading. This usually takes about 9 seconds." (the measured median read time, once 50 reads
 * exist; "This can take up to 20 seconds." until then) and "Type the details instead", in the fact slot.
 */
export function ReadSlowNote({ onTypeInstead }: { onTypeInstead: () => void }) {
  const { readP50Sec } = usePublicConfig();
  return (
    <Arrives className="flex flex-col items-start" data-slot="scene-slow-read">
      <p className="text-[15px] leading-[22px] text-muted-foreground lg:text-base lg:leading-6" data-slot="scene-slow">
        {readSlowText(readP50Sec)}
      </p>
      <Button type="button" variant="link" onClick={onTypeInstead} className="-ml-0.5 h-auto min-h-11 px-0.5" data-slot="scene-slow-action">
        {COPY["read.typeInstead"]}
      </Button>
    </Arrives>
  );
}

export function SceneWaiting({
  status,
  slowMatch = false,
  slowCompare,
  onEditInstead,
}: {
  /** The status line under the balance ("In DLD records as ...", "43 registered sales of ..."). */
  status: string | null;
  /** "Still finding the building." (a building match pending for 4 s). */
  slowMatch?: boolean;
  slowCompare: boolean;
  /** While matching or comparing: the form with everything known. */
  onEditInstead: () => void;
}) {
  return (
    <div className="flex min-h-10 flex-col gap-4 pt-2 lg:pt-4" data-slot="scene-below">
      {status ? (
        <Arrives>
          <p className="max-w-[52ch] text-[14px] leading-5 text-muted-foreground num" data-slot="scene-status">
            {noBreakBeds(keepFiguresTogether(status))}
          </p>
        </Arrives>
      ) : null}
      {slowMatch ? <SlowLine text={COPY["scene.slowMatch"]} action={COPY["read.typeInstead"]} onAction={onEditInstead} /> : null}
      {slowCompare ? <SlowLine text={COPY["scene.slowCompare"]} action={COPY["read.typeInstead"]} onAction={onEditInstead} /> : null}
    </div>
  );
}

/** Whole seconds until `retryAt` (0 when it has passed). */
export function secondsUntil(retryAt: number | null, now: number): number {
  return retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1000));
}

/** Ticks once a second until `retryAt`, then stays at 0. */
function useCountdown(retryAt: number | null): number {
  const [left, setLeft] = useState(() => secondsUntil(retryAt, Date.now()));
  useEffect(() => {
    if (retryAt === null) return;
    const tick = () => setLeft(secondsUntil(retryAt, Date.now()));
    const first = setTimeout(tick, 0);
    const id = setInterval(() => {
      tick();
      if (Date.now() >= retryAt) clearInterval(id);
    }, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [retryAt]);
  return retryAt === null ? 0 : left;
}

export function SceneFailure({
  title,
  detail,
  headingRef,
}: {
  title: string;
  detail: string | null;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  return (
    <div data-slot="scene-failure">
      <h2 ref={headingRef} tabIndex={-1} data-scene-caption="" className="type-display-md max-w-[18ch] text-foreground outline-none">
        {title}
      </h2>
      {detail ? <p className="mt-3 type-lead max-w-[52ch] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

const ACTION_LABEL: Record<ReadAction, string> = {
  retry: COPY["alert.tryAgain"],
  type: COPY["home.type"],
  another: COPY["alert.tryAnother"],
  edit: COPY["result.editDetails"],
};

export function FailureActions({ failure, handlers }: { failure: ReadFailure; handlers: Record<ReadAction, (() => void) | null> }) {
  const announce = useAnnounce();
  const wait = useCountdown(failure.retryAt);
  const waitedRef = useRef(wait > 0);
  useEffect(() => {
    if (wait > 0) waitedRef.current = true;
    else if (waitedRef.current) {
      // The countdown is not read out each second: one announcement when Try again is ready.
      waitedRef.current = false;
      announce(COPY["alert.tryAgain"]);
    }
  }, [wait, announce]);

  const actions = failure.actions.filter((a) => handlers[a] !== null);
  return (
    <div className="flex flex-col gap-6 pt-6" data-slot="failure-actions">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {actions.map((a, i) => {
          const waiting = a === "retry" && wait > 0;
          // Primary ink, then outline, then a text button.
          const variant = i === 0 ? "default" : i === 1 ? "outline" : "link";
          return (
            <Button
              key={a}
              type="button"
              size={variant === "link" ? "default" : "lg"}
              variant={variant}
              aria-disabled={waiting || undefined}
              onClick={() => {
                if (!waiting) handlers[a]?.();
              }}
              className={cn(variant !== "link" && "sm:w-auto")}
              data-action={a}
            >
              <span className="num">{waiting ? t("rate.retryIn", { n: wait }) : ACTION_LABEL[a]}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** The partial read: [Type the details] (the form, filled with what was read) and [Try another screenshot]. */
export function PartialActions({ onType, onAnother }: { onType: () => void; onAnother: (() => void) | null }) {
  return (
    <div className="flex flex-col gap-6 pt-6" data-slot="failure-actions">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Button type="button" size="lg" onClick={onType}>
          {COPY["home.type"]}
        </Button>
        {onAnother ? (
          <Button type="button" size="lg" variant="outline" onClick={onAnother}>
            {COPY["alert.tryAnother"]}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
