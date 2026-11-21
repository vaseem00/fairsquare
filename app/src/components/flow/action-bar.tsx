"use client";

/**
 * The step's primary actions (DESIGN.md sections 2.3 and 3.0).
 * Below 1024px it is a sticky bottom bar: 72px plus the safe-area inset, opaque background, a 1px
 * top border, no shadow, 16px side padding. From 1024px it renders inline.
 * While mounted it sets `data-action-bar` on <html>, which turns on `--action-bar-h: 72px` and with
 * it the scroll padding, so a focused field is never hidden behind the bar.
 */
import { useLayoutEffect, useEffect, type ReactNode } from "react";
import { useSettleEntering, useSettleShift } from "@/components/scene/use-settle";
import { cn } from "@/lib/utils";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** How many ActionBars are mounted (a hidden route kept by <Activity> unmounts its effects). */
let mounted = 0;

function attach(tall = false): () => void {
  const html = document.documentElement;
  mounted += 1;
  // "tall": a bar with a note above its actions (124px), so the page and scroll padding make room.
  if (tall || html.getAttribute("data-action-bar") !== "tall") html.setAttribute("data-action-bar", tall ? "tall" : "");
  return () => {
    mounted = Math.max(0, mounted - 1);
    if (mounted === 0) html.removeAttribute("data-action-bar");
  };
}

export function ActionBar({
  children,
  className,
  note,
}: {
  children: ReactNode;
  /** Applies to the row of actions. */
  className?: string;
  /** A one-line note above the actions inside the bar (the too-few result's "New sales ... under Saved"). */
  note?: ReactNode;
}) {
  const tall = Boolean(note);
  useIsoLayoutEffect(() => attach(tall), [tall]);
  // At the settle the phone bar slides up (translateY 100% to 0, 240ms from 640ms, RESULT_SPEC 2.7);
  // a re-settle after an edit leaves it where it is.
  const entering = useSettleEntering();
  const shift = useSettleShift();
  const slide = entering && shift === 0;
  if (note) {
    return (
      <div
        data-slot="action-bar"
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2 border-t border-border bg-background px-4 pt-2.5 pb-[calc(12px+env(safe-area-inset-bottom))]",
          "lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0",
          slide && "max-lg:animate-[mz-bar-up_240ms_var(--ease-out)_640ms_both]",
        )}
      >
        <p className="text-caption text-muted-foreground">{note}</p>
        <div className={cn("flex items-center gap-3 [&>*]:min-h-12 [&>*]:flex-1 lg:[&>*]:min-h-10 lg:[&>*]:flex-none", className)}>{children}</div>
      </div>
    );
  }
  return (
    <div
      data-slot="action-bar"
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 flex min-h-[calc(72px+env(safe-area-inset-bottom))] items-center gap-3 border-t border-border bg-background px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]",
        "[&>*]:min-h-12 [&>*]:flex-1",
        "lg:static lg:z-auto lg:min-h-0 lg:border-0 lg:bg-transparent lg:p-0 lg:[&>*]:min-h-10 lg:[&>*]:flex-none",
        slide && "max-lg:animate-[mz-bar-up_240ms_var(--ease-out)_640ms_both]",
        className,
      )}
    >
      {children}
    </div>
  );
}
