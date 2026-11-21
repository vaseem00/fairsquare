"use client";

/**
 * The fact line (RESULT_SPEC section 2.4): what was read, in one stable slot from the scene to the
 * result, so it never moves.
 *
 *   Aykon City Tower C, Business Bay.
 *   Ready 2-bed, 812 sq ft, AED 1,450,000.  Edit
 *
 * A sentence, not fields: no labels and no blanks. What is not known yet is left out (a question shows
 * only what it has). Archivo 15/22 on phones and 16/24 from 1024px, ink, tabular figures; the building
 * line is 500. In the scene (`ink`) each new figure sets in bottom-up (220ms, 60ms apart) with a 1px
 * ink underline that dries 760ms later; under reduced motion it renders whole with no underline. On
 * the result, Edit (a `<button>` named "Edit the details") follows line 2 and fades in at 640ms of the
 * settle. Its text is plain: screen readers read it as written.
 */
import { motion, useReducedMotionConfig } from "motion/react";
import type { Ref } from "react";
import { noBreakBeds } from "@/components/result/no-break";
import { SETTLE_AT, SettleIn } from "@/components/scene/use-settle";
import { COPY } from "@/lib/copy";
import { EASE_OUT } from "@/lib/motion";
import { factLines, type FactPart, type FactValues } from "@/lib/result/words";
import { cn } from "@/lib/utils";

function Figure({ part, index, ink, animated }: { part: FactPart; index: number; ink: boolean; animated: boolean }) {
  const cls = cn(ink && animated && "read-ink");
  if (!animated) return <span className={cls}>{part.text}</span>;
  // The building may wrap, so it only fades in; the numbers reveal bottom-up.
  const wraps = part.figure === "building";
  return (
    <motion.span
      key={part.text}
      className={cn(cls, wraps ? "inline" : "inline-block")}
      data-slot="fact-figure"
      initial={wraps ? { opacity: 0 } : { clipPath: "inset(100% 0 0 0)" }}
      animate={wraps ? { opacity: 1 } : { clipPath: "inset(0% 0 0 0)" }}
      transition={{ duration: 0.22, delay: Math.min(0.18, index * 0.06), ease: [...EASE_OUT] }}
    >
      {part.text}
    </motion.span>
  );
}

function Line({
  parts,
  ink,
  animated,
  start,
  only,
}: {
  parts: FactPart[];
  ink: boolean;
  animated: boolean;
  start: number;
  only?: FactPart["figure"];
}) {
  let n = start;
  return (
    <>
      {parts.map((p, i) =>
        p.figure ? (
          <Figure
            key={`${p.figure}:${p.text}`}
            part={p}
            index={only ? 0 : n++}
            ink={ink && (!only || p.figure === only)}
            animated={animated && (!only || p.figure === only)}
          />
        ) : (
          <span key={`t${i}`}>{noBreakBeds(p.text)}</span>
        ),
      )}
    </>
  );
}

export function FactLine({
  values,
  onEdit,
  editRef,
  ink = false,
  only,
  className,
}: {
  values: FactValues;
  /** The result's Edit. Without it the line is in the scene or a question. */
  onEdit?: () => void;
  editRef?: Ref<HTMLButtonElement>;
  /** The set-in: new figures reveal and carry a drying underline (the scene; a result being changed). */
  ink?: boolean;
  /** Only this figure sets in (the value just changed in the Change a detail sheet). */
  only?: FactPart["figure"];
  className?: string;
}) {
  const reduce = useReducedMotionConfig() === true;
  const animated = ink && !reduce;
  const { line1, line2 } = factLines(values);
  if (!line1 && !line2) return null;
  return (
    <p className={cn("max-w-[52ch] text-[15px] leading-[22px] text-foreground num lg:text-base lg:leading-6", className)} data-slot="fact-line">
      {line1 ? (
        <span className="font-medium" data-slot="fact-line1">
          <Line parts={line1} ink={ink} animated={animated} start={0} only={only} />
        </span>
      ) : null}
      {/* A space before the break, so the text reads as two sentences when copied or read aloud. */}
      {line1 && line2 ? (
        <>
          {" "}
          <br />
        </>
      ) : null}
      {line2 ? (
        <span data-slot="fact-line2">
          <Line parts={line2} ink={ink} animated={animated} start={1} only={only} />
        </span>
      ) : null}
      {onEdit ? (
        <>
          {"  "}
          <SettleIn at={SETTLE_AT.edit} as="span" className="inline">
            <button
              ref={editRef}
              type="button"
              onClick={onEdit}
              aria-label={COPY["fact.editSr"]}
              data-slot="fact-edit"
              className="relative rounded-sm font-medium whitespace-nowrap text-foreground underline decoration-1 underline-offset-4 outline-none after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {COPY["fact.edit"]}
            </button>
          </SettleIn>
        </>
      ) : null}
    </p>
  );
}
