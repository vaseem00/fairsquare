"use client";

/**
 * The two label blocks under the balance's pans (docs/REDESIGN.md section 7.2): HTML, not SVG text,
 * so they stay 14px or more. Line 1 is the figure (Archivo 17/500, tabular, ink), line 2 the caption
 * (Archivo 14, pencil). The left one carries the indigo "this listing" diamond. They hang between the
 * pans (at their lowest tilt) and the stand's base, each narrower than the gap to the base, so a
 * caption never sits on the base line. They are aria-hidden:
 * the caption, the read line and the result carry the meaning. A changed label crossfades (160ms).
 */
import { AnimatePresence, motion } from "motion/react";
import { keepFiguresTogether } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface BalanceLabel {
  figure: string;
  caption: string;
}

function Label({ label, side, animated }: { label: BalanceLabel; side: "left" | "right"; animated: boolean }) {
  const body = (
    <>
      <span className="flex items-center justify-center gap-1.5 type-figure text-foreground">
        {side === "left" ? <span aria-hidden="true" className="inline-block size-2 shrink-0 rotate-45 bg-stamp" /> : null}
        {label.figure}
      </span>
      {/* "per sq ft" never splits across lines. */}
      <span className="text-caption leading-snug text-muted-foreground">{keepFiguresTogether(label.caption)}</span>
    </>
  );
  const cls = cn("absolute top-0 flex w-[32%] flex-col items-center text-center", side === "left" ? "left-0" : "right-0");
  if (!animated) {
    return (
      <div className={cls} data-slot={`label-${side}`}>
        {body}
      </div>
    );
  }
  return (
    <motion.div
      key={`${label.figure}|${label.caption}`}
      className={cls}
      data-slot={`label-${side}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      {body}
    </motion.div>
  );
}

export function BalanceLabels({
  left,
  right,
  animated = false,
}: {
  left: BalanceLabel | null;
  right: BalanceLabel | null;
  animated?: boolean;
}) {
  return (
    <div aria-hidden="true" data-slot="balance-labels" className="pointer-events-none absolute inset-x-0 top-[72%]">
      <AnimatePresence initial={false}>
        {left ? <Label key={`l${left.figure}|${left.caption}`} label={left} side="left" animated={animated} /> : null}
        {right ? <Label key={`r${right.figure}|${right.caption}`} label={right} side="right" animated={animated} /> : null}
      </AnimatePresence>
    </div>
  );
}
