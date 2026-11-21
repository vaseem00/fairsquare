/**
 * One layout for every flow screen (docs/REDESIGN.md section 7.1, RESULT_SPEC section 2.1): home,
 * the scene, the questions, the form and the result. Seven slots, each a direct grid child, so the
 * order differs by width with no second copy of anything:
 *
 *   phone:   notices, head, fact, stage, chart, below, rest (one column)
 *   desktop: notices, head, fact, chart and below in columns 1 to 6; the stage in columns 7 to 12,
 *            sticky under the header, beside them; `rest` under both across all 12 columns
 *            (`restWide`, the result) or in columns 1 to 6 beside the stage (home)
 *   DOM:     notices, head, fact, chart, below, stage, rest: the reading and tab order of the result
 *            is the verdict, the fact line, the chart and the sentences, then the share card preview
 *            and its actions (RESULT_SPEC 3.1). Phones put the stage back under the fact line with
 *            `order`; the balance in it is aria-hidden, so nothing is read out of place.
 *
 * The stage cell is the same element from home to the result, so the balance inside it keeps its
 * motion values. `stagePhone: "hide"` hides it below 1024px with `hidden` (still mounted): the phone
 * home, a question, the form and a settled result. `"collapse"` keeps it on screen with no top margin
 * while a result settles: the stage closes its own height (flow-stage.tsx) and the chart under it
 * takes its place.
 * The head reserves 88px on phones (two lines of the verdict, or of any scene caption) so a caption
 * and the verdict swap without moving anything; during the scene it reserves 96px on desktop too. The
 * fact slot reserves 44px on phones and 48px on desktop from the first frame of the scene
 * (`reserveFact`), so nothing below it moves when the read arrives. Empty cells take no space.
 */
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

export interface FlowLayoutProps {
  notices?: ReactNode;
  head: ReactNode;
  /** The fact line (or, while reading, the slow note in its place). */
  fact?: ReactNode;
  stage: ReactNode;
  /** The market scale (or the tally) on the result. */
  chart?: ReactNode;
  below?: ReactNode;
  rest?: ReactNode;
  stagePhone: "show" | "hide" | "collapse";
  /** Reserve the head's two lines on phones (the scene and the result), and on desktop too ("scene"). */
  reserveHead?: false | "phone" | "scene";
  /** Reserve the fact slot from the first frame (the scene, the questions and the result). */
  reserveFact?: boolean;
  /** `rest` spans all 12 columns under the stage (the result's level 2); else columns 1 to 6. */
  restWide?: boolean;
  /**
   * A phone stage collapsing (not covered, while the settle runs): the head's reserved lines close
   * over the same time as the stage instead of snapping shut when the settle ends.
   */
  headCollapse?: boolean;
  /** The scene is working (aria-busy on the head and stage). */
  busy?: boolean;
  mode: string;
  headRef?: Ref<HTMLDivElement>;
  className?: string;
}

export function FlowLayout({
  notices,
  head,
  fact,
  stage,
  chart,
  below,
  rest,
  stagePhone,
  reserveHead = false,
  reserveFact = false,
  restWide = false,
  headCollapse = false,
  busy = false,
  mode,
  headRef,
  className,
}: FlowLayoutProps) {
  return (
    <div
      data-slot="flow-layout"
      data-mode={mode}
      aria-busy={busy || undefined}
      className={cn("grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[auto_auto_auto_auto_auto_1fr_auto] lg:gap-x-6", className)}
    >
      <div data-slot="flow-notices" className="flex min-w-0 flex-col gap-3 empty:hidden lg:col-span-6 lg:row-start-1 [&:not(:empty)]:mb-6">
        {notices}
      </div>
      <div
        ref={headRef}
        data-slot="flow-head"
        className={cn(
          "relative min-w-0 lg:col-span-6 lg:row-start-2",
          reserveHead && "min-h-[88px]",
          reserveHead === "scene" ? "lg:min-h-[96px]" : "lg:min-h-0",
          // min-height animates from 88px to 0px (not to `auto`, which does not interpolate).
          headCollapse && "max-lg:min-h-0 max-lg:transition-[min-height] max-lg:delay-[440ms] max-lg:duration-160 max-lg:ease-out",
        )}
      >
        {head}
      </div>
      <div
        data-slot="flow-fact"
        className={cn(
          "min-w-0 lg:col-span-6 lg:col-start-1 lg:row-start-3",
          reserveFact ? "mt-2 min-h-11 lg:mt-4 lg:min-h-12" : "empty:hidden mt-2 lg:mt-4",
        )}
      >
        {fact}
      </div>
      <div data-slot="flow-chart" className="mt-5 min-w-0 empty:hidden max-lg:order-2 lg:col-span-6 lg:col-start-1 lg:row-start-4 lg:mt-6">
        {chart}
      </div>
      <div data-slot="flow-below" className="min-w-0 empty:hidden max-lg:order-3 lg:col-span-6 lg:col-start-1 lg:row-start-5">
        {below}
      </div>
      {/* After `below` in the DOM, so the reading and tab order is the sentences first, then the card
          preview and its actions (RESULT_SPEC 3.1); phones show it between the fact and the chart
          (order), desktop beside them (explicit placement). Its content there is aria-hidden or text. */}
      <div
        data-slot="flow-stage"
        className={cn(
          "min-w-0 max-lg:order-1 lg:col-span-6 lg:col-start-7 lg:row-span-6 lg:row-start-1 lg:block",
          stagePhone === "show" ? "mt-5 lg:mt-0" : stagePhone === "collapse" ? "lg:mt-0" : "hidden",
        )}
      >
        <div className="lg:sticky lg:top-[calc(var(--header-h)+32px)]">{stage}</div>
      </div>
      <div
        data-slot="flow-rest"
        className={cn(
          "min-w-0 empty:hidden max-lg:order-4",
          restWide ? "lg:col-span-12 lg:col-start-1 lg:row-start-7" : "lg:col-span-6 lg:col-start-1 lg:row-start-6",
        )}
      >
        {rest}
      </div>
    </div>
  );
}
