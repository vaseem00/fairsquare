/**
 * The recent-sales line (RESULT_SPEC sections 3.1 and 6.1): shown only when the last 90 days hold 5
 * or more sales whose median differs from the 12-month median by more than 5%. Archivo 15/22 (16/24
 * from 1024px), ink, behind a 2px ink rule, with the filled-dot glyph the scale uses for those sales.
 * "Recent sales are lower. The 11 since 18 Aug have a median of AED 1,602 per sq ft. This asking price
 * is higher than 9 of them." The verdict keeps its 12-month rule (owner decision, 18 Nov 2026).
 */
import { keepFiguresTogether } from "@/lib/format";
import type { ScaleModel } from "@/lib/result/scale-model";
import { recentText } from "@/lib/result/words";
import { cn } from "@/lib/utils";

export function RecentLine({ model, className }: { model: ScaleModel; className?: string }) {
  const text = recentText(model);
  if (!text) return null;
  return (
    <p
      className={cn("max-w-[60ch] border-l-2 border-foreground pl-3 text-[15px] leading-[22px] text-foreground num lg:text-base lg:leading-6", className)}
      data-slot="recent-line"
      data-direction={model.recent.direction ?? undefined}
    >
      <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true" className="mr-1.5 inline-block align-[1px]">
        <circle cx={4} cy={4} r={3.5} fill="var(--chart-3)" />
      </svg>
      {keepFiguresTogether(text)}
    </p>
  );
}
