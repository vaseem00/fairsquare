/**
 * The gap sentence (RESULT_SPEC sections 3 and 6): AED per sq ft first, then the % (in line only; the
 * headline carries it otherwise), then the count framing. Newsreader type-lead (18/1.5 on phones,
 * 20/30 from 1024px), ink. "The asking price is AED 25 per sq ft above the median (1.4%), and higher
 * than 25 of the 43 sales." The count matches the dots left (or right) of the pin exactly.
 */
import { keepFiguresTogether } from "@/lib/format";
import type { ScaleModel } from "@/lib/result/scale-model";
import { gapText } from "@/lib/result/words";
import { cn } from "@/lib/utils";

export function GapSentence({ model, className }: { model: ScaleModel; className?: string }) {
  return (
    <p className={cn("type-lead max-w-[52ch] text-foreground", className)} data-slot="gap-sentence" data-kind={model.gap.kind}>
      {keepFiguresTogether(gapText(model))}
    </p>
  );
}
